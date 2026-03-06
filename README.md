# @drfok/opencode-ttc-plugin

OpenCode message-transform plugin for The Token Company (TTC) prompt compression.

## Install

From npm (recommended):

```bash
npm install -g @drfok/opencode-ttc-plugin
opencode-ttc-plugin install
```

From source checkout:

```bash
cd /path/to/opencode-ttc-plugin
npm install
npm run plugin:install
```

Manual copy:

```bash
mkdir -p ~/.config/opencode/plugins
cp opencode-plugins/ttc-message-transform.js ~/.config/opencode/plugins/ttc-message-transform.js
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

## Important Notes

- This package is plugin-only; it does not run a local proxy server.

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
opencode-ttc-plugin install
npm run plugin:install

opencode-ttc-plugin doctor
npm run plugin:doctor

opencode-ttc-plugin uninstall
npm run plugin:uninstall
```
