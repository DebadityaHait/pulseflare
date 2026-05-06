# Claude Code Instructions

Implement Pulseflare from `PRD.md` and `ai-enhanced-uptime-monitor-prd.md`.

- TypeScript only.
- Cloudflare Workers runtime.
- D1 for persistence, KV for latest status, Queues for async work, Workers AI for AI features, R2 for archives.
- Use prepared D1 statements.
- Keep AI calls asynchronous and guarded by deterministic fallbacks.
- Do not commit secrets or expose webhook URLs in public responses.
- Run `pnpm typecheck` and `pnpm test` before submitting.
