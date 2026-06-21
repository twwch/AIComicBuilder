// src/lib/ai/agent-caller.ts
// Multi-platform agent caller: Bailian, Dify, Coze

export type AgentPlatform = "bailian" | "dify" | "coze";

interface AgentConfig {
  platform: AgentPlatform;
  appId: string;
  apiKey: string;
}

// ── Unified streaming caller ────────────────────────────────────────
// Returns a ReadableStream of text chunks (decoded). Throws on error.
export async function callAgentStream(config: AgentConfig, prompt: string): Promise<ReadableStream<Uint8Array>> {
  switch (config.platform) {
    case "bailian":
      return callBailianAgentStream(config, prompt);
    case "dify":
      return callDifyAgentStream(config, prompt);
    case "coze":
      // Coze workflow doesn't have native SSE for run_workflow — fall back to full text
      const text = await callCozeAgent(config, prompt);
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text));
          controller.close();
        },
      });
    default:
      throw new Error(`不支持的智能体平台: ${config.platform}`);
  }
}

async function callBailianAgentStream(
  config: { appId: string; apiKey: string },
  prompt: string,
): Promise<ReadableStream<Uint8Array>> {
  const url = `https://dashscope.aliyuncs.com/api/v1/apps/${config.appId}/completion`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
      "X-DashScope-SSE": "enable",
    },
    body: JSON.stringify({
      input: { prompt },
      parameters: { incremental_output: true },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`百炼智能体请求失败: ${res.status} ${errText.slice(0, 300)}`);
  }
  if (!res.body) throw new Error("百炼智能体返回为空");

  // Parse SSE stream and re-emit raw text deltas
  return new ReadableStream({
    async start(controller) {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const dataStr = line.slice(5).trim();
            if (!dataStr) continue;
            try {
              const json = JSON.parse(dataStr);
              if (json.code) {
                controller.error(new Error(`百炼智能体错误 [${json.code}]: ${json.message ?? "unknown"}`));
                return;
              }
              let chunk = json.output?.text ?? "";
              // 解包 result wrapper
              try {
                const wrapper = JSON.parse(chunk);
                if (wrapper && typeof wrapper === "object" && "result" in wrapper && typeof wrapper.result === "string") {
                  chunk = wrapper.result;
                }
              } catch { /* not wrapped */ }
              if (chunk) controller.enqueue(encoder.encode(chunk));
            } catch { /* skip malformed line */ }
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

async function callDifyAgentStream(
  config: { appId: string; apiKey: string },
  prompt: string,
): Promise<ReadableStream<Uint8Array>> {
  const baseUrl = config.appId.replace(/\/+$/, "");
  const url = `${baseUrl}/v1/workflows/run`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      inputs: { query: prompt, input: prompt },
      response_mode: "streaming",
      user: "aicomic-user",
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Dify 工作流请求失败: ${res.status} ${errText.slice(0, 300)}`);
  }
  if (!res.body) throw new Error("Dify 工作流返回为空");

  return new ReadableStream({
    async start(controller) {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const dataStr = line.slice(5).trim();
            if (!dataStr) continue;
            try {
              const json = JSON.parse(dataStr);
              const event = json.event;
              if (event === "text_chunk" && json.data?.text) {
                controller.enqueue(encoder.encode(json.data.text));
              } else if (event === "node_finished" && json.data?.outputs) {
                // For workflows that don't use text_chunk, emit final output once
                const out = json.data.outputs;
                const txt = out.text || out.result || out.output;
                if (typeof txt === "string") controller.enqueue(encoder.encode(txt));
              }
            } catch { /* skip */ }
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

// ── Unified non-streaming caller ────────────────────────────────────

export async function callAgent(config: AgentConfig, prompt: string): Promise<string> {
  switch (config.platform) {
    case "bailian":
      return callBailianAgent(config, prompt);
    case "dify":
      return callDifyAgent(config, prompt);
    case "coze":
      return callCozeAgent(config, prompt);
    default:
      throw new Error(`不支持的智能体平台: ${config.platform}`);
  }
}


// ── 百炼 (DashScope) ────────────────────────────────────────────────

interface BailianResponse {
  status_code?: number;
  output?: { text?: string; finish_reason?: string };
  code?: string;
  message?: string;
}

export async function callBailianAgent(
  config: { appId: string; apiKey: string },
  prompt: string,
): Promise<string> {
  const url = `https://dashscope.aliyuncs.com/api/v1/apps/${config.appId}/completion`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      input: { prompt },
      parameters: {},
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`百炼智能体请求失败: ${res.status} ${errText.slice(0, 300)}`);
  }

  const json = (await res.json()) as BailianResponse;

  if (json.code) {
    throw new Error(`百炼智能体错误 [${json.code}]: ${json.message ?? "unknown"}`);
  }

  const rawText = json.output?.text;
  if (!rawText) {
    throw new Error("百炼智能体返回为空");
  }
  let text: string = rawText;

  // 百炼 Agent 的工作流模式会将结果包在 {"result": "..."} 中，需要解包
  try {
    const wrapper = JSON.parse(text);
    if (wrapper && typeof wrapper === "object" && "result" in wrapper && typeof wrapper.result === "string") {
      text = wrapper.result;
    }
  } catch {
    // text 不是 JSON wrapper，直接使用原始值
  }

  return text;
}

// ── Dify ─────────────────────────────────────────────────────────────
// API: POST {appId}/v1/workflows/run  (appId 填 Dify 实例 base URL)
// 或    POST https://api.dify.ai/v1/workflows/run
// Auth: Bearer {apiKey}
// Body: { inputs: { query: prompt }, response_mode: "blocking", user: "aicomic" }
// Response: { data: { outputs: { result: "..." } } }

interface DifyResponse {
  data?: {
    outputs?: Record<string, string>;
    error?: string;
    status?: string;
  };
  code?: string;
  message?: string;
}

async function callDifyAgent(
  config: { appId: string; apiKey: string },
  prompt: string,
): Promise<string> {
  // appId is the Dify base URL (e.g. https://api.dify.ai or self-hosted URL)
  const baseUrl = config.appId.replace(/\/+$/, "");
  const url = `${baseUrl}/v1/workflows/run`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      inputs: { query: prompt },
      response_mode: "blocking",
      user: "aicomic-user",
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Dify 工作流请求失败: ${res.status} ${errText.slice(0, 300)}`);
  }

  const json = (await res.json()) as DifyResponse;

  if (json.code) {
    throw new Error(`Dify 错误 [${json.code}]: ${json.message ?? "unknown"}`);
  }

  if (json.data?.error) {
    throw new Error(`Dify 工作流执行失败: ${json.data.error}`);
  }

  // Dify outputs is a dict, try common keys: result, text, output
  const outputs = json.data?.outputs;
  if (!outputs) {
    throw new Error("Dify 工作流返回为空");
  }

  const text = outputs.result || outputs.text || outputs.output || Object.values(outputs)[0];
  if (!text) {
    throw new Error(`Dify 工作流输出为空: ${JSON.stringify(outputs)}`);
  }

  return text;
}

// ── Coze ─────────────────────────────────────────────────────────────
// API: POST https://api.coze.cn/v1/workflow/run
// Auth: Bearer {apiKey} (Personal Access Token)
// Body: { workflow_id: appId, parameters: { input: prompt } }
// Response: { code: 0, data: "..." } or { code: 0, data: "{json}" }

interface CozeResponse {
  code?: number;
  msg?: string;
  data?: string;
  debug_url?: string;
}

async function callCozeAgent(
  config: { appId: string; apiKey: string },
  prompt: string,
): Promise<string> {
  const url = "https://api.coze.cn/v1/workflow/run";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      workflow_id: config.appId,
      parameters: { input: prompt },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Coze 工作流请求失败: ${res.status} ${errText.slice(0, 300)}`);
  }

  const json = (await res.json()) as CozeResponse;

  if (json.code !== 0) {
    throw new Error(`Coze 错误 [${json.code}]: ${json.msg ?? "unknown"}`);
  }

  if (!json.data) {
    throw new Error("Coze 工作流返回为空");
  }

  // Coze workflow returns JSON string like {"result":"..."} — extract the result value
  try {
    const parsed = JSON.parse(json.data);
    if (parsed.result !== undefined) return parsed.result;
  } catch (e) {
    console.warn("[Coze] data 字段 JSON 解析失败, 返回原始值:", e);
  }

  return json.data;
}

