import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("http://localhost:5173");
    await page
      .getByRole("heading", { name: "Your uptime. In full view." })
      .waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(
      () =>
        Number(
          getComputedStyle(document.querySelector(".hero-product-stage"))
            .opacity,
        ) === 1,
    );
    await page.screenshot({ path: `artifacts/hero-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://localhost:5173/signup");
  await page
    .waitForFunction(
      () =>
        document.querySelector(".cl-rootBox") ||
        document.body.innerText.includes("Clerk failed"),
      {},
      { timeout: 20000 },
    )
    .catch(() => {});
  console.log(
    JSON.stringify({
      signupText: await page.locator("body").innerText(),
      errors,
    }),
  );
  await page.screenshot({ path: "artifacts/signup.png" });
} finally {
  await browser.close();
}
