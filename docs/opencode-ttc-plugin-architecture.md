# OpenCode TTC Plugin Architecture

## Design Goals

- Compress eligible outbound user text before provider calls.
- Preserve tool-calling and structured-output behavior.
- Fail open on all TTC errors.
- Keep latency bounded.

## Primary Path

1. OpenCode builds message history.
2. Plugin hook inspects message parts.
3. Eligible text parts are sent to TTC `/v1/compress`.
4. Plugin replaces text only when output is valid and shorter.
5. OpenCode proceeds normally with transformed messages.

## Safety Rules

- Compress only text parts.
- Skip synthetic parts.
- Skip code fences, diffs, stack-trace-like and likely JSON/schema-sensitive blocks.
- Enforce min length threshold.

## Reliability

- Timeout per TTC attempt (bounded).
- Retry only transient failures (`429`, `5xx`, timeout/network).
- On failure, return original text (no throw).

## Caching

- In-memory dedupe key:
  - `sessionID + messageID + partID + hash(text) + model + aggressiveness`
- Store transformed text and reason metadata.
- Bounded cache size.

## Logging

- Structured events:
  - `ttc.plugin.request`
  - `ttc.plugin.response`
  - `ttc.plugin.skip`
  - `ttc.plugin.fallback`
- Never log raw prompt text or secrets.
