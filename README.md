# Opencode The Token Company Plugin

OpenCode message-transform plugin + sidebar widget for [The Token Company](https://thetokencompany.com/) (YC W26).

TTC compresses LLM prompts by removing low-signal tokens based on context and semantic intent. This plugin wires that into OpenCode so bloated context (long file dumps, verbose tool output, repeated boilerplate) gets shrunk before it hits your LLM provider. You keep the same models, just fewer tokens and faster turns.

The sidebar reads redacted per-session metrics from local state. It never stores prompt text, compressed output, request bodies, or API keys.

[![npm version](https://img.shields.io/npm/v/@drfok/opencode-ttc-plugin.svg)](https://www.npmjs.com/package/@drfok/opencode-ttc-plugin)
[![npm downloads](https://img.shields.io/npm/dy/@drfok/opencode-ttc-plugin)](https://www.npmjs.com/package/@drfok/opencode-ttc-plugin)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](./LICENSE)
[![X (Twitter)](https://img.shields.io/badge/X-%40drf0k-111111.svg)](https://x.com/drf0k)

## Requirements

- OpenCode 1.4.0 or newer (uses the `@opencode-ai/plugin` peer dep)
- Node.js 20 or newer
- A TTC API key from <https://thetokencompany.com/>

## 1) Setup

### Option A: Agent-assisted

Paste this into your coding agent:

```text
Install @drfok/opencode-ttc-plugin by following: https://raw.githubusercontent.com/MrFok/opencode-ttc-plugin/main/README.md
```

### Option B: Manual

1. Install and register the plugin:

   ```bash
   npm install -g @drfok/opencode-ttc-plugin
   opencode plugin @drfok/opencode-ttc-plugin --global
   ```

   On older OpenCode builds that don't support package plugin targets, fall back to the file installer:

   ```bash
   opencode-ttc-plugin install
   ```

2. Set your TTC API key. Pick whichever path fits:

   ```bash
   # Plugin-managed (writes to the opencode auth store, mode 0o600)
   opencode-ttc-plugin login                                                   # interactive TTY prompt, echo off
   printf '%s' "$TTC_API_KEY" | opencode-ttc-plugin login --stdin              # non-interactive / CI

    # Inside opencode (TUI slash commands)
    /ttc-login                                                                  # shows safe login instructions
    /ttc-logout                                                                 # removes a saved key

    # Through opencode's native auth flow (single place to enter the key)
    opencode auth login                                                         # then pick provider: opencode-ttc-plugin
    ```

    > **Only one prompt.** Use `opencode auth login` (choose the TTC provider) or the direct CLI. `/ttc-login` does not collect the secret in the TUI because the available prompt dialog displays plain text.
    >
    > **No `--key <value>` flag.** Passing a secret on the command line leaks it via `ps aux` and shell history. Use `--stdin` or the TTY prompt.

3. Verify:

   ```bash
   opencode-ttc-plugin doctor --verbose
   ```

4. Restart OpenCode. In a session, the sidebar should show `Token Compression` with the live status dot. Once a key is present it reads `authenticated — send a message to start compressing`; you don't have to send a message first to clear stale `missing auth` state.

### For LLMs installing this on behalf of a user

<details>
<summary>Expand for the agent-readable install script</summary>

1. Install the package with npm:

   ```bash
   npm install -g @drfok/opencode-ttc-plugin
   ```

2. Place the plugin file into `~/.config/opencode/plugins`:

   ```bash
   opencode-ttc-plugin install
   ```

 3. Tell the user to set their TTC API key with one of:
    - `printf '%s' "$KEY" | opencode-ttc-plugin login --stdin` (CLI, recommended for scripts)
    - `opencode-ttc-plugin login` (CLI interactive prompt, echo off)
    - `opencode auth login` then choose provider `opencode-ttc-plugin`

4. Tell the user to get a key from <https://thetokencompany.com/> if they don't have one.

5. Verify with `opencode-ttc-plugin doctor --verbose`.

6. Tell the user to restart OpenCode and watch the sidebar when they start a session.

</details>

## 2) Sidebar

The `Token Compression` row in the opencode sidebar shows live per-session state.

**Status dot colors**

| Color | Meaning |
| --- | --- |
| green | active, skipped, fallback, or no reduction — all normal operating states |
| red | `missing auth` or `disabled` |

**Status line examples**

| Status line | What it means |
| --- | --- |
| `active` | Last message compressed successfully |
| `authenticated — send a message to start compressing` | Key present, no message has triggered compression yet (overrides stale `missing_auth` from a previous state file) |
| `skipped: code fence, below threshold` | Last message had parts that were intentionally not compressed, with reason counts |
| `fallback: request failed open` | TTC API errored; original text was passed through unchanged |
| `no reduction` | TTC returned output that wasn't smaller than the input; original used |
| `missing TTC auth` | No API key found — run `opencode-ttc-plugin login` or `opencode auth login` (choose provider `opencode-ttc-plugin`) |
| `disabled` | `enabled: false` in config |
| `waiting for metrics` | State file not written yet (e.g. brand-new session, no messages) |

The sidebar shows the configured `model` next to the title. The model shown is exactly what gets sent to the TTC API — it cannot change on its own. If it ever looks wrong, see [Troubleshooting](#8-troubleshooting).

## 3) Slash commands

| Command | Action |
| --- | --- |
| `/ttc` | Open the Token Compression settings menu (enable/disable, level, aggressiveness, min chars, model, reset) |
| `/ttc-login` | Show safe API-key login instructions (native auth flow or CLI) |
| `/ttc-logout` | Remove the TTC API key (asks for confirmation) |

The `/ttc` menu shows one auth row: `Add API key` when no saved key exists, or `Remove API key` when a key is saved. `Add API key` opens the same safe instructions as `/ttc-login`; it does not render a visible secret input.

The model picker is curated from the TTC docs (`bear-2`, `bear-1.2`) plus a `custom model id` escape hatch for enterprise fine-tunes. See [Models](#6-models).

## 4) CLI reference

```bash
opencode-ttc-plugin install                         # place plugin file in ~/.config/opencode/plugins
opencode-ttc-plugin uninstall                       # remove the installed plugin file
opencode-ttc-plugin doctor                          # setup/auth checks
opencode-ttc-plugin doctor --verbose                # show effective config sources + known models + sidebar state path
opencode-ttc-plugin login                           # interactive TTY prompt (echo off), writes key with mode 0o600
opencode-ttc-plugin login --stdin                   # read key from stdin — use for CI: printf '%s' "$KEY" | opencode-ttc-plugin login --stdin
opencode-ttc-plugin logout                          # remove TTC auth entries (current and legacy IDs)
opencode-ttc-plugin config get                      # print plugin config + effective aggressiveness
opencode-ttc-plugin config set level <level>        # low | balanced | high | max
opencode-ttc-plugin config set aggressiveness <n>   # 0..1 numeric
opencode-ttc-plugin config set <setting> <value>    # any behavior setting from the table below
opencode-ttc-plugin config reset                    # remove plugin config file
```

## 5) Configuration

All config is optional. Defaults work for most users.

### Aggressiveness

The main knob. Higher = more tokens removed.

```bash
opencode-ttc-plugin config set level balanced   # recommended
opencode-ttc-plugin config set aggressiveness 0.15   # exact numeric override
```

| Level | Aggressiveness | Typical use |
| --- | --- | --- |
| `low` | `0.05` | Minimal changes — financial, legal, medical |
| `balanced` | `0.10` | **Default.** Good savings with stable quality |
| `high` | `0.20` | Stronger compression |
| `max` | `0.30` | Most aggressive preset |

Per TTC's docs (`https://thetokencompany.com/docs/compression`):
- `0.05–0.15` Light — financial reports, legal contracts, medical records
- `0.15–0.4` Moderate — meeting transcripts, call recordings, scraped page content
- `0.4–0.9` Aggressive — chat history summarization, replacing compact

**Resolution order:** `TTC_AGGRESSIVENESS` env → `~/.config/opencode/ttc-plugin.json` → built-in default (`balanced` = `0.1`).

### Behavior settings

CLI config is the normal path; env vars are advanced overrides.

| Setting | Default | What it does | CLI |
| --- | --- | --- | --- |
| `enabled` | `true` | Master on/off switch for the transform hook | `config set enabled true` |
| `model` | `bear-1.2` | TTC model sent to `/v1/compress` (see [Models](#6-models)) | `config set model bear-1.2` |
| `minChars` | `400` | Skip compression for text shorter than this | `config set min-chars 400` |
| `timeoutMs` | `2000` | Per-request timeout | `config set timeout-ms 2000` |
| `maxRetries` | `1` | Retry count for retryable TTC failures (429, 5xx) | `config set max-retries 1` |
| `retryBackoffMs` | `100` | Backoff base between retries (linear) | `config set retry-backoff-ms 100` |
| `useGzip` | `true` | gzip the request body to TTC | `config set use-gzip true` |
| `compressSystem` | `false` | Also compress eligible `system` messages | `config set compress-system false` |
| `compressHistory` | `false` | Also compress older `user` turns, not just the latest | `config set compress-history false` |
| `debug` | `false` | Emit extra plugin debug logs | `config set debug false` |
| `cacheMaxEntries` | `1000` | Max in-memory dedupe cache entries | `config set cache-max-entries 1000` |
| `toastOnActive` | `false` | One activation toast per session (sidebar is primary UI) | `config set toast-on-active true` |
| `toastOnIdleSummary` | `false` | Idle summary toast with savings stats | `config set toast-on-idle-summary true` |

The only TTC API parameters this plugin sends are `model` and `compression_settings.aggressiveness`. Everything else is plugin-side control.

**Env overrides (optional):** `TTC_ENABLED`, `TTC_MODEL`, `TTC_MIN_CHARS`, `TTC_TIMEOUT_MS`, `TTC_MAX_RETRIES`, `TTC_RETRY_BACKOFF_MS`, `TTC_USE_GZIP`, `TTC_COMPRESS_SYSTEM`, `TTC_COMPRESS_HISTORY`, `TTC_DEBUG`, `TTC_CACHE_MAX_ENTRIES`, `TTC_TOAST_ON_ACTIVE`, `TTC_TOAST_ON_IDLE_SUMMARY`, `TTC_AGGRESSIVENESS`.

## 6) Models

Per <https://thetokencompany.com/docs/compression>:

| Model | Status | Notes |
| --- | --- | --- |
| `bear-2` | **Recommended** | Most accurate compression. Best quality preservation. |
| `bear-1.2` | Available | Faster compression. Lower latency per request. |

This plugin's default is `bear-1.2` to preserve existing behavior. To switch: `/ttc` → `Model` → `bear-2 (Recommended)`, or `opencode-ttc-plugin config set model bear-2`.

There is no TTC API endpoint for listing models at runtime, so the `/ttc` picker is curated from the docs above plus a `custom model id` escape hatch for enterprise fine-tunes.

## 7) What gets compressed

**Selection:**
- By default, only the latest `user` turn is compressed (avoids re-compressing unchanged history every turn).
- `compressSystem: true` adds eligible `system` messages.
- `compressHistory: true` adds older `user` turns.
- `assistant` messages are never compressed.

**Skip patterns** (a part that matches is passed through unchanged):

| Reason | What triggers it |
| --- | --- |
| `below threshold` | Text shorter than `minChars` |
| `code fence` | Contains a `` ``` `` fence |
| `diff` | Looks like a `diff --git` blob, `+++`/`---`/`@@` hunks |
| `stack trace` | Python-style traceback or `Exception:` line |
| `JSON` | Whole message is a JSON object or array |
| `schema` | JSON Schema markers (`$schema`, `tool_calls`, `properties`, etc.) |
| `synthetic` | Opencode-internal synthetic parts |
| `empty` / `non-text` | Empty string or non-text part |

These protect content where compression could mangle semantics. They are hardcoded; there is no per-pattern toggle today.

## 8) Troubleshooting

**`missing TTC auth` after I logged in**
The sidebar polls the opencode auth store every 2s, so it should clear on its own. If it doesn't, run `opencode-ttc-plugin doctor` and confirm the key is detected under either `opencode-ttc-plugin` (new) or `the-token-company-plugin` (legacy) — both are read.

**Sidebar shows a model I didn't configure (e.g. `bear-2.0`)**
The sidebar shows exactly what the plugin is configured to send. `bear-2.0` is **not** a real model id. Common causes:
- A `model` key left in `~/.config/opencode/ttc-plugin.json` from a previous `/ttc` selection
- `TTC_MODEL` exported in your shell
- A typo from the old free-text prompt

Run `opencode-ttc-plugin doctor --verbose` to see the effective `model` and its source. Reset with `opencode-ttc-plugin config reset`, then re-pick from the curated list via `/ttc`.

**`opencode auth login` keeps asking for two keys**
That's expected — one is your LLM provider key (OpenAI/Anthropic/etc), the other is the TTC key. They're separate flows. Use `opencode-ttc-plugin login` (CLI) or `opencode auth login` → pick provider `opencode-ttc-plugin`. There is no separate custom prompt in the TUI.

**Compression isn't firing**
Check the sidebar status line. If it says `skipped: ...`, the message matched a [skip pattern](#7-what-gets-compressed) or was below `minChars`. Lower `minChars` (`config set min-chars 100`) or check that your message isn't mostly code/JSON.

**Sidebar metrics reset after switching sessions or restarting OpenCode**
Metrics are keyed by OpenCode session id and persisted under the hashed state path shown by `opencode-ttc-plugin doctor --verbose`. Switching sessions may show `new session` or `waiting for first compression` for sessions TTC has not processed yet, but returning to a processed session should restore its sidebar totals. After restarting OpenCode, the next compression in that session hydrates from the persisted state before writing new totals, so cumulative metrics should not reset.

**Doctor says `auth store ... set under 'the-token-company-plugin'`**
That's the legacy provider id from before v0.1.5. It still works — the plugin reads both. Your next `login` writes under the new `opencode-ttc-plugin` id and also clears the legacy entry; you can `logout` once to clear the legacy entry if you want a clean store.

**A non-TTC provider key disappeared from `auth.json`**
The auth store is written with atomic temp+rename (no partial files) but is not serialized across concurrent writers. If you ran `opencode-ttc-plugin login` at the exact moment `opencode auth login` was rotating another provider's key, the slower writer wins and the other's update can be dropped. Rare in practice (both are user-initiated, single-shot). Recovery: re-enter the dropped key via `opencode auth login`.

## 9) Security and network policy

- **Egress pinned** to `https://api.thetokencompany.com/v1/compress`. Custom/invalid `TTC_BASE_URL` is ignored.
- **Redirects rejected.** Fetch follows no redirects.
- **Auth store writes are atomic.** Temp file + `rename(2)`, file mode `0o600`, directory mode `0o700`. A corrupt existing file is refused, never silently overwritten. A symlink at the target path is replaced, not followed, so a planted symlink can't exfiltrate the key.
- **No key in argv.** `login` never accepts `--key <value>` (would leak via `ps aux` and shell history). Use the TTY prompt (echo off) or `--stdin`.
- **XDG fallback.** A relative or non-absolute `XDG_DATA_HOME` is ignored and falls back to `$HOME/.local/share` to prevent the key being written to the working directory.
- **Sidebar state is metadata only.** Written under `${XDG_STATE_HOME:-~/.local/state}/opencode/ttc-plugin` with hashed session filenames. Contains aggregate counts and token/character savings only — no prompts, compressed output, request bodies, or API keys.
- **First compression request may trip a firewall prompt.** That's expected outbound traffic to `api.thetokencompany.com`.

## License

ISC — see [LICENSE](./LICENSE).
