# Opencode The Token Company Plugin

OpenCode message transform plugin with [The Token Company](https://thetokencompany.com/) (TTC) API.

The Token Company (YC W26) builds models that process tokens based on context and semantic intent. With this plugin, you can remove context bloat from your prompts to Opencode before they hit the LLM provider.

Modern OpenCode builds also load a TTC sidebar widget. Compression still runs in the server plugin; the sidebar reads redacted per-session metrics from local state and never stores prompt text, compressed text, request bodies, or API keys.

[![npm version](https://img.shields.io/npm/v/@drfok/opencode-ttc-plugin.svg)](https://www.npmjs.com/package/@drfok/opencode-ttc-plugin)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](./LICENSE)
[![X (Twitter)](https://img.shields.io/badge/X-%40drf0k-111111.svg)](https://x.com/drf0k)
[![npm downloads](https://img.shields.io/npm/dy/@drfok/opencode-ttc-plugin)](https://www.npmjs.com/package//@drfok/opencode-ttc-plugin)

## 1) Setup

### Option A: Agent-assisted setup

Paste this into your coding agent:

```text
Install @drfok/opencode-ttc-plugin by following: https://raw.githubusercontent.com/MrFok/opencode-ttc-plugin/main/README.md
```

### Option B: Manual setup

1. Install and register plugin:

```bash
npm install -g @drfok/opencode-ttc-plugin
opencode plugin @drfok/opencode-ttc-plugin --global
```

If you are on an older OpenCode build without package plugin target support, use the legacy file installer:

```bash
opencode-ttc-plugin install
```

2. Configure auth in OpenCode (any of these works):

```bash
# Option A — plugin-managed login (writes to the opencode auth store, mode 0o600)
opencode-ttc-plugin login                   # interactive prompt (no echo)
printf '%s' "$TTC_API_KEY" | opencode-ttc-plugin login --stdin   # non-interactive / CI

# Option B — from inside opencode (TUI)
/ttc-login      # opens a dialog asking for the TTC API key
/ttc-logout     # removes the TTC API key

# Option C — through opencode's native auth flow
opencode auth login
```

> The `login` command no longer accepts `--key <value>` inline — passing a secret on the command line leaks it via `ps aux` and shell history. Use `--stdin` for non-interactive flows, or the TTY prompt for interactive use.

3. In the `opencode auth login` flow (Option C) choose:
- provider: `opencode-ttc-plugin`
- method: `The Token Company (TTC) API key`
- paste key from `https://thetokencompany.com/`

> Note: `opencode auth login` may also prompt for your LLM provider key (OpenAI/Anthropic/etc). That is a separate opencode auth — the TTC plugin only ever asks for one key (the TTC API key). Use `opencode-ttc-plugin login` or `/ttc-login` if you only want to set the TTC key without re-running the full opencode auth menu.

4. Verify:

```bash
opencode-ttc-plugin doctor --verbose
```

5. Restart OpenCode. In a session, the sidebar should include `Token Compression` with the latest message and session savings. The sidebar polls the opencode auth store directly, so once you log in it shows `authenticated — send a message to start compressing` without needing to send a message first. Toasts remain as a fallback/configurable summary path.

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

Finally, tell the user to 

1. Set their TTC API key with one of:
   - `printf '%s' "$KEY" \| opencode-ttc-plugin login --stdin` (CLI, recommended for scripts), or
   - `opencode-ttc-plugin login` (CLI interactive prompt, no echo), or
   - `/ttc-login` slash command inside opencode, or
   - `opencode auth login` then choose provider `opencode-ttc-plugin`
2. Get a key from https://thetokencompany.com/
3. Verify by running `opencode-ttc-plugin doctor --verbose`
4. Restart OpenCode and watch the sidebar when they start a session
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
| `opencode-ttc-plugin doctor --verbose` | Shows effective config sources, TUI entrypoint status, known models, and sidebar state path |
| `opencode-ttc-plugin uninstall` | Removes installed plugin file |
| `opencode-ttc-plugin login [--stdin]` | Saves a TTC API key under the `opencode-ttc-plugin` provider in the opencode auth store. Without `--stdin`, prompts on the TTY with echo off. With `--stdin`, reads the key from stdin (use for CI: `printf '%s' "$KEY" \| opencode-ttc-plugin login --stdin`). The auth file is written atomically with mode `0o600`. |
| `opencode-ttc-plugin logout` | Removes TTC auth entries (current and legacy) from the opencode auth store |
| `opencode-ttc-plugin config get` | Prints plugin config and effective aggressiveness |
| `opencode-ttc-plugin config set level <low\|balanced\|high\|max>` | Sets named aggressiveness level |
| `opencode-ttc-plugin config set aggressiveness <0..1>` | Sets numeric aggressiveness |
| `opencode-ttc-plugin config set <setting> <value>` | Sets behavior settings (see table below) |
| `opencode-ttc-plugin config reset` | Removes plugin config file |

The same login/logout actions are available inside OpenCode as slash commands: `/ttc-login`, `/ttc-logout`, and `/ttc` (full settings menu including a model picker).

## Models

The TTC compress endpoint accepts a `model` field. Per `https://thetokencompany.com/docs/compression`, the currently-listed models are:

| Model | Status | Notes |
| --- | --- | --- |
| `bear-2` | Recommended | Most accurate compression. Best quality preservation. |
| `bear-1.2` | Available | Faster compression. Lower latency per request. |

This plugin's default is `bear-1.2` to preserve existing behavior; use `/ttc` → `Model` → `bear-2 (Recommended)` to switch. There is no TTC API endpoint for listing models at runtime, so the picker uses the curated list above plus a `custom model id` escape hatch for enterprise fine-tunes.

If you ever see an unexpected model id in the sidebar (e.g. something like `bear-2.0` — note: `bear-2.0` is **not** a real model id), check `opencode-ttc-plugin doctor --verbose` for the effective `model` value and its source. The model displayed in the sidebar is exactly what the plugin sends to the API; it cannot change on its own. Common causes:

- A `model` key left in `~/.config/opencode/ttc-plugin.json` from a previous `/ttc` selection
- A `TTC_MODEL` environment variable exported in your shell
- A model id typed manually through the old free-text prompt

Reset to defaults with `opencode-ttc-plugin config reset`, then re-pick from the curated list via `/ttc`.

## Behavior settings

Use CLI config for normal setup. Env vars are advanced overrides.

| Setting | Default | What it does | CLI command |
| --- | --- | --- | --- |
| `enabled` | `true` | Master on/off switch for the transform hook | `opencode-ttc-plugin config set enabled true` |
| `model` | `bear-1.2` | TTC model sent to `/v1/compress` | `opencode-ttc-plugin config set model bear-1.2` |
| `minChars` | `400` | Skip compression for text shorter than this | `opencode-ttc-plugin config set min-chars 400` |
| `timeoutMs` | `2000` | Request timeout per TTC call | `opencode-ttc-plugin config set timeout-ms 2000` |
| `maxRetries` | `1` | Retry count for retryable TTC failures | `opencode-ttc-plugin config set max-retries 1` |
| `retryBackoffMs` | `100` | Backoff base between retries | `opencode-ttc-plugin config set retry-backoff-ms 100` |
| `useGzip` | `true` | Sends compressed request body to TTC | `opencode-ttc-plugin config set use-gzip true` |
| `compressSystem` | `false` | Also compresses eligible `system` messages in context | `opencode-ttc-plugin config set compress-system false` |
| `compressHistory` | `false` | Also compresses older eligible `user` history messages (not just latest user turn) | `opencode-ttc-plugin config set compress-history false` |
| `debug` | `false` | Emits extra plugin debug logs | `opencode-ttc-plugin config set debug false` |
| `cacheMaxEntries` | `1000` | Max in-memory dedupe cache entries | `opencode-ttc-plugin config set cache-max-entries 1000` |
| `toastOnActive` | `false` | Shows one activation toast per session when enabled; sidebar is the primary UI | `opencode-ttc-plugin config set toast-on-active true` |
| `toastOnIdleSummary` | `false` | Shows idle summary toast with savings stats when enabled; sidebar is the primary UI | `opencode-ttc-plugin config set toast-on-idle-summary true` |

Notes on scope:
- TTC API parameters used directly by this plugin request are primarily `model` and `compression_settings.aggressiveness`.
- Most settings above are plugin-side controls (selection, retries, skipping, caching, and UX behavior).
- For TTC API details, see `https://thetokencompany.com/docs`.

Advanced overrides (optional):
- `TTC_AGGRESSIVENESS`, `TTC_MIN_CHARS`, `TTC_TIMEOUT_MS`, `TTC_MAX_RETRIES`, `TTC_RETRY_BACKOFF_MS`
- `TTC_USE_GZIP`, `TTC_COMPRESS_SYSTEM`, `TTC_COMPRESS_HISTORY`, `TTC_DEBUG`
- `TTC_CACHE_MAX_ENTRIES`, `TTC_TOAST_ON_ACTIVE`, `TTC_TOAST_ON_IDLE_SUMMARY`, `TTC_MODEL`, `TTC_ENABLED`

## Security and network policy

- Compression egress is pinned to `https://api.thetokencompany.com/v1/compress`.
- Custom/invalid `TTC_BASE_URL` is ignored and safely falls back to pinned host.
- Fetch redirects are rejected.
- The TTC API key is stored in the opencode auth store (`${XDG_DATA_HOME:-$HOME/.local/share}/opencode/auth.json`). All writes by this plugin are atomic (temp file + `rename(2)`), set file mode `0o600` and directory mode `0o700`, refuse to overwrite a corrupt existing file, and replace any symlink at the target path (so a planted symlink cannot exfiltrate the key to another location).
- The CLI `login` command never accepts the key as a `--key <value>` argument (which would leak via `ps aux` and shell history). Use the TTY prompt (echo off) or `--stdin`.
- A relative or non-absolute `XDG_DATA_HOME` is ignored and falls back to `$HOME/.local/share` to prevent the key being written to the working directory.
- Sidebar state is written under `${XDG_STATE_HOME:-~/.local/state}/opencode/ttc-plugin` with hashed session filenames.
- Sidebar state contains aggregate counts and token/character savings only; it does not persist prompts, compressed output, request bodies, or API keys.
- If your firewall prompts about outbound socket traffic, that is expected on first compression request.
