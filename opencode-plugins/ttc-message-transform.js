import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const AUTH_PROVIDER_ID = "the-token-company-plugin";
const LOCKED_BASE_URL = "https://api.thetokencompany.com";

const COMPRESSION_LEVELS = {
  low: 0.05,
  balanced: 0.1,
  high: 0.2,
  max: 0.3
};

const DEFAULT_CONFIG = {
  enabled: true,
  apiKey: "",
  baseUrl: "https://api.thetokencompany.com",
  model: "bear-1.2",
  aggressiveness: 0.1,
  minChars: 400,
  timeoutMs: 2000,
  maxRetries: 1,
  retryBackoffMs: 100,
  useGzip: true,
  compressSystem: false,
  compressHistory: false,
  debug: false,
  cacheMaxEntries: 1000,
  toastOnActive: true,
  toastOnIdleSummary: true
};

const SKIP_PATTERNS = [
  [/```/, "code_fence"],
  [/^diff --git/m, "diff_blob"],
  [/^@@\s/m, "diff_blob"],
  [/^\+\+\+\s/m, "diff_blob"],
  [/^---\s/m, "diff_blob"],
  [/Traceback \(most recent call last\):/, "stack_trace"],
  [/\bException:/, "stack_trace"],
  [/^\s*\{[\s\S]*\}\s*$/m, "json_blob"],
  [/^\s*\[[\s\S]*\]\s*$/m, "json_blob"],
  [/\bjson\s*schema\b/i, "schema_sensitive"],
  [/(\$schema|additionalProperties|tool_calls?|function_call)/i, "schema_sensitive"],
  [/("properties"\s*:|"required"\s*:)/i, "schema_sensitive"]
];

function parseBoolean(rawValue, fallbackValue) {
  if (rawValue === undefined) return fallbackValue;
  const normalized = String(rawValue).trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return fallbackValue;
}

function parseFloatValue(rawValue, fallbackValue) {
  const parsed = Number.parseFloat(String(rawValue ?? ""));
  return Number.isFinite(parsed) ? parsed : fallbackValue;
}

function parseIntValue(rawValue, fallbackValue) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  return Number.isInteger(parsed) ? parsed : fallbackValue;
}

function hasEnvValue(rawValue) {
  if (rawValue === undefined || rawValue === null) return false;
  return String(rawValue).trim() !== "";
}

function clampAggressiveness(value) {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return null;
  return Math.min(1, Math.max(0, parsed));
}

function normalizeCompressionLevel(level) {
  const normalized = String(level ?? "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(COMPRESSION_LEVELS, normalized) ? normalized : "";
}

function summarizeUrlForLog(rawValue) {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return "empty";
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return "malformed";
  }
}

function resolveLockedBaseUrl(rawValue) {
  if (!hasEnvValue(rawValue)) {
    return {
      baseUrl: LOCKED_BASE_URL,
      source: "default",
      rejected: false,
      reason: ""
    };
  }

  let parsed;
  try {
    parsed = new URL(String(rawValue).trim());
  } catch {
    return {
      baseUrl: LOCKED_BASE_URL,
      source: "default",
      rejected: true,
      reason: "malformed"
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      baseUrl: LOCKED_BASE_URL,
      source: "default",
      rejected: true,
      reason: "protocol_not_https"
    };
  }

  if (parsed.hostname !== "api.thetokencompany.com") {
    return {
      baseUrl: LOCKED_BASE_URL,
      source: "default",
      rejected: true,
      reason: "host_not_allowed"
    };
  }

  if (parsed.port && parsed.port !== "443") {
    return {
      baseUrl: LOCKED_BASE_URL,
      source: "default",
      rejected: true,
      reason: "port_not_allowed"
    };
  }

  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return {
      baseUrl: LOCKED_BASE_URL,
      source: "default",
      rejected: true,
      reason: "path_not_allowed"
    };
  }

  return {
    baseUrl: LOCKED_BASE_URL,
    source: "validated_env",
    rejected: false,
    reason: ""
  };
}

function toNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function estimateTokensFromChars(charsSaved) {
  return charsSaved > 0 ? Math.ceil(charsSaved / 4) : 0;
}

function extractTokenSavings(payload) {
  if (!payload || typeof payload !== "object") return null;

  const inputTokens = toNumber(
    payload.input_tokens ?? payload.inputTokens ?? payload.usage?.input_tokens ?? payload.usage?.inputTokens
  );
  const outputTokens = toNumber(
    payload.output_tokens ?? payload.outputTokens ?? payload.usage?.output_tokens ?? payload.usage?.outputTokens
  );

  if (inputTokens === null || outputTokens === null) return null;
  if (inputTokens < outputTokens) return null;
  return inputTokens - outputTokens;
}

function createSessionStats() {
  return {
    processed: 0,
    compressed: 0,
    skipped: 0,
    fallback: 0,
    cacheHits: 0,
    charsBefore: 0,
    charsAfter: 0,
    estimatedTokensSaved: 0,
    exactTokensSaved: 0,
    activationToastShown: false,
    version: 0,
    lastSummaryVersion: 0
  };
}

function getSessionStats(sessionStats, sessionID) {
  if (!sessionStats || !sessionID) return null;
  if (!sessionStats.has(sessionID)) {
    sessionStats.set(sessionID, createSessionStats());
  }
  return sessionStats.get(sessionID);
}

function updateStatsVersion(stats) {
  if (!stats) return;
  stats.version += 1;
}

async function showToast(client, message, variant = "info", duration = 7000) {
  if (!client?.tui?.showToast) return;
  try {
    await client.tui.showToast({
      body: {
        message,
        variant,
        duration
      }
    });
  } catch {
    // fail-open toast rendering
  }
}

function buildIdleSummaryMessage(stats) {
  const tokenValue = stats.exactTokensSaved > 0 ? `${stats.exactTokensSaved}` : `~${stats.estimatedTokensSaved}`;
  const tokenLabel = stats.exactTokensSaved > 0 ? "tokens" : "estimated tokens";
  return `TTC: saved ${tokenValue} ${tokenLabel}, compressed ${stats.compressed}/${stats.processed} parts, cache hits ${stats.cacheHits}, fallbacks ${stats.fallback}.`;
}

function resolveSessionIDFromEvent(event) {
  const properties = event?.properties ?? {};
  return properties.sessionID ?? properties.sessionId ?? properties.info?.id ?? properties.id ?? "";
}

async function maybeShowActivationToast(client, config, stats) {
  if (!config.toastOnActive || !stats || stats.activationToastShown) return;
  stats.activationToastShown = true;
  await showToast(client, "TTC active for this session.", "info", 4500);
}

function recordSkip(stats) {
  if (!stats) return;
  stats.skipped += 1;
  updateStatsVersion(stats);
}

function recordProcessedPart(stats, { charsBefore, charsAfter, compressed, fallback, cacheHit, tokenSavingsExact }) {
  if (!stats) return;

  stats.processed += 1;
  stats.charsBefore += charsBefore;
  stats.charsAfter += charsAfter;
  if (compressed) stats.compressed += 1;
  if (fallback) stats.fallback += 1;
  if (cacheHit) stats.cacheHits += 1;

  const charsSaved = Math.max(0, charsBefore - charsAfter);
  stats.estimatedTokensSaved += estimateTokensFromChars(charsSaved);
  if (Number.isFinite(tokenSavingsExact) && tokenSavingsExact > 0) {
    stats.exactTokensSaved += tokenSavingsExact;
  }

  updateStatsVersion(stats);
}

function buildTtcPluginConfig(env = process.env) {
  const baseUrlResolution = resolveLockedBaseUrl(env.TTC_BASE_URL);
  return {
    enabled: parseBoolean(env.TTC_ENABLED, DEFAULT_CONFIG.enabled),
    apiKey: String(env.TTC_API_KEY ?? ""),
    baseUrl: baseUrlResolution.baseUrl,
    baseUrlSource: baseUrlResolution.source,
    baseUrlRejected: baseUrlResolution.rejected,
    baseUrlRejectReason: baseUrlResolution.reason,
    baseUrlProvidedSummary: summarizeUrlForLog(env.TTC_BASE_URL),
    model: String(env.TTC_MODEL ?? DEFAULT_CONFIG.model),
    aggressiveness: parseFloatValue(env.TTC_AGGRESSIVENESS, DEFAULT_CONFIG.aggressiveness),
    minChars: parseIntValue(env.TTC_MIN_CHARS, DEFAULT_CONFIG.minChars),
    timeoutMs: parseIntValue(env.TTC_TIMEOUT_MS, DEFAULT_CONFIG.timeoutMs),
    maxRetries: parseIntValue(env.TTC_MAX_RETRIES, DEFAULT_CONFIG.maxRetries),
    retryBackoffMs: parseIntValue(env.TTC_RETRY_BACKOFF_MS, DEFAULT_CONFIG.retryBackoffMs),
    useGzip: parseBoolean(env.TTC_USE_GZIP, DEFAULT_CONFIG.useGzip),
    compressSystem: parseBoolean(env.TTC_COMPRESS_SYSTEM, DEFAULT_CONFIG.compressSystem),
    compressHistory: parseBoolean(env.TTC_COMPRESS_HISTORY, DEFAULT_CONFIG.compressHistory),
    debug: parseBoolean(env.TTC_DEBUG, DEFAULT_CONFIG.debug),
    cacheMaxEntries: parseIntValue(env.TTC_CACHE_MAX_ENTRIES, DEFAULT_CONFIG.cacheMaxEntries),
    toastOnActive: parseBoolean(env.TTC_TOAST_ON_ACTIVE, DEFAULT_CONFIG.toastOnActive),
    toastOnIdleSummary: parseBoolean(env.TTC_TOAST_ON_IDLE_SUMMARY, DEFAULT_CONFIG.toastOnIdleSummary)
  };
}

function getAuthStorePath(env = process.env) {
  const xdgDataHome = String(env.XDG_DATA_HOME ?? "").trim();
  const dataHome = xdgDataHome || join(homedir(), ".local", "share");
  return join(dataHome, "opencode", "auth.json");
}

function getPluginConfigPath(env = process.env) {
  const xdgConfigHome = String(env.XDG_CONFIG_HOME ?? "").trim();
  const configHome = xdgConfigHome || join(homedir(), ".config");
  return join(configHome, "opencode", "ttc-plugin.json");
}

async function resolvePluginSettings({
  settingsFilePath = getPluginConfigPath(),
  readFileImpl = readFile
} = {}) {
  try {
    const content = await readFileImpl(settingsFilePath, "utf8");
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function resolveCompressionConfig({
  env = process.env,
  settings = {},
  defaultAggressiveness = DEFAULT_CONFIG.aggressiveness
} = {}) {
  const envHasAggressiveness = hasEnvValue(env.TTC_AGGRESSIVENESS);
  if (envHasAggressiveness) {
    return {
      aggressiveness: clampAggressiveness(env.TTC_AGGRESSIVENESS) ?? defaultAggressiveness,
      level: "",
      source: "env"
    };
  }

  const settingsAggressiveness = clampAggressiveness(settings.aggressiveness);
  if (settingsAggressiveness !== null) {
    return {
      aggressiveness: settingsAggressiveness,
      level: "",
      source: "plugin_config"
    };
  }

  const level = normalizeCompressionLevel(settings.compressionLevel);
  if (level) {
    return {
      aggressiveness: COMPRESSION_LEVELS[level],
      level,
      source: "plugin_config"
    };
  }

  return {
    aggressiveness: defaultAggressiveness,
    level: "balanced",
    source: "default"
  };
}

async function resolveApiKeyFromAuthStore({
  providerID = AUTH_PROVIDER_ID,
  authFilePath = getAuthStorePath(),
  readFileImpl = readFile
} = {}) {
  try {
    const content = await readFileImpl(authFilePath, "utf8");
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object") return "";

    const auth = parsed[providerID];
    if (!auth || typeof auth !== "object") return "";
    if (auth.type !== "api") return "";

    const key = String(auth.key ?? "").trim();
    return key;
  } catch {
    return "";
  }
}

function resolveEffectiveApiKey(envApiKey, authStoreApiKey) {
  const envKey = String(envApiKey ?? "").trim();
  if (envKey) return { apiKey: envKey, source: "env" };

  const authKey = String(authStoreApiKey ?? "").trim();
  if (authKey) return { apiKey: authKey, source: "auth_store" };

  return { apiKey: "", source: "missing" };
}

function isRetryableStatus(statusCode) {
  return statusCode === 429 || statusCode >= 500;
}

function compressUrl(baseUrl) {
  return baseUrl.endsWith("/v1") ? `${baseUrl}/compress` : `${baseUrl}/v1/compress`;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function hashText(text) {
  return createHash("sha256").update(text).digest("hex");
}

function cacheKey({ sessionID, messageID, partID, text, config }) {
  return [sessionID || "", messageID || "", partID || "", hashText(text), config.model, config.aggressiveness].join(":");
}

function getRole(messageInfo) {
  return String(messageInfo?.role ?? "").toLowerCase();
}

function isTextPart(part) {
  return Boolean(part && typeof part === "object" && part.type === "text" && typeof part.text === "string");
}

function getSkipReasonForText(text, part, config) {
  if (!isTextPart(part)) return "non_text_part";
  if (part.synthetic) return "synthetic_part";
  if (!text) return "empty_text";
  if (text.length < config.minChars) return "below_threshold";
  for (const [pattern, reason] of SKIP_PATTERNS) {
    if (pattern.test(text)) return reason;
  }
  return null;
}

function shouldCompressMessage(messageInfo, latestUserMessageID, config) {
  const role = getRole(messageInfo);
  if (role === "user") {
    if (config.compressHistory) return true;
    return messageInfo?.id === latestUserMessageID;
  }
  return role === "system" && config.compressSystem;
}

async function logEvent(client, level, message, extra = {}) {
  if (!client?.app?.log) return;
  try {
    await client.app.log({
      body: {
        service: "ttc-message-transform",
        level,
        message,
        extra
      }
    });
  } catch {
    // fail-open logging
  }
}

async function compressText(text, config, fetchImpl) {
  const maxAttempts = Math.max(0, config.maxRetries) + 1;
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const payload = {
        model: config.model,
        input: text,
        compression_settings: {
          aggressiveness: Number.isFinite(config.aggressiveness) ? config.aggressiveness : 0.1
        }
      };

      let body;
      const headers = {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      };

      if (config.useGzip) {
        headers["content-encoding"] = "gzip";
        body = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
      } else {
        body = JSON.stringify(payload);
      }

      const response = await fetchImpl(compressUrl(config.baseUrl), {
        method: "POST",
        headers,
        body,
        signal: controller.signal
      });

      if (!response.ok) {
        if (isRetryableStatus(response.status) && attempt < maxAttempts) {
          await sleep(config.retryBackoffMs * attempt);
          continue;
        }
        return {
          changed: false,
          text,
          reason: `ttc_http_${response.status}`,
          fallback: true,
          attemptCount: attempt,
          durationMs: Date.now() - startedAt
        };
      }

      const payloadOut = await response.json().catch(() => null);
      if (!payloadOut || typeof payloadOut.output !== "string" || !payloadOut.output) {
        return {
          changed: false,
          text,
          reason: "ttc_bad_payload",
          fallback: true,
          attemptCount: attempt,
          durationMs: Date.now() - startedAt
        };
      }

      const tokenSavingsExact = extractTokenSavings(payloadOut);

      if (payloadOut.output.length >= text.length) {
        return {
          changed: false,
          text,
          reason: "no_size_reduction",
          fallback: false,
          attemptCount: attempt,
          durationMs: Date.now() - startedAt,
          tokenSavingsExact
        };
      }

      return {
        changed: true,
        text: payloadOut.output,
        reason: "compressed",
        fallback: false,
        attemptCount: attempt,
        durationMs: Date.now() - startedAt,
        tokenSavingsExact
      };
    } catch (error) {
      const reason = error?.name === "AbortError" ? "ttc_timeout" : "ttc_request_failed";
      if (attempt < maxAttempts) {
        await sleep(config.retryBackoffMs * attempt);
        continue;
      }
      return {
        changed: false,
        text,
        reason,
        fallback: true,
        attemptCount: attempt,
        durationMs: Date.now() - startedAt
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    changed: false,
    text,
    reason: "ttc_retry_exhausted",
    fallback: true,
    attemptCount: maxAttempts,
    durationMs: Date.now() - startedAt
  };
}

function setCached(cache, key, value, maxEntries) {
  cache.set(key, value);
  const limit = Number.isFinite(maxEntries) ? Math.max(1, maxEntries) : 1000;
  while (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

async function transformMessagesWithTtc({
  output,
  client,
  config,
  cache,
  sessionStats = null,
  fetchImpl = fetch
}) {
  if (!output || !Array.isArray(output.messages)) return;
  if (!config.enabled || !config.apiKey) return;

  const latestUser = [...output.messages].reverse().find((entry) => getRole(entry?.info) === "user");
  const latestUserMessageID = latestUser?.info?.id;

  for (const messageEntry of output.messages) {
    if (!messageEntry || !messageEntry.info || !Array.isArray(messageEntry.parts)) continue;
    if (!shouldCompressMessage(messageEntry.info, latestUserMessageID, config)) continue;

    const stats = getSessionStats(sessionStats, messageEntry.info.sessionID);

    for (const part of messageEntry.parts) {
      if (!isTextPart(part)) continue;

      const skipReason = getSkipReasonForText(part.text, part, config);
      if (skipReason) {
        if (config.debug) {
          await logEvent(client, "debug", "ttc.plugin.skip", {
            session_id: messageEntry.info.sessionID,
            message_id: messageEntry.info.id,
            part_id: part.id,
            reason_code: skipReason,
            chars_before: part.text.length
          });
        }
        recordSkip(stats);
        continue;
      }

      const key = cacheKey({
        sessionID: messageEntry.info.sessionID,
        messageID: messageEntry.info.id,
        partID: part.id,
        text: part.text,
        config
      });

      if (cache.has(key)) {
        const cached = cache.get(key);
        const originalChars = cached.originalChars ?? part.text.length;
        part.text = cached.text;
        await maybeShowActivationToast(client, config, stats);
        recordProcessedPart(stats, {
          charsBefore: originalChars,
          charsAfter: cached.text.length,
          compressed: cached.reason === "compressed",
          fallback: false,
          cacheHit: true,
          tokenSavingsExact: cached.tokenSavingsExact ?? null
        });
        await logEvent(client, "info", "ttc.plugin.response", {
          session_id: messageEntry.info.sessionID,
          message_id: messageEntry.info.id,
          part_id: part.id,
          chars_before: originalChars,
          chars_after: cached.text.length,
          reduction_pct: cached.reductionPct,
          reason_code: cached.reason,
          cache_hit: true,
          attempt_count: 0,
          duration_ms: 0
        });
        continue;
      }

      await logEvent(client, "info", "ttc.plugin.request", {
        session_id: messageEntry.info.sessionID,
        message_id: messageEntry.info.id,
        part_id: part.id,
        chars_before: part.text.length
      });

      const originalChars = part.text.length;
      const result = await compressText(part.text, config, fetchImpl);
      const reductionPct = originalChars > 0
        ? Number((((originalChars - result.text.length) / originalChars) * 100).toFixed(2))
        : 0;

      await maybeShowActivationToast(client, config, stats);
      recordProcessedPart(stats, {
        charsBefore: originalChars,
        charsAfter: result.text.length,
        compressed: result.changed,
        fallback: result.fallback,
        cacheHit: false,
        tokenSavingsExact: result.tokenSavingsExact ?? null
      });

      await logEvent(client, result.fallback ? "warn" : "info", result.fallback ? "ttc.plugin.fallback" : "ttc.plugin.response", {
        session_id: messageEntry.info.sessionID,
        message_id: messageEntry.info.id,
        part_id: part.id,
        chars_before: originalChars,
        chars_after: result.text.length,
        reduction_pct: reductionPct,
        reason_code: result.reason,
        cache_hit: false,
        attempt_count: result.attemptCount,
        duration_ms: result.durationMs
      });

      if (result.changed || result.reason === "no_size_reduction") {
        setCached(cache, key, {
          text: result.text,
          reason: result.reason,
          originalChars,
          reductionPct,
          tokenSavingsExact: result.tokenSavingsExact ?? null
        }, config.cacheMaxEntries);
      }

      part.text = result.text;
    }
  }
}

const TtcMessageTransformPlugin = async ({ client }) => {
  const config = buildTtcPluginConfig();
  const pluginSettings = await resolvePluginSettings();
  const compressionResolution = resolveCompressionConfig({
    env: process.env,
    settings: pluginSettings,
    defaultAggressiveness: config.aggressiveness
  });
  config.aggressiveness = compressionResolution.aggressiveness;
  const authStoreApiKey = await resolveApiKeyFromAuthStore({ providerID: AUTH_PROVIDER_ID });
  const apiKeyResolution = resolveEffectiveApiKey(config.apiKey, authStoreApiKey);
  config.apiKey = apiKeyResolution.apiKey;
  const cache = new Map();
  const sessionStats = new Map();

  if (config.baseUrlRejected) {
    await logEvent(client, "warn", "ttc.plugin.config_invalid", {
      field: "TTC_BASE_URL",
      provided: config.baseUrlProvidedSummary,
      reason_code: config.baseUrlRejectReason,
      using: LOCKED_BASE_URL
    });
  }

  await logEvent(client, "info", "ttc.plugin.init", {
    enabled: config.enabled,
    has_api_key: Boolean(config.apiKey),
    auth_provider_id: AUTH_PROVIDER_ID,
    auth_source: apiKeyResolution.source,
    base_url_source: config.baseUrlSource,
    compression_source: compressionResolution.source,
    compression_level: compressionResolution.level || "custom",
    base_url: config.baseUrl,
    model: config.model,
    aggressiveness: config.aggressiveness,
    min_chars: config.minChars,
    timeout_ms: config.timeoutMs,
    max_retries: config.maxRetries,
    use_gzip: config.useGzip,
    compress_system: config.compressSystem,
    compress_history: config.compressHistory,
    cache_max_entries: config.cacheMaxEntries,
    toast_on_active: config.toastOnActive,
    toast_on_idle_summary: config.toastOnIdleSummary
  });

  return {
    auth: {
      provider: AUTH_PROVIDER_ID,
      methods: [
        {
          type: "api",
          label: "Set TTC API Key",
          prompts: [
            {
              type: "text",
              key: "apiKey",
              message: "Enter TTC API key",
              placeholder: "ttc_..."
            }
          ],
          async authorize(inputs = {}) {
            const key = String(inputs.apiKey ?? "").trim();
            if (!key) return { type: "failed" };
            return { type: "success", key };
          }
        }
      ]
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      try {
        await transformMessagesWithTtc({ output, client, config, cache, sessionStats });
      } catch {
        await logEvent(client, "warn", "ttc.plugin.fallback", {
          reason_code: "plugin_transform_failed"
        });
      }
    },
    event: async ({ event }) => {
      if (!config.toastOnIdleSummary) return;
      if (event?.type !== "session.idle") return;

      const sessionID = resolveSessionIDFromEvent(event);
      if (!sessionID) return;

      const stats = sessionStats.get(sessionID);
      if (!stats) return;
      if (stats.version === 0 || stats.version === stats.lastSummaryVersion) return;

      stats.lastSummaryVersion = stats.version;
      await showToast(client, buildIdleSummaryMessage(stats), "info", 9000);
    }
  };
};

export default TtcMessageTransformPlugin;

TtcMessageTransformPlugin._test = {
  AUTH_PROVIDER_ID,
  COMPRESSION_LEVELS,
  buildTtcPluginConfig,
  getPluginConfigPath,
  resolvePluginSettings,
  resolveCompressionConfig,
  resolveLockedBaseUrl,
  getAuthStorePath,
  resolveApiKeyFromAuthStore,
  resolveEffectiveApiKey,
  getSkipReasonForText,
  transformMessagesWithTtc
};
