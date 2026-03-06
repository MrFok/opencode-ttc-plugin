# OpenCode TTC Plugin Release Plan

## Goal

Validate the plugin end-to-end locally before packaging and publishing.

## Naming Decisions

- npm scope: `@drfok`
- package name: `@drfok/opencode-ttc-plugin`
- no implied first-party affiliation with Token Company or OpenCode

## Phase A: Local Validation Gates

- unit tests pass: `npm test`
- transform hook executes in a local smoke run
- fail-open behavior verified for timeout/429/5xx
- conservative skip rules preserve tool/schema-sensitive content
- logs do not include raw prompt text or API keys

## Phase B: Install UX Rehearsal (Unpublished)

- verify local plugin load from `~/.config/opencode/plugins/`
- verify setup instructions are copy-paste friendly
- verify fallback bridge plugin can coexist without regressions

## Phase C: Auth Strategy Validation

- v1 scope: env-only auth via `TTC_API_KEY`
- verify no key present results in fail-open no-op
- defer OpenCode auth-store integration to v1.1

## Phase D: Packaging Readiness

- finalize `package.json` metadata (`name`, `repository`, `license`, `homepage`, `bugs`)
- add installer/doctor/uninstall CLI commands
- add minimal troubleshooting docs

## Phase E: Publish Gate

- all validation gates pass
- release checklist complete
- tag and publish to npm under `@drfok`
