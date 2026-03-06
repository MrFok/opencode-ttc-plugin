# AGENTS.md

Guidance for coding agents working in `token-company-proxy`.

## Stack And Structure
- Runtime: Node.js `>=20`.
- Module system: ESM (`"type": "module"`).
- Entrypoint: `src/server.js`.
- Tests: `tests/*.test.js` via Node's built-in test runner.
- Scripts: `scripts/smoke-e2e.mjs`, `scripts/load-conformance.mjs`.
- No build pipeline, no TypeScript, no lint/format tooling currently configured.

## Repository Rule Files
- `.cursor/rules/`: not present.
- `.cursorrules`: not present.
- `.github/copilot-instructions.md`: not present.
- If any are added later, treat them as higher-priority constraints and merge with this file.

## Setup
- `npm install`
- `cp .env.example .env.local`
- Set required values in `.env.local`:
  - `UPSTREAM_API_KEY` (required for normal use)
  - `UPSTREAM_BASE_URL` (optional; defaults are already provided)
  - `PROXY_API_KEY` (optional; enables proxy auth)

## Run Commands
- Start server: `npm start`
- Start with watch mode: `npm run dev`
- Health probe: `curl -s http://localhost:8080/healthz`
- Stats probe: `curl -s http://localhost:8080/stats`

## Build / Lint / Test

### Build
- No build step exists for this repository.
- Optional syntax check: `node --check src/server.js`

### Lint
- No lint command exists in `package.json`.
- Do not add lint tooling unless explicitly requested.
- Lightweight syntax guard: `node --check src/server.js`

### Test
- Run full suite: `npm test`
- Equivalent direct command: `node --test tests/*.test.js`
- Run one file: `node --test tests/upstream-resilience.test.js`
- Run one named test: `node --test --test-name-pattern "retries upstream on 500" tests/upstream-resilience.test.js`
- Run matching names across suite: `node --test --test-name-pattern "responses|embeddings|models" tests/*.test.js`
- Spec-style reporter: `node --test --test-reporter spec tests/*.test.js`

### E2E / Load
- Smoke checks: `npm run smoke:e2e`
- Load conformance: `npm run load:conformance`
- Useful env overrides:
  - `PROXY_BASE_URL`
  - `PROXY_TEST_MODEL`
  - `PROXY_TEST_API_KEY`
  - `LOAD_CONCURRENCY`
  - `LOAD_REQUESTS_PER_WORKER`
  - `LOAD_STREAM`

## Coding Conventions

### Imports
- Use ESM `import`; avoid `require`.
- Prefer Node built-ins with `node:` prefixes.
- Keep imports at top of file.
- Keep import specifiers in double quotes.

### Formatting
- Use semicolons.
- Use double-quoted strings.
- Follow existing spacing/line-breaking style in touched files.
- Prefer guard clauses and early return over deep nesting.
- Keep helpers small and focused.
- Add comments only when behavior is non-obvious.

### Types And Validation
- This is JS-only; there are no TypeScript types.
- Validate request/env input explicitly with runtime checks.
- Use `Number.parseInt` / `Number.parseFloat` for numeric env parsing.
- Use safe JSON parsing with fallback defaults.
- Prefer plain objects, arrays, `Map`, and `Set`.

### Naming
- Constants and env-derived config: `UPPER_SNAKE_CASE`.
- Functions and variables: `camelCase`.
- Boolean helpers should read clearly (`isX`, `hasX`, `shouldX`).
- Handlers follow `handleX`.
- URL constructors follow `buildXUrl`.

### Error Handling
- Handle parse/network failures with explicit `try/catch`.
- Return structured OpenAI-style errors using existing `openAiError(...)` shape.
- Do not crash process on expected upstream/transient failures.
- Preserve fail-open behavior for optional compression paths.
- Preserve bounded retry/backoff/fallback behavior.

### HTTP And Streaming
- Preserve OpenAI-compatible routes and payload contracts:
  - `/v1/chat/completions`
  - `/v1/responses`
  - `/v1/embeddings`
  - `/v1/models`
- Keep streaming behavior stream-safe (no full buffering unless necessary).
- Strip hop-by-hop headers when proxying.
- Keep `x-proxy-request-id` propagation.
- Be careful with auth header forwarding rules.

### Logging And Secrets
- Keep logs structured JSON via existing logging helpers.
- Include request identifiers and outcome metadata.
- Never log secrets, bearer tokens, or raw API keys.
- Preserve/use sanitization helpers when adding log fields.

### Testing Style
- Use `node:test` + `node:assert/strict`.
- Tests are integration-oriented with local mock HTTP servers.
- Use deterministic setup and teardown (`try/finally`).
- Keep tests isolated with unique local ports.
- Assert both status codes and response body contract details.

## Agent Working Rules For This Repo
- Keep changes minimal and scoped to the user request.
- Do not introduce dependencies or tooling changes unless asked.
- Prefer editing existing patterns over refactoring style globally.
- Update tests when behavior changes.
- Update `README.md` when external behavior or env vars change.
- Maintain backward compatibility for existing API contract unless explicitly asked to break it.

## Quick Start (Cursor)
1. Open this folder in Cursor.
2. Ensure Node 20+ is active (`node -v`).
3. Run `npm install`.
4. Run `cp .env.example .env.local`.
5. Put your upstream key in `.env.local` (`UPSTREAM_API_KEY=...`).
6. Start proxy: `npm start`.
7. In Cursor OpenAI settings, set:
   - Base URL: `http://localhost:8080/v1`
   - API key: any value, or your `PROXY_API_KEY` if enabled.
8. Verify locally with `npm test` and optionally `npm run smoke:e2e`.
