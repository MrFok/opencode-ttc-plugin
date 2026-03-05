# Compatibility and Reliability Gates

This document defines validation gates for Cursor/OpenCode compatibility before release.

## Required automated gates
- `npm test` passes.
- Contract tests pass (`tests/cursor-compat-contract.test.js`).
- Endpoint tests pass for:
  - `/v1/chat/completions`
  - `/v1/responses`
  - `/v1/embeddings`
  - `/v1/models`

## Required smoke checks
- `npm run smoke:e2e` returns `[smoke] PASS`.
- `GET /stats` shows request counter growth after smoke run.

## Load conformance gate
- Run:

```bash
LOAD_CONCURRENCY=3 LOAD_REQUESTS_PER_WORKER=10 npm run load:conformance
```

Minimum pass criteria:
- Error rate <= 5%
- Streaming and non-streaming modes both complete without hangs.

Suggested stronger target:
- Error rate <= 1%
- p95 latency stable across repeated runs.

## Manual IDE gate (Cursor)
1. Set Override OpenAI Base URL to `http://localhost:8080/v1`.
2. Confirm model list loads from `/v1/models`.
3. Run a normal chat prompt.
4. Run a streaming prompt.
5. Run a tool-call prompt.
6. Verify no obvious format or schema breakage.

## Fail conditions
- Any endpoint returns non-OpenAI-compatible error schema.
- `/v1/models` unavailable in configured mode.
- Streaming truncation or replay behavior after output starts.
- Retry/fallback behavior causes duplicate output on active stream.
