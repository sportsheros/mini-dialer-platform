import { type DependencyList, useCallback, useEffect, useRef, useState } from 'react';

export interface QueryState<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | undefined;
  reload: () => void;
  setData: React.Dispatch<React.SetStateAction<T | undefined>>;
}

/**
 * Minimal data-fetching hook: loading / error / data + reload, and it ignores responses from
 * stale requests (a slow page-1 response can't overwrite a newer page-2 response).
 */
export function useQuery<T>(fetcher: () => Promise<T>, deps: DependencyList): QueryState<T> {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();
  const requestId = useRef(0);
  const fetchRef = useCallback(fetcher, deps);

  const run = useCallback(
    (background = false) => {
      const id = ++requestId.current;
      if (!background) setLoading(true);
      fetchRef()
        .then((result) => {
          if (id !== requestId.current) return;
          setData(result);
          setError(undefined);
        })
        .catch((err: unknown) => {
          if (id !== requestId.current) return;
          setError(err instanceof Error ? err : new Error(String(err)));
        })
        .finally(() => {
          if (id === requestId.current) setLoading(false);
        });
    },
    [fetchRef],
  );

  useEffect(() => run(), [run]);

  return { data, loading, error, reload: () => run(true), setData };
}
