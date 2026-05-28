import { NextResponse } from "next/server";

interface ListRequest {
  protocol: string;
  baseUrl: string;
  apiKey: string;
}

interface ModelItem {
  id: string;
  name: string;
}

function buildModelsUrl(baseUrl: string): string {
  let url = baseUrl.replace(/\/+$/, "");
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
    const body = (await request.json()) as ListRequest;

    if (body.protocol === "kling") {
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

    if (body.protocol === "ucloud-seedance") {
      return NextResponse.json({
        models: [
          { id: "doubao-seedance-1-5-pro-251215", name: "Seedance 1.5 Pro (UCloud)" },
          { id: "doubao-seedance-2-0-260128", name: "Seedance 2.0 (UCloud)" },
        ],
      });
    }

    if (body.protocol === "wan") {
      return NextResponse.json({
        models: [
          { id: "wan2.7-t2v", name: "Wan 2.7 文生视频" },
          { id: "wan2.7-r2v", name: "Wan 2.7 参考生视频" },
          { id: "wan2.6-t2v", name: "Wan 2.6 文生视频" },
          { id: "wan2.6-i2v-flash", name: "Wan 2.6 图生视频 Flash" },
          { id: "wan2.6-i2v", name: "Wan 2.6 图生视频" },
          { id: "wan2.6-r2v", name: "Wan 2.6 参考生视频" },
          { id: "wan2.6-r2v-flash", name: "Wan 2.6 参考生视频 Flash" },
          { id: "happyhorse-1.0-t2v", name: "HappyHorse 1.0 文生视频" },
          { id: "happyhorse-1.0-i2v", name: "HappyHorse 1.0 图生视频" },
          { id: "happyhorse-1.0-r2v", name: "HappyHorse 1.0 参考生视频" },
          { id: "happyhorse-1.0-video-edit", name: "HappyHorse 1.0 视频编辑" },
        ],
      });
    }

    if (body.protocol === "dashscope") {
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
