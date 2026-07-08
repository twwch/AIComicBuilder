import type { AIProvider, ImageOptions, TextOptions } from "./types";

export interface KeyPoolEntry {
  apiKey: string;
  secretKey?: string;
  label: string;
}

interface PoolSlot {
  entry: KeyPoolEntry;
  provider: AIProvider;
  active: number;
  coolUntil: number;
}

interface LeaseSlot {
  entry: KeyPoolEntry;
  active: number;
  coolUntil: number;
}

type ProviderFactory = (entry: KeyPoolEntry) => AIProvider;

const DEFAULT_WAIT_MS = 250;

function parseList(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function splitConfiguredKeys(params: {
  apiKey?: string | null;
  secretKey?: string | null;
  apiKeysEnv?: string[];
  secretKeysEnv?: string[];
  labelPrefix: string;
}): KeyPoolEntry[] {
  const apiKeys = unique([
    ...parseList(params.apiKey),
    ...(params.apiKeysEnv ?? []).flatMap((name) => parseList(process.env[name])),
  ]);

  const secretKeys = [
    ...parseList(params.secretKey),
    ...(params.secretKeysEnv ?? []).flatMap((name) => parseList(process.env[name])),
  ];

  return apiKeys.map((apiKey, index) => ({
    apiKey,
    secretKey:
      secretKeys.length === apiKeys.length
        ? secretKeys[index]
        : secretKeys.length === 1
          ? secretKeys[0]
          : undefined,
    label: `${params.labelPrefix}#${index + 1}`,
  }));
}

export class KeyPoolAIProvider implements AIProvider {
  private slots: PoolSlot[];
  private cursor = 0;
  private perKeyConcurrency: number;
  private cooldownMs: number;

  constructor(entries: KeyPoolEntry[], factory: ProviderFactory, options?: {
    perKeyConcurrency?: number;
    cooldownMs?: number;
  }) {
    if (entries.length === 0) {
      throw new Error("Key pool requires at least one API key");
    }

    this.perKeyConcurrency =
      options?.perKeyConcurrency ??
      parsePositiveInt(process.env.IMAGE_KEY_POOL_PER_KEY_CONCURRENCY, 1);
    this.cooldownMs =
      options?.cooldownMs ??
      parsePositiveInt(process.env.IMAGE_KEY_POOL_COOLDOWN_MS, 10_000);
    this.slots = entries.map((entry) => ({
      entry,
      provider: factory(entry),
      active: 0,
      coolUntil: 0,
    }));
  }

  async generateText(prompt: string, options?: TextOptions): Promise<string> {
    return this.withSlot((slot) => slot.provider.generateText(prompt, options));
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    return this.withSlot((slot) => slot.provider.generateImage(prompt, options));
  }

  private async withSlot<T>(run: (slot: PoolSlot) => Promise<T>): Promise<T> {
    const slot = await this.acquire();
    try {
      return await run(slot);
    } catch (err) {
      if (isRateLimitLikeError(err)) {
        slot.coolUntil = Date.now() + this.cooldownMs;
      }
      throw err;
    } finally {
      slot.active = Math.max(0, slot.active - 1);
    }
  }

  private async acquire(): Promise<PoolSlot> {
    while (true) {
      const now = Date.now();

      for (let checked = 0; checked < this.slots.length; checked++) {
        const index = (this.cursor + checked) % this.slots.length;
        const slot = this.slots[index];
        if (slot.active < this.perKeyConcurrency && slot.coolUntil <= now) {
          slot.active += 1;
          this.cursor = (index + 1) % this.slots.length;
          return slot;
        }
      }

      const nextCoolSlot = this.slots
        .filter((slot) => slot.active < this.perKeyConcurrency)
        .sort((a, b) => a.coolUntil - b.coolUntil)[0];
      const waitMs = nextCoolSlot
        ? Math.max(DEFAULT_WAIT_MS, nextCoolSlot.coolUntil - now)
        : DEFAULT_WAIT_MS;
      await sleep(Math.min(waitMs, 1_000));
    }
  }
}

export class ApiKeyPool {
  private slots: LeaseSlot[];
  private cursor = 0;
  private perKeyConcurrency: number;
  private cooldownMs: number;

  constructor(entries: KeyPoolEntry[], options?: {
    perKeyConcurrency?: number;
    cooldownMs?: number;
  }) {
    if (entries.length === 0) {
      throw new Error("API key pool requires at least one API key");
    }

    this.perKeyConcurrency =
      options?.perKeyConcurrency ??
      parsePositiveInt(process.env.IMAGE_KEY_POOL_PER_KEY_CONCURRENCY, 1);
    this.cooldownMs =
      options?.cooldownMs ??
      parsePositiveInt(process.env.IMAGE_KEY_POOL_COOLDOWN_MS, 10_000);
    this.slots = entries.map((entry) => ({
      entry,
      active: 0,
      coolUntil: 0,
    }));
  }

  async withKey<T>(run: (entry: KeyPoolEntry) => Promise<T>): Promise<T> {
    const slot = await this.acquire();
    try {
      return await run(slot.entry);
    } catch (err) {
      if (isRateLimitLikeError(err)) {
        slot.coolUntil = Date.now() + this.cooldownMs;
      }
      throw err;
    } finally {
      slot.active = Math.max(0, slot.active - 1);
    }
  }

  private async acquire(): Promise<LeaseSlot> {
    while (true) {
      const now = Date.now();

      for (let checked = 0; checked < this.slots.length; checked++) {
        const index = (this.cursor + checked) % this.slots.length;
        const slot = this.slots[index];
        if (slot.active < this.perKeyConcurrency && slot.coolUntil <= now) {
          slot.active += 1;
          this.cursor = (index + 1) % this.slots.length;
          return slot;
        }
      }

      const nextCoolSlot = this.slots
        .filter((slot) => slot.active < this.perKeyConcurrency)
        .sort((a, b) => a.coolUntil - b.coolUntil)[0];
      const waitMs = nextCoolSlot
        ? Math.max(DEFAULT_WAIT_MS, nextCoolSlot.coolUntil - now)
        : DEFAULT_WAIT_MS;
      await sleep(Math.min(waitMs, 1_000));
    }
  }
}

function isRateLimitLikeError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return /\b(429|rate limit|too many requests|quota|throttle)\b/i.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
