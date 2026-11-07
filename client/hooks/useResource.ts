import { useCallback, useEffect, useRef, useState } from 'react';

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
 */
export function useResource<T>(
  key: string,
  loader: () => Promise<T>,
  intervalMs = 0,
): Resource<T> {
  const [state, setState] = useState<ResourceState<T>>({
    data: null,
    error: null,
    loading: true,
    updatedAt: null,
  });
  const [tick, setTick] = useState(0);
  const previousKey = useRef<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let active = true;
    const keyChanged = previousKey.current !== key;
    previousKey.current = key;

    if (keyChanged) {
      setState({ data: null, error: null, loading: true, updatedAt: null });
    }

    const run = async () => {
      try {
        const data = await loaderRef.current();
        if (!active) return;
        setState({ data, error: null, loading: false, updatedAt: Date.now() });
      } catch (cause) {
        if (!active) return;
        const message =
          cause instanceof Error && cause.message.length > 0
            ? cause.message
            : 'The database request failed.';
        setState((previous) => ({
          data: previous.data,
          error: message,
          loading: false,
          updatedAt: previous.updatedAt,
        }));
      }
    };

    void run();

    const timer = intervalMs > 0 ? window.setInterval(() => void run(), intervalMs) : null;

    return () => {
      active = false;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [key, tick, intervalMs]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  return { ...state, refresh };
}
