/**
 * Short-lived sharing for screen-level loads.
 *
 * Supabase Realtime is not enabled for this project, so screens poll. Several cards can
 * need the same rows at the same moment; without sharing, each one repeats the whole
 * query. A successful result is reused only for `maxAgeMs`, and callers always receive
 * the time it was actually fetched, so a shared value is never presented as newer than
 * it is. Failures are never shared, so an error stays visible and the next attempt
 * retries immediately.
 */

export type SharedResult<T> =
  | { ok: true; data: T; updatedAt: number }
  | { ok: false; error: string };

const MAX_ENTRIES = 32;

const stored = new Map<string, { result: SharedResult<unknown>; storedAt: number }>();
const inFlight = new Map<string, Promise<SharedResult<unknown>>>();

function describe(cause: unknown): string {
  return cause instanceof Error && cause.message.length > 0
    ? cause.message
    : 'The database request failed.';
}

/**
 * Loads `key` once. Concurrent callers join a single in-flight request, and a successful
 * result younger than `maxAgeMs` is reused. `maxAgeMs = 0` always fetches.
 */
export async function loadShared<T>(
  key: string,
  loader: () => Promise<T>,
  maxAgeMs = 0,
): Promise<SharedResult<T>> {
  if (maxAgeMs > 0) {
    const hit = stored.get(key);
    if (hit && Date.now() - hit.storedAt <= maxAgeMs) {
      return hit.result as SharedResult<T>;
    }
  }

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<SharedResult<T>>;

  const request = (async (): Promise<SharedResult<T>> => {
    try {
      return { ok: true, data: await loader(), updatedAt: Date.now() };
    } catch (cause) {
      return { ok: false, error: describe(cause) };
    }
  })();

  inFlight.set(key, request as Promise<SharedResult<unknown>>);

  try {
    const result = await request;
    // Only successes are kept: caching a failure would keep a recovered screen showing an
    // old error and would delay its retry.
    if (result.ok && maxAgeMs > 0) {
      if (stored.size >= MAX_ENTRIES) stored.clear();
      stored.set(key, { result: result as SharedResult<unknown>, storedAt: result.updatedAt });
    }
    return result;
  } finally {
    inFlight.delete(key);
  }
}

/** Drops every shared result. Used by tests and when the signed-in account changes. */
export function resetSharedCache(): void {
  stored.clear();
  inFlight.clear();
}
