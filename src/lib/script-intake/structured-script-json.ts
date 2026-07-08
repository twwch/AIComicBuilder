import type {
  StructuredChunkDraft,
  StructuredEpisodeDraft,
  StructuredSceneDraft,
  StructuredScript,
} from "@/lib/script-structure";

export type StructuredScriptUnitType = "heading" | "dialogue" | "narration" | "action" | "emotion";

export interface StructuredScriptUnit {
  id: string;
  type: StructuredScriptUnitType;
  episodeId: string;
  sceneId: string;
  chunkIds: string[];
  lineIndex: number;
  startIndex: number;
  endIndex: number;
  speaker?: string;
  text: string;
  sourceText: string;
  emotionTags: string[];
  actionTags: string[];
}

export interface StructuredScriptJson {
  schemaVersion: "structured_script_v1";
  generatedAt: string;
  source: {
    charCount: number;
    lineCount: number;
    language: string;
  };
  summary: StructuredScript["summary"] & {
    unitCount: number;
    dialogueCount: number;
    narrationCount: number;
    actionCount: number;
    emotionCount: number;
  };
  episodes: Array<Pick<
    StructuredEpisodeDraft,
    "id" | "episodeIndex" | "sequence" | "title" | "startIndex" | "endIndex" | "sceneIndexes" | "sceneCount" | "chunkCount"
  > & {
    sceneIds: string[];
    unitCount: number;
  }>;
  scenes: Array<Pick<
    StructuredSceneDraft,
    "id" | "episodeIndex" | "sceneIndex" | "sequence" | "title" | "startIndex" | "endIndex" | "chunkCount"
  > & {
    chunkIds: string[];
    unitIds: string[];
    unitCounts: Record<StructuredScriptUnitType, number>;
  }>;
  chunks: Array<Pick<
    StructuredChunkDraft,
    "id" | "chunkIndex" | "episodeIndex" | "sceneIndex" | "startIndex" | "endIndex" | "overlapBefore" | "overlapAfter" | "metadata"
  > & {
    unitIds: string[];
  }>;
  units: StructuredScriptUnit[];
  statistics: {
    unitCounts: Record<StructuredScriptUnitType, number>;
    speakerCounts: Array<{ speaker: string; count: number }>;
    emotionCounts: Array<{ emotion: string; count: number }>;
  };
}

const narratorNames = new Set(["旁白", "画外音", "字幕", "OS", "VO", "V.O", "O.S"]);

const emotionTerms = [
  "愤怒",
  "生气",
  "震惊",
  "惊讶",
  "害怕",
  "恐惧",
  "紧张",
  "焦急",
  "委屈",
  "难过",
  "悲伤",
  "哭",
  "哽咽",
  "冷笑",
  "微笑",
  "笑",
  "得意",
  "尴尬",
  "沉默",
  "犹豫",
  "坚定",
  "温柔",
  "羞愧",
  "慌乱",
  "崩溃",
];

const actionTerms = [
  "走",
  "跑",
  "冲",
  "看",
  "盯",
  "望",
  "拿",
  "放",
  "推",
  "拉",
  "坐",
  "站",
  "跪",
  "转身",
  "抬头",
  "低头",
  "伸手",
  "抱",
  "摔",
  "拍",
  "敲",
  "递",
  "打开",
  "关上",
  "镜头",
  "特写",
  "切到",
];

