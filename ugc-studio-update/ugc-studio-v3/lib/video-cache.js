// Shared in-memory LRU cache for proxied video bytes.
//
// Goal: when fal.ai's CDN is slow for a user's geography, Railway still gets
// fast consistent throughput to fal.ai. We proxy through Railway and cache
// the bytes on the server. Second load of the same URL → instant from memory.
// The agent route also pre-warms this cache immediately after a job completes,
// so when the user opens the editor the videos are already resident.
//
// Constraints:
//  - Railway memory is limited. Cap total cache at ~500MB with LRU eviction.
//  - Entries expire after 1h (fal.ai URLs go stale anyway).
//  - Buffering a ReadableStream into memory is fine for MP4 clips (5-15MB each);
//    we'd never cache anything near the free-tier RSS limit as long as we evict.
//  - Concurrency safe: a second request for the same URL while the first is
//    still buffering will wait on the same in-flight Promise (`inFlight` map)
//    and each get its own Buffer copy — no double-fetch.

const MAX_CACHE_BYTES = 500 * 1024 * 1024;   // 500 MB
const CACHE_TTL_MS    = 60 * 60 * 1000;      // 1 hour

// Using globalThis keeps the cache alive across hot-reloads in dev. In prod
// (Railway) it's a normal module singleton.
const g = globalThis;
if (!g.__ugcVideoCache) {
  g.__ugcVideoCache = {
    map: new Map(),      // url → { buf, contentType, at }
    totalBytes: 0,
    inFlight: new Map(), // url → Promise<Buffer>
  };
}
const state = g.__ugcVideoCache;

function isFresh(entry) {
  return entry && (Date.now() - entry.at) < CACHE_TTL_MS;
}

function evictIfNeeded() {
  // Drop stale entries first (cheap scan, at most a few dozen keys).
  for (const [k, v] of state.map) {
    if (!isFresh(v)) {
      state.totalBytes -= v.buf.byteLength;
      state.map.delete(k);
    }
  }
  // Then LRU-evict (Map preserves insertion order) until we're under the cap.
  while (state.totalBytes > MAX_CACHE_BYTES && state.map.size > 0) {
    const oldestKey = state.map.keys().next().value;
    const oldest = state.map.get(oldestKey);
    state.totalBytes -= oldest.buf.byteLength;
    state.map.delete(oldestKey);
    console.log(`[VideoCache] evicted ${oldestKey.slice(0, 80)} (${(oldest.buf.byteLength / 1024 / 1024).toFixed(1)}MB)`);
  }
}

export function getCached(url) {
  if (!url) return null;
  const entry = state.map.get(url);
  if (!isFresh(entry)) {
    if (entry) {
      state.totalBytes -= entry.buf.byteLength;
      state.map.delete(url);
    }
    return null;
  }
  // Touch: move to end for LRU order.
  state.map.delete(url);
  state.map.set(url, entry);
  return entry;
}

export function setCached(url, buf, contentType) {
  if (!url || !buf || !buf.byteLength) return;
  // Skip anything > 100MB — videos this large would dominate the cache.
  if (buf.byteLength > 100 * 1024 * 1024) {
    console.warn(`[VideoCache] refusing to cache ${url.slice(0, 80)} — ${buf.byteLength} bytes > 100MB`);
    return;
  }
  const existing = state.map.get(url);
  if (existing) state.totalBytes -= existing.buf.byteLength;
  state.map.set(url, { buf, contentType: contentType || 'video/mp4', at: Date.now() });
  state.totalBytes += buf.byteLength;
  evictIfNeeded();
  console.log(`[VideoCache] stored ${url.slice(0, 80)} (${(buf.byteLength / 1024 / 1024).toFixed(1)}MB), total=${(state.totalBytes / 1024 / 1024).toFixed(1)}MB, entries=${state.map.size}`);
}

export function stats() {
  return {
    entries: state.map.size,
    totalBytes: state.totalBytes,
    totalMB: Number((state.totalBytes / 1024 / 1024).toFixed(1)),
    maxMB: Number((MAX_CACHE_BYTES / 1024 / 1024).toFixed(1)),
  };
}

// Fetch a URL and populate the cache. Safe to call concurrently — requests
// for the same URL share a single in-flight fetch.
export async function warmCache(url, { timeoutMs = 30000 } = {}) {
  if (!url) return null;
  const cached = getCached(url);
  if (cached) return cached.buf;
  const existing = state.inFlight.get(url);
  if (existing) return existing;

  const promise = (async () => {
    const start = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get('content-type') || 'video/mp4';
      setCached(url, buf, contentType);
      console.log(`[VideoCache] warmed ${url.slice(0, 80)} in ${Date.now() - start}ms (${(buf.byteLength / 1024 / 1024).toFixed(1)}MB)`);
      return buf;
    } catch (err) {
      console.warn(`[VideoCache] warm failed for ${url.slice(0, 80)} after ${Date.now() - start}ms:`, err.message);
      return null;
    } finally {
      state.inFlight.delete(url);
    }
  })();
  state.inFlight.set(url, promise);
  return promise;
}

// Fire-and-forget pre-warm of multiple URLs. Used on job completion so that
// by the time the user opens the editor, the videos are resident on Railway.
export function prewarmVideos(urls) {
  if (!Array.isArray(urls)) return;
  const valid = urls.filter(u => typeof u === 'string' && /^https?:\/\//.test(u));
  console.log(`[VideoCache] prewarming ${valid.length} videos…`);
  // Serial rather than parallel — avoids a 4× memory spike while fetching.
  // Each warm has its own 30s timeout; total budget ≤ 2 minutes.
  (async () => {
    for (const u of valid) {
      try { await warmCache(u, { timeoutMs: 30000 }); } catch {}
    }
    console.log(`[VideoCache] prewarm batch done. Stats:`, stats());
  })();
}
