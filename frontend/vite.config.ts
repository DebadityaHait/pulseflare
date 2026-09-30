import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "..", "");
  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(
        env.VITE_CLERK_PUBLISHABLE_KEY ||
          env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
          "",
      ),
    },
    server: {
      port: 5173,
      proxy: {
        "/api": { target: "http://localhost:8787", changeOrigin: true },
      },
    },
  };
});
