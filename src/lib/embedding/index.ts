import OpenAI from "openai";

let _client: OpenAI | null = null;

function getEmbeddingClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY,
      baseURL: process.env.EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL || undefined,
      timeout: 60_000,
    });
  }
  return _client;
}

const DEFAULT_MODEL = "text-embedding-3-small";

export async function embedText(text: string, model?: string): Promise<number[]> {
  const client = getEmbeddingClient();
  const resp = await client.embeddings.create({
    model: model || process.env.EMBEDDING_MODEL || DEFAULT_MODEL,
    input: text,
  });
  return resp.data[0].embedding;
}

export async function embedBatch(texts: string[], model?: string): Promise<number[][]> {
  const client = getEmbeddingClient();
  const resp = await client.embeddings.create({
    model: model || process.env.EMBEDDING_MODEL || DEFAULT_MODEL,
    input: texts,
  });
  resp.data.sort((a, b) => a.index - b.index);
  return resp.data.map((d) => d.embedding);
}

export function getEmbeddingModel(): string {
  return process.env.EMBEDDING_MODEL || DEFAULT_MODEL;
}

export async function embedTextSafe(text: string): Promise<number[] | null> {
  try {
    return await embedText(text);
  } catch (err) {
    console.warn("[embedding] embedText failed:", (err as Error)?.message?.substring(0, 100));
    return null;
  }
}

export async function embedBatchSafe(texts: string[]): Promise<(number[] | null)[]> {
  try {
    return await embedBatch(texts);
  } catch (err) {
    console.warn("[embedding] embedBatch failed:", (err as Error)?.message?.substring(0, 100));
    return texts.map(() => null);
  }
}

export { DEFAULT_MODEL };
