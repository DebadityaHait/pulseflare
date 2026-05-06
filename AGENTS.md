# AGENTS.md

## Project

Pulseflare is a Cloudflare-native AI-enhanced uptime monitor.

## Commands

- Install: `pnpm install`
- Typecheck: `pnpm typecheck`
- Test: `pnpm test`
- Build frontend: `pnpm --filter frontend build`
- Deploy: `pnpm deploy`

## Important Files

- `migrations/0001_schema.sql`
- `packages/shared/src`
- `workers/checker/src/index.ts`
- `workers/api/src/index.ts`
- `workers/ai/src/index.ts`
- `workers/alert/src/index.ts`
- `frontend/src/App.tsx`
