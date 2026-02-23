import * as admin from 'firebase-admin';
import { createHash } from 'crypto';

/** TTL in milliseconds per API. 0 = never cache. */
const TTL_MAP: Record<string, number> = {
  weather: 10 * 60 * 1000,      // 10 min
  crypto: 2 * 60 * 1000,        // 2 min
  exchange: 30 * 60 * 1000,     // 30 min
  time: 0,                       // never cache (live time)
  dictionary: 24 * 60 * 60 * 1000,  // 24h
  wikipedia: 60 * 60 * 1000,    // 1h
  country: 24 * 60 * 60 * 1000, // 24h
  ip: 60 * 60 * 1000,           // 1h
  image_generate: 0,             // never cache
};

/** Get TTL for an API. Transform executors (transform_*) are never cached. */
function getTTL(apiId: string): number {
  if (apiId.startsWith('transform_')) return 0;
  return TTL_MAP[apiId] ?? 0;
}

/** Compute a cache key from API id + sorted params. Truncated SHA-256 to 16 chars. */
export function computeCacheKey(apiId: string, params: Record<string, string>): string {
  const sortedEntries = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const input = `${apiId}:${sortedEntries}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/** Check cache for a stored result. Returns null if expired/missing. */
export async function getCachedResult(
  db: admin.database.Database,
  boardId: string,
  apiId: string,
  params: Record<string, string>,
): Promise<string | null> {
  const ttl = getTTL(apiId);
  if (ttl === 0) return null;

  const key = computeCacheKey(apiId, params);
  const snap = await db.ref(`boards/${boardId}/apiCache/${key}`).get();
  if (!snap.exists()) return null;

  const cached = snap.val() as { result: string; createdAt: number; expiresAt: number; apiId: string };
  if (Date.now() > cached.expiresAt) {
    // Expired — clean up
    await db.ref(`boards/${boardId}/apiCache/${key}`).remove();
    return null;
  }

  return cached.result;
}

/** Write a result to cache with appropriate TTL. */
export async function setCachedResult(
  db: admin.database.Database,
  boardId: string,
  apiId: string,
  params: Record<string, string>,
  result: string,
): Promise<void> {
  const ttl = getTTL(apiId);
  if (ttl === 0) return;

  const key = computeCacheKey(apiId, params);
  const now = Date.now();
  await db.ref(`boards/${boardId}/apiCache/${key}`).set({
    result,
    createdAt: now,
    expiresAt: now + ttl,
    apiId,
  });
}
