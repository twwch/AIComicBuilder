import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createLanguageModel, extractJSON, resolveLanguageModelConfig, supportsOpenAIJsonMode } from "@/lib/ai/ai-sdk";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { addImportLog, chunkText } from "@/lib/import-utils";
import { buildScriptSplitPrompt } from "@/lib/ai/prompts/script-split";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";

export const maxDuration = 300;

interface SplitEpisode {
  title: string;
  description: string;
  keywords: string;
  idea: string;
  characters?: string[];
}

interface CharacterSummary {
  name: string;
  scope: string;
}

interface AssetSummary {
  name: string;
}

interface EpisodeMarker {
  marker: string;
  heading: string;
  titleSuffix: string;
  episodeNumber: number | null;
  markerStart: number;
  contentStart: number;
}

interface EpisodeMarkerRun {
  markers: EpisodeMarker[];
  startIndex: number;
  endIndex: number;
  contentLength: number;
}

const INITIAL_CHUNK_SIZE = 3000;
const MIN_FALLBACK_CHUNK_SIZE = 1500;
const CHUNK_RETRY_ATTEMPTS = 3;
const MODEL_CALL_TIMEOUT_MS = 60_000;

class SplitJsonParseError extends Error {
  readonly snippet: string;

  constructor(message: string, snippet: string) {
    super(message);
    this.name = "SplitJsonParseError";
    this.snippet = snippet;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  return String(err || "");
}

function isConnectionLikeError(err: unknown) {
  if (!err) return false;
  const message = getErrorMessage(err);
  const lastError = err as { lastError?: { message?: string; cause?: { code?: string } }; cause?: { code?: string } };
  const nested = [
    lastError.lastError?.message,
    lastError.lastError?.cause?.code,
    lastError.cause?.code,
  ]
    .filter(Boolean)
    .join(" ");

  return /Cannot connect to API|other side closed|ECONNRESET|UND_ERR_SOCKET|socket|fetch failed|network/i.test(
    `${message} ${nested}`
  );
}

function getShortErrorMessage(err: unknown) {
  const message = getErrorMessage(err);
  if (/aborted|abort|timeout|timed out/i.test(message)) {
    return "模型调用超时";
  }
  if (isConnectionLikeError(err)) {
    return "模型连接被中断";
  }
  return message.slice(0, 160) || "未知错误";
}

function repairCommonJsonIssues(json: string) {
  return json
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
}

function normalizeSplitEpisode(raw: Partial<SplitEpisode>): SplitEpisode | null {
  const title = String(raw.title || "").trim();
  const description = String(raw.description || "").trim();
  const keywords = String(raw.keywords || "").trim();
  const idea = String(raw.idea || "").trim();
  if (!title || !idea) return null;

  return {
    title,
    description,
    keywords,
    idea,
    characters: Array.isArray(raw.characters)
      ? raw.characters.map((name) => String(name).trim()).filter(Boolean)
      : [],
  };
}

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function truncateText(text: string, maxLength: number) {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trim()}...`;
}

function chineseNumberToInt(input: string): number | null {
  const raw = input.replace(/\s+/g, "");
  if (/^\d+$/.test(raw)) return Number(raw);

  const digitMap: Record<string, number> = {
    "\u96f6": 0,
    "\u3007": 0,
    "\u4e00": 1,
    "\u4e8c": 2,
    "\u4e24": 2,
    "\u4e09": 3,
    "\u56db": 4,
    "\u4e94": 5,
    "\u516d": 6,
    "\u4e03": 7,
    "\u516b": 8,
    "\u4e5d": 9,
  };
  const unitMap: Record<string, number> = {
    "\u5341": 10,
    "\u767e": 100,
    "\u5343": 1000,
    "\u4e07": 10000,
  };

  if (![...raw].some((char) => unitMap[char])) {
    const digits = [...raw].map((char) => digitMap[char]);
    return digits.every((digit) => typeof digit === "number") ? Number(digits.join("")) : null;
  }

  let result = 0;
  let section = 0;
  let number = 0;

  for (const char of raw) {
    if (typeof digitMap[char] === "number") {
      number = digitMap[char];
      continue;
    }

    const unit = unitMap[char];
    if (!unit) return null;

    if (unit === 10000) {
      section = (section + number) * unit;
      result += section;
      section = 0;
    } else {
      section += (number || 1) * unit;
    }
    number = 0;
  }

  return result + section + number;
}

function findExplicitEpisodeMarkers(text: string): EpisodeMarker[] {
  const numberPattern = String.raw`(\d+|[\u96f6\u3007\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07]+)`;
  const markerRegex = new RegExp(
    String.raw`(^|\r?\n)[ \t#>*_\-\u3010\[]*((?:\u7b2c\s*${numberPattern}\s*[\u96c6\u7ae0\u56de])|(?:EP\.?\s*(\d+))|(?:Episode\s+(\d+)))(?:[\u3011\]\s:\uff1a\u3001.\uff0e-]*(.*?))(?=\r?\n|$)`,
    "gi"
  );

