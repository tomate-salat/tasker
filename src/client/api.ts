export type Account = { email: string; name: string; avatar: string };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status);
  return body as T;
}

export const api = {
  me: () => request<{ account: Account | null }>('/api/me'),

  login: (email: string, password: string, keepSignedIn: boolean) =>
    request<{ account: Account }>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, keepSignedIn }),
    }),

  logout: () => request<{ ok: true }>('/api/logout', { method: 'POST' }),

  status: () =>
    request<{ database: string; boots: number; firstBootAt: string }>('/api/status'),
};
