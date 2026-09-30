import readline from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
if (process.stdin.isTTY) process.stdin.setRawMode(true);
const input = readline.createInterface({
  input: process.stdin,
  terminal: false,
});
const url = await new Promise((resolve) =>
  input.once("line", (line) => {
    input.close();
    resolve(line.trim());
  }),
);
const response = await fetch(url);
if (!response.ok)
  throw new Error(`D1 backup download failed (${response.status})`);
const sql = await response.text();
if (!sql.includes("CREATE TABLE") || !sql.includes("monitors"))
  throw new Error("D1 backup is not a SQL export");
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/pre-mvp-config-backup.sql", sql);
console.log(
  JSON.stringify({
    backup: "artifacts/pre-mvp-config-backup.sql",
    bytes: Buffer.byteLength(sql),
  }),
);
