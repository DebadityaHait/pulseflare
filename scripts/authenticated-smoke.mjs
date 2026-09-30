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
    // Clerk submits a complete OTP automatically. Clicking Continue as well
    // races that request and can invalidate the in-flight verification.
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
      .getByLabel("Environment", { exact: true })
      .selectOption("production");
    await page
      .getByLabel("Tags", { exact: true })
      .fill("critical, customer-facing");
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
    await page.goto(`${origin}/dashboard/monitors`);
    await page.getByLabel("Filter environment").selectOption("production");
    await page.getByRole("button", { name: "critical", exact: true }).click();
    await page.reload();
    await expect(page.getByLabel("Filter environment")).toHaveValue(
      "production",
    );
    await expect(
      page.getByRole("button", { name: "critical", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".monitor-row")).toHaveCount(1);
    const tagged = (await api("/api/monitors")).find((m) => m.id === monitorId);
    if (
      tagged.environment !== "production" ||
      !tagged.tags.includes("customer-facing")
    )
      throw new Error("Monitor labels did not persist");
    checks.push("Monitor environments, tags and shareable filter reload");
    await page.goto(`${origin}/dashboard/deployments`);
    await page
      .getByRole("button", { name: "Record deployment", exact: true })
      .click();
    await page.getByLabel("Version or commit").fill(`manual-${tag}`);
    await page.getByLabel("Release test website", { exact: true }).check();
    await page
      .getByRole("button", { name: "Save deployment", exact: true })
      .click();
    await expect(
      page.getByText(`manual-${tag}`, { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText(`manual-${tag}`, { exact: true }),
    ).toBeVisible();
    const ci = await api("/api/api-keys", "POST", {
      name: "Release CI",
      scopes: ["deployments:read", "deployments:write"],
    });
    const ciPayload = {
      version: `ci-${tag}`,
      environment: "production",
      source: "github",
      monitorIds: [monitorId],
    };
    async function ciRequest(path, method = "GET", body) {
      return fetch(`${origin}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${ci.key}`,
          "content-type": "application/json",
          "Idempotency-Key": `release-${tag}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    }
    const firstDeploy = await (
      await ciRequest("/api/deployments", "POST", ciPayload)
    ).json();
    const retryDeploy = await (
      await ciRequest("/api/deployments", "POST", ciPayload)
    ).json();
    if (!firstDeploy.ok || firstDeploy.data.id !== retryDeploy.data?.id)
      throw new Error("CI deployment retry was not idempotent");
    if ((await ciRequest("/api/monitors")).status !== 403)
      throw new Error("CI key exceeded its scope");
    await api(`/api/api-keys/${ci.id}`, "DELETE");
    await page.goto(`${origin}/dashboard/monitors/${monitorId}`);
    await expect(page.getByText(`ci-${tag}`, { exact: true })).toBeVisible();
    checks.push(
      "Manual deployments, monitor annotations and idempotent scoped CI API",
    );
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
    for (const [suffix, type] of [
      ["/badge.svg", "image/svg+xml"],
      ["/rss", "application/rss+xml"],
    ]) {
      const feed = await fetch(`${origin}/api/status/release-${tag}${suffix}`);
      const text = await feed.text();
      if (
        !feed.ok ||
        !feed.headers.get("content-type")?.includes(type) ||
        text.includes(`ci-${tag}`) ||
        text.includes("Release test backup")
      )
        throw new Error(
          "Public distribution leaked private data or returned an invalid format",
        );
    }
    await expect(
      page.getByRole("heading", {
        name: "Share your service health",
        exact: true,
      }),
    ).toBeVisible();
    checks.push("Published SVG badge, RSS and JSON privacy");
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
    const incidentId = missed.find((i) => i.status !== "resolved").id;
    await page.goto(`${origin}/dashboard/incidents/${incidentId}`);
    await page.getByRole("button", { name: "Postmortem", exact: true }).click();
    await page
      .getByLabel("Impact", { exact: true })
      .fill("Private release-test impact. No customer traffic was involved.");
    await page
      .getByLabel("Root cause", { exact: true })
      .fill("Intentionally missed test heartbeat.");
    await page
      .getByRole("button", { name: "Save report", exact: true })
      .click();
    await expect(
      page.getByText("Report saved. It remains private to your workspace.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Postmortem", exact: true }).click();
    await expect(page.getByLabel("Root cause", { exact: true })).toHaveValue(
      "Intentionally missed test heartbeat.",
    );
    const exportEvent = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export Markdown", exact: true })
      .click();
    const exportedReport = await exportEvent;
    if (exportedReport.suggestedFilename() !== `pulseflare-${incidentId}.md`)
      throw new Error("Saved report export failed");
    const reportStream = await exportedReport.createReadStream();
    let reportText = "";
    for await (const chunk of reportStream) reportText += chunk.toString();
    if (
      !reportText.includes(
        "\n## Root cause\nIntentionally missed test heartbeat.",
      )
    )
      throw new Error("Export did not contain the saved Markdown report");
    checks.push(
      "Private editable postmortem, saved reload and Markdown export",
    );
    await page.getByRole("button", { name: "Ask AI", exact: true }).click();
    await page
      .getByLabel("Your question", { exact: true })
      .fill("What does the evidence show about this missed heartbeat?");
    await page
      .getByRole("button", { name: "Send question", exact: true })
      .click();
    await expect(
      page.locator(".chat-turn .chat-message.assistant"),
    ).toHaveCount(1, { timeout: 40000 });
    await expect(page.locator(".chat-sources")).toHaveCount(1, {
      timeout: 40000,
    });
    const firstChat = await api(`/api/incidents/${incidentId}/chat`);
    if (
      firstChat.turns.length !== 1 ||
      firstChat.turns[0].status !== "complete" ||
      !firstChat.turns[0].answer ||
      !firstChat.model.includes("llama-3.3")
    )
      throw new Error("Real Llama 3.3 conversation was not saved");
    await page.reload();
    await page.getByRole("button", { name: "Ask AI", exact: true }).click();
    await expect(page.locator(".chat-sources")).toHaveCount(1);
    await page
      .getByLabel("Your question", { exact: true })
      .fill("Following up on my previous question, what should I check next?");
    await page
      .getByRole("button", { name: "Send question", exact: true })
      .click();
    await expect(page.locator(".chat-sources")).toHaveCount(2, {
      timeout: 40000,
    });
    const followupChat = await api(`/api/incidents/${incidentId}/chat`);
    if (
      followupChat.turns.length !== 2 ||
      followupChat.turns[1].status !== "complete"
    )
      throw new Error("Follow-up chat was not persisted");
    checks.push(
      "Real Llama 3.3 incident chat, D1 memory, reload and follow-up",
    );
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
