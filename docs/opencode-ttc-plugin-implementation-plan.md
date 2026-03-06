# OpenCode TTC Plugin Implementation Plan

## Branch

- `research/opencode-ttc-plugin-pivot`

## Phase 1

- Plugin scaffold in `opencode-plugins/ttc-message-transform.js`.
- `experimental.chat.messages.transform` hook wiring.
- Config loader + structured logging.

## Phase 2 (MVP)

- TTC client for `/v1/compress`.
- Timeout/retry/backoff.
- Optional gzip request body.
- Fail-open compression wrapper.

## Phase 3

- Conservative eligibility and skip heuristics.
- In-memory dedupe cache by session/message/part/hash.
- Preserve tool/schema-sensitive content untouched.

## Test Plan

- Success compression path.
- Skip conditions.
- Timeout/retry/fail-open path.
- Cache hit behavior.

## Compatibility

- Keep `opencode-plugins/tcc-proxy-bridge.js` available as fallback.
