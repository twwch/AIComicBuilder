import { NextResponse } from "next/server";
import { streamText } from "ai";
import { createLanguageModel, extractJSON } from "@/lib/ai/ai-sdk";
import { db } from "@/lib/db";
import { projects, episodes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { callAgentStream } from "@/lib/ai/agent-caller";
import {
  type ModelConfig,
  findBoundAgent,
} from "@/lib/generate-utils";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";

import { TEMPERATURE_GENERAL, TEMPERATURE_CREATIVE } from "@/lib/config/defaults";
import { buildScriptGeneratePrompt } from "@/lib/ai/prompts/script-generate";
import { buildScriptParsePrompt } from "@/lib/ai/prompts/script-parse";
import { buildVisualStylePromptLead } from "@/lib/visual-style";

export async function handleScriptOutlineAction(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  const idea = (payload?.idea as string) || "";
  const visualStyleLead = buildVisualStylePromptLead(undefined, idea);
  if (!idea.trim()) {
    return NextResponse.json({ error: "No idea provided" }, { status: 400 });
  }

  // === 智能体路由（流式）===
  const boundAgent = await findBoundAgent(projectId, "script_outline");
  if (boundAgent) {
    try {
      const agentStream = await callAgentStream(
        { platform: boundAgent.platform as "bailian" | "dify" | "coze", appId: boundAgent.appId, apiKey: boundAgent.apiKey },
        `${visualStyleLead ? `${visualStyleLead}\n\n` : ""}创意构想：${idea}`,
      );
      // TransformStream: accumulate chunks, save to DB in flush (tied to response lifecycle)
      const decoder = new TextDecoder();
      let outlineBuf = "";
      const saveTransform = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          outlineBuf += decoder.decode(chunk, { stream: true });
          controller.enqueue(chunk);
        },
        async flush() {
          const outline = outlineBuf.trim();
          if (!outline) return;
          try {
            if (episodeId) {
              await db.update(episodes).set({ outline, updatedAt: new Date() }).where(eq(episodes.id, episodeId));
            } else {
              await db.update(projects).set({ outline, updatedAt: new Date() }).where(eq(projects.id, projectId));
            }
            console.log(`[ScriptOutline Agent] Saved outline (${outline.length} chars)`);
          } catch (err) {
            console.error(`[ScriptOutline Agent] DB save failed:`, err);
          }
        },
      });
      return new Response(agentStream.pipeThrough(saveTransform), {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Agent script_outline] Error:`, message);
      return NextResponse.json({ error: message }, { status: 422 });
    }
  }
  // === 智能体路由结束 ===

  if (!modelConfig?.text) {
    return NextResponse.json(
      { error: "No text model configured" },
      { status: 400 }
    );
  }

  const model = createLanguageModel(modelConfig.text);
  const outlineSystem = await resolvePrompt("script_outline", { userId, projectId });

  const result = streamText({
    model,
    system: outlineSystem,
    prompt: `${visualStyleLead ? `${visualStyleLead}\n\n` : ""}创意构想：${idea}`,
    temperature: TEMPERATURE_GENERAL,
    onFinish: async ({ text }) => {
      try {
        const outline = text.trim();
        if (episodeId) {
          await db
            .update(episodes)
            .set({ outline, updatedAt: new Date() })
            .where(eq(episodes.id, episodeId));
        } else {
          await db
            .update(projects)
            .set({ outline, updatedAt: new Date() })
            .where(eq(projects.id, projectId));
        }
        console.log(`[ScriptOutline] Saved outline for ${episodeId || projectId}`);
      } catch (err) {
        console.error("[ScriptOutline] onFinish error:", err);
      }
    },
  });

  return result.toTextStreamResponse();
}

export async function handleScriptGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  const idea = (payload?.idea as string) || "";
  if (!idea.trim()) {
    return NextResponse.json({ error: "No idea provided" }, { status: 400 });
  }

  // Save the original idea before generating
  if (episodeId) {
    await db
      .update(episodes)
      .set({ idea, updatedAt: new Date() })
      .where(eq(episodes.id, episodeId));
  } else {
    await db
      .update(projects)
      .set({ idea, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
  }

  // === 智能体路由（流式）===
  const sgBoundAgent = await findBoundAgent(projectId, "script_generate");
  if (sgBoundAgent) {
    try {
      const visualStyleLead = buildVisualStylePromptLead(undefined, idea);
      const outline = (payload?.outline as string) || "";
      const basePrompt = outline
        ? `创意构想：${idea}\n\n故事大纲：${outline}`
        : `创意构想：${idea}`;
      const agentPrompt = visualStyleLead
        ? `${visualStyleLead}\n\n${basePrompt}`
        : basePrompt;
      const agentStream = await callAgentStream(
        { platform: sgBoundAgent.platform as "bailian" | "dify" | "coze", appId: sgBoundAgent.appId, apiKey: sgBoundAgent.apiKey },
        agentPrompt,
      );
      const sgDecoder = new TextDecoder();
      let scriptBuf = "";
      const sgSaveTransform = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          scriptBuf += sgDecoder.decode(chunk, { stream: true });
          controller.enqueue(chunk);
        },
        async flush() {
          const script = scriptBuf.trim();
          if (!script) return;
          try {
            if (episodeId) {
              await db.update(episodes).set({ script, updatedAt: new Date() }).where(eq(episodes.id, episodeId));
            } else {
              await db.update(projects).set({ script, updatedAt: new Date() }).where(eq(projects.id, projectId));
            }
            console.log(`[ScriptGenerate Agent] Saved script (${script.length} chars)`);
          } catch (err) {
            console.error(`[ScriptGenerate Agent] DB save failed:`, err);
          }
        },
      });
      return new Response(agentStream.pipeThrough(sgSaveTransform), {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Agent script_generate] Error:`, message);
      return NextResponse.json({ error: message }, { status: 422 });
    }
  }
  // === 智能体路由结束 ===

  if (!modelConfig?.text) {
    return NextResponse.json(
      { error: "No text model configured" },
      { status: 400 }
    );
  }

  // Use outline from payload (latest from UI) or fallback to DB
  let outline = (payload?.outline as string) || "";
  if (!outline) {
    if (episodeId) {
      const [ep] = await db.select({ outline: episodes.outline }).from(episodes).where(eq(episodes.id, episodeId));
      outline = ep?.outline || "";
    } else {
      const [proj] = await db.select({ outline: projects.outline }).from(projects).where(eq(projects.id, projectId));
      outline = proj?.outline || "";
    }
  }

  const outlineContext = outline
    ? `\n\n【故事大纲 - 请严格按照以下大纲结构展开剧本】\n${outline}\n\n`
    : "";

  // Fetch world setting from project
  let worldSettingContext = "";
  const [projForWorld] = await db.select({ worldSetting: projects.worldSetting }).from(projects).where(eq(projects.id, projectId));
  if (projForWorld?.worldSetting) {
    worldSettingContext = `\n\n【世界观设定】\n${projForWorld.worldSetting}\n\n剧本必须与此世界观设定保持一致。\n\n`;
  }

  const model = createLanguageModel(modelConfig.text);
  const scriptGenerateSystem = await resolvePrompt("script_generate", { userId, projectId });

  const result = streamText({
    model,
    system: scriptGenerateSystem,
    prompt: worldSettingContext + outlineContext + buildScriptGeneratePrompt(idea),
    temperature: TEMPERATURE_CREATIVE,
    onFinish: async ({ text }) => {
      try {
        if (episodeId) {
          await db
            .update(episodes)
            .set({ script: text, updatedAt: new Date() })
            .where(eq(episodes.id, episodeId));
        } else {
          await db
            .update(projects)
            .set({ script: text, updatedAt: new Date() })
            .where(eq(projects.id, projectId));
        }
        console.log(`[ScriptGenerate] Saved generated script for ${episodeId || projectId}`);
      } catch (err) {
        console.error("[ScriptGenerate] onFinish error:", err);
      }
    },
  });

  return result.toTextStreamResponse();
}

