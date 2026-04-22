type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const MAX_ENTRIES = 2000;

export class TTLCache<T> {
  private map = new Map<string, CacheEntry<T>>();
  private ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.map.size >= MAX_ENTRIES) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
    }
    this.map.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  size(): number {
    return this.map.size;
  }
}

type BaselineEntry = {
  median: number;
  max: number;
  count: number;
} | null;

const ONE_DAY = 24 * 60 * 60 * 1000;

const globalForCache = globalThis as unknown as {
  __channelBaselineCache?: TTLCache<BaselineEntry>;
};

export const channelBaselineCache: TTLCache<BaselineEntry> =
  globalForCache.__channelBaselineCache ?? new TTLCache<BaselineEntry>(ONE_DAY);

if (!globalForCache.__channelBaselineCache) {
  globalForCache.__channelBaselineCache = channelBaselineCache;
}
