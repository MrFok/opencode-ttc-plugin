# @drfok/opencode-ttc-plugin

OpenCode message transform plugin for The Token Company (TTC) compression.

[![npm version](https://img.shields.io/npm/v/@drfok/opencode-ttc-plugin.svg)](https://www.npmjs.com/package/@drfok/opencode-ttc-plugin)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](./LICENSE)
[![X (Twitter)](https://img.shields.io/badge/X-%40drfok-111111.svg)](https://x.com/drfok)

## Quick Start

Install from npm and register the plugin with OpenCode:

```bash
npm install -g @drfok/opencode-ttc-plugin
opencode-ttc-plugin install
```

Set your TTC API key once in OpenCode auth store:

1. Run `/connect` in OpenCode.
2. Choose `the-token-company-plugin`.
3. Select `Set TTC API Key` and paste your key.

Optional override (advanced):

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

API key resolution order:

1. `TTC_API_KEY` environment variable (optional override)
2. OpenCode auth store entry for `the-token-company-plugin` (recommended default)
3. fail-open no-op (plugin stays inactive)

Compression setting resolution order:

1. `TTC_AGGRESSIVENESS` environment variable (optional override)
2. Plugin config file `~/.config/opencode/ttc-plugin.json`
3. Built-in default (`balanced` = `0.1`)

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
opencode-ttc-plugin doctor --verbose
opencode-ttc-plugin uninstall
opencode-ttc-plugin config get
opencode-ttc-plugin config set level balanced
opencode-ttc-plugin config set aggressiveness 0.25
opencode-ttc-plugin config reset
```

Compression presets:

- `low` = `0.05`
- `balanced` = `0.1`
- `high` = `0.2`
- `max` = `0.3`

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
