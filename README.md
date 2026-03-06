# @drfok/opencode-ttc-plugin

OpenCode message transform plugin for The Token Company (TTC) compression.

## Quick Start

Install from npm and register the plugin with OpenCode:

```bash
npm install -g @drfok/opencode-ttc-plugin
opencode-ttc-plugin install
```

Set your TTC API key before launching OpenCode:

```bash
export TTC_API_KEY=<your-token-company-key>
```

## Configuration

Environment variables:

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

See `.env.example` for the same defaults.

## Behavior

- Compresses eligible outbound text through `experimental.chat.messages.transform`.
- Fail-open by design: TTC errors and timeouts never block model requests.
- Skips high-risk content (code fences, diffs, likely JSON/schema-sensitive, synthetic parts).
- Uses in-memory dedupe cache by session/message/part/hash and compression settings.
- Emits structured logs without raw prompt text or secret values.
- Shows activation and idle-summary toasts with savings estimates.

## CLI Commands

```bash
opencode-ttc-plugin install
opencode-ttc-plugin doctor
opencode-ttc-plugin uninstall
```

Equivalent source-repo scripts:

```bash
npm run plugin:install
npm run plugin:doctor
npm run plugin:uninstall
```

## Development

Run tests:

```bash
npm test
```

Run smoke check:

```bash
npm run smoke:plugin
```

The smoke output reports only metadata (`changed`, char counts, reason), not raw prompt text.
