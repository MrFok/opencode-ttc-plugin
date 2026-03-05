# E2E Smoke Checklist (Cursor/OpenCode)

## Preconditions
- Proxy running locally (`npm start`)
- Upstream credentials configured in `.env.local`
- Base URL points to proxy (`http://localhost:8080/v1`)

## Automated smoke run
```bash
npm run smoke:e2e
```

Optional env overrides:
```bash
PROXY_BASE_URL=http://localhost:8080/v1 \
PROXY_TEST_MODEL=arcee-ai/trinity-large-preview:free \
PROXY_TEST_API_KEY= \
npm run smoke:e2e
```

Expected output includes:
- `[smoke] healthz ok`
- `[smoke] models listed: ...`
- `[smoke] chat ok ...`
- `[smoke] responses ok`
- `[smoke] PASS`

Embeddings line may show `ok` or `skipped`, depending on upstream model availability.

## Manual Cursor checks
1. Set `Override OpenAI Base URL` to `http://localhost:8080/v1`.
2. Select a model exposed by `/v1/models`.
3. Run a standard chat request and verify successful output.
4. Run a code-heavy prompt and confirm no obvious prompt corruption.
5. Validate streaming response starts quickly and completes.
6. Check `http://localhost:8080/stats` to confirm counters increased.

## Troubleshooting quick checks
- `401` responses: verify `PROXY_API_KEY` expectation and client auth header.
- `502` responses: verify upstream API key/base URL and route rules.
- Missing models: verify `MODELS_SOURCE_MODE` and provider config.
- Empty or wrong route: verify `MODEL_ROUTE_RULES_JSON` and `MODEL_DEFAULT_PROVIDER`.
