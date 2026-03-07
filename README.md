# Opencode The Token Company Plugin

OpenCode message transform plugin with [The Token Company](https://thetokencompany.com/) (TTC) API.

The Token Company (YC W26) builds models that process tokens based on context and semantic intent. With this plugin, you can remove context bloat from your prompts to Opencode before they hit the LLM provider.

[![npm version](https://img.shields.io/npm/v/@drfok/opencode-ttc-plugin.svg)](https://www.npmjs.com/package/@drfok/opencode-ttc-plugin)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](./LICENSE)
[![X (Twitter)](https://img.shields.io/badge/X-%40drfok-111111.svg)](https://x.com/drfok)

## 1) Setup

### Option A: Let an LLM do it

Paste this into your coding agent:

```text
Install the @drfok/opencode-ttc-plugin and install the plugin by following: https://raw.githubusercontent.com/MrFok/opencode-ttc-plugin/main/README.md
```

### Option B: Manual setup

1. Install and register plugin:

```bash
npm install -g @drfok/opencode-ttc-plugin
opencode-ttc-plugin install
```

3. Configure auth in OpenCode:

```bash
opencode auth login
```

3. In the auth flow choose:
- provider: `the-token-company-plugin`
- method: `Set TTC API Key`
- paste key from `https://thetokencompany.com/`

4. Verify:

```bash
opencode-ttc-plugin doctor --verbose
```

<details>
<summary>For LLMs</summary>

1. Install @drfok/opencode-ttc-plugin with npm
'''bash
npm install -g @drfok/opencode-ttc-plugin
'''

2. Run the installation command to place the js file into the /.config/opencode/plugins directory
'''bash
opencode-ttc-plugin install
'''

3. Tell the user to run `opencode auth login`, search for `the-token-company-plugin`, and enter their TTC API key, which they can get from https://thetokencompany.com/ and then finally verify by running `opencode-ttc-plugin doctor --verbose`

4. Tell them to restart their OpenCode, and to watch for the toast when they start a session
</details>

## 2) Configure compression aggressiveness

Primary control is aggressiveness. You can set it by named level (recommended) or exact numeric value.

Set by level:

```bash
opencode-ttc-plugin config set level balanced
```

Set exact value:

```bash
opencode-ttc-plugin config set aggressiveness 0.25
```

Inspect active config:

```bash
opencode-ttc-plugin config get
opencode-ttc-plugin doctor --verbose
```

Compression levels:

| Level | Aggressiveness | Typical tradeoff |
| --- | --- | --- |
| `low` | `0.05` | Minimal changes, conservative compression |
| `balanced` | `0.10` | Default; good savings with stable quality |
| `high` | `0.20` | Stronger compression, better token reduction |
| `max` | `0.30` | Most aggressive preset in this plugin |

Why these values exist:
- TTC API exposes aggressiveness on a `0.0-1.0` range in their docs: `https://thetokencompany.com/docs`
- TTC benchmark data shows quality/token tradeoffs vary by aggressiveness: `https://www.thetokencompany.com/benchmarks/accuracy`

Runtime resolution order for aggressiveness:
1. `TTC_AGGRESSIVENESS` env var (override)
2. plugin config file `~/.config/opencode/ttc-plugin.json`
3. built-in default (`balanced` = `0.1`)

## 3) CLI commands

| Command | What it does |
| --- | --- |
| `opencode-ttc-plugin install` | Installs plugin file into `~/.config/opencode/plugins` |
| `opencode-ttc-plugin doctor` | Runs setup/auth checks |
| `opencode-ttc-plugin doctor --verbose` | Shows effective config sources and resolution order |
| `opencode-ttc-plugin uninstall` | Removes installed plugin file |
| `opencode-ttc-plugin config get` | Prints plugin config and effective aggressiveness |
| `opencode-ttc-plugin config set level <low\|balanced\|high\|max>` | Sets named aggressiveness level |
| `opencode-ttc-plugin config set aggressiveness <0..1>` | Sets numeric aggressiveness |
| `opencode-ttc-plugin config set <setting> <value>` | Sets behavior settings (see table below) |
| `opencode-ttc-plugin config reset` | Removes plugin config file |

## Behavior settings

Use CLI config for normal setup. Env vars are advanced overrides.

| Setting | Default | CLI command |
| --- | --- | --- |
| `enabled` | `true` | `opencode-ttc-plugin config set enabled true` |
| `model` | `bear-1.2` | `opencode-ttc-plugin config set model bear-1.2` |
| `minChars` | `400` | `opencode-ttc-plugin config set min-chars 400` |
| `timeoutMs` | `2000` | `opencode-ttc-plugin config set timeout-ms 2000` |
| `maxRetries` | `1` | `opencode-ttc-plugin config set max-retries 1` |
| `retryBackoffMs` | `100` | `opencode-ttc-plugin config set retry-backoff-ms 100` |
| `useGzip` | `true` | `opencode-ttc-plugin config set use-gzip true` |
| `compressSystem` | `false` | `opencode-ttc-plugin config set compress-system false` |
| `compressHistory` | `false` | `opencode-ttc-plugin config set compress-history false` |
| `debug` | `false` | `opencode-ttc-plugin config set debug false` |
| `cacheMaxEntries` | `1000` | `opencode-ttc-plugin config set cache-max-entries 1000` |
| `toastOnActive` | `true` | `opencode-ttc-plugin config set toast-on-active true` |
| `toastOnIdleSummary` | `true` | `opencode-ttc-plugin config set toast-on-idle-summary true` |

Advanced overrides (optional):
- `TTC_AGGRESSIVENESS`, `TTC_MIN_CHARS`, `TTC_TIMEOUT_MS`, `TTC_MAX_RETRIES`, `TTC_RETRY_BACKOFF_MS`
- `TTC_USE_GZIP`, `TTC_COMPRESS_SYSTEM`, `TTC_COMPRESS_HISTORY`, `TTC_DEBUG`
- `TTC_CACHE_MAX_ENTRIES`, `TTC_TOAST_ON_ACTIVE`, `TTC_TOAST_ON_IDLE_SUMMARY`, `TTC_MODEL`, `TTC_ENABLED`

## Security and network policy

- Compression egress is pinned to `https://api.thetokencompany.com`.
- Custom/invalid `TTC_BASE_URL` is ignored and safely falls back to pinned host.
- If your firewall prompts about outbound socket traffic, that is expected on first compression request.
