# OpenCode + TTC Plugin Feasibility

## Objective

Pivot from proxy-first architecture to plugin-first compression using TTC before outbound provider calls.

## Verdict

Feasible in OpenCode using `experimental.chat.messages.transform`.

## Why

- Transform hook can mutate outbound message parts before provider request generation.
- Hook execution is provider/auth agnostic because it runs before provider transport.
- Plugin can implement fail-open behavior internally, so TTC outages never block model calls.

## Practical Notes

- Use TTC endpoint `POST https://api.thetokencompany.com/v1/compress`.
- Keep conservative skip rules for code/diff/JSON/schema-sensitive text.
- Keep existing `opencode-plugins/tcc-proxy-bridge.js` as optional fallback path.
