# Reliability, Adaptation, and Deployment Hardening Plan

## Purpose
Define the concrete roadmap for adapting proven gateway reliability patterns into this proxy, while maintaining safety-first prompt compression and avoiding IDE bottlenecks.

## Current Baseline
- Milestone 1 complete: OpenAI-compatible pass-through for `/v1/chat/completions` with streaming support.
- Milestone 2 complete: safe-mode selective Token Company compression + fail-open.
- Milestone 3 complete: compression retry hardening + integration tests.
- Structured logs and local log inspection endpoint are implemented.

## Product and Reliability Goals
- Keep Cursor and OpenAI-compatible clients working without workflow changes.
- Reduce input size safely where eligible.
- Never block model responses when compression or transient dependencies fail.
- Ensure proxy overhead remains small enough that IDE UX is not degraded.

## Design Principles
- Safe by default: skip risky compression candidates.
- Fail-open always: forward original payload when compression path degrades.
- Streaming first: preserve stream passthrough, avoid response buffering.
- Bounded external calls: strict timeout/retry policies.
- Security-first observability: structured logs and metrics without secret leakage.

---

## 1) Copy/Adapt Governance (Licensing + Attribution)

### Allowed direct adaptation
- MIT
- Apache-2.0
- BSD-2-Clause / BSD-3-Clause

### Disallowed for direct code copy into this repository
- GPL / AGPL / other copyleft licenses unless project license strategy is intentionally changed.

### Source licensing notes from prior research
- `BerriAI/litellm`: MIT for open-source portions; separate license for enterprise folder.
- `Nayjest/lm-proxy` (`openai-http-proxy`): MIT.
- `rxliuli/openai-api-proxy`: GPL-3.0 (do not copy code into this repo).

### Required adaptation workflow
1. Verify source license before copying any substantial code.
2. Record source URL and commit/hash if available.
3. Add attribution in `THIRD_PARTY_NOTICES.md`.
4. Keep adapted code minimal and test-covered.

### Required documentation files
- `docs/third-party-adaptation-policy.md` (license policy and process)
- `THIRD_PARTY_NOTICES.md` (source, license, files adapted, notes)

---

## 2) Feature Adaptation Plan

## Phase P0 (next, highest impact)
1. **Upstream retry policy**
   - Retry only on transient failures: `429`, `5xx`, timeouts, network errors.
   - No retry on auth/validation class errors: `400`, `401`, `403`, `404`.
   - Add config:
     - `UPSTREAM_MAX_RETRIES`
     - `UPSTREAM_RETRY_BACKOFF_MS`
     - `UPSTREAM_RETRY_STATUS_CODES`

2. **Split timeout model**
   - Add first-token timeout for streaming startup.
   - Add full-response timeout.
   - Add config:
     - `UPSTREAM_STREAM_FIRST_CHUNK_TIMEOUT_MS`
     - `UPSTREAM_TOTAL_TIMEOUT_MS`

3. **Upstream fallback chain**
   - On retry exhaustion, route request to ordered backup route(s).
   - Keep OpenAI-compatible response surface for caller.
   - Add config:
     - `UPSTREAM_FALLBACKS`

4. **Idempotency-safe stream retry guard**
   - Retry/fallback is allowed before first stream chunk.
   - No replay retry once stream bytes were emitted to client.

## Phase P1 (stability under partial outages)
5. **Passive cooldown / route health tracking**
   - Mark unstable route in cooldown window after repeated failures.
   - Skip cooled-down routes until recovery window expires.
   - Add config:
     - `UPSTREAM_ALLOWED_FAILS_PER_WINDOW`
     - `UPSTREAM_FAIL_WINDOW_SECONDS`
     - `UPSTREAM_COOLDOWN_SECONDS`

6. **Per-request resilience overrides (bounded)**
   - Optional request controls:
     - `disable_fallbacks`
     - `timeout_ms`
     - `max_retries`
   - Enforce server-side max caps.

7. **Error-class-specific fallback policies**
   - Rate-limit/outage class -> alternate provider/model.
   - Context-window class -> larger-context fallback model.

## Phase P2 (hosted readiness)
8. **Rate limiting + concurrency bounds**
   - Per key and global request limits.
   - Max in-flight and bounded queue.

9. **Expanded metrics and routing telemetry**
   - Retry, fallback, cooldown, timeout, first-token latency histograms.

10. **Failure injection controls**
- Test-only switches to induce timeout/429/5xx/stream startup delay paths.

---

## 3) Deployment Hardening and Anti-Bottleneck Practices

## Runtime architecture
- Keep proxy stateless and horizontally scalable.
- Run multiple instances behind reverse proxy or load balancer.
- Keep shared mutable state out of request path where possible.

## Streaming hardening
- Preserve stream passthrough end-to-end.
- Avoid full response buffering.
- Ensure reverse proxies are configured for streaming behavior.

## Connection efficiency
- Reuse upstream and compression API connections (keep-alive/pooling).
- Avoid repeated TCP/TLS setup overhead where possible.

## Timeout budgets
- TTC timeout short and bounded.
- Upstream first-token timeout distinct from total timeout.
- Clear timeout hierarchy to prevent hanging request chains.

## Backpressure and load shedding
- Add max in-flight request limit.
- Add bounded queue.
- Return explicit overload responses quickly instead of degrading event loop.

