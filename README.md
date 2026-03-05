# token-company-proxy

OpenAI-compatible proxy for IDE workflows (Cursor-compatible) that can apply safe prompt compression before forwarding requests to an upstream model provider.

## Current Status
- Milestone 1 implemented: baseline pass-through proxy
- Milestone 2 implemented: safe-mode selective compression with fail-open fallback

## Milestone 1 Features
- `POST /v1/chat/completions` OpenAI-compatible pass-through
- Streaming pass-through (no full response buffering)
- Configurable upstream (`UPSTREAM_BASE_URL`, `UPSTREAM_API_KEY`)
- Optional proxy auth (`PROXY_API_KEY`)
- Health endpoint at `GET /healthz`

## Supported Endpoints (current)
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/embeddings`
- `GET /v1/models`
- `GET /healthz`
- `GET /stats`
- `GET /debug/logs` (local mode)

## Milestone 2 Features
- Safe-mode selective compression for `/v1/chat/completions` request messages
- Conservative default: compress only `user` role content (`COMPRESS_ROLES` configurable)
- High-risk content skip heuristics (code fences, diffs, stack traces, likely structured blobs)
- Fail-open behavior for all compression errors/timeouts
- Token Company integration with optional gzip requests
- Stats endpoint at `GET /stats` (no prompt content)
- Local structured logs endpoint at `GET /debug/logs` (local mode only)

## Milestone 3 Hardening
- Compression retry policy for transient Token Company failures (`5xx`, `429`, timeouts)
- Bounded retry/backoff with fail-open fallback after retry exhaustion
- Integration tests for fail-open and retry success paths (`npm test`)

## Milestone 4 Hardening
- Upstream retry matrix for transient failures (`429`, `5xx`, timeout/network)
- Upstream timeout split: first stream chunk timeout + total upstream timeout
- Model fallback chain support via `UPSTREAM_FALLBACKS`
- Stream-safe behavior: no replay retry after stream output begins

## Milestone 5 Routing
- Multi-provider registry via `UPSTREAM_PROVIDERS_JSON`
- Model routing rules (exact/prefix/glob) via `MODEL_ROUTE_RULES_JSON`
- Default provider selection via `MODEL_DEFAULT_PROVIDER`
- Cross-provider fallback rules via `MODEL_FALLBACK_RULES_JSON`

## Milestone 6 Provider Auth Policy
- Per-provider auth mode support (`provider_key`, `client_bearer`, `provider_or_client`)
- Per-provider API key via inline `apiKey` or `apiKeyEnv`
- Safe custom provider headers (`x-*` and `openrouter-*` allowlist)
- Optional strict startup validation via `PROVIDER_CONFIG_STRICT`

## Milestone 7 Models Catalog
- `GET /v1/models` support for OpenAI-compatible model discovery
- Modes: `passthrough`, `aggregate`, and `static`
- TTL cache for model catalog responses
- Optional allowlist/denylist filters and alias names

## Milestone 8 Responses API
- `POST /v1/responses` support with same routing/retry/fallback behavior as chat completions
- Safe fail-open compression for eligible `input` content in responses payloads
- Streaming passthrough with first-chunk timeout protections

## Milestone 9 Embeddings API
- `POST /v1/embeddings` support with multi-provider routing/retry/fallback parity
- Embeddings compression is disabled by default (`ENABLE_EMBEDDINGS_COMPRESSION=false`)

## Quick Start
1. Copy env file and set keys:
   - `cp .env.example .env.local`
   - Set `UPSTREAM_API_KEY`
2. Start server:
   - `npm start`
3. Configure Cursor:
   - Base URL: `http://localhost:8080/v1`
   - API Key: `anything` (or your `PROXY_API_KEY` if enabled)

