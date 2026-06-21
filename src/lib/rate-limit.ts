interface Bucket {
  tokens: number[];
}

const buckets = new Map<string, Bucket>();

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export function rateLimit(key: string, config: RateLimitConfig): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: [] };
    buckets.set(key, bucket);
  }
  bucket.tokens = bucket.tokens.filter((t) => now - t < config.windowMs);
  if (bucket.tokens.length >= config.maxRequests) {
    const oldest = bucket.tokens[0];
    const retryAfter = Math.ceil((oldest + config.windowMs - now) / 1000);
    return { allowed: false, retryAfter };
  }
  bucket.tokens.push(now);
  return { allowed: true, retryAfter: 0 };
}

export function rateLimitMiddleware(config: RateLimitConfig) {
  return (request: Request): Response | null => {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || "unknown";
    const userId = request.headers.get("x-user-id") || ip;
    const result = rateLimit(userId, config);
    if (!result.allowed) {
      return new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(result.retryAfter),
        },
      });
    }
    return null;
  };
}
