# token-company-proxy

Plugin-first TTC compression for OpenCode.

## What This Branch Contains

- OpenCode transform plugin: `opencode-plugins/ttc-message-transform.js`
- Existing bridge fallback plugin: `opencode-plugins/tcc-proxy-bridge.js`
- Plugin tests:
  - `tests/opencode-ttc-plugin.test.js`
  - `tests/opencode-bridge-plugin.test.js`
- Plugin-focused design docs under `docs/`.

All proxy server runtime code and proxy-only test harness code has been removed on this branch.

## Install

```bash
npm install
npm run plugin:install
```

Direct copy alternative:

```bash
mkdir -p ~/.config/opencode/plugins
cp opencode-plugins/ttc-message-transform.js ~/.config/opencode/plugins/ttc-message-transform.js
```

Optional fallback plugin:

```bash
cp opencode-plugins/tcc-proxy-bridge.js ~/.config/opencode/plugins/tcc-proxy-bridge.js
```

## TTC Plugin Env

```env
TTC_ENABLED=true
TTC_API_KEY=<token-company-key>
TTC_BASE_URL=https://api.thetokencompany.com
TTC_MODEL=bear-1.2
TTC_AGGRESSIVENESS=0.1
TTC_MIN_CHARS=400
TTC_TIMEOUT_MS=2000
TTC_MAX_RETRIES=1
TTC_RETRY_BACKOFF_MS=100
TTC_USE_GZIP=true
TTC_COMPRESS_SYSTEM=false
TTC_COMPRESS_HISTORY=false
TTC_DEBUG=false
TTC_CACHE_MAX_ENTRIES=1000
TTC_TOAST_ON_ACTIVE=true
TTC_TOAST_ON_IDLE_SUMMARY=true
```

## Behavior

- Compresses eligible outbound text using `experimental.chat.messages.transform`.
- Fail-open: TTC errors/timeouts/rate limits never block normal model requests.
- Conservative skip policy for code, diffs, likely JSON/schema-sensitive and synthetic content.
- In-memory dedupe cache keyed by session/message/part/hash + compression settings.
- Structured logs via `client.app.log` without raw prompt text or secrets.
- TUI toasts show per-session activation and idle summaries with token-savings estimates.

## Test

```bash
npm test
```

## Local Smoke Test

- Export your TTC key in your shell:

```bash
export TTC_API_KEY=<your-token-company-key>
```

- Run:

```bash
npm run smoke:plugin
```

- The smoke output reports only metadata (changed, char counts, reason), not raw prompt text.

## Plugin CLI

```bash
npm run plugin:doctor
npm run plugin:uninstall
```