## Environment Variables
- `PORT` (default `8080`)
- `UPSTREAM_BASE_URL` (default `https://api.openai.com`)
- `UPSTREAM_API_KEY` (recommended; if empty, proxy forwards client Bearer token)
- `UPSTREAM_MAX_RETRIES` (default `2`)
- `UPSTREAM_RETRY_BACKOFF_MS` (default `150`)
- `UPSTREAM_RETRY_STATUS_CODES` (default `429,500,502,503,504`)
- `UPSTREAM_STREAM_FIRST_CHUNK_TIMEOUT_MS` (default `12000`)
- `UPSTREAM_TOTAL_TIMEOUT_MS` (default `120000`)
- `UPSTREAM_FALLBACKS` (format: `model=fallback1,fallback2;*=defaultFallback`)
- `UPSTREAM_PROVIDERS_JSON` (JSON provider registry)
- `MODEL_ROUTE_RULES_JSON` (JSON route rules)
- `MODEL_DEFAULT_PROVIDER` (default `default`)
- `MODEL_FALLBACK_RULES_JSON` (JSON fallback chains)
- `PROVIDER_CONFIG_STRICT` (`true` fails startup on invalid provider auth config)
- `MODELS_SOURCE_MODE` (`passthrough|aggregate|static`)
- `MODELS_CACHE_TTL_MS` (default `30000`)
- `MODELS_ALLOWLIST` (comma-separated model IDs)
- `MODELS_DENYLIST` (comma-separated model IDs)
- `MODELS_ALIASES_JSON` (JSON map of model id to display name)
- `MODELS_STATIC_JSON` (JSON array of model objects for static mode)
- `PROXY_API_KEY` (optional, enables proxy-level auth)
- `TOKEN_COMPANY_API_KEY` (used in Milestone 2)
- `LOCAL_TEST_MODE` (`true` enables `.env.local` preference)
- `ENABLE_COMPRESSION` (`true`/`false`)
- `ENABLE_EMBEDDINGS_COMPRESSION` (`true` enables optional embeddings input compression)
- `TOKEN_COMPANY_BASE_URL` (default `https://api.thetokencompany.com`)
- `TOKEN_COMPANY_MODEL` (default `bear-1.2`)
- `TOKEN_COMPANY_AGGRESSIVENESS` (default `0.1`)
- `TOKEN_COMPANY_TIMEOUT_MS` (default `2500`)
- `TOKEN_COMPANY_USE_GZIP` (default `true`)
- `TOKEN_COMPANY_MAX_RETRIES` (default `1`)
- `TOKEN_COMPANY_RETRY_BACKOFF_MS` (default `100`)
- `COMPRESSION_MIN_CHARS` (default `500`)
- `COMPRESS_ROLES` (comma-separated, default `user`)
- `LOG_LEVEL` (`debug|info|warn|error`)
- `LOG_BUFFER_SIZE` (in-memory log ring size, default `500`)
- `LOG_LOCAL_ENDPOINT` (enable `GET /debug/logs` in non-production)

## Local Test Mode
- When `LOCAL_TEST_MODE=true` (or when `.env.local` exists and `NODE_ENV` is not `production`), the proxy loads `.env.local` first.
- `.env` is also loaded as fallback for missing values.
- Existing shell environment variables still take priority over file values.

## OpenRouter Example
Use OpenRouter as upstream by setting:

```env
UPSTREAM_BASE_URL=https://openrouter.ai/api
UPSTREAM_API_KEY=<openrouter_key>
```

Then send a request through the proxy using your model name, for example:

```bash
curl -s http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_PROXY_API_KEY" \
  -d '{
    "model": "arcee-ai/trinity-large-preview:free",
    "messages": [
      {"role": "user", "content": "Say hello in one sentence."}
    ]
  }'
```

## Notes
- Upstream compatibility target is currently `/v1/chat/completions`.
- Compression path is intentionally conservative for coding safety.
- `.env.local` remains ignored and should never be committed.
- `/stats` now includes upstream retry/fallback counters and fallback rule visibility.

## Multi-Provider Routing Example
```env
UPSTREAM_PROVIDERS_JSON={"openrouter":{"baseURL":"https://openrouter.ai/api","authMode":"provider_or_client","apiKeyEnv":"OPENROUTER_API_KEY","passThroughClientAuth":true},"openai":{"baseURL":"https://api.openai.com","authMode":"provider_key","apiKeyEnv":"OPENAI_API_KEY","headers":{"x-app":"token-proxy"}}}
MODEL_ROUTE_RULES_JSON=[{"match":"prefix","value":"openrouter/","provider":"openrouter"},{"match":"prefix","value":"gpt-","provider":"openai"}]
MODEL_DEFAULT_PROVIDER=openrouter
MODEL_FALLBACK_RULES_JSON={"gpt-5.2":["openai:gpt-5.1","openrouter:gpt-4.1"]}
PROVIDER_CONFIG_STRICT=true
```

## Testing
- Run integration tests:
  - `npm test`
- Run local end-to-end smoke checks:
  - `npm run smoke:e2e`
- Run basic load conformance checks:
  - `npm run load:conformance`

## Local Logs Endpoint
- Endpoint: `GET /debug/logs`
- Available only when `LOG_LOCAL_ENDPOINT=true` and not in production.
- Requires proxy auth if `PROXY_API_KEY` is configured.
- Query params:
  - `level` (`debug|info|warn|error`)
  - `request_id`
  - `since` (ISO timestamp)
  - `limit` (max `200`)

## Planning Docs
- `docs/spec.md`
- `docs/implementation-plan.md`
- `docs/evaluation-plan.md`
- `docs/decisions.md`
- `docs/token-company-api-notes.md`
- `docs/logging-instructions.txt`