  const markers: EpisodeMarker[] = [];
  for (const match of text.matchAll(markerRegex)) {
    const lineBreak = match[1] ?? "";
    const markerStart = (match.index ?? 0) + lineBreak.length;
    let contentStart = (match.index ?? 0) + match[0].length;
    while (text[contentStart] === "\r" || text[contentStart] === "\n") contentStart++;

    const marker = normalizeWhitespace(match[2] ?? "");
    const numberText = match[3] || match[4] || match[5] || "";
    const titleSuffix = normalizeWhitespace(match[6] ?? "");
    const heading = normalizeWhitespace(text.slice(markerStart, contentStart));

    if (!marker || !numberText) continue;

    markers.push({
      marker,
      heading,
      titleSuffix,
      episodeNumber: chineseNumberToInt(numberText),
      markerStart,
      contentStart,
    });
  }

  return markers;
}

function getMarkerRunContentLength(text: string, allMarkers: EpisodeMarker[], startIndex: number, endIndex: number) {
  const runEnd = allMarkers[endIndex + 1]?.markerStart ?? text.length;
  let length = 0;

  for (let index = startIndex; index <= endIndex; index++) {
    const marker = allMarkers[index];
    const nextMarker = index < endIndex ? allMarkers[index + 1] : null;
    const end = nextMarker?.markerStart ?? runEnd;
    length += Math.max(0, end - marker.contentStart);
  }

  return length;
}

function selectBestEpisodeMarkerRun(text: string, markers: EpisodeMarker[]): EpisodeMarkerRun | null {
  if (markers.length < 2) return null;

  const runs: EpisodeMarkerRun[] = [];
  let startIndex = 0;

  for (let index = 1; index < markers.length; index++) {
    const previousNumber = markers[index - 1].episodeNumber;
    const currentNumber = markers[index].episodeNumber;
    const restarted =
      typeof previousNumber === "number" &&
      typeof currentNumber === "number" &&
      currentNumber <= previousNumber;

    if (!restarted) continue;

    const endIndex = index - 1;
    const runMarkers = markers.slice(startIndex, index);
    if (runMarkers.length >= 2) {
      runs.push({
        markers: runMarkers,
        startIndex,
        endIndex,
        contentLength: getMarkerRunContentLength(text, markers, startIndex, endIndex),
      });
    }
    startIndex = index;
  }

  const finalRunMarkers = markers.slice(startIndex);
  if (finalRunMarkers.length >= 2) {
    const endIndex = markers.length - 1;
    runs.push({
      markers: finalRunMarkers,
      startIndex,
      endIndex,
      contentLength: getMarkerRunContentLength(text, markers, startIndex, endIndex),
    });
  }

  return runs.sort((a, b) => b.markers.length - a.markers.length || b.contentLength - a.contentLength)[0] ?? null;
}

function deriveEpisodeTitle(marker: EpisodeMarker, body: string) {
  if (marker.titleSuffix) {
    return truncateText(`${marker.marker} ${marker.titleSuffix}`, 80);
  }

  const firstLine = body
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .find((line) => line.length > 0 && line.length <= 60);

  return truncateText(firstLine ? `${marker.marker} ${firstLine}` : marker.marker, 80);
}

function inferEpisodeCharacters(content: string, allCharacters: CharacterSummary[]) {
  return allCharacters
    .map((character) => character.name.trim())
    .filter((name, index, names) => name && names.indexOf(name) === index && content.includes(name));
}

