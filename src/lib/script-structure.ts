export interface ScriptMarker {
  index: number;
  line: string;
  title: string;
  sequence: number;
}

export interface StructuredEpisodeDraft {
  id: string;
  episodeIndex: number;
  sequence: number;
  title: string;
  markerLine: string;
  startIndex: number;
  endIndex: number;
  text: string;
  sceneIndexes: number[];
  chunkIndexes: number[];
  sceneCount: number;
  chunkCount: number;
}

export interface StructuredSceneDraft {
  id: string;
  episodeIndex: number;
  sceneIndex: number;
  sequence: number;
  title: string;
  markerLine: string;
  startIndex: number;
  endIndex: number;
  text: string;
  chunkIndexes: number[];
  chunkCount: number;
}

export interface StructuredChunkDraft {
  id: string;
  chunkIndex: number;
  episodeIndex: number;
  sceneIndex: number;
  text: string;
  startIndex: number;
  endIndex: number;
  overlapBefore: number;
  overlapAfter: number;
  metadata: {
    coreStartIndex: number;
    coreEndIndex: number;
    episodeId?: string;
    sceneId?: string;
    episodeTitle?: string;
    sceneTitle?: string;
    sceneIds?: string[];
    sceneIndexes?: number[];
    dialogueCharacters: string[];
  };
}

export interface ScriptStructureSummary {
  language: "zh" | "en" | "unknown";
  charCount: number;
  lineCount: number;
  episodeMarkers: ScriptMarker[];
  sceneMarkers: ScriptMarker[];
  dialogueCharacters: string[];
  episodeCount: number;
  sceneCount: number;
  chunkCount: number;
}

export interface StructuredScript {
  cleanedText: string;
  summary: ScriptStructureSummary;
  episodes: StructuredEpisodeDraft[];
  scenes: StructuredSceneDraft[];
  chunks: StructuredChunkDraft[];
}

export interface ChunkingOptions {
  minSize?: number;
  maxSize?: number;
  overlap?: number;
}

const DEFAULT_MIN_CHUNK_SIZE = 1800;
const DEFAULT_MAX_CHUNK_SIZE = 3600;
const DEFAULT_OVERLAP_SIZE = 220;

function normalizeLineEndings(text: string) {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function normalizeCommonPunctuation(text: string) {
  return text
    .replace(/[\u201c\u201d\u201e\u301d\u301e]/g, "\"")
    .replace(/[\u2018\u2019\u201a]/g, "'")
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/[ \t]{2,}/g, " ");
}

export function cleanScriptText(rawText: string) {
  return normalizeCommonPunctuation(normalizeLineEndings(rawText))
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function detectScriptLanguage(text: string): ScriptStructureSummary["language"] {
  const chineseChars = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const latinWords = text.match(/[A-Za-z]{2,}/g)?.length ?? 0;
  if (chineseChars > 20 && chineseChars > latinWords * 2) return "zh";
  if (latinWords > 20) return "en";
  return "unknown";
}

function chineseNumberToInt(input: string): number | null {
  const raw = input.replace(/\s+/g, "");
  if (!raw) return null;
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
  };

  if (![...raw].some((char) => unitMap[char])) {
    const digits = [...raw].map((char) => digitMap[char]);
    return digits.every((digit) => typeof digit === "number") ? Number(digits.join("")) : null;
  }

  let total = 0;
  let current = 0;
  for (const char of raw) {
    if (typeof digitMap[char] === "number") {
      current = digitMap[char];
      continue;
    }
    const unit = unitMap[char];
    if (!unit) return null;
    total += (current || 1) * unit;
    current = 0;
  }
  return total + current;
}

function lineStartIndexes(text: string) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n" && i + 1 < text.length) starts.push(i + 1);
  }
  return starts;
}

function cleanMarkerTitle(value: string, fallback: string) {
  const title = value
    .replace(/^[\s:：\-—–，,。.【】\[\]]+/, "")
    .trim();
  return title || fallback;
}

