type RateLimitConfig = {
  windowMs: number;
  maxAttempts: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  ok: boolean;
  retryAfterSeconds: number;
};

const globalForRateLimit = globalThis as typeof globalThis & {
  authRateLimitStore?: Map<string, RateLimitEntry>;
};

function getStore() {
  if (!globalForRateLimit.authRateLimitStore) {
    globalForRateLimit.authRateLimitStore = new Map();
  }

  return globalForRateLimit.authRateLimitStore;
}

function pruneExpired(now: number) {
  const store = getStore();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

export function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const [firstIp] = forwardedFor.split(",");
    if (firstIp?.trim()) return firstIp.trim();
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}

export function consumeRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  pruneExpired(now);

  const store = getStore();
  const current = store.get(key);
  if (!current || current.resetAt <= now) {
    store.set(key, {
      count: 1,
      resetAt: now + config.windowMs,
    });
    return { ok: true, retryAfterSeconds: 0 };
  }

  current.count += 1;
  store.set(key, current);

  if (current.count > config.maxAttempts) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  return { ok: true, retryAfterSeconds: 0 };
}

export function clearRateLimit(key: string) {
  getStore().delete(key);
}

export function tooManyRequests(message: string, retryAfterSeconds: number) {
  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfterSeconds),
    },
  });
}
