const API_BASE = import.meta.env.VITE_PUBLIC_API_BASE_URL || "";

let getSessionToken: (() => Promise<string | null>) | undefined;
export function setTokenProvider(provider?: () => Promise<string | null>) {
  getSessionToken = provider;
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("content-type") && options.body)
    headers.set("content-type", "application/json");
  const token = await getSessionToken?.();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error(
      "The API is unavailable. Check the API connection configuration.",
    );
  const payload = (await response.json()) as {
    ok: boolean;
    data?: T;
    error?: { message: string };
  };
  if (!response.ok || !payload.ok)
    throw new Error(
      payload.error?.message ?? `Request failed (${response.status})`,
    );
  return payload.data as T;
}
