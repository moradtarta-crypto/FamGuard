import { useCallback, useEffect, useRef, useState } from 'react';
import { loadShared } from '../lib/resourceCache';

export interface ResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  updatedAt: number | null;
}

export interface Resource<T> extends ResourceState<T> {
  refresh: () => void;
}

/**
 * Loads data once and then re-fetches on an interval.
 *
 * Supabase Realtime is not enabled for this project, so screens poll instead of
 * subscribing. `intervalMs = 0` disables polling (manual refresh only).
 *
 * `maxAgeMs` lets screens that need the same rows share one request: a successful result
 * younger than that window is reused, and callers that load at the same time join a
 * single in-flight request. `updatedAt` still reports when the rows were actually
 * fetched, so shared data is never shown as fresher than it is, and `refresh()` always
 * bypasses the shared result so a user-initiated retry reaches the database.
 */
export function useResource<T>(
  key: string,
  loader: () => Promise<T>,
  intervalMs = 0,
  maxAgeMs = 0,
): Resource<T> {
  const emptyState: ResourceState<T> = {
    data: null,
    error: null,
    loading: true,
    updatedAt: null,
  };
  const [state, setState] = useState<{ key: string; value: ResourceState<T> }>({
    key,
    value: emptyState,
  });
  // Hide the previous key's rows synchronously during render, before the effect runs.
  // This prevents a family switch from briefly showing the previous family's data.
  const [tick, setTick] = useState(0);
  const previousKey = useRef<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const forceNextRun = useRef(false);

  useEffect(() => {
    let active = true;
    const keyChanged = previousKey.current !== key;
    previousKey.current = key;

    if (keyChanged) {
      setState({ key, value: emptyState });
    }

    // A manual refresh must reach the database; later interval runs may reuse a result.
    let bypassShared = forceNextRun.current;
    forceNextRun.current = false;

    const run = async () => {
      const result = await loadShared(key, loaderRef.current, bypassShared ? 0 : maxAgeMs);
      bypassShared = false;
      if (!active) return;

      if (result.ok) {
        setState({
          key,
          value: { data: result.data, error: null, loading: false, updatedAt: result.updatedAt },
        });
        return;
      }

      setState((previous) => ({
        key,
        value: {
          data: previous.key === key ? previous.value.data : null,
          error: result.error,
          loading: false,
          updatedAt: previous.key === key ? previous.value.updatedAt : null,
        },
      }));
    };

    void run();

    const timer = intervalMs > 0 ? window.setInterval(() => void run(), intervalMs) : null;

    return () => {
      active = false;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [key, tick, intervalMs, maxAgeMs]);

  const refresh = useCallback(() => {
    forceNextRun.current = true;
    setTick((value) => value + 1);
  }, []);

  const visibleState = state.key === key ? state.value : emptyState;
  return { ...visibleState, refresh };
}
