process.loadEnvFile(".env");
const key =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  process.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!key || !process.env.CLERK_SECRET_KEY)
  throw new Error("Clerk keys are missing");
const host = Buffer.from(key.split("_").slice(2).join("_"), "base64")
  .toString()
  .replace(/\$$/, "");
const response = await fetch("https://api.clerk.com/v1/instance", {
  headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
});
const data = await response.json();
console.log(
  JSON.stringify(
    {
      status: response.status,
      development: key.startsWith("pk_test_"),
      name: data.name,
      errors: data.errors?.map((e) => e.code),
    },
    null,
    2,
  ),
);
