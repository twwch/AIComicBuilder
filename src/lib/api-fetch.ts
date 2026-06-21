import { getUserId } from "./fingerprint";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch(url: string, options: RequestInit & { timeout?: number } = {}): Promise<Response> {
  const userId = getUserId();
  const headers = new Headers(options.headers);
  if (userId) headers.set("x-user-id", userId);

  if (typeof url === "string" && url.includes("undefined")) {
    throw new ApiError(0, `Invalid API URL: ${url}`);
  }

  let response: Response;
  try {
    const controller = new AbortController();
    const timeoutMs = options.timeout ?? 600_000;
    const timeout = setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), timeoutMs);
    try {
      response = await fetch(url, { ...options, headers, signal: options.signal || controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    throw new ApiError(0, `网络请求失败，请检查服务器是否在运行: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.clone().json();
      if (body.error) message = body.error;
    } catch {}
    throw new ApiError(response.status, message);
  }
  return response;
}
