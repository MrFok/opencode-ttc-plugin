import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  AUTH_PROVIDER_ID,
  LEGACY_AUTH_PROVIDER_IDS,
  getAuthStorePath as getSharedAuthStorePath
} from "../lib/auth-store.js";

export { AUTH_PROVIDER_ID };
export const SHARED_AUTH_PROVIDER_IDS = [AUTH_PROVIDER_ID, ...LEGACY_AUTH_PROVIDER_IDS];

const SKIP_REASON_LABELS = {
  below_threshold: "below threshold",
  code_fence: "code fence",
  diff_blob: "diff",
  stack_trace: "stack trace",
  json_blob: "JSON",
  schema_sensitive: "schema",
  synthetic_part: "synthetic",
  empty_text: "empty",
  non_text_part: "non-text"
};

export function getSidebarStateDir(env = process.env) {
  const xdgStateHome = String(env.XDG_STATE_HOME ?? "").trim();
  const stateHome = xdgStateHome || join(homedir(), ".local", "state");
  return join(stateHome, "opencode", "ttc-plugin");
}

export function getSidebarStatePath(sessionID, env = process.env) {
  const sessionHash = createHash("sha256").update(String(sessionID ?? "")).digest("hex").slice(0, 32);
  return join(getSidebarStateDir(env), `${sessionHash}.json`);
}

export function getAuthStorePath(env = process.env) {
  return getSharedAuthStorePath(env);
}

export async function loadAuthStatus(options = {}) {
  const env = options.env ?? process.env;
  const envKey = String(env.TTC_API_KEY ?? "").trim();
  if (envKey) {
    return { hasKey: true, providerID: "env", authPath: "" };
  }

  const readFileImpl = options.readFileImpl ?? readFile;
  const authPath = options.authFilePath ?? getSharedAuthStorePath(env);
  try {
    const content = await readFileImpl(authPath, "utf8");
    const trimmed = String(content ?? "").trim();
    if (!trimmed) return { hasKey: false, providerID: null, authPath };
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { hasKey: false, providerID: null, authPath };
    }
    for (const candidateID of SHARED_AUTH_PROVIDER_IDS) {
      const auth = parsed[candidateID];
      if (auth && auth.type === "api" && String(auth.key ?? "").trim()) {
        return { hasKey: true, providerID: candidateID, authPath };
      }
    }
    return { hasKey: false, providerID: null, authPath };
  } catch {
    return { hasKey: false, providerID: null, authPath };
  }
}

export async function loadSidebarState(sessionID, options = {}) {
  const readFileImpl = options.readFileImpl ?? readFile;
  const statePath = options.statePath ?? getSidebarStatePath(sessionID, options.env ?? process.env);

  try {
    const content = await readFileImpl(statePath, "utf8");
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.schemaVersion !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function formatCompactNumber(value) {
  const numeric = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (numeric >= 1000000) {
    const formatted = numeric >= 10000000 ? (numeric / 1000000).toFixed(0) : (numeric / 1000000).toFixed(1);
    return `${formatted.replace(/\.0$/, "")}m`;
  }
  if (numeric >= 1000) {
    const formatted = numeric >= 10000 ? (numeric / 1000).toFixed(0) : (numeric / 1000).toFixed(1);
    return `${formatted.replace(/\.0$/, "")}k`;
  }
  return `${Math.round(numeric)}`;
}

export function formatTokenValue(value, tokenMode = "estimated") {
  const prefix = tokenMode === "exact" || value <= 0 ? "" : "~";
  return `${prefix}${formatCompactNumber(value)}`;
}

export function formatPercent(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return "0%";
  return `${Math.max(0, Math.round((numerator / denominator) * 100))}%`;
}

export function formatSignedSavingsPercent(charsAfter, charsBefore) {
  if (!Number.isFinite(charsAfter) || !Number.isFinite(charsBefore) || charsBefore <= 0) return "0%";
  const percent = Math.round(((charsAfter - charsBefore) / charsBefore) * 100);
  return `${percent}%`;
}

export function formatCompactRatio(charsAfter, charsBefore) {
  const after = Number.isFinite(charsAfter) ? charsAfter : 0;
  const before = Number.isFinite(charsBefore) ? charsBefore : 0;
  return `${formatCompactNumber(after)}/${formatCompactNumber(before)}`;
}

export function formatMetricValue(charsAfter, charsBefore) {
  return `${formatSignedSavingsPercent(charsAfter, charsBefore)} (${formatCompactRatio(charsAfter, charsBefore)})`;
}

export function formatPartLine(session = {}) {
  const compressed = Number.isFinite(session.compressed) ? Math.max(0, session.compressed) : 0;
  const processed = Number.isFinite(session.processed) ? Math.max(0, session.processed) : 0;
  return `${compressed}/${processed} parts compressed`;
}

export function shouldRenderSidebarState(state, loadedSessionID, currentSessionID) {
  return Boolean(state && loadedSessionID && loadedSessionID === currentSessionID);
}

export function emptySidebarStateText({ loading = false, messageCount = 0 } = {}) {
  if (loading) return "loading session metrics";
  return messageCount > 0 ? "waiting for first compression" : "new session";
}

export function getStatusDotColor(status, theme = {}) {
  const successColor = theme.success ?? "green";
  const errorColor = theme.error ?? "red";

  switch (status) {
    case "missing_auth":
    case "disabled":
      return errorColor;
    case "compressed":
    case "skipped":
    case "fallback":
    case "no_reduction":
    default:
      return successColor;
  }
}

export function formatSkipReasons(skipReasons = {}) {
  const entries = Object.entries(skipReasons).filter(([, count]) => Number(count) > 0);
  if (entries.length === 0) return "no eligible content";
  return entries
    .sort(([, a], [, b]) => Number(b) - Number(a))
    .slice(0, 3)
    .map(([reason, count]) => {
      const label = SKIP_REASON_LABELS[reason] ?? reason;
      return Number(count) === 1 ? label : `${count} ${label}`;
    })
    .join(", ");
}

export function statusText(state) {
  switch (state?.status) {
    case "compressed":
      return "active";
    case "skipped":
      return `skipped: ${formatSkipReasons(state.lastMessage?.skipReasons)}`;
    case "fallback":
      return "fallback: request failed open";
    case "no_reduction":
      return "no reduction";
    case "missing_auth":
      return "missing TTC auth";
    case "disabled":
      return "disabled";
    default:
      return "waiting for metrics";
  }
}