function splitByExplicitEpisodeMarkers(text: string, allCharacters: CharacterSummary[]): SplitEpisode[] {
  const markers = findExplicitEpisodeMarkers(text);
  const markerRun = selectBestEpisodeMarkerRun(text, markers);
  if (!markerRun) return [];

  const episodes: SplitEpisode[] = [];
  const runEnd = markers[markerRun.endIndex + 1]?.markerStart ?? text.length;

  for (let index = 0; index < markerRun.markers.length; index++) {
    const marker = markerRun.markers[index];
    const nextMarker = markerRun.markers[index + 1];
    const bodyAfterHeading = text.slice(marker.contentStart, nextMarker ? nextMarker.markerStart : runEnd).trim();
    const sectionContent = `${marker.heading}${bodyAfterHeading ? `\n\n${bodyAfterHeading}` : ""}`.trim();
    if (!sectionContent) continue;

    const title = deriveEpisodeTitle(marker, bodyAfterHeading || marker.titleSuffix || marker.heading);
    const characters = inferEpisodeCharacters(sectionContent, allCharacters);
    const markerKeyword = marker.episodeNumber ? `\u7b2c${marker.episodeNumber}\u96c6` : marker.marker;
    const keywords = [markerKeyword, ...characters.slice(0, 4)]
      .filter(Boolean)
      .join(", ");

    episodes.push({
      title,
      description: truncateText(sectionContent, 180),
      keywords,
      idea: `\u3010${title}\u3011\n\n${sectionContent}`,
      characters,
    });
  }

  return episodes;
}

function parseSplitEpisodes(text: string): SplitEpisode[] {
  const json = repairCommonJsonIssues(extractJSON(text));

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (firstError) {
    const message = firstError instanceof Error ? firstError.message : "Invalid split JSON";
    throw new SplitJsonParseError(message, json.slice(0, 1200));
  }

  const rawEpisodes = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { episodes?: unknown }).episodes)
      ? (parsed as { episodes: unknown[] }).episodes
      : null;

  if (!rawEpisodes) {
    throw new SplitJsonParseError("Split response is not a JSON array", json.slice(0, 1200));
  }

  const episodes = rawEpisodes
    .map((episode) => normalizeSplitEpisode(episode as Partial<SplitEpisode>))
    .filter((episode): episode is SplitEpisode => episode !== null);

  if (episodes.length === 0) {
    throw new SplitJsonParseError("Split response contained no valid episodes", json.slice(0, 1200));
  }

  return episodes;
}

function splitForFallback(text: string) {
  const nextSize = Math.max(MIN_FALLBACK_CHUNK_SIZE, Math.ceil(text.length / 2));
  const paragraphChunks = chunkText(text, nextSize);
  if (paragraphChunks.length > 1) return paragraphChunks;

  const hardChunks: string[] = [];
  for (let index = 0; index < text.length; index += nextSize) {
    const chunk = text.slice(index, index + nextSize).trim();
    if (chunk) hardChunks.push(chunk);
  }
  return hardChunks;
}

