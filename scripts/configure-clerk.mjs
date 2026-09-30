// Development-instance setup required by Pulseflare's organization-scoped API.
process.loadEnvFile(".env");
const key =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  process.env.VITE_CLERK_PUBLISHABLE_KEY;
if (
  !key?.startsWith("pk_test_") ||
  !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")
)
  throw new Error("This setup script requires development Clerk credentials");
const response = await fetch(
  "https://api.clerk.com/v1/instance/organization_settings",
  {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ enabled: true }),
  },
);
const result = await response.json();
if (!response.ok)
  throw new Error(
    `Clerk organization setup failed (${response.status}): ${result.errors?.map((e) => e.code).join(",")}`,
  );
console.log(
  JSON.stringify({ development: true, organizationsEnabled: result.enabled }),
);
