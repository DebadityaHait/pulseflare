import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import captureReadme from "./capture-readme.js";

await mkdir("docs/screenshots", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  console.log(JSON.stringify(await captureReadme(page, process.argv[2])));
} finally {
  await browser.close();
}