## Compression under load
- Maintain conservative threshold and skip heuristics.
- Optionally disable compression dynamically when local load exceeds threshold.

## Reverse proxy notes for streaming routes
- Disable response buffering for streaming path.
- Keep HTTP version and connection settings suitable for long-lived streams.
- Ensure idle/read timeouts are long enough for stream responses.

## Security hardening
- Keep `.env` and `.env.local` gitignored.
- Redact secrets from logs.
- Keep debug endpoints local/dev only.
- Require proxy auth for hosted deployments.

---

## 4) Observability and SLOs

## Target SLOs
- Added proxy latency (no compression): p95 < 30 ms.
- Added proxy latency (compression enabled): p95 < 150 ms (excluding upstream generation time).
- Added first-token delay from proxy: p95 < 100 ms.
- Fail-open continuity under TTC failure injection: near 100% request continuity.

## Required metrics
- `proxy_requests_total`
- `proxy_request_duration_ms` (histogram)
- `proxy_inflight_requests`
- `proxy_queue_wait_ms`
- `compression_attempted_count`
- `compression_applied_count`
- `compression_fallback_count`
- `compression_skipped_count`
- `upstream_retry_count`
- `upstream_fallback_count`
- `upstream_cooldown_active`
- `stream_first_chunk_timeout_count`

## Required structured log fields
- `request_id`, `trace_id`, `event_name`, `status_code`, `duration_ms`
- selected upstream route/model
- retry/fallback/cooldown decision details
- compression decision details (without prompt content)

---

## 5) Full Test Bed Plan

## Why this is required
This proxy must prove reliability, safety, and value continuously, not only in ad hoc manual checks.

## Test bed structure
- `tests/contracts/` API compatibility tests.
- `tests/compression/` compression safety and skip behavior tests.
- `tests/reliability/` retries, fallbacks, cooldown, fail-open tests.
- `tests/streaming/` first-token, truncation, ordering, replay safety tests.
- `tests/performance/` load and latency overhead tests.
- `tests/security/` secret leakage and debug-surface checks.
- `bench/` A/B harness for compression impact.

## Core test classes
1. **Contract compatibility**
   - Request/response schema parity for supported endpoint(s).
   - Error surface and status behavior validation.

2. **Compression safety**
   - Fixtures: prose, code blocks, diffs, JSON/YAML, stack traces, shell commands, paths, mixed prompts.
   - Assert protected regions remain intact in safe mode.

3. **Reliability behavior**
   - TTC: timeout, malformed response, 429/5xx, network failures.
   - Upstream: timeout, 429/5xx, auth failures, stream startup failures.
   - Validate retry matrix and fallback chain behavior.

4. **Streaming correctness**
   - Validate first-chunk behavior and stream completion semantics.
   - Confirm no replay retry after stream starts.

5. **Performance and bottleneck checks**
   - Measure proxy overhead (compression on/off).
   - Test realistic Cursor-like concurrency (start with 3 parallel requests, then 5+).

6. **Security checks**
   - Verify no key leakage in logs.
   - Verify debug endpoints disabled in production mode.
   - Verify env files are not tracked in git.

## Release gates
- 0 critical failures in contract and streaming suites.
- Fail-open path validated under induced TTC failures.
- No secret leakage in logs.
- Proxy overhead and first-token delay remain within SLO targets.

---

## 6) Suggested Configuration Additions

```env
# Upstream resilience
UPSTREAM_MAX_RETRIES=2
UPSTREAM_RETRY_BACKOFF_MS=150
UPSTREAM_RETRY_STATUS_CODES=429,500,502,503,504
UPSTREAM_STREAM_FIRST_CHUNK_TIMEOUT_MS=12000
UPSTREAM_TOTAL_TIMEOUT_MS=120000

# Fallback routing (example format; exact parser to be implemented)
UPSTREAM_FALLBACKS=primary_model=backup_model_a,backup_model_b

# Cooldown controls
UPSTREAM_ALLOWED_FAILS_PER_WINDOW=5
UPSTREAM_FAIL_WINDOW_SECONDS=60
UPSTREAM_COOLDOWN_SECONDS=30

# Load controls
MAX_INFLIGHT_REQUESTS=200
MAX_QUEUE_SIZE=500

# Logging and local diagnostics
LOG_LEVEL=info
LOG_BUFFER_SIZE=500
LOG_LOCAL_ENDPOINT=false
```

---

## 7) Implementation Sequence
1. Implement upstream retries + timeout split + fallback chain.
2. Add stream-safe retry semantics and first-token timeout behavior.
3. Add cooldown tracking and route selection logic.
4. Expand metrics and structured logging for resilience decisions.
5. Add load controls (in-flight + queue).
6. Build full test bed directory and seed test fixtures.
7. Run load + fault injection validation and tune defaults.

---

## 8) Research References
- LiteLLM reliability and fallback docs:
  - `https://docs.litellm.ai/docs/proxy/reliability`
  - `https://docs.litellm.ai/docs/proxy/timeout`
  - `https://docs.litellm.ai/docs/routing`
- OpenAI production best practices:
  - `https://developers.openai.com/api/docs/guides/production-best-practices/`
- OpenAI HTTP Proxy project overview (MIT):
  - `https://pypi.org/project/openai-http-proxy/`
- Token Company benchmarks index:
  - `https://thetokencompany.com/benchmarks`
