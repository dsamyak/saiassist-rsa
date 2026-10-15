import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Filter state kept in the URL so lists are shareable and survive refresh. */
export function useUrlState<T extends Record<string, string>>(defaults: T) {
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => {
    const out: Record<string, string> = { ...defaults };
    for (const k of Object.keys(defaults)) {
      const v = params.get(k);
      if (v !== null) out[k] = v;
    }
    return out as T;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const update = (patch: Partial<T>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries({ ...(resetPage && !('page' in patch) ? { page: '' } : {}), ...patch })) {
      if (v === undefined || v === '' || v === defaults[k]) next.delete(k);
      else next.set(k, String(v));
    }
    setParams(next, { replace: true });
  };
  return [state, update] as const;
}

/** A text input whose debounced value is committed elsewhere (e.g. into the URL). */
export function useSyncedInput(committed: string, commit: (v: string) => void, ms = 300) {
  const [value, setValue] = useState(committed);
  const debounced = useDebounced(value, ms);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    if (debounced !== committed) commitRef.current(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  return [value, setValue] as const;
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} · SaiAssist RSA` : 'SaiAssist RSA';
    return () => {
      document.title = prev;
    };
  }, [title]);
}
