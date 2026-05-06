const API_BASE = import.meta.env.PUBLIC_API_BASE_URL || import.meta.env.VITE_PUBLIC_API_BASE_URL || "";

export function getAdminToken() {
  return localStorage.getItem("pulseflare_admin_token") ?? "";
}

export function setAdminToken(token: string) {
  localStorage.setItem("pulseflare_admin_token", token);
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("content-type") && options.body) headers.set("content-type", "application/json");
  const token = getAdminToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const payload = await response.json() as { ok: boolean; data?: T; error?: { message: string } };
  if (!payload.ok) throw new Error(payload.error?.message ?? "Request failed");
  return payload.data as T;
}