function getFriendlyModelError(err: unknown, config: ProviderConfig): string {
  const error = err as {
    message?: string;
    statusCode?: number;
    lastError?: { statusCode?: number; responseHeaders?: Record<string, string> };
  };
  const statusCode = error.statusCode ?? error.lastError?.statusCode;
  const message = error.message || "";
  const requestId = error.lastError?.responseHeaders?.["x-api-request-id"];

  if (statusCode === 503) {
    return `模型 ${config.modelId} 调用失败：中转站返回 503，当前没有可用渠道、额度不足，或模型 ID 与中转站不匹配。请在设置里换一个可用文本模型，或确认中转站后台是否支持这个模型。${requestId ? ` Request ID: ${requestId}` : ""}`;
  }

  if (isConnectionLikeError(err)) {
    return `模型 ${config.modelId} 连接被中断：${message}。分集已改为顺序小分块处理；如果仍失败，请换一个更稳定的文本模型或稍后重试。`;
  }

  return err instanceof Error ? err.message : "Unknown error";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    text: string;
    allCharacters: CharacterSummary[];
    allItems?: AssetSummary[];
    allEnvironments?: AssetSummary[];
    modelConfig?: { text: ProviderConfig | null };
  };

  const explicitEpisodes = splitByExplicitEpisodeMarkers(body.text, body.allCharacters || []);
  if (explicitEpisodes.length > 0) {
    await addImportLog(
      projectId,
      4,
      "running",
      `检测到原文已有 ${explicitEpisodes.length} 个分集标注，跳过 AI 分集，按原文标注直接拆分`
    );
    await addImportLog(
      projectId,
      4,
      "done",
      `分集完成，共 ${explicitEpisodes.length} 集`,
      { episodes: explicitEpisodes, mode: "explicit_markers" }
    );

    return NextResponse.json({ episodes: explicitEpisodes, mode: "explicit_markers" });
  }

  const textModelConfig = resolveLanguageModelConfig(body.modelConfig?.text);
  if (!textModelConfig) {
    return NextResponse.json({ error: "No text model" }, { status: 400 });
  }

  const chunks = chunkText(body.text, INITIAL_CHUNK_SIZE);
  const model = createLanguageModel(textModelConfig);
  const scriptSplitSystem = await resolvePrompt("script_split", { userId, projectId });

  await addImportLog(
    projectId, 4, "running",
    `开始自动分集，共 ${chunks.length} 块`
  );

  // Build character context for prompt
  const allNames = body.allCharacters.map((c) => c.name);
  const itemNames = (body.allItems || []).map((item) => item.name);
  const environmentNames = (body.allEnvironments || []).map((env) => env.name);
  const charContext = allNames.length > 0
    ? `\n\nAll extracted characters (assign each to ONLY the episodes where they actually appear): ${allNames.join(", ")}`
    : "";
  const itemContext = itemNames.length > 0
    ? `\nAll extracted important items/props (use as context when assigning episode descriptions): ${itemNames.join(", ")}`
    : "";
  const environmentContext = environmentNames.length > 0
    ? `\nAll extracted environments/locations (use as context when describing episodes): ${environmentNames.join(", ")}`
    : "";

  let allEpisodes: SplitEpisode[];
  try {
    const completedEpisodes: SplitEpisode[] = [];
    const jsonMode = supportsOpenAIJsonMode(textModelConfig)
      ? { openai: { response_format: { type: "json_object" } } }
      : undefined;
    const pendingChunks = chunks.map((text, index) => ({ text, label: `${index + 1}` }));
    let processedCount = 0;

    for (let queueIndex = 0; queueIndex < pendingChunks.length; queueIndex++) {
      const current = pendingChunks[queueIndex];
      await addImportLog(
        projectId, 4, "running",
        `正在处理第 ${queueIndex + 1}/${pendingChunks.length} 块...`
      );

      const prompt = buildScriptSplitPrompt(
        current.text,
        { chunkIndex: queueIndex, totalChunks: pendingChunks.length, episodeOffset: completedEpisodes.length }
      ) + charContext + itemContext + environmentContext;

      let lastError: unknown;
      for (let attempt = 1; attempt <= CHUNK_RETRY_ATTEMPTS; attempt++) {
        try {
          const result = await generateText({
            model,
            system: scriptSplitSystem,
            prompt: attempt === 1
              ? prompt
              : prompt + "\n\nIMPORTANT: Return COMPLETE, VALID JSON. Fewer episodes is better than broken JSON.",
            providerOptions: jsonMode,
            maxRetries: isConnectionLikeError(lastError) ? 1 : 2,
            timeout: MODEL_CALL_TIMEOUT_MS,
          });
          const episodes = parseSplitEpisodes(result.text);
          completedEpisodes.push(...episodes);
          lastError = null;
          processedCount++;
          break;
        } catch (err) {
          lastError = err;
          if (err instanceof SplitJsonParseError) {
            console.error(`[ImportSplit] Chunk ${current.label} JSON parse failed. Raw:\n${err.snippet}...`);
          }
          await addImportLog(
            projectId, 4, "running",
            `第 ${queueIndex + 1} 块处理失败：${getShortErrorMessage(err)}，正在重试 (${attempt}/${CHUNK_RETRY_ATTEMPTS})...`
          );
          await sleep(Math.min(1500 * attempt, 5000));
        }
      }

      if (lastError) {
        const fallbackChunks = current.text.length > MIN_FALLBACK_CHUNK_SIZE
          ? splitForFallback(current.text)
          : [];

        if (fallbackChunks.length > 1) {
          pendingChunks.splice(
            queueIndex + 1,
            0,
            ...fallbackChunks.map((text, partIndex) => ({
              text,
              label: `${current.label}.${partIndex + 1}`,
            }))
          );
          await addImportLog(
            projectId, 4, "running",
            `第 ${queueIndex + 1} 块连续失败，已拆成 ${fallbackChunks.length} 个更小分块继续处理`
          );
          continue;
        }

        throw lastError;
      }
    }
    allEpisodes = completedEpisodes;
    await addImportLog(
      projectId, 4, "running",
      `顺序分块处理完成，成功处理 ${processedCount} 块`
    );
  } catch (err) {
    const msg = getFriendlyModelError(err, textModelConfig);
    console.error("[ImportSplit] Episode split failed:", err);
    await addImportLog(projectId, 4, "error", `分集失败: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  await addImportLog(
    projectId, 4, "done",
    `分集完成，共 ${allEpisodes.length} 集`,
    { episodes: allEpisodes }
  );

  return NextResponse.json({ episodes: allEpisodes });
}

