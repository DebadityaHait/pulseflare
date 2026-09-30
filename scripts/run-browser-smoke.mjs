import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import smoke from "./browser-smoke.js";

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await smoke(page, process.argv[2]);
} finally {
  await browser.close();
}
