// Asset upload only. The short-lived Pages JWT is read from stdin, never logged.
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import readline from "node:readline";
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { hash } = wranglerRequire("blake3-wasm");
if (process.stdin.isTTY) process.stdin.setRawMode(true);
const input = readline.createInterface({
  input: process.stdin,
  terminal: false,
});
const jwt = await new Promise((resolve) =>
  input.once("line", (line) => {
    input.close();
    resolve(line.trim());
  }),
);
if (!jwt) throw new Error("Missing Pages upload token");
const root = path.resolve("frontend/dist");
const excluded = new Set([
  "_headers",
  "_redirects",
  "_routes.json",
  "_worker.js",
]);
const types = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
  ".json": "application/json",
  ".ico": "image/x-icon",
};
const assets = [],
  manifest = {};
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(filename);
      continue;
    }
    if (excluded.has(entry.name)) continue;
    const extension = path.extname(filename),
      value = (await readFile(filename)).toString("base64");
    const key = hash(value + extension.slice(1))
      .toString("hex")
      .slice(0, 32);
    manifest["/" + path.relative(root, filename).replaceAll("\\", "/")] = key;
    assets.push({
      key,
      value,
      base64: true,
      metadata: { contentType: types[extension] || "application/octet-stream" },
    });
  }
}
await walk(root);
async function send(endpoint, body) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/pages/assets/${endpoint}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${jwt}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const result = await response.json();
  if (!response.ok || !result.success)
    throw new Error(
      `Pages asset ${endpoint} failed (${response.status}): ${result.errors?.map((e) => e.code).join(",")}`,
    );
}
for (let i = 0; i < assets.length; i += 25)
  await send("upload", assets.slice(i, i + 25));
await send("upsert-hashes", { hashes: assets.map((a) => a.key) });
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/pages-manifest.json", JSON.stringify(manifest));
console.log(
  JSON.stringify({
    uploaded: assets.length,
    manifest: "artifacts/pages-manifest.json",
  }),
);
