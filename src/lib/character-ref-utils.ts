import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { CharacterReferenceLayout } from "@/lib/ai/prompts/registry-character";

const LAYOUT_GRID: Record<Exclude<CharacterReferenceLayout, "single">, { rows: number; cols: number }> = {
  "three-view": { rows: 1, cols: 3 },
  "four-view": { rows: 2, cols: 2 },
};

const CELL_MARGIN_RATIO = 0.05;
const MIN_CONTENT_DENSITY = 0.05;
// To override the requested layout, an alternative must beat it by this
// margin. Without this, ties between the requested grid and a similar
// alternative (e.g. 2x2 vs 4x1 when the silhouette sits in the top row)
// can flip the choice on noise.
const ALTERNATIVE_LAYOUT_ADVANTAGE = 0.1;

export interface CharacterReferencePortraitResult {
  portraitPath: string;
  sourceWidth: number;
  sourceHeight: number;
  cellWidth: number;
  cellHeight: number;
  detectedLayout: "horizontal" | "vertical" | "grid";
  contentDensity: number;
}

interface GridCandidate {
  rows: number;
  cols: number;
  label: "horizontal" | "vertical" | "grid";
}

function candidateLayouts(
  layout: Exclude<CharacterReferenceLayout, "single">,
): GridCandidate[] {
  const requested = LAYOUT_GRID[layout];
  const others: GridCandidate[] = [];
  if (layout === "four-view") {
    others.push({ rows: 1, cols: 4, label: "horizontal" });
    others.push({ rows: 1, cols: 3, label: "horizontal" });
    others.push({ rows: 4, cols: 1, label: "vertical" });
  } else {
    others.push({ rows: 1, cols: 4, label: "horizontal" });
    others.push({ rows: 4, cols: 1, label: "vertical" });
    others.push({ rows: 2, cols: 2, label: "grid" });
  }
  return [{ ...requested, label: "grid" }, ...others];
}

async function detectBackgroundColor(inputBuf: Buffer): Promise<{ r: number; g: number; b: number }> {
  const sample = await sharp(inputBuf)
    .extract({ left: 0, top: 0, width: 16, height: 16 })
    .removeAlpha()
    .raw()
    .toBuffer();
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < sample.length; i += 3) {
    r += sample[i];
    g += sample[i + 1];
    b += sample[i + 2];
    n++;
  }
  if (n === 0) return { r: 255, g: 255, b: 255 };
  return { r: r / n, g: g / n, b: b / n };
}