function pad(value: number, length = 4) {
  return String(value).padStart(length, "0");
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function findTags(text: string, terms: string[]) {
  return terms.filter((term) => text.includes(term));
}

function isHeading(line: string) {
  return /^(第\s*[0-9一二两三四五六七八九十百千]+\s*[集场幕回]|场景\s*[0-9一二两三四五六七八九十百千]*|SCENE\s*\d*|INT\.|EXT\.|内景|外景)/i.test(line);
}

function parseDialogue(line: string) {
  const match = line.match(/^([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9_.·\s]{0,16})\s*[:：]\s*(\S[\s\S]*)$/);
  if (!match) return null;
  const speaker = clean(match[1]);
  const text = clean(match[2]);
  if (!speaker || !text) return null;
  if (/^(场景|镜头|音效|音乐|动作|时间|地点)$/i.test(speaker)) return null;
  return { speaker, text };
}

function classifyLine(line: string): {
  type: StructuredScriptUnitType;
  speaker?: string;
  text: string;
  emotionTags: string[];
  actionTags: string[];
} {
  const trimmed = clean(line);
  const dialogue = parseDialogue(trimmed);
  const emotionTags = findTags(trimmed, emotionTerms);
  const actionTags = findTags(trimmed, actionTerms);

  if (isHeading(trimmed)) {
    return { type: "heading", text: trimmed, emotionTags, actionTags };
  }

  if (dialogue) {
    const normalizedSpeaker = dialogue.speaker.toUpperCase();
    const isNarrator = narratorNames.has(dialogue.speaker) || narratorNames.has(normalizedSpeaker);
    return {
      type: isNarrator ? "narration" : "dialogue",
      speaker: dialogue.speaker,
      text: dialogue.text,
      emotionTags: findTags(dialogue.text, emotionTerms),
      actionTags: findTags(dialogue.text, actionTerms),
    };
  }

  if (emotionTags.length > 0 && actionTags.length === 0 && trimmed.length <= 80) {
    return { type: "emotion", text: trimmed, emotionTags, actionTags };
  }

  if (/^(旁白|画外音|字幕)[：:]/.test(trimmed)) {
    return { type: "narration", text: trimmed.replace(/^(旁白|画外音|字幕)[：:]\s*/, ""), emotionTags, actionTags };
  }

  if (actionTags.length > 0 || /[。！？.!?]$/.test(trimmed)) {
    return { type: "action", text: trimmed, emotionTags, actionTags };
  }

  return { type: "narration", text: trimmed, emotionTags, actionTags };
}

function sceneSourceText(sourceText: string, scene: StructuredSceneDraft) {
  const raw = sourceText.slice(scene.startIndex, scene.endIndex);
  const leadingTrim = raw.length - raw.trimStart().length;
  return {
    text: raw.trim(),
    startIndex: scene.startIndex + leadingTrim,
  };
}

function lineRanges(text: string, baseStartIndex: number) {
  const lines = text.split("\n");
  let offset = 0;
  return lines.map((line, index) => {
    const leadingTrim = line.length - line.trimStart().length;
    const trimmed = line.trim();
    const startIndex = baseStartIndex + offset + leadingTrim;
    const endIndex = startIndex + trimmed.length;
    offset += line.length + 1;
    return { index, raw: line, trimmed, startIndex, endIndex };
  });
}

function chunkIdsForRange(chunks: StructuredChunkDraft[], startIndex: number, endIndex: number) {
  return chunks
    .filter((chunk) => startIndex < chunk.endIndex && endIndex > chunk.startIndex)
    .map((chunk) => chunk.id);
}

function makeEmptyUnitCounts(): Record<StructuredScriptUnitType, number> {
  return {
    heading: 0,
    dialogue: 0,
    narration: 0,
    action: 0,
    emotion: 0,
  };
}

function incrementCount<K extends string>(map: Map<K, number>, key: K) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedSpeakerCounts(map: Map<string, number>) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([speaker, count]) => ({ speaker, count }));
}

function sortedEmotionCounts(map: Map<string, number>) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([emotion, count]) => ({ emotion, count }));
}

