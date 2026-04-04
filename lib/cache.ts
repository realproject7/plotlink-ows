/**
 * Singleton in-memory cache with TTL and in-flight request deduplication.
 * Ported from mintpad's singleton-memory-cache pattern.
 */

interface CacheEntry {
  value: unknown;
  expires: number;
}

class MemoryCache {
  private cache = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<unknown>>();

  async get<T>(key: string, fetcher: () => Promise<T>, ttlSeconds = 60): Promise<T> {
    const normalizedKey = key.toLowerCase();

    // Return cached if fresh
    const cached = this.cache.get(normalizedKey);
    if (cached && Date.now() < cached.expires) {
      return cached.value as T;
    }

    // Dedup: if same key is already being fetched, await that promise
    const pending = this.inFlight.get(normalizedKey);
    if (pending) return pending as Promise<T>;

    // Fetch, cache, and clean up
    const promise = fetcher()
      .then((value) => {
        this.cache.set(normalizedKey, {
          value,
          expires: Date.now() + ttlSeconds * 1000,
        });
        this.inFlight.delete(normalizedKey);
        return value;
      })
      .catch((err) => {
        this.inFlight.delete(normalizedKey);
        throw err;
      });

    this.inFlight.set(normalizedKey, promise);
    return promise;
  }

  delete(key: string): void {
    const normalizedKey = key.toLowerCase();
    this.cache.delete(normalizedKey);
    this.inFlight.delete(normalizedKey);
  }

  clear(): void {
    this.cache.clear();
  }
}

export const priceCache = new MemoryCache();
