import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { extractCharacterReferencePortrait } from "../character-ref-utils";

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "character-ref-utils-"));
  process.env.UPLOAD_DIR = tmpDir;
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
});

interface FakeSheetOptions {
  width: number;
  height: number;
  rows: number;
  cols: number;
  contentCell?: { row: number; col: number };
}

async function makeSheet({
  width,
  height,
  rows,
  cols,
  contentCell = { row: 0, col: 0 },
}: FakeSheetOptions): Promise<Buffer> {
  const cellW = Math.floor(width / cols);
  const cellH = Math.floor(height / rows);
  const baseBg = await sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();

  const silhouetteSize = Math.floor(Math.min(cellW, cellH) * 0.4);
  const silhouetteLeft = contentCell.col * cellW + Math.floor((cellW - silhouetteSize) / 2);
  const silhouetteTop = contentCell.row * cellH + Math.floor((cellH - silhouetteSize) / 2);

  const silhouette = await sharp({
    create: {
      width: silhouetteSize,
      height: silhouetteSize,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();

  return sharp(baseBg)
    .composite([{ input: silhouette, left: silhouetteLeft, top: silhouetteTop }])
    .png()
    .toBuffer();
}

describe("extractCharacterReferencePortrait", () => {
  it("returns null for single layout", async () => {
    const result = await extractCharacterReferencePortrait("characters/single.png", "single");
    expect(result).toBeNull();
  });

  it("crops a 2x2 grid (four-view) with square source", async () => {
    // 1000x1000 → 2x2 grid, silhouette in top-left cell.
    // cellWidth=500, cellHeight=500, margin=25, crop=450x450, no padding
    const buf = await makeSheet({ width: 1000, height: 1000, rows: 2, cols: 2 });
    const fileName = "characters/grid.png";
    await fs.mkdir(path.join(tmpDir, "characters"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, fileName), buf);

    const rel = await extractCharacterReferencePortrait(fileName, "four-view");
    expect(rel).toBe(path.join("characters", "grid_single.png"));
    const meta = await sharp(path.join(tmpDir, "characters", "grid_single.png")).metadata();
    expect(meta.width).toBe(450);
    expect(meta.height).toBe(450);
  });

  it("pads cropped cell to white square when source cells are non-square", async () => {
    // 1200x1000 (aspect 1.2) → 2x2 grid with rectangular cells.
    // cellWidth=600, cellHeight=500, margin 30/25, crop 540x450,
    // maxDim 540 → padX=0, padY=45 → 540x540 white-padded square.
    const buf = await makeSheet({ width: 1200, height: 1000, rows: 2, cols: 2 });
    const fileName = "characters/rect.png";
    await fs.mkdir(path.join(tmpDir, "characters"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, fileName), buf);

    const rel = await extractCharacterReferencePortrait(fileName, "four-view");
    expect(rel).toBe(path.join("characters", "rect_single.png"));
    const out = path.join(tmpDir, "characters", "rect_single.png");
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(540);
    expect(meta.height).toBe(540);
    const top = await sharp(out)
      .extract({ left: 269, top: 0, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect(Array.from(top)).toEqual([255, 255, 255]);
    const center = await sharp(out)
      .extract({ left: 269, top: 269, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect(Array.from(center)).toEqual([0, 0, 0]);
  });

  it("crops the left cell of a 3-view horizontal strip", async () => {
    // 1500x500 (aspect 3.0) → 1x3 strip, silhouette in leftmost cell.
    // cellWidth=500, cellHeight=500, margin=25, crop=450x450, no padding
    const buf = await makeSheet({
      width: 1500,
      height: 500,
      rows: 1,
      cols: 3,
      contentCell: { row: 0, col: 0 },
    });
    const fileName = "characters/strip3h.png";
    await fs.mkdir(path.join(tmpDir, "characters"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, fileName), buf);

    const rel = await extractCharacterReferencePortrait(fileName, "three-view");
    expect(rel).toBe(path.join("characters", "strip3h_single.png"));
    const meta = await sharp(path.join(tmpDir, "characters", "strip3h_single.png")).metadata();
    expect(meta.width).toBe(450);
    expect(meta.height).toBe(450);
  });

  it("crops the top cell of a 4-view vertical strip", async () => {
    // 500x2000 (aspect 0.25) → 4x1 vertical strip, silhouette in top cell.
    // cellWidth=500, cellHeight=500, margin=25, crop=450x450, no padding
    const buf = await makeSheet({
      width: 500,
      height: 2000,
      rows: 4,
      cols: 1,
      contentCell: { row: 0, col: 0 },
    });
    const fileName = "characters/strip4v.png";
    await fs.mkdir(path.join(tmpDir, "characters"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, fileName), buf);

    const rel = await extractCharacterReferencePortrait(fileName, "four-view");
    expect(rel).toBe(path.join("characters", "strip4v_single.png"));
    const meta = await sharp(path.join(tmpDir, "characters", "strip4v_single.png")).metadata();
    expect(meta.width).toBe(450);
    expect(meta.height).toBe(450);
  });

  it("detects 1x4 horizontal strip when the model rearranged from 2x2 request", async () => {
    // User requested four-view (2x2) but model generated a 1x4 strip at 2048x512.
    // Silhouette in the leftmost cell.
    const buf = await makeSheet({
      width: 2048,
      height: 512,
      rows: 1,
      cols: 4,
      contentCell: { row: 0, col: 0 },
    });
    const fileName = "characters/actual-strip.png";
    await fs.mkdir(path.join(tmpDir, "characters"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, fileName), buf);

    const rel = await extractCharacterReferencePortrait(fileName, "four-view");
    expect(rel).toBe(path.join("characters", "actual-strip_single.png"));
    const meta = await sharp(path.join(tmpDir, "characters", "actual-strip_single.png")).metadata();
    // cellWidth=512, cellHeight=512, margin=25, crop=462x462, no padding
    expect(meta.width).toBe(462);
    expect(meta.height).toBe(462);
  });

  it("detects 2x2 grid when the model kept four-view (16:9 aspect ratio)", async () => {
    // User requested four-view, model generated 2560x1440 (16:9, 2x2 grid of 16:9 cells).
    // Silhouette in top-left cell. Aspect 1.78 would mislead a naive detector
    // into thinking this is a 1x4 strip, but content-based scoring picks 2x2.
    const buf = await makeSheet({ width: 2560, height: 1440, rows: 2, cols: 2 });
    const fileName = "characters/wide-grid.png";
    await fs.mkdir(path.join(tmpDir, "characters"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, fileName), buf);

    const rel = await extractCharacterReferencePortrait(fileName, "four-view");
    expect(rel).toBe(path.join("characters", "wide-grid_single.png"));
    const meta = await sharp(path.join(tmpDir, "characters", "wide-grid_single.png")).metadata();
    // 2x2 picked: cellWidth=1280, cellHeight=720, margin 64/36
    // crop = 1152x648; maxDim=1152; padY=252 → 1152x1152
    expect(meta.width).toBe(1152);
    expect(meta.height).toBe(1152);
  });

  it("returns null when no candidate has enough content", async () => {
    // Pure white image — no content in any cell.
    const buf = await sharp({
      create: { width: 1000, height: 1000, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();
    const fileName = "characters/blank.png";
    await fs.mkdir(path.join(tmpDir, "characters"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, fileName), buf);

    const rel = await extractCharacterReferencePortrait(fileName, "four-view");
    expect(rel).toBeNull();
  });

  it("returns a path that round-trips through uploadUrl's normalization", async () => {
    const buf = await makeSheet({ width: 1024, height: 1024, rows: 2, cols: 2 });
    const fileName = "characters/sub/foo.png";
    await fs.mkdir(path.join(tmpDir, "characters", "sub"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, fileName), buf);

    const rel = await extractCharacterReferencePortrait(fileName, "four-view");
    expect(rel).toBe(path.join("characters", "sub", "foo_single.png"));
    const normalized = (rel as string).replace(/\\/g, "/").replace(/^.*?uploads\//, "");
    expect(normalized).toBe("characters/sub/foo_single.png");
  });

  it("handles DB-style paths that already include the uploadDir prefix", async () => {
    // Production stores image paths like "uploads/frames/abc.png" (relative to
    // project root, with the uploadDir prefix included). The path resolver
    // must strip the redundant prefix before joining with uploadDir, otherwise
    // we get "uploads/uploads/frames/abc.png" and ENOENT.
    const buf = await makeSheet({ width: 1024, height: 1024, rows: 2, cols: 2 });
    const relInput = "uploads/frames/bar.png";
    await fs.mkdir(path.join(tmpDir, "frames"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "frames", "bar.png"), buf);

    const rel = await extractCharacterReferencePortrait(relInput, "four-view");
    expect(rel).toBe(path.join("uploads", "frames", "bar_single.png"));
    const outAbs = path.join(tmpDir, "frames", "bar_single.png");
    expect(await fs.stat(outAbs)).toBeTruthy();
  });
});
