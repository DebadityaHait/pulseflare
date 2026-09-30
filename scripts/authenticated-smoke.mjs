import { chromium, expect } from "@playwright/test";
import { clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
process.loadEnvFile(".env");
const origin = process.argv[2] || "http://localhost:5173";
const authOnly = process.argv.includes("--auth-only");
const publishableKey =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  process.env.VITE_CLERK_PUBLISHABLE_KEY;
await clerkSetup({ publishableKey, dotenv: false });
await mkdir("artifacts", { recursive: true });
const tag = Date.now().toString(36),
  email = `pulseflare-${tag}+clerk_test@example.com`,
  password = `Pf_${randomBytes(16).toString("hex")}!a7`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext();
await setupClerkTestingToken({ context });
const page = await context.newPage();
page.setDefaultTimeout(20000);
let userId,
  orgId,
  workspaceId,
  heartbeatUrl,
  monitorId,
  heartbeatId,
  keyId,
  statusId;
const checks = [];
async function backend(path, method = "GET", body) {
  const response = await fetch(`https://api.clerk.com/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      `Clerk ${method} failed (${response.status}): ${result.errors?.map((e) => e.code).join(",")}`,
    );
  return result;
}
async function api(path, method = "GET", body) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const token = await window.Clerk.session.getToken();
      const r = await fetch(path, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const value = await r.json();
      if (!r.ok || !value.ok)
        throw new Error(
          `API ${method} ${path.replace(/heartbeat\/[^/]+/, "heartbeat/[redacted]")} failed (${r.status}): ${value.error?.message}`,
        );
      return value.data;
    },
    { path, method, body },
  );
}
try {
  await page.goto(`${origin}/signup`);
  await page.getByRole("button", { name: /Google/ }).waitFor();
  await page.getByRole("button", { name: /Google/ }).click();
  await page.waitForURL((url) => url.hostname === "accounts.google.com", {
    timeout: 30000,
  });
  checks.push("Google OAuth handoff");
  await page.goto(`${origin}/signup`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const verifying = page.getByRole("heading", {
    name: "Verify your email",
    exact: true,
  });
  await Promise.race([
    verifying.waitFor(),
    page.getByLabel("Name", { exact: true }).waitFor(),
  ]);
  if (await verifying.isVisible()) {
    // Fill atomically: typing six keys can race Clerk's OTP re-render.
    await page
      .locator('input[autocomplete="one-time-code"]')
      .first()
      .fill("424242");
    if (
      await page
        .getByRole("button", { name: "Continue", exact: true })
        .isVisible()
    )
      await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await page.getByLabel("Name", { exact: true }).waitFor();
  checks.push("Email/password signup and email verification");
  await page.getByLabel("Name", { exact: true }).fill(`Pulseflare test ${tag}`);
  await page
    .getByRole("button", { name: /^(Create organization|Continue)$/ })
    .click();
  await page.waitForFunction(() => window.Clerk?.organization, null, {
    timeout: 30000,
  });
  orgId = await page.evaluate(() => window.Clerk.organization.id);
  userId = await page.evaluate(() => window.Clerk.user.id);
  checks.push("Organization creation");
  if (!authOnly) {
    await page.waitForURL("**/dashboard");
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    const workspace = await api("/api/workspace");
    workspaceId = workspace.workspace.id;
    if (workspace.role !== "admin")
      throw new Error("New organization is not admin");
    checks.push("Authenticated Clerk organization API");
    await page.goto(`${origin}/dashboard/monitors/new`);
    await page
      .getByLabel("Monitor name", { exact: true })
      .fill("Release test website");
    await page
      .getByLabel("Endpoint URL", { exact: true })
      .fill("https://example.com");
    await page
      .getByLabel("Allow this monitor on your public status page")
      .check();
    await page
      .getByRole("button", { name: "Create monitor", exact: true })
      .click();
    await page.waitForURL(
      (url) =>
        /^\/dashboard\/monitors\/[^/]+$/.test(url.pathname) &&
        !url.pathname.endsWith("/new"),
    );
    monitorId = new URL(page.url()).pathname.split("/").at(-1);
    await page.getByRole("button", { name: "Run check", exact: true }).click();
    await expect(
      page.getByText("HTTP 200", { exact: true }).first(),
    ).toBeVisible({ timeout: 30000 });
    checks.push("HTTP creation and real manual check");
    await page.goto(`${origin}/dashboard/monitors/new`);
    await page.getByRole("button", { name: /Background job/ }).click();
    await page
      .getByLabel("Monitor name", { exact: true })
      .fill("Release test backup");
    await page.getByLabel("Expected interval (minutes)").fill("1");
    await page.getByLabel("Grace period (minutes)").fill("0");
    await page
      .getByRole("button", { name: "Create monitor", exact: true })
      .click();
    await page.locator(".secret-code").waitFor();
    heartbeatUrl = await page.locator(".secret-code").innerText();
    heartbeatId = (await api("/api/monitors")).find(
      (m) => m.name === "Release test backup",
    ).id;
    const ping = await fetch(heartbeatUrl);
    if (!ping.ok) throw new Error("Heartbeat ping failed");
    const heartbeat = await api(`/api/monitors/${heartbeatId}`);
    if (heartbeat.lastState !== "up")
      throw new Error("Heartbeat was not recorded");
    checks.push("Heartbeat creation, one-time URL and ping");
    await page.goto(`${origin}/dashboard/status-page`);
    await page
      .getByLabel("Page title", { exact: true })
      .fill("Release test status");
    await page.getByLabel("Public URL slug").fill(`release-${tag}`);
    await page.getByLabel("Release test website").check();
    await page
      .getByRole("button", { name: "Save status page", exact: true })
      .click();
    await page
      .getByText("Saved. Public changes appear within two minutes.")
      .waitFor();
    statusId = (await api("/api/status-pages"))[0].id;
    const snapshot = await (
      await fetch(`${origin}/api/status/release-${tag}`)
    ).json();
    if (
      !snapshot.ok ||
      snapshot.data.monitors.length !== 1 ||
      snapshot.data.monitors[0].id !== monitorId
    )
      throw new Error("Public selection did not match");
    checks.push("Public status publication and privacy");
    const key = await api("/api/api-keys", "POST", {
      name: "Release test",
      scopes: ["monitors:read"],
    });
    keyId = key.id;
    if (
      !(
        await fetch(`${origin}/api/monitors`, {
          headers: { authorization: `Bearer ${key.key}` },
        })
      ).ok
    )
      throw new Error("API key read failed");
    await api(`/api/api-keys/${keyId}`, "DELETE");
    if (
      (
        await fetch(`${origin}/api/monitors`, {
          headers: { authorization: `Bearer ${key.key}` },
        })
      ).status !== 401
    )
      throw new Error("Revoked key was accepted");
    checks.push("Scoped API key and revocation");
    await expect
      .poll(async () => (await api(`/api/monitors/${heartbeatId}`)).lastState, {
        timeout: 150000,
        intervals: [10000],
      })
      .toBe("down");
    const missed = await api(`/api/monitors/${heartbeatId}/incidents`);
    if (!missed.some((i) => i.status !== "resolved"))
      throw new Error("Missed heartbeat did not open an incident");
    if (!(await fetch(heartbeatUrl, { method: "POST" })).ok)
      throw new Error("Heartbeat recovery ping failed");
    const recovered = await api(`/api/monitors/${heartbeatId}/incidents`);
    if (recovered.some((i) => i.status !== "resolved"))
      throw new Error("Heartbeat did not resolve its incident");
    checks.push("Scheduled missed-heartbeat incident and automatic recovery");
    await page.goto(`${origin}/dashboard`);
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await page.locator(".workspace-shell").waitFor();
    await expect(page.locator(".skeleton-group")).toHaveCount(0);
    await expect(
      page.getByText("Release test website", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Release test backup", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "artifacts/authenticated-workspace.png",
      fullPage: true,
    });
  }
  console.log(JSON.stringify({ passed: checks, origin }));
} catch (error) {
  await page
    .screenshot({ path: "artifacts/authenticated-failure.png", fullPage: true })
    .catch(() => {});
  console.log(
    JSON.stringify({
      stage: checks,
      visibleText: (await page.locator("body").innerText())
        .replaceAll(email, "[test email]")
        .slice(0, 5000),
    }),
  );
  throw error;
} finally {
  await writeFile(
    "artifacts/authenticated-test.json",
    JSON.stringify({ workspaceId, orgId, userId, checks, origin }),
  );
  if (!userId) {
    const users = await backend(
      `/users?email_address=${encodeURIComponent(email)}`,
    );
    userId = users[0]?.id;
  }
  if (!orgId && userId) {
    try {
      const orgs = await backend(`/users/${userId}/organization_memberships`);
      orgId = orgs.data?.[0]?.organization.id;
    } catch {
      /* A disabled Organization feature must not prevent test-user cleanup. */
    }
  }
  if (!authOnly && orgId) {
    for (const id of [monitorId, heartbeatId].filter(Boolean))
      await api(`/api/monitors/${id}`, "DELETE").catch(() => {});
    if (statusId)
      await api(`/api/status-pages/${statusId}`, "DELETE").catch(() => {});
  }
  if (orgId) await backend(`/organizations/${orgId}`, "DELETE");
  if (userId) await backend(`/users/${userId}`, "DELETE");
  console.log(
    JSON.stringify({
      cleanup: { clerkUser: !!userId, clerkOrganization: !!orgId },
    }),
  );
  await browser.close();
}