function findEpisodeMarkers(text: string): ScriptMarker[] {
  const starts = lineStartIndexes(text);
  const lines = text.split("\n");
  const markers: ScriptMarker[] = [];
  const numberChars = "0-9\\u96f6\\u3007\\u4e00\\u4e8c\\u4e24\\u4e09\\u56db\\u4e94\\u516d\\u4e03\\u516b\\u4e5d\\u5341\\u767e\\u5343";
  const bracketedZhEpisode = new RegExp(`^(?:[#>\\-\\s]*)?(?:[\\u3010\\[])?\\u7b2c\\s*([${numberChars}]+)\\s*[\\u96c6\\u7ae0\\u8282\\u56de\\u5e55](?:[\\s:\\uff1a\\-\\u2014\\u2013,\\uff0c\\u3001]*(.*?))?(?:[\\u3011\\]])?$`, "i");
  const bracketedEnEpisode = /^(?:[#>\-\s]*)?(?:[\u3010\[])?(?:EP\.?\s*0*(\d+)|Episode\s+0*(\d+))(?:[\s:\uff1a\-\u2014\u2013,\uff0c\u3001]*(.*?))?(?:[\u3011\]])?$/i;
  const zhEpisode = new RegExp(`^(?:[#>\\-\\s]*)?\\u7b2c\\s*([${numberChars}]+)\\s*[\\u96c6\\u7ae0\\u8282\\u56de\\u5e55](?:[\\s:：\\-—–]*(.*))?$`, "i");
  const enEpisode = /^(?:[#>\-\s]*)?(?:EP\.?\s*0*(\d+)|Episode\s+0*(\d+))(?:[\s:：\-—–]*(.*))?$/i;

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 260) return;
    const zhMatch = trimmed.match(bracketedZhEpisode) || trimmed.match(zhEpisode);
    const enMatch = trimmed.match(bracketedEnEpisode) || trimmed.match(enEpisode);
    const sequence = zhMatch
      ? chineseNumberToInt(zhMatch[1])
      : enMatch
        ? Number(enMatch[1] || enMatch[2])
        : null;
    if (!sequence) return;
    const rawTitle = zhMatch ? zhMatch[2] || "" : enMatch?.[3] || "";
    markers.push({
      index: starts[i] ?? 0,
      line: trimmed,
      title: cleanMarkerTitle(rawTitle, trimmed),
      sequence,
    });
  });

  return selectPrimaryEpisodeRun(dedupeMarkers(markers), text.length);
}

function splitEpisodeRuns(markers: ScriptMarker[]) {
  const runs: ScriptMarker[][] = [];
  for (const marker of markers) {
    const current = runs[runs.length - 1];
    const previous = current?.[current.length - 1];
    if (!current || (previous && marker.sequence <= previous.sequence)) {
      runs.push([marker]);
    } else {
      current.push(marker);
    }
  }
  return runs;
}

function selectPrimaryEpisodeRun(markers: ScriptMarker[], textLength: number) {
  const runs = splitEpisodeRuns(markers);
  if (runs.length <= 1) return markers;

  const scoredRuns = runs.map((run, index) => {
    const nextRunStart = runs[index + 1]?.[0]?.index ?? textLength;
    const span = Math.max(0, nextRunStart - run[0].index);
    const averageEpisodeLength = span / Math.max(1, run.length);
    const startsAtOne = run[0].sequence === 1 ? 1 : 0;
    const continuity = run.reduce((score, marker, markerIndex) => {
      if (markerIndex === 0) return score;
      return score + (marker.sequence === run[markerIndex - 1].sequence + 1 ? 1 : 0);
    }, 0);

    return {
      run,
      score:
        run.length * 1000 +
        continuity * 50 +
        startsAtOne * 100 +
        Math.min(averageEpisodeLength, 5000),
    };
  });

  scoredRuns.sort((a, b) => b.score - a.score);
  return scoredRuns[0]?.run ?? markers;
}

function findSceneMarkers(text: string): ScriptMarker[] {
  const starts = lineStartIndexes(text);
  const lines = text.split("\n");
  const markers: ScriptMarker[] = [];
  const numberChars = "0-9\\u96f6\\u3007\\u4e00\\u4e8c\\u4e24\\u4e09\\u56db\\u4e94\\u516d\\u4e03\\u516b\\u4e5d\\u5341\\u767e\\u5343";
  const bracketedNumberedScene = new RegExp(`^(?:[#>\\-\\s]*)?(?:[\\u3010\\[])?(?:\\u7b2c\\s*([${numberChars}]+)\\s*\\u573a|\\u573a\\u666f\\s*([${numberChars}]+)?|SCENE\\s*(\\d+)?)(?:[\\s:\\uff1a\\-\\u2014\\u2013,\\uff0c\\u3001]*(.*?))?(?:[\\u3011\\]])?(?:\\s*[\\(\\uff08].*)?$`, "i");
  const bracketedZhSlugScene = /^(?:[#>\-\s]*)?(?:[\u3010\[])?([\u5185\u5916][\u666f])(?:[\s:\uff1a\-\u2014\u2013,\uff0c\u3001]*(.+?))?(?:[\u3011\]])?(?:\s*[\(\uff08].*)?$/i;
  const numberedScene = new RegExp(`^(?:[#>\\-\\s]*)?(?:\\u7b2c\\s*([${numberChars}]+)\\s*\\u573a|\\u573a\\u666f\\s*([${numberChars}]+)?|SCENE\\s*(\\d+)?)(?:[\\s:：\\-—–]*(.*))?$`, "i");
  const slugScene = /^(?:[#>\-\s]*)?(INT\.|EXT\.|INT\/EXT\.)(?:\s+|\.\s*)(.+)$/i;
  const zhSlugScene = /^(?:[#>\-\s]*)?([\u5185\u5916][\u666f])(?:[\s:：\-—–]*(.+))?$/i;

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 220) return;
    const numberedMatch = trimmed.match(bracketedNumberedScene) || trimmed.match(numberedScene);
    const slugMatch = trimmed.match(slugScene);
    const zhSlugMatch = trimmed.match(bracketedZhSlugScene) || trimmed.match(zhSlugScene);

    if (numberedMatch) {
      const sequence =
        chineseNumberToInt(numberedMatch[1] || numberedMatch[2] || numberedMatch[3] || "") ??
        markers.length + 1;
      markers.push({
        index: starts[i] ?? 0,
        line: trimmed,
        title: cleanMarkerTitle(numberedMatch[4] || "", trimmed),
        sequence,
      });
      return;
    }

    if (slugMatch || zhSlugMatch) {
      const rawTitle = slugMatch ? `${slugMatch[1]} ${slugMatch[2] || ""}` : `${zhSlugMatch?.[1] || ""} ${zhSlugMatch?.[2] || ""}`;
      markers.push({
        index: starts[i] ?? 0,
        line: trimmed,
        title: cleanMarkerTitle(rawTitle, trimmed),
        sequence: markers.length + 1,
      });
    }
  });

  return dedupeMarkers(markers);
}

function dedupeMarkers(markers: ScriptMarker[]) {
  const seen = new Set<number>();
  return markers
    .sort((a, b) => a.index - b.index || a.sequence - b.sequence)
    .filter((marker) => {
      if (seen.has(marker.index)) return false;
      seen.add(marker.index);
      return true;
    });
}

function extractDialogueCharacters(text: string) {
  const names = new Map<string, number>();
  const ignored = /^(旁白|字幕|音效|音乐|镜头|场景|内景|外景|OS|VO)$/i;
  for (const line of text.split("\n")) {
    const match = line.trim().match(/^([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9_.·]{1,14})\s*[:：]\s*\S/);
    if (!match) continue;
    const name = match[1].trim();
    if (/^第.+[集章节回幕]$/.test(name) || /^(场景|第.+场)/.test(name)) continue;
    if (ignored.test(name)) continue;
    names.set(name, (names.get(name) ?? 0) + 1);
  }
  return [...names.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name)
    .slice(0, 80);
}

function markersInRange(markers: ScriptMarker[], startIndex: number, endIndex: number) {
  return markers.filter((marker) => marker.index >= startIndex && marker.index < endIndex);
}

function buildEpisodes(cleanedText: string, episodeMarkers: ScriptMarker[]): StructuredEpisodeDraft[] {
  const markers = episodeMarkers.length
    ? episodeMarkers
    : [{
        index: 0,
        line: "Full script",
        title: "Full script",
        sequence: 1,
      }];

  return markers.map((marker, index) => {
    const endIndex = markers[index + 1]?.index ?? cleanedText.length;
    const textStart = episodeMarkers.length ? marker.index : 0;
    const text = cleanedText.slice(textStart, endIndex).trim();
    return {
      id: `episode_${String(index + 1).padStart(3, "0")}`,
      episodeIndex: index + 1,
      sequence: marker.sequence || index + 1,
      title: marker.title || `Episode ${index + 1}`,
      markerLine: marker.line,
      startIndex: textStart,
      endIndex,
      text,
      sceneIndexes: [],
      chunkIndexes: [],
      sceneCount: 0,
      chunkCount: 0,
    };
  });
}

function buildScenes(cleanedText: string, episodes: StructuredEpisodeDraft[], sceneMarkers: ScriptMarker[]): StructuredSceneDraft[] {
  const scenes: StructuredSceneDraft[] = [];

  for (const episode of episodes) {
    const episodeScenes = markersInRange(sceneMarkers, episode.startIndex, episode.endIndex);
    const markers = episodeScenes.length
      ? episodeScenes
      : [{
          index: episode.startIndex,
          line: episode.title,
          title: episode.title,
          sequence: 1,
        }];

    markers.forEach((marker, localIndex) => {
      const startIndex = marker.index;
      const endIndex = markers[localIndex + 1]?.index ?? episode.endIndex;
      const sceneIndex = scenes.length + 1;
      const scene: StructuredSceneDraft = {
        id: `scene_${String(sceneIndex).padStart(4, "0")}`,
        episodeIndex: episode.episodeIndex,
        sceneIndex,
        sequence: marker.sequence || localIndex + 1,
        title: marker.title || `${episode.title} Scene ${localIndex + 1}`,
        markerLine: marker.line,
        startIndex,
        endIndex,
        text: cleanedText.slice(startIndex, endIndex).trim(),
        chunkIndexes: [],
        chunkCount: 0,
      };
      scenes.push(scene);
      episode.sceneIndexes.push(scene.sceneIndex);
      episode.sceneCount = episode.sceneIndexes.length;
    });
  }

  return scenes;
}

function findBreakPosition(text: string, start: number, minSize: number, maxSize: number) {
  const minEnd = Math.min(text.length, start + minSize);
  const maxEnd = Math.min(text.length, start + maxSize);
  if (maxEnd >= text.length) return text.length;

  const window = text.slice(minEnd, maxEnd);
  const paragraphBreak = window.lastIndexOf("\n\n");
  if (paragraphBreak >= 0) return minEnd + paragraphBreak + 2;

  const lineBreak = window.lastIndexOf("\n");
  if (lineBreak >= 0) return minEnd + lineBreak + 1;

  const sentenceBreak = Math.max(
    window.lastIndexOf("\u3002"),
    window.lastIndexOf("\uff1b"),
    window.lastIndexOf("\uff01"),
    window.lastIndexOf("\uff1f"),
    window.lastIndexOf(". "),
  );
  if (sentenceBreak >= 0) return minEnd + sentenceBreak + 1;

  return maxEnd;
}

export function createStructuredChunks(
  cleanedText: string,
  summary: Omit<ScriptStructureSummary, "charCount" | "lineCount" | "language" | "episodeCount" | "sceneCount" | "chunkCount"> & Pick<ScriptStructureSummary, "language">,
  options: ChunkingOptions = {},
): StructuredChunkDraft[] {
  const episodes = buildEpisodes(cleanedText, summary.episodeMarkers);
  const scenes = buildScenes(cleanedText, episodes, summary.sceneMarkers);
  return createChunksForScenes(cleanedText, episodes, scenes, options);
}

function createChunksForScenes(
  cleanedText: string,
  episodes: StructuredEpisodeDraft[],
  scenes: StructuredSceneDraft[],
  options: ChunkingOptions = {},
) {
  const minSize = options.minSize ?? DEFAULT_MIN_CHUNK_SIZE;
  const maxSize = options.maxSize ?? DEFAULT_MAX_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP_SIZE;
  const chunks: StructuredChunkDraft[] = [];

  function pushChunkForRange(params: {
    episode: StructuredEpisodeDraft;
    scenesInChunk: StructuredSceneDraft[];
    coreStart: number;
    coreEnd: number;
  }) {
    const firstScene = params.scenesInChunk[0];
    if (!firstScene || params.coreEnd <= params.coreStart) return;

    const startIndex = Math.max(params.episode.startIndex, params.coreStart - overlap);
    const endIndex = Math.min(params.episode.endIndex, params.coreEnd + overlap);
    const chunkIndex = chunks.length + 1;
    const text = cleanedText.slice(startIndex, endIndex).trim();

    chunks.push({
      id: `chunk_${String(chunkIndex).padStart(4, "0")}`,
      chunkIndex: chunkIndex - 1,
      episodeIndex: params.episode.episodeIndex,
      sceneIndex: firstScene.sceneIndex,
      text,
      startIndex,
      endIndex,
      overlapBefore: params.coreStart - startIndex,
      overlapAfter: endIndex - params.coreEnd,
      metadata: {
        coreStartIndex: params.coreStart,
        coreEndIndex: params.coreEnd,
        episodeId: params.episode.id,
        sceneId: firstScene.id,
        episodeTitle: params.episode.title,
        sceneTitle: params.scenesInChunk.map((scene) => scene.title).join(" / "),
        sceneIds: params.scenesInChunk.map((scene) => scene.id),
        sceneIndexes: params.scenesInChunk.map((scene) => scene.sceneIndex),
        dialogueCharacters: extractDialogueCharacters(text),
      },
    });

    for (const scene of params.scenesInChunk) {
      scene.chunkIndexes.push(chunkIndex - 1);
      scene.chunkCount = scene.chunkIndexes.length;
    }
    params.episode.chunkIndexes.push(chunkIndex - 1);
    params.episode.chunkCount = params.episode.chunkIndexes.length;
  }

  function splitLongScene(episode: StructuredEpisodeDraft, scene: StructuredSceneDraft) {
    let coreStart = scene.startIndex;
    const sceneEnd = scene.endIndex;

    while (coreStart < sceneEnd) {
      const localCoreStart = coreStart - scene.startIndex;
      const localText = cleanedText.slice(scene.startIndex, sceneEnd);
      const localCoreEnd = findBreakPosition(localText, localCoreStart, minSize, maxSize);
      const coreEnd = Math.min(sceneEnd, scene.startIndex + localCoreEnd);
      pushChunkForRange({
        episode,
        scenesInChunk: [scene],
        coreStart,
        coreEnd,
      });

      if (coreEnd <= coreStart) break;
      coreStart = coreEnd;
    }
  }

  for (const episode of episodes) {
    const episodeScenes = scenes.filter((scene) => scene.episodeIndex === episode.episodeIndex);
    let group: StructuredSceneDraft[] = [];

    const flushGroup = () => {
      if (group.length === 0) return;
      pushChunkForRange({
        episode,
        scenesInChunk: group,
        coreStart: group[0].startIndex,
        coreEnd: group[group.length - 1].endIndex,
      });
      group = [];
    };

    for (const scene of episodeScenes) {
      const sceneLength = scene.endIndex - scene.startIndex;
      if (sceneLength >= maxSize) {
        flushGroup();
        splitLongScene(episode, scene);
        continue;
      }

      if (group.length === 0) {
        group.push(scene);
        continue;
      }

      const nextLength = scene.endIndex - group[0].startIndex;
      const currentLength = group[group.length - 1].endIndex - group[0].startIndex;
      if (nextLength > maxSize && currentLength >= minSize) {
        flushGroup();
      }
      group.push(scene);
    }

    flushGroup();
  }

  return chunks;
}

export function structureScriptText(rawText: string, options?: ChunkingOptions): StructuredScript {
  const cleanedText = cleanScriptText(rawText);
  const episodeMarkers = findEpisodeMarkers(cleanedText);
  const sceneMarkers = findSceneMarkers(cleanedText);
  const dialogueCharacters = extractDialogueCharacters(cleanedText);
  const episodes = buildEpisodes(cleanedText, episodeMarkers);
  const scenes = buildScenes(cleanedText, episodes, sceneMarkers);
  const chunks = createChunksForScenes(cleanedText, episodes, scenes, options);
  const summary: ScriptStructureSummary = {
    language: detectScriptLanguage(cleanedText),
    charCount: cleanedText.length,
    lineCount: cleanedText ? cleanedText.split("\n").length : 0,
    episodeMarkers,
    sceneMarkers,
    dialogueCharacters,
    episodeCount: episodes.length,
    sceneCount: scenes.length,
    chunkCount: chunks.length,
  };

  return {
    cleanedText,
    summary,
    episodes,
    scenes,
    chunks,
  };
}
