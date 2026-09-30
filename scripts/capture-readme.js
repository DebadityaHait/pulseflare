// Capture the actual deployed UI, without signing in or modifying server data.
// Run: node scripts/run-readme-capture.mjs [origin]
export default async function captureReadme(
  page,
  origin = "https://pulseflare.zlv.uk",
) {
  const captures = [
    { route: "/", file: "homepage", theme: "dark", width: 1440, height: 880 },
    {
      route: "/demo",
      file: "workspace",
      theme: "dark",
      width: 1440,
      height: 960,
    },
    {
      route: "/demo/monitors/website",
      file: "monitor",
      theme: "light",
      width: 1440,
      height: 960,
    },
    {
      route: "/demo/incidents/inc-search",
      file: "incident",
      theme: "dark",
      width: 1440,
      height: 1050,
    },
    {
      route: "/demo/deployments",
      file: "deployments",
      theme: "dark",
      width: 1440,
      height: 960,
    },
    {
      route: "/demo/incidents/inc-search",
      tab: "Postmortem",
      file: "postmortem",
      theme: "light",
      width: 1440,
      height: 1050,
    },
    {
      route: "/status/demo",
      file: "status-page",
      theme: "light",
      width: 1440,
      height: 1050,
    },
    { route: "/demo", file: "mobile", theme: "dark", width: 390, height: 844 },
  ];
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(origin);
  const results = [];
  for (const capture of captures) {
    await page.setViewportSize({
      width: capture.width,
      height: capture.height,
    });
    await page.evaluate(
      (theme) => localStorage.setItem("pulseflare_theme", theme),
      capture.theme,
    );
    await page.goto(`${origin}${capture.route}`);
    await page.locator("h1").first().waitFor();
    if (capture.tab)
      await page
        .getByRole("button", { name: capture.tab, exact: true })
        .click();
    await page.evaluate(() => document.fonts.ready);
    // Give the actual chart/entry animation time to settle, without changing it.
    await page.waitForTimeout(1200);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    if (overflow) throw new Error(`Horizontal overflow on ${capture.route}`);
    await page.screenshot({
      path: `docs/screenshots/${capture.file}.png`,
      animations: "disabled",
      fullPage: capture.route !== "/" && capture.file !== "mobile",
    });
    results.push({
      route: capture.route,
      file: capture.file,
      theme: capture.theme,
      title: await page.title(),
    });
  }
  return results;
}
