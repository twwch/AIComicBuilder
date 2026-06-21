import { NextResponse } from "next/server";
import { ModelListSchema, parseOrThrow } from "@/lib/validation";

interface ModelItem {
  id: string;
  name: string;
}

function buildModelsUrl(baseUrl: string): string {
  const url = baseUrl.replace(/\/+$/, "");
  // If baseUrl already ends with /v1, don't duplicate
  if (url.endsWith("/v1")) {
    return url + "/models";
  }
  return url + "/v1/models";
}

async function fetchModels(baseUrl: string, apiKey: string): Promise<ModelItem[]> {
  const url = buildModelsUrl(baseUrl);
  console.log("[models/list] Fetching:", url);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { data?: { id: string }[] };
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error("Unexpected response format: missing data array");
  }
  return data.data.map((m) => ({ id: m.id, name: m.id }));
}

async function fetchGeminiModels(baseUrl: string, apiKey: string): Promise<ModelItem[]> {
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  console.log("[models/list] Fetching Gemini:", url.replace(apiKey, "***"));

  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { models?: { name: string; displayName?: string }[] };
  if (!data.models || !Array.isArray(data.models)) {
    throw new Error("Unexpected Gemini response format: missing models array");
  }
  return data.models.map((m) => {
    const id = m.name.replace(/^models\//, "");
    return { id, name: m.displayName || id };
  });
}

export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const body = parseOrThrow(ModelListSchema, raw);

    if (body.protocol === "kling" && body.capability === "video") {
      return NextResponse.json({
        models: [
          { id: "kling-v1", name: "Kling v1" },
          { id: "kling-v1-5", name: "Kling v1.5" },
          { id: "kling-v1-6", name: "Kling v1.6" },
          { id: "kling-v2", name: "Kling v2" },
          { id: "kling-v2-new", name: "Kling v2 New" },
          { id: "kling-v2-1", name: "Kling v2.1" },
          { id: "kling-v2-master", name: "Kling v2 Master" },
          { id: "kling-v2-1-master", name: "Kling v2.1 Master" },
          { id: "kling-v2-5-turbo", name: "Kling v2.5 Turbo" },
        ],
      });
    }

    if (body.protocol === "kling" && body.capability === "image") {
      return NextResponse.json({
        models: [
          { id: "kling-v1", name: "Kling Image" },
        ],
      });
    }

    if (body.protocol === "ucloud-seedance") {
      return NextResponse.json({
        models: [
          { id: "doubao-seedance-1-5-pro-251215", name: "Seedance 1.5 Pro (UCloud)" },
          { id: "doubao-seedance-2-0-260128", name: "Seedance 2.0 (UCloud)" },
        ],
      });
    }

    if (body.protocol === "wan" && body.capability === "video") {
      return NextResponse.json({
        models: [
          { id: "wan2.7-t2v", name: "Wan 2.7 文生视频" },
          { id: "wan2.7-r2v", name: "Wan 2.7 参考生视频" },
          { id: "wan2.6-t2v", name: "Wan 2.6 文生视频" },
          { id: "wan2.6-i2v-flash", name: "Wan 2.6 图生视频 Flash" },
          { id: "wan2.6-i2v", name: "Wan 2.6 图生视频" },
          { id: "wan2.6-r2v", name: "Wan 2.6 参考生视频" },
          { id: "wan2.6-r2v-flash", name: "Wan 2.6 参考生视频 Flash" },
        ],
      });
    }

    if (body.protocol === "comfyui" && body.capability === "video") {
      return NextResponse.json({
        models: [
          { id: "wan2.2-i2v-comfyui", name: "Wan 2.2 图生视频 (ComfyUI)" },
          { id: "wan-firstlast", name: "Wan 首尾帧视频 (ComfyUI)" },
          { id: "wan-i2v", name: "Wan 图生视频 (ComfyUI)" },
          { id: "ltx-i2v", name: "LTX Video 2.3 图生视频" },
          { id: "ltx-i2v-pro", name: "LTX Video 2.3 图生视频 Pro (4LoRA+NAG双采样)" },
          { id: "ltx-t2v", name: "LTX Video 2.3 文生视频" },
          { id: "ltx-flf2v", name: "LTX Video 2.3 首尾帧视频" },
          { id: "ltx-4grid", name: "LTX-2.3 四宫格分镜（4图引导+音画同步）" },
          { id: "ltx-2-multiguide", name: "LTX-2.3 多图引导（角色参考+分段提示）" },
        ],
      });
    }

    if (body.protocol === "comfyui" && body.capability === "image") {
      return NextResponse.json({
        models: [
          { id: "z-image-turbo-comfyui", name: "Z-Image Turbo (ComfyUI)" },
          { id: "qwen-edit-dual", name: "Qwen Edit Dual (ComfyUI)" },
          { id: "ideogram4-comfyui", name: "Ideogram 4.0 (ComfyUI)" },
          { id: "hidream-o1-comfyui", name: "HiDream-O1 (ComfyUI)" },
          { id: "ernie-image-comfyui", name: "ERNIE-Image (ComfyUI)" },
        ],
      });
    }

    if (body.protocol === "dashscope" && body.capability === "image") {
      return NextResponse.json({
        models: [
          { id: "wan2.7-image-pro", name: "Wan 2.7 Image Pro (4K)" },
          { id: "wan2.7-image", name: "Wan 2.7 Image" },
          { id: "qwen-image-2.0-pro", name: "Qwen Image 2.0 Pro" },
          { id: "qwen-image-2.0", name: "Qwen Image 2.0" },
          { id: "qwen-image-max", name: "Qwen Image Max" },
          { id: "qwen-image-plus", name: "Qwen Image Plus" },
          { id: "z-image-turbo", name: "Z-Image Turbo" },
        ],
      });
    }

    if (body.protocol === "sensenova") {
      return NextResponse.json({
        models: [
          { id: "sensenova-u1-fast", name: "SenseNova U1 Fast" },
        ],
      });
    }

    if (body.protocol === "asxs" && body.capability === "image") {
      return NextResponse.json({
        models: [
          { id: "gpt-image-2", name: "GPT Image 2" },
        ],
      });
    }

    if (body.protocol === "nvidia-nim" && body.capability === "video") {
      return NextResponse.json({
        models: [
          { id: "nvidia/cosmos-1-0-7b-text2world", name: "Cosmos-1.0 7B Text2World" },
          { id: "nvidia/cosmos-1-0-14b-text2world", name: "Cosmos-1.0 14B Text2World" },
          { id: "nvidia/cosmos-1-0-7b-video2world", name: "Cosmos-1.0 7B Video2World" },
          { id: "nvidia/cosmos-1-0-14b-video2world", name: "Cosmos-1.0 14B Video2World" },
          { id: "nvidia/cosmos-predict1-7b-text2world", name: "Cosmos-Predict1 7B Text2World" },
          { id: "nvidia/cosmos-predict1-7b-video2world", name: "Cosmos-Predict1 7B Video2World" },
          { id: "nvidia/cosmos-predict2-2b-text2world", name: "Cosmos-Predict2 2B Text2World" },
          { id: "nvidia/cosmos-predict2-14b-text2world", name: "Cosmos-Predict2 14B Text2World" },
          { id: "nvidia/cosmos-predict2-14b-video2world", name: "Cosmos-Predict2 14B Video2World" },
          { id: "nvidia/cosmos-transfer2-14b", name: "Cosmos-Transfer2 14B" },
        ],
      });
    }

    if (body.protocol === "nvidia-nim" && body.capability === "image") {
      return NextResponse.json({
        models: [
          { id: "nvidia/cosmos-predict2-2b-text2image", name: "Cosmos-Predict2 2B Text2Image" },
          { id: "nvidia/cosmos-predict2-14b-text2image", name: "Cosmos-Predict2 14B Text2Image" },
        ],
      });
    }

    if (!body.baseUrl) {
      return NextResponse.json({ error: "Base URL is required" }, { status: 400 });
    }
    if (!body.apiKey) {
      return NextResponse.json({ error: "API Key is required" }, { status: 400 });
    }

    const models = body.protocol === "gemini"
      ? await fetchGeminiModels(body.baseUrl, body.apiKey)
      : await fetchModels(body.baseUrl, body.apiKey);
    return NextResponse.json({ models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[models/list] Error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
