const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveAesKey(masterKey: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(masterKey));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, usage);
}

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  version: number;
}

export async function encryptSecret(plaintext: string, masterKey: string): Promise<EncryptedSecret> {
  if (!masterKey) throw new Error("Secret encryption key is not configured");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(masterKey, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext));
  return { ciphertext: toBase64Url(new Uint8Array(ciphertext)), iv: toBase64Url(iv), version: 1 };
}

export async function decryptSecret(secret: EncryptedSecret, masterKey: string): Promise<string> {
  if (!masterKey) throw new Error("Secret encryption key is not configured");
  const key = await deriveAesKey(masterKey, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(secret.iv) }, key, fromBase64Url(secret.ciphertext));
  return new TextDecoder().decode(plaintext);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 24): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function signWebhook(timestamp: string, rawBody: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${rawBody}`));
  return `sha256=${toBase64Url(new Uint8Array(signature))}`;
}

export function redactSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  return `${value.slice(0, Math.min(4, value.length))}••••${value.slice(-4)}`;
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

export function readJsonPath(value: unknown, path: string): unknown {
  const parts = path.replace(/^\$\.?/, "").split(/[.[\]]+/).filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    if (["__proto__", "prototype", "constructor"].includes(part) || !Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
