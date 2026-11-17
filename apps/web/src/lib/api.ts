export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly issues?: Array<{ path: string; message: string }>, public readonly code?: string) {
    super(message);
  }
}

/** Browser → Next BFF (`/api/*`). Tokens stay in httpOnly cookies; this code never sees them. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: Array<{ path: string; message: string }>; code?: string };
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login") && !window.location.pathname.startsWith("/register")) {
      window.location.href = "/login";
    }
    throw new ApiError(res.status, data.error ?? "Terjadi kesalahan", data.issues, data.code);
  }
  return data as T;
}

export const fetcher = <T,>(path: string) => api<T>(path);

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const first = e.issues?.[0];
    return first ? `${first.path ? first.path + ": " : ""}${first.message}` : e.message;
  }
  return "Terjadi kesalahan";
}
