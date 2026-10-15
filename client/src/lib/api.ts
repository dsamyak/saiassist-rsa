// Fetch wrapper: bearer access token in memory, refresh token in an httpOnly cookie.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { fields?: Record<string, string> } & Record<string, unknown>,
  ) {
    super(message);
  }
  get fields(): Record<string, string> {
    return this.details?.fields ?? {};
  }
}

let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;
let onSessionExpired: (() => void) | null = null;

export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
export const setSessionExpiredHandler = (fn: (() => void) | null) => {
  onSessionExpired = fn;
};

export function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
      .then(async (r) => {
        if (r.ok) return ((await r.json()).accessToken as string | null) ?? null;
        await r.body?.cancel();
        return null;
      })
      .catch(() => null)
      .then((t) => {
        accessToken = t;
        return t;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function toQueryString(q?: Query) {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

interface Options {
  method?: string;
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
}

async function request(path: string, opts: Options = {}): Promise<Response> {
  const url = path + toQueryString(opts.query);
  const send = () =>
    fetch(url, {
      method: opts.method ?? 'GET',
      credentials: 'same-origin',
      signal: opts.signal,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  let res = await send();
  if (res.status === 401 && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/refresh')) {
    const token = await refreshAccessToken();
    if (token) {
      await res.body?.cancel();
      res = await send();
    } else onSessionExpired?.();
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? `Request failed (${res.status})`, data?.error?.details);
  }
  return res;
}

export async function api<T = any>(path: string, opts: Options = {}): Promise<T> {
  const res = await request(path, opts);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function apiBlob(path: string, opts: Options = {}): Promise<Blob> {
  const res = await request(path, opts);
  return res.blob();
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