async function scoreContentDensity(
  inputBuf: Buffer,
  rows: number,
  cols: number,
  bg: { r: number; g: number; b: number },
): Promise<number> {
  const meta = await sharp(inputBuf).metadata();
  if (!meta.width || !meta.height) return 0;
  const cellW = Math.floor(meta.width / cols);
  const cellH = Math.floor(meta.height / rows);
  const marginX = Math.max(1, Math.floor(cellW * CELL_MARGIN_RATIO));
  const marginY = Math.max(1, Math.floor(cellH * CELL_MARGIN_RATIO));
  const left = marginX;
  const top = marginY;
  const width = cellW - 2 * marginX;
  const height = cellH - 2 * marginY;
  if (width <= 0 || height <= 0) return 0;

  const cellBuf = await sharp(inputBuf)
    .extract({ left, top, width, height })
    .resize({ width: 64, height: 64, fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();

  let foreground = 0;
  const total = 64 * 64;
  for (let i = 0; i < cellBuf.length; i += 3) {
    const r = cellBuf[i];
    const g = cellBuf[i + 1];
    const b = cellBuf[i + 2];
    const dist = Math.sqrt(
      (r - bg.r) * (r - bg.r) +
      (g - bg.g) * (g - bg.g) +
      (b - bg.b) * (b - bg.b),
    );
    if (dist > 30) foreground++;
  }
  return foreground / total;
}

/**
 * Extract a single-character portrait from a multi-view reference image.
 *
 * Layout selection: the model may rearrange the requested layout (e.g.
 * "four-view" → 2×2 grid vs. 1×4 horizontal strip) based on the cell aspect
 * ratio. Pure image-aspect heuristics are unreliable — a 16:9 image can be
 * either a 2×2 grid of 16:9 cells or a 1×4 strip. We therefore try the
 * requested grid first, then fall back to alternative grids, and pick the
 * candidate whose front-view cell has the highest non-background content
 * density.
 *
 * Front-view position: assumed top-left cell (or leftmost cell in a
 * horizontal strip, topmost cell in a vertical strip). The character-image
 * prompts all instruct the model to place the front view there; the model
 * is not 100% reliable. To make this robust without model cooperation, the
 * caller can pass an explicit `frontCellIndex` in a future API. See the
 * JSDoc on the previous implementation for the full limitation note.
 *
 * Returns a path relative to the upload dir. Returns null when the input
 * is already a single portrait or when no candidate yields enough content.
 */
export async function extractCharacterReferencePortrait(
  imagePath: string,
  layout: CharacterReferenceLayout,
): Promise<string | null> {
  if (layout === "single") return null;

  const inputPath = resolveUploadPath(imagePath);
  const inputBuf = await fs.readFile(inputPath);
  const meta = await sharp(inputBuf).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Could not read dimensions of ${inputPath}`);
  }

  const candidates = candidateLayouts(layout);
  const bg = await detectBackgroundColor(inputBuf);
  const requested = candidates[0];
  const requestedDensity = await scoreContentDensity(
    inputBuf,
    requested.rows,
    requested.cols,
    bg,
  );
  let bestDensity = requestedDensity;
  let bestCandidate: GridCandidate = requested;
  for (let i = 1; i < candidates.length; i++) {
    const cand = candidates[i];
    const density = await scoreContentDensity(inputBuf, cand.rows, cand.cols, bg);
    if (density > bestDensity + ALTERNATIVE_LAYOUT_ADVANTAGE) {
      bestDensity = density;
      bestCandidate = cand;
    }
  }
  if (bestDensity < MIN_CONTENT_DENSITY) {
    return null;
  }

  const { rows, cols } = bestCandidate;
  const cellWidth = Math.floor(meta.width / cols);
  const cellHeight = Math.floor(meta.height / rows);
  const marginX = Math.max(1, Math.floor(cellWidth * CELL_MARGIN_RATIO));
  const marginY = Math.max(1, Math.floor(cellHeight * CELL_MARGIN_RATIO));
  const left = marginX;
  const top = marginY;
  const width = cellWidth - 2 * marginX;
  const height = cellHeight - 2 * marginY;

  const croppedBuf = await sharp(inputBuf)
    .extract({ left, top, width, height })
    .toBuffer();
  const croppedMeta = await sharp(croppedBuf).metadata();
  const croppedW = croppedMeta.width ?? width;
  const croppedH = croppedMeta.height ?? height;
  const maxDim = Math.max(croppedW, croppedH);
  const padX = Math.floor((maxDim - croppedW) / 2);
  const padY = Math.floor((maxDim - croppedH) / 2);

  const parsed = path.parse(imagePath);
  const portraitFileName = `${parsed.name}_single${parsed.ext}`;
  const uploadDir = process.env.UPLOAD_DIR || "./uploads";
  const parsedDirInsideUpload = stripUploadPrefix(parsed.dir);
  const portraitAbsPath = path.isAbsolute(imagePath)
    ? path.join(path.dirname(imagePath), portraitFileName)
    : path.join(uploadDir, parsedDirInsideUpload, portraitFileName);
  // Keep the cwd-relative form (with uploadDir prefix) so the stored value
  // matches the existing `referenceImage` convention: "uploads/frames/abc.png".
  const portraitRelPath = path.isAbsolute(imagePath)
    ? path.relative(process.cwd(), portraitAbsPath)
    : path.join(parsed.dir, portraitFileName);

  await sharp(croppedBuf)
    .extend({
      top: padY,
      bottom: maxDim - croppedH - padY,
      left: padX,
      right: maxDim - croppedW - padX,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .toFile(portraitAbsPath);

  return portraitRelPath;
}

// (no helpers re-exported below — `extractCharacterReferencePortrait` is the
// only public surface of this module)

function resolveUploadPath(imagePath: string): string {
  if (path.isAbsolute(imagePath)) return imagePath;
  const uploadDir = process.env.UPLOAD_DIR || "./uploads";
  const normalized = imagePath.replace(/\\/g, "/");
  // Production stores image paths relative to the project root with a
  // leading "uploads/" prefix (e.g. "uploads/frames/abc.png"). Strip that
  // redundant prefix before joining with the upload dir, otherwise we get
  // "uploads/uploads/frames/abc.png" and an ENOENT.
  const uploadBasename = path.basename(uploadDir.replace(/\/$/, ""));
  const prefixes = new Set<string>();
  if (uploadBasename) prefixes.add(uploadBasename);
  prefixes.add("uploads");
  for (const p of prefixes) {
    if (normalized === p) return path.join(uploadDir, ".");
    if (normalized.startsWith(p + "/")) {
      return path.join(uploadDir, normalized.slice(p.length + 1));
    }
  }
  return path.join(uploadDir, normalized);
}

function stripUploadPrefix(inputDir: string): string {
  const uploadDir = process.env.UPLOAD_DIR || "./uploads";
  const uploadBasename = path.basename(uploadDir.replace(/\/$/, ""));
  const candidates = [uploadBasename, "uploads"].filter(
    (c): c is string => Boolean(c),
  );
  const normalized = inputDir.replace(/\\/g, "/").replace(/\/$/, "");
  for (const p of candidates) {
    if (normalized === p) return ".";
    if (normalized.startsWith(p + "/")) {
      return normalized.slice(p.length + 1);
    }
  }
  return inputDir;
}