export function buildStructuredScriptJson(
  structured: StructuredScript,
  sourceText = structured.cleanedText,
): StructuredScriptJson {
  const units: StructuredScriptUnit[] = [];
  const globalUnitCounts = makeEmptyUnitCounts();
  const speakerCounts = new Map<string, number>();
  const emotionCounts = new Map<string, number>();
  const unitIdsByScene = new Map<string, string[]>();
  const unitIdsByChunk = new Map<string, string[]>();
  const unitCountsByScene = new Map<string, Record<StructuredScriptUnitType, number>>();

  for (const scene of structured.scenes) {
    const source = sceneSourceText(sourceText, scene);
    const sceneCounts = makeEmptyUnitCounts();
    for (const line of lineRanges(source.text, source.startIndex)) {
      if (!line.trimmed) continue;
      const classified = classifyLine(line.trimmed);
      const unitId = `unit_${pad(units.length + 1, 5)}`;
      const chunkIds = chunkIdsForRange(structured.chunks, line.startIndex, line.endIndex);
      const unit: StructuredScriptUnit = {
        id: unitId,
        type: classified.type,
        episodeId: `episode_${pad(scene.episodeIndex, 3)}`,
        sceneId: scene.id,
        chunkIds,
        lineIndex: line.index,
        startIndex: line.startIndex,
        endIndex: line.endIndex,
        ...(classified.speaker && { speaker: classified.speaker }),
        text: classified.text,
        sourceText: line.trimmed,
        emotionTags: classified.emotionTags,
        actionTags: classified.actionTags,
      };
      units.push(unit);

      globalUnitCounts[unit.type] += 1;
      sceneCounts[unit.type] += 1;
      if (unit.speaker) incrementCount(speakerCounts, unit.speaker);
      for (const emotion of unit.emotionTags) incrementCount(emotionCounts, emotion);

      unitIdsByScene.set(scene.id, [...(unitIdsByScene.get(scene.id) || []), unitId]);
      for (const chunkId of chunkIds) {
        unitIdsByChunk.set(chunkId, [...(unitIdsByChunk.get(chunkId) || []), unitId]);
      }
    }
    unitCountsByScene.set(scene.id, sceneCounts);
  }

  return {
    schemaVersion: "structured_script_v1",
    generatedAt: new Date().toISOString(),
    source: {
      charCount: structured.cleanedText.length,
      lineCount: structured.cleanedText ? structured.cleanedText.split("\n").length : 0,
      language: structured.summary.language,
    },
    summary: {
      ...structured.summary,
      unitCount: units.length,
      dialogueCount: globalUnitCounts.dialogue,
      narrationCount: globalUnitCounts.narration,
      actionCount: globalUnitCounts.action,
      emotionCount: globalUnitCounts.emotion,
    },
    episodes: structured.episodes.map((episode) => {
      const scenes = structured.scenes.filter((scene) => scene.episodeIndex === episode.episodeIndex);
      return {
        id: episode.id,
        episodeIndex: episode.episodeIndex,
        sequence: episode.sequence,
        title: episode.title,
        startIndex: episode.startIndex,
        endIndex: episode.endIndex,
        sceneIndexes: episode.sceneIndexes,
        sceneCount: episode.sceneCount,
        chunkCount: episode.chunkCount,
        sceneIds: scenes.map((scene) => scene.id),
        unitCount: scenes.reduce((total, scene) => total + (unitIdsByScene.get(scene.id)?.length || 0), 0),
      };
    }),
    scenes: structured.scenes.map((scene) => ({
      id: scene.id,
      episodeIndex: scene.episodeIndex,
      sceneIndex: scene.sceneIndex,
      sequence: scene.sequence,
      title: scene.title,
      startIndex: scene.startIndex,
      endIndex: scene.endIndex,
      chunkCount: scene.chunkCount,
      chunkIds: structured.chunks
        .filter((chunk) => chunk.sceneIndex === scene.sceneIndex)
        .map((chunk) => chunk.id),
      unitIds: unitIdsByScene.get(scene.id) || [],
      unitCounts: unitCountsByScene.get(scene.id) || makeEmptyUnitCounts(),
    })),
    chunks: structured.chunks.map((chunk) => ({
      id: chunk.id,
      chunkIndex: chunk.chunkIndex,
      episodeIndex: chunk.episodeIndex,
      sceneIndex: chunk.sceneIndex,
      startIndex: chunk.startIndex,
      endIndex: chunk.endIndex,
      overlapBefore: chunk.overlapBefore,
      overlapAfter: chunk.overlapAfter,
      metadata: chunk.metadata,
      unitIds: unitIdsByChunk.get(chunk.id) || [],
    })),
    units,
    statistics: {
      unitCounts: globalUnitCounts,
      speakerCounts: sortedSpeakerCounts(speakerCounts),
      emotionCounts: sortedEmotionCounts(emotionCounts),
    },
  };
}
