import { NextResponse } from "next/server";
import { TEMPERATURE_STRUCTURED } from "@/lib/config/defaults";
import { db } from "@/lib/db";
import { shots, episodes, projects, characterRelations } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import {
  type ModelConfig,
  findBoundAgent,
  callAndValidateAgent,
  getEpisodeCharacters,
  resolveGenerationMode,
} from "@/lib/generate-utils";
import { extractJSON } from "@/lib/ai/ai-sdk";
import { resolveAIProvider } from "@/lib/ai/provider-factory";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { buildKeyframePromptsRequest } from "@/lib/ai/prompts/keyframe-prompts";
import { buildVisualStyleContext } from "@/lib/visual-style";
import { insertAssetVersion } from "@/lib/shot-asset-utils";
import { id as genId } from "@/lib/id";
import { registerTask } from "@/lib/task-registry";
import { updateTaskProgress, completeTask } from "@/lib/task-utils";

export async function handleGenerateKeyframePrompts(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string,
  taskId?: string
) {
  const generationMode = await resolveGenerationMode(projectId, episodeId);
  const panelStartType = generationMode === "4grid" ? "panel_1" as const : "first_frame" as const;
  const panelEndType = generationMode === "4grid" ? "panel_4" as const : "last_frame" as const;
  const taskSignal = taskId ? registerTask(taskId).signal : undefined;
  if (taskId) updateTaskProgress(taskId, { total: 0, completed: 0, failed: [] });

  // === 智能体路由 ===
  const kpBoundAgent = await findBoundAgent(projectId, "keyframe_prompts");
  if (kpBoundAgent) {
    // Build prompt from shots data (same info as built-in pipeline)
    const batchVersionId = payload?.versionId as string | undefined;
    const kpWhereConds = [eq(shots.projectId, projectId)];
    if (batchVersionId) kpWhereConds.push(eq(shots.versionId, batchVersionId));
    if (episodeId) kpWhereConds.push(eq(shots.episodeId, episodeId));
    const kpAgentShots = await db.select().from(shots).where(and(...kpWhereConds)).orderBy(asc(shots.sequence));
    if (kpAgentShots.length === 0) {
      return NextResponse.json({ error: "没有分镜数据，请先生成分镜" }, { status: 400 });
    }
    const kpAgentChars = await getEpisodeCharacters(projectId, episodeId);
    const kpPrompt = JSON.stringify({
      shots: kpAgentShots.map((s) => ({
        sequence: s.sequence,
        sceneDescription: s.prompt,
        motionScript: s.motionScript,
        cameraDirection: s.cameraDirection,
        duration: s.duration,
      })),
      characters: kpAgentChars.map((c) => ({ name: c.name, description: c.description, visualHint: c.visualHint })),
    }, null, 2);

    const agentResult = await callAndValidateAgent(kpBoundAgent, "keyframe_prompts", kpPrompt);
    if (agentResult instanceof NextResponse) return agentResult;

    // Parse agent output — must be JSON array
    try {
      const kpParsed = JSON.parse(extractJSON(agentResult.text)) as Array<Record<string, unknown>>;
      if (!Array.isArray(kpParsed)) {
        return NextResponse.json({ error: "智能体必须返回 JSON 数组格式的首尾帧提示词" }, { status: 422 });
      }

      const agentGenId = genId();
      let savedCount = 0;
      const agentTotal = kpParsed.length;
      for (let ai = 0; ai < agentTotal; ai++) {
        const entry = kpParsed[ai];
        if (taskSignal?.aborted) { break; }
        const seq = (entry.sequence as number) ?? (entry.shotSequence as number) ?? 0;
        const shot = kpAgentShots.find((s) => s.sequence === seq);
        if (!shot) continue;

        const startFrame = (entry.startFrame || (entry.prompts as string[])?.[0] || "") as string;
        const endFrame = (entry.endFrame || (entry.prompts as string[])?.[1] || "") as string;
        const chars = Array.isArray(entry.characters) ? entry.characters as string[] : [];

        if (startFrame) {
          await insertAssetVersion({ shotId: shot.id, type: panelStartType, sequenceInType: 0, prompt: startFrame, status: "pending", characters: chars, generationId: agentGenId });
          savedCount++;
        }
        if (endFrame) {
          await insertAssetVersion({ shotId: shot.id, type: panelEndType, sequenceInType: 0, prompt: endFrame, status: "pending", characters: chars, generationId: agentGenId });
          savedCount++;
        }
      }
      if (taskId) completeTask(taskId, { total: agentTotal, completed: savedCount > 0 ? agentTotal : 0, failed: [] });
      console.log(`[KeyframePrompts Agent] Saved ${savedCount} assets from ${agentTotal} shots`);
      return NextResponse.json({ updatedCount: agentTotal, totalShots: kpAgentShots.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (taskId) completeTask(taskId, { total: 0, completed: 0, failed: [msg] });
      return NextResponse.json({ error: `智能体首尾帧提示词解析失败: ${msg}` }, { status: 422 });
    }
  }
  // === 智能体路由结束 ===

  if (!modelConfig?.text) {
    return NextResponse.json({ error: "No text model configured" }, { status: 400 });
  }

  const batchVersionId = payload?.versionId as string | undefined;
  const buildWhere = (includeVersion: boolean) => {
    const conds = [eq(shots.projectId, projectId)];
    if (includeVersion && batchVersionId) conds.push(eq(shots.versionId, batchVersionId));
    if (episodeId) conds.push(eq(shots.episodeId, episodeId));
    return and(...conds);
  };

  let allShots = await db
    .select()
    .from(shots)
    .where(buildWhere(true))
    .orderBy(asc(shots.sequence));

  if (allShots.length === 0 && batchVersionId) {
    console.warn(`[GenerateKeyframePrompts] strict filter empty (versionId=${batchVersionId}), falling back to no-version filter`);
    allShots = await db
      .select()
      .from(shots)
      .where(buildWhere(false))
      .orderBy(asc(shots.sequence));
  }

  if (allShots.length === 0) {
    return NextResponse.json({ error: "No shots found" }, { status: 400 });
  }

  const projectCharacters = await getEpisodeCharacters(projectId, episodeId);

  // Pull visual style meta from script (same regex as ref prompts handler)
  const scriptSource = episodeId
    ? await db.select({ script: episodes.script, idea: episodes.idea }).from(episodes).where(eq(episodes.id, episodeId))
    : await db.select({ script: projects.script, idea: projects.idea }).from(projects).where(eq(projects.id, projectId));
  const script = scriptSource[0]?.script || "";
  const idea = scriptSource[0]?.idea || "";
  const visualStyle = buildVisualStyleContext(script, idea);

  // Load character relationships — drives on-screen interaction framing.
  // Enemies must face each other as live combatants, not background icons.
  const kfRelations = await db
    .select()
    .from(characterRelations)
    .where(eq(characterRelations.projectId, projectId));
  let kfRelationsText = "";
  if (kfRelations.length > 0) {
    kfRelationsText = "\n\n## 角色关系（必须用于决定站位、眼神、肢体对抗、画面张力）\n";
    for (const rel of kfRelations) {
      const charA = projectCharacters.find((c) => c.id === rel.characterAId);
      const charB = projectCharacters.find((c) => c.id === rel.characterBId);
      if (charA && charB) {
        kfRelationsText += `- ${charA.name} ↔ ${charB.name}：${rel.relationType}${rel.description ? `（${rel.description}）` : ""}\n`;
      }
    }
    kfRelationsText += `
**关系驱动构图规则（最高优先级）**：
- **敌对 / 对立 / 仇人**：两人必须都是**活人角色同屏对峙**，直接对视、肢体对抗、武器对准彼此。严禁把任一方画成背景的雕像/神像/虚影/浮雕/壁画。
- **友好 / 盟友**：并肩站位、相互掩护、眼神交流。
- **爱慕 / 亲密**：靠近、牵手、拥抱、温柔对视。
- **父女 / 师徒**：长辈在前或侧，晚辈跟随。
- 凡是出现在 characters 列表里的角色，在首尾帧画面里都必须是真实的活人，不允许以雕像/虚影形式出场。
`;
  }

  const textProvider = resolveAIProvider(modelConfig);
  const keyframeSystemPrompt = await resolvePrompt("shot_split_keyframe_assets", {
    userId,
    projectId,
  });

  const loopGenId = genId();

  // Serial per-shot generation: process one shot at a time to avoid rate limits.
  const total = allShots.length;
  let doneCount = 0;
  let updatedCount = 0;
  const failed: string[] = [];
  if (taskId) updateTaskProgress(taskId, { total, completed: 0, failed: [] });
  console.log(`[GenerateKeyframePrompts] Starting serial generation: 0/${total}`);

  for (const shot of allShots) {
    if (taskSignal?.aborted) { break; }
    try {
      const basePromptRequest = buildKeyframePromptsRequest(
        [{
          sequence: shot.sequence,
          prompt: shot.prompt || "",
          motionScript: shot.motionScript,
          cameraDirection: shot.cameraDirection,
        }],
        projectCharacters.map((c) => ({
          name: c.name,
          description: c.description,
          visualHint: c.visualHint,
        })),
        visualStyle
      );
      const promptRequest = kfRelationsText
        ? basePromptRequest + kfRelationsText
        : basePromptRequest;

      const result = await textProvider.generateText(promptRequest, {
        systemPrompt: keyframeSystemPrompt,
        temperature: TEMPERATURE_STRUCTURED,
      });

      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error(`Shot ${shot.sequence}: invalid JSON response`);
      }
      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        shotSequence: number;
        characters?: string[];
        prompts: string[];
      }>;
      const entry = parsed.find((e) => e.shotSequence === shot.sequence) || parsed[0];
      if (!entry || !Array.isArray(entry.prompts) || entry.prompts.length < 2) {
        throw new Error(`Shot ${shot.sequence}: expected 2 prompts (first/last frame)`);
      }

      // Use LLM-provided per-shot character list (only visible chars in this shot).
      // Fall back to empty array if LLM omitted the field — never default to all chars.
      const charsForShot = Array.isArray(entry.characters) ? entry.characters : [];
      await insertAssetVersion({
        shotId: shot.id,
        type: panelStartType,
        sequenceInType: 0,
        prompt: entry.prompts[0],
        status: "pending",
        characters: charsForShot,
        generationId: loopGenId,
      });
      await insertAssetVersion({
        shotId: shot.id,
        type: panelEndType,
        sequenceInType: 0,
        prompt: entry.prompts[1],
        status: "pending",
        characters: charsForShot,
        generationId: loopGenId,
      });
      doneCount++;
      updatedCount++;
      if (taskId) updateTaskProgress(taskId, { total, completed: doneCount, failed });
      console.log(`[GenerateKeyframePrompts] ✓ shot ${shot.sequence} (${doneCount}/${total})`);
    } catch (err) {
      doneCount++;
      failed.push(shot.id);
      if (taskId) updateTaskProgress(taskId, { total, completed: doneCount, failed });
      console.warn(`[GenerateKeyframePrompts] ✗ shot ${shot.sequence} (${doneCount}/${total}): ${String(err)}`);
    }
  }

  if (taskId) completeTask(taskId, { total, completed: updatedCount, failed });
  console.log(`[GenerateKeyframePrompts] Updated ${updatedCount}/${allShots.length} shots (serial)`);
  return NextResponse.json({ updatedCount, totalShots: allShots.length });
}