export async function handleScriptParseStream(
  projectId: string,
  userId: string,
  _payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  let script: string | null = null;

  if (episodeId) {
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    script = episode?.script ?? null;
  } else {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    script = project?.script ?? null;
  }

  if (!script) {
    return NextResponse.json(
      { error: "Project or script not found" },
      { status: 404 }
    );
  }

    // === 智能体路由（流式）===
  const boundAgent = await findBoundAgent(projectId, "script_parse");
  if (boundAgent) {
    try {
      const agentStream = await callAgentStream(
        { platform: boundAgent.platform as "bailian" | "dify" | "coze", appId: boundAgent.appId, apiKey: boundAgent.apiKey },
        script,
      );
      const spSaveTransform = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) { controller.enqueue(chunk); },
        async flush() {
          try {
            if (episodeId) {
              await db.update(episodes).set({ updatedAt: new Date() }).where(eq(episodes.id, episodeId));
            } else {
              await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
            }
            console.log(`[ScriptParse Agent] Updated timestamp`);
          } catch (err) {
            console.error(`[ScriptParse Agent] DB update failed:`, err);
          }
        },
      });
      return new Response(agentStream.pipeThrough(spSaveTransform), {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Agent script_parse] Error:`, message);
      return NextResponse.json({ error: message }, { status: 422 });
    }
  }
  // === 智能体路由结束 ===

  if (!modelConfig?.text) {
    return NextResponse.json(
      { error: "No text model configured" },
      { status: 400 }
    );
  }

  const model = createLanguageModel(modelConfig.text);
  const scriptParseSystem = await resolvePrompt("script_parse", { userId, projectId });

  const result = streamText({
    model,
    system: scriptParseSystem,
    prompt: buildScriptParsePrompt(script),
    temperature: TEMPERATURE_GENERAL,
    onFinish: async ({ text }) => {
      try {
        const screenplay = extractJSON(text);
        JSON.parse(screenplay); // validate JSON
        if (episodeId) {
          await db.update(episodes).set({ updatedAt: new Date() }).where(eq(episodes.id, episodeId));
        } else {
          await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
        }
        console.log(`[ScriptParse] Parsed screenplay for ${episodeId || projectId}`);
      } catch (err) {
        console.error("[ScriptParse] onFinish error:", err);
      }
    },
  });

  return result.toTextStreamResponse();
}
