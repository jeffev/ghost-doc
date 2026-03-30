import type { TracerInstance } from "@ghost-doc/agent-js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class CacheService {
  private readonly store = new Map<string, string>();

  readonly get: (key: string) => Promise<string | null>;
  readonly set: (key: string, value: string, ttlMs?: number) => Promise<void>;
  readonly invalidate: (pattern: string) => Promise<number>;

  constructor(tracer: TracerInstance) {
    this.get = tracer.wrap(
      async (key: string): Promise<string | null> => {
        await sleep(1 + Math.random() * 2); // 1–3ms cache read
        return this.store.get(key) ?? null;
      },
      "CacheService.get",
      "Reads a value from the in-memory cache by key, returns null on miss",
    );

    this.set = tracer.wrap(
      async (key: string, value: string, _ttlMs?: number): Promise<void> => {
        await sleep(1 + Math.random() * 1); // 1–2ms cache write
        this.store.set(key, value);
      },
      "CacheService.set",
      "Writes a key-value pair to the cache with an optional TTL",
    );

    this.invalidate = tracer.wrap(
      async (pattern: string): Promise<number> => {
        await sleep(1);
        let count = 0;
        for (const key of this.store.keys()) {
          if (key.includes(pattern)) {
            this.store.delete(key);
            count++;
          }
        }
        return count;
      },
      "CacheService.invalidate",
      "Removes all cache entries whose key contains the given pattern",
    );
  }
}
