import { NextResponse } from "next/server";
import {
  getSeedancePresetModels,
  normalizeSeedanceBaseUrl,
} from "@/lib/ai/providers/seedance-url";

interface ListRequest {
  protocol: string;
  baseUrl: string;
  apiKey: string;
}

interface ModelItem {
  id: string;
  name: string;
}

function buildOpenAIModelsUrl(baseUrl: string): string {
  const url = baseUrl.trim().replace(/\/+$/, "");
  if (url.endsWith("/v1")) {
    return `${url}/models`;
  }
  return `${url}/v1/models`;
}

function toModelItem(item: unknown): ModelItem | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const record = item as Record<string, unknown>;
  const rawName = typeof record.name === "string" ? record.name : null;
  const id =
    typeof record.id === "string"
      ? record.id
      : rawName
        ? rawName.replace(/^models\//, "")
        : null;

  if (!id) {
    return null;
  }

  const name =
    typeof record.display_name === "string"
      ? record.display_name
      : typeof record.displayName === "string"
        ? record.displayName
        : rawName
          ? rawName.replace(/^models\//, "")
          : id;

  return { id, name };
}

function parseModelList(data: unknown): ModelItem[] {
  if (!data || typeof data !== "object") {
    throw new Error("Unexpected response format");
  }

  const record = data as Record<string, unknown>;
  const candidates = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : null;

  if (!candidates) {
    throw new Error("Unexpected response format: missing models array");
  }

  const models = candidates
    .map((item) => toModelItem(item))
    .filter((item): item is ModelItem => item !== null);

  if (models.length === 0) {
    throw new Error("Unexpected response format: empty models array");
  }

  return models;
}

async function fetchOpenAIModels(
  baseUrl: string,
  apiKey: string
): Promise<ModelItem[]> {
  const url = buildOpenAIModelsUrl(baseUrl);
  console.log("[models/list] OpenAI fetch:", url);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }

  return parseModelList(await res.json());
}

async function fetchGeminiModels(apiKey: string): Promise<ModelItem[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  console.log("[models/list] Gemini fetch:", url);

  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }

  return parseModelList(await res.json());
}

async function fetchSeedanceModels(
  baseUrl?: string,
  apiKey?: string
): Promise<ModelItem[]> {
  if (!baseUrl || !apiKey) {
    return getSeedancePresetModels();
  }

  const url = `${normalizeSeedanceBaseUrl(baseUrl)}/models`;
  console.log("[models/list] Seedance fetch:", url);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn(
      "[models/list] Seedance live fetch failed, falling back to presets:",
      res.status,
      text.slice(0, 200)
    );
    return getSeedancePresetModels();
  }

  try {
    return parseModelList(await res.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      "[models/list] Seedance model response not recognized, falling back to presets:",
      message
    );
    return getSeedancePresetModels();
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ListRequest;
    let models: ModelItem[];

    switch (body.protocol) {
      case "openai":
        if (!body.baseUrl) {
          return NextResponse.json(
            { error: "Base URL is required" },
            { status: 400 }
          );
        }
        if (!body.apiKey) {
          return NextResponse.json(
            { error: "API Key is required" },
            { status: 400 }
          );
        }
        models = await fetchOpenAIModels(body.baseUrl, body.apiKey);
        break;
      case "gemini":
        if (!body.apiKey) {
          return NextResponse.json(
            { error: "API Key is required" },
            { status: 400 }
          );
        }
        models = await fetchGeminiModels(body.apiKey);
        break;
      case "seedance":
        models = await fetchSeedanceModels(body.baseUrl, body.apiKey);
        break;
      default:
        return NextResponse.json(
          { error: `Unknown protocol: ${body.protocol}` },
          { status: 400 }
        );
    }

    return NextResponse.json({ models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[models/list] Error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