// ── JSON 提取 ───────────────────────────────────────────────────────

function extractJSON(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  const jsonMatch = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (jsonMatch) return jsonMatch[1].trim();

  return text.trim();
}

// ── Schema 校验 ─────────────────────────────────────────────────────

export type AgentCategory = "script_outline" | "script_generate" | "script_parse" | "character_extract" | "shot_split" | "keyframe_prompts" | "video_prompts" | "ref_image_prompts" | "ref_video_prompts";

export function validateAgentOutput(category: AgentCategory, rawText: string): unknown {
  const jsonStr = extractJSON(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(
      `智能体返回的内容不是有效 JSON。请修改智能体的输出格式。\n原始返回: ${rawText.slice(0, 500)}`,
    );
  }

  console.log(`[AgentValidate] category=${category}, parsed keys:`, typeof parsed === 'object' && parsed ? Object.keys(parsed as Record<string, unknown>) : typeof parsed);
  console.log(`[AgentValidate] rawText (first 1000):`, rawText.slice(0, 1000));

  switch (category) {
    case "script_outline":
    case "script_generate":
      // Both return free-form text — wrap in {outline}/{script} loosely
      return validateScriptOutline(parsed);
    case "script_parse":
      return validateScriptParse(parsed);
    case "character_extract":
      return validateCharacterExtract(parsed);
    case "shot_split":
      return validateShotSplit(parsed);
    case "keyframe_prompts":
    case "video_prompts":
    case "ref_image_prompts":
    case "ref_video_prompts":
      return parsed;
  }
}

