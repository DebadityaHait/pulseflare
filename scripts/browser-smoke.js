export default async function smoke(page, origin = "http://127.0.0.1:5173") {
  const errors = [];
  const optionalAnalyticsWarnings = [];
  const apiRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      // Some local DNS/ad blockers refuse Cloudflare's zone-injected beacon.
      // Keep that explicit; never suppress Clerk, API or application failures.
      if (
        message
          .location()
          .url.startsWith("https://static.cloudflareinsights.com/")
      )
        optionalAnalyticsWarnings.push(message.text());
      else errors.push(message.text());
    }
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      apiRequests.push(request.url());
  });
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(origin);
  await page.evaluate(() => {
    localStorage.setItem("pulseflare_theme", "dark");
  });
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("heading", { name: "Your uptime. In full view." })
    .waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "artifacts/home-dark.png" });
  await page
    .locator(".preview-nav")
    .getByRole("button", { name: "Incidents" })
    .click();
  await page
    .getByRole("heading", { name: "Elevated latency on Search", exact: true })
    .waitFor();
  await page
    .locator(".preview-nav")
    .getByRole("button", { name: "Status page" })
    .click();
  await page
    .locator(".preview-status")
    .getByRole("heading", { name: "Orbit system status" })
    .waitFor();
  await page
    .locator(".preview-nav")
    .getByRole("button", { name: "Monitors" })
    .click();
  await page.getByRole("button", { name: "Explore Pro", exact: true }).click();
  check(
    await page.getByRole("dialog").isVisible(),
    "Pricing dialog did not open",
  );
  await page.keyboard.press("Escape");
  check(
    !(await page.getByRole("dialog").isVisible()),
    "Escape did not close dialog",
  );
  await page.getByRole("button", { name: "Explore Team", exact: true }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.goto(`${origin}/demo/monitors`);
  await page
    .getByRole("textbox", { name: "Search monitors" })
    .fill("not-a-monitor");
  await page.getByRole("heading", { name: "No monitors match" }).waitFor();
  await page.getByRole("textbox", { name: "Search monitors" }).fill("");
  await page.getByLabel("Filter monitors").selectOption("heartbeat");
  await page.waitForFunction(
    () => document.querySelectorAll(".monitor-row").length === 1,
  );
  check(
    (await page.locator(".monitor-row").count()) === 1,
    "Heartbeat filter incorrect",
  );
  await page.getByLabel("Filter environment").selectOption("production");
  await page.getByRole("button", { name: "background", exact: true }).click();
  await page.reload();
  check(
    (await page.getByLabel("Filter monitors").inputValue()) === "heartbeat",
    "Monitor type filter did not survive reload",
  );
  check(
    (await page.getByLabel("Filter environment").inputValue()) === "production",
    "Environment filter did not survive reload",
  );
  check(
    (await page
      .getByRole("button", { name: "background", exact: true })
      .getAttribute("aria-pressed")) === "true",
    "Tag filter did not survive reload",
  );
  await page.goto(`${origin}/demo/deployments`);
  check(
    !(await page
      .getByRole("button", { name: "Record deployment", exact: true })
      .isVisible()),
    "Demo allowed deployment creation",
  );
  await page.goto(`${origin}/demo/monitors/website`);
  await page.getByRole("button", { name: "Pause monitor" }).click();
  await page
    .getByRole("heading", { name: "This workspace is read-only" })
    .waitFor();
  await page.keyboard.press("Escape");
  await page.goto(`${origin}/demo/monitors/new`);
  await page.getByLabel("Monitor name").fill("My endpoint");
  await page.getByLabel("Endpoint URL").fill("https://example.com");
  await page.getByRole("button", { name: "Preview creation" }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.goto(`${origin}/demo/incidents/inc-search`);
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  await page
    .getByRole("heading", { name: "Ask about this incident" })
    .waitFor();
  check(
    await page.getByText("This sample conversation is read-only.").isVisible(),
    "Chat demo must be explicitly read-only",
  );
  check(
    await page
      .getByRole("link", { name: "Ask about your incidents" })
      .isVisible(),
    "Chat demo must link to the real workspace signup",
  );
  await page.getByRole("button", { name: "Postmortem", exact: true }).click();
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Markdown" }).click();
  check(
    (await pendingDownload).suggestedFilename() ===
      "pulseflare-inc-search-sample.md",
    "Export filename incorrect",
  );
  await page.goto(`${origin}/demo/incidents/inc-search?tab=chat`);
  await page
    .getByRole("heading", { name: "Ask about this incident", exact: true })
    .waitFor();
  const routes = [
    "/",
    "/features",
    "/pricing",
    "/architecture",
    "/docs",
    "/login",
    "/signup",
    "/demo",
    "/demo/monitors",
    "/demo/monitors/website",
    "/demo/monitors/backup",
    "/demo/monitors/new",
    "/demo/incidents",
    "/demo/deployments",
    "/demo/incidents/inc-search",
    "/demo/incidents/inc-api",
    "/demo/integrations",
    "/demo/status-page",
    "/demo/maintenance",
    "/demo/api-keys",
    "/demo/usage",
    "/demo/audit",
    "/demo/settings",
    "/status/demo",
    "/does-not-exist",
  ];
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      console.log(`Checking ${width}px ${route}`);
      await page.goto(`${origin}${route}`);
      await page.locator("h1").first().waitFor();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      check(!overflow, `Horizontal overflow at ${width}px on ${route}`);
      const brokenImages = await page
        .locator("img")
        .evaluateAll((images) =>
          images
            .filter((image) => image.complete && !image.naturalWidth)
            .map((image) => image.src),
        );
      check(
        brokenImages.length === 0,
        `Broken image on ${route}: ${brokenImages}`,
      );
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/demo`);
  await page.getByRole("button", { name: "Open sidebar" }).click();
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("link", { name: "Usage & plans" })
    .click();
  await page.locator(".app-sidebar").waitFor({ state: "hidden" });
  await page.goto(origin);
  await page.locator("h1").waitFor();
  await page.screenshot({ path: "artifacts/home-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/demo`);
  await page.locator("h1").waitFor();
  await page.screenshot({ path: "artifacts/demo-dark.png", fullPage: true });
  await page
    .locator(".app-topbar")
    .getByRole("button", { name: "Switch to light theme" })
    .click();
  check(
    (await page.evaluate(() => document.documentElement.dataset.theme)) ===
      "light",
    "Light theme did not activate",
  );
  await page.screenshot({ path: "artifacts/demo-light.png", fullPage: true });
  await page.goto(origin);
  await page.locator("h1").waitFor();
  await page.screenshot({ path: "artifacts/home-light.png" });
  check(
    apiRequests.length === 0,
    `Demo made API requests: ${apiRequests.join(", ")}`,
  );
  check(errors.length === 0, `Browser errors: ${errors.join("; ")}`);
  if (optionalAnalyticsWarnings.length)
    console.log(
      `Optional Cloudflare analytics warnings: ${optionalAnalyticsWarnings.length}`,
    );
  console.log(
    JSON.stringify({
      result: "PASS",
      routeViewportChecks: routes.length * 3,
      pricingDialogs: true,
      readOnlyDemo: true,
      export: true,
      mobileNavigation: true,
      themes: true,
      apiRequests: 0,
      browserErrors: 0,
    }),
  );
}