function assertField(obj: Record<string, unknown>, field: string, type: string, context: string) {
  if (!(field in obj) || obj[field] === undefined || obj[field] === null) {
    throw new Error(`智能体输出缺少必填字段 "${field}"（${context}）`);
  }
  if (type === "string" && typeof obj[field] !== "string") {
    throw new Error(`智能体输出字段 "${field}" 应为字符串类型（${context}）`);
  }
  if (type === "number" && typeof obj[field] !== "number") {
    throw new Error(`智能体输出字段 "${field}" 应为数字类型（${context}）`);
  }
  if (type === "array" && !Array.isArray(obj[field])) {
    throw new Error(`智能体输出字段 "${field}" 应为数组类型（${context}）`);
  }
}

function validateScriptOutline(parsed: unknown): { outline: string } {
  if (typeof parsed === "string") {
    return { outline: parsed };
  }
  const obj = parsed as Record<string, unknown>;
  assertField(obj, "outline", "string", "script_outline");
  return { outline: obj.outline as string };
}

function validateScriptParse(parsed: unknown): unknown {
  const obj = parsed as Record<string, unknown>;
  assertField(obj, "title", "string", "script_parse");
  assertField(obj, "synopsis", "string", "script_parse");
  assertField(obj, "scenes", "array", "script_parse");
  const scenes = obj.scenes as Array<Record<string, unknown>>;
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    assertField(s, "sceneNumber", "number", `script_parse.scenes[${i}]`);
    assertField(s, "setting", "string", `script_parse.scenes[${i}]`);
    assertField(s, "description", "string", `script_parse.scenes[${i}]`);
  }
  return parsed;
}

function validateCharacterExtract(parsed: unknown): unknown {
  if (Array.isArray(parsed)) {
    for (let i = 0; i < parsed.length; i++) {
      const c = parsed[i] as Record<string, unknown>;
      assertField(c, "name", "string", `character[${i}]`);
      assertField(c, "description", "string", `character[${i}]`);
    }
    return { characters: parsed };
  }

  const obj = parsed as Record<string, unknown>;
  assertField(obj, "characters", "array", "character_extract");
  const chars = obj.characters as Array<Record<string, unknown>>;
  for (let i = 0; i < chars.length; i++) {
    assertField(chars[i], "name", "string", `characters[${i}]`);
    assertField(chars[i], "description", "string", `characters[${i}]`);
  }
  return parsed;
}

function validateShotSplit(parsed: unknown): unknown {
  if (!Array.isArray(parsed)) {
    throw new Error("智能体输出 shot_split 应为数组类型");
  }
  if (parsed.length === 0) return parsed;

  const first = parsed[0] as Record<string, unknown>;

  // Format A: 按场景分组 [{ sceneTitle, shots: [...] }]
  if ("sceneTitle" in first && "shots" in first) {
    for (let i = 0; i < parsed.length; i++) {
      const scene = parsed[i] as Record<string, unknown>;
      assertField(scene, "sceneTitle", "string", `scene[${i}]`);
      assertField(scene, "shots", "array", `scene[${i}]`);
      const shots = scene.shots as Array<Record<string, unknown>>;
      for (let j = 0; j < shots.length; j++) {
        assertField(shots[j], "sequence", "number", `scene[${i}].shots[${j}]`);
      }
    }
    return parsed;
  }

  // Format B: 扁平数组 [{ sequence, prompt/startFrame, ... }] — 智能体常见输出
  // 校验每个 shot 有 sequence 字段即可
  for (let i = 0; i < parsed.length; i++) {
    const shot = parsed[i] as Record<string, unknown>;
    assertField(shot, "sequence", "number", `shot[${i}]`);
  }
  // 包装成 Format A 以便下游统一处理
  return [{ sceneTitle: "Scene 1", sceneDescription: "", lighting: "", colorPalette: "", shots: parsed }];
}
