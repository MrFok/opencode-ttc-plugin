import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

function parseDotenv(fileContent) {
  const result = {};
  const lines = fileContent.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function loadEnvFile(fileName) {
  const filePath = resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) return;
  const parsed = parseDotenv(readFileSync(filePath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function loadEnvironment() {
  const explicitLocalMode = process.env.LOCAL_TEST_MODE === "true" || process.env.LOCAL_TEST_MODE === "1";
  const inferredLocalMode = process.env.NODE_ENV !== "production" && existsSync(resolve(process.cwd(), ".env.local"));
  const localMode = explicitLocalMode || inferredLocalMode;
  if (localMode) {
    loadEnvFile(".env.local");
  }
  loadEnvFile(".env");
  return localMode;
}

const LOCAL_TEST_MODE = loadEnvironment();

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const PROXY_API_KEY = process.env.PROXY_API_KEY ?? "";
const UPSTREAM_BASE_URL = (process.env.UPSTREAM_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
const UPSTREAM_API_KEY = process.env.UPSTREAM_API_KEY ?? "";
const ENABLE_COMPRESSION = process.env.ENABLE_COMPRESSION !== "false";
const TOKEN_COMPANY_API_KEY = process.env.TOKEN_COMPANY_API_KEY ?? "";
const TOKEN_COMPANY_BASE_URL = (process.env.TOKEN_COMPANY_BASE_URL ?? "https://api.thetokencompany.com").replace(/\/$/, "");
const TOKEN_COMPANY_MODEL = process.env.TOKEN_COMPANY_MODEL ?? "bear-1.2";
const TOKEN_COMPANY_AGGRESSIVENESS = Number.parseFloat(process.env.TOKEN_COMPANY_AGGRESSIVENESS ?? "0.1");
const TOKEN_COMPANY_TIMEOUT_MS = Number.parseInt(process.env.TOKEN_COMPANY_TIMEOUT_MS ?? "2500", 10);
const TOKEN_COMPANY_USE_GZIP = process.env.TOKEN_COMPANY_USE_GZIP !== "false";
const TOKEN_COMPANY_MAX_RETRIES = Number.parseInt(process.env.TOKEN_COMPANY_MAX_RETRIES ?? "1", 10);
const TOKEN_COMPANY_RETRY_BACKOFF_MS = Number.parseInt(process.env.TOKEN_COMPANY_RETRY_BACKOFF_MS ?? "100", 10);
const COMPRESSION_MIN_CHARS = Number.parseInt(process.env.COMPRESSION_MIN_CHARS ?? "500", 10);
const UPSTREAM_MAX_RETRIES = Number.parseInt(process.env.UPSTREAM_MAX_RETRIES ?? "2", 10);
const UPSTREAM_RETRY_BACKOFF_MS = Number.parseInt(process.env.UPSTREAM_RETRY_BACKOFF_MS ?? "150", 10);
const UPSTREAM_RETRY_STATUS_CODES = new Set(
  (process.env.UPSTREAM_RETRY_STATUS_CODES ?? "429,500,502,503,504")
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value))
);
const UPSTREAM_NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404]);
const UPSTREAM_STREAM_FIRST_CHUNK_TIMEOUT_MS = Number.parseInt(
  process.env.UPSTREAM_STREAM_FIRST_CHUNK_TIMEOUT_MS ?? "12000",
  10
);
const UPSTREAM_TOTAL_TIMEOUT_MS = Number.parseInt(process.env.UPSTREAM_TOTAL_TIMEOUT_MS ?? "120000", 10);
const UPSTREAM_FALLBACKS_RAW = process.env.UPSTREAM_FALLBACKS ?? "";
const UPSTREAM_PROVIDERS_JSON = process.env.UPSTREAM_PROVIDERS_JSON ?? "";
const MODEL_ROUTE_RULES_JSON = process.env.MODEL_ROUTE_RULES_JSON ?? "";
const MODEL_DEFAULT_PROVIDER = process.env.MODEL_DEFAULT_PROVIDER ?? "default";
const MODEL_FALLBACK_RULES_JSON = process.env.MODEL_FALLBACK_RULES_JSON ?? "";
const PROVIDER_CONFIG_STRICT = process.env.PROVIDER_CONFIG_STRICT === "true";
const MODELS_SOURCE_MODE = (process.env.MODELS_SOURCE_MODE ?? "passthrough").toLowerCase();
const MODELS_CACHE_TTL_MS = Number.parseInt(process.env.MODELS_CACHE_TTL_MS ?? "30000", 10);
const MODELS_ALLOWLIST = new Set(
  (process.env.MODELS_ALLOWLIST ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const MODELS_DENYLIST = new Set(
  (process.env.MODELS_DENYLIST ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const MODELS_ALIASES_JSON = process.env.MODELS_ALIASES_JSON ?? "";
const MODELS_STATIC_JSON = process.env.MODELS_STATIC_JSON ?? "";
const ENABLE_EMBEDDINGS_COMPRESSION = process.env.ENABLE_EMBEDDINGS_COMPRESSION === "true";
const COMPRESS_ROLES = new Set(
  (process.env.COMPRESS_ROLES ?? "user")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
);
const LOG_LEVEL = (process.env.LOG_LEVEL ?? (LOCAL_TEST_MODE ? "debug" : "info")).toLowerCase();
const LOG_BUFFER_SIZE = Number.parseInt(process.env.LOG_BUFFER_SIZE ?? "500", 10);
const LOG_LOCAL_ENDPOINT =
  process.env.NODE_ENV !== "production" &&
  (process.env.LOG_LOCAL_ENDPOINT === "true" || LOCAL_TEST_MODE);

const LOG_LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const logBuffer = [];
const SENSITIVE_LOG_KEYS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "password",
  "secret",
  "token",
  "api_key",
  "apikey",
  "upstream_api_key",
  "proxy_api_key",
  "token_company_api_key"
]);

const stats = {
  requests_total: 0,
  requests_compression_eligible: 0,
  requests_compression_applied: 0,
  upstream_attempt_count: 0,
  upstream_retry_count: 0,
  upstream_fallback_count: 0,
  upstream_timeout_count: 0,
  stream_first_chunk_timeout_count: 0,
  models_cache_hit_count: 0,
  models_cache_miss_count: 0,
  models_aggregate_error_count: 0,
  compression_attempted_count: 0,
  compression_applied_count: 0,
  compression_fallback_count: 0,
  compression_skipped_count: 0,
  estimated_input_size_before: 0,
  estimated_input_size_after: 0,
  last_error_code: null
};

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host"
]);

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.setHeader("content-length", Buffer.byteLength(body));
  res.end(body);
}

function getCurrentIsoTimestamp() {
  return new Date().toISOString();
}

function getLogPriority(level) {
  return LOG_LEVEL_PRIORITY[level] ?? LOG_LEVEL_PRIORITY.info;
}

function shouldLog(level) {
  return getLogPriority(level) >= getLogPriority(LOG_LEVEL);
}

function redactString(input) {
  if (typeof input !== "string") return input;
  return input
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-or-[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\bttc_sk_[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, "[REDACTED]");
}

function sanitizeForLogs(value, keyName = "") {
  const lowerKey = keyName.toLowerCase();

  if (SENSITIVE_LOG_KEYS.has(lowerKey)) {
    return "[REDACTED]";
  }

  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLogs(item));
  }

  if (typeof value === "object") {
    const sanitized = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      sanitized[childKey] = sanitizeForLogs(childValue, childKey);
    }
    return sanitized;
  }

  return String(value);
}

function pushLogEvent(event) {
  logBuffer.push(event);
  const maxSize = Number.isFinite(LOG_BUFFER_SIZE) ? Math.max(1, LOG_BUFFER_SIZE) : 500;
  if (logBuffer.length > maxSize) {
    logBuffer.shift();
  }
}

function logEvent(level, eventName, fields = {}) {
  if (!shouldLog(level)) return;
  const event = sanitizeForLogs({
    timestamp: getCurrentIsoTimestamp(),
    level,
    event_name: eventName,
    service: "token-company-proxy",
    ...fields
  });
  pushLogEvent(event);
  console.log(JSON.stringify(event));
}

function openAiError(message, type = "invalid_request_error", code = null) {
  return {
    error: {
      message,
      type,
      code
    }
  };
}

function getBearerToken(authorizationHeader) {
  if (!authorizationHeader) return "";
  const [scheme, token] = authorizationHeader.split(" ");
  if (!scheme || !token) return "";
  if (scheme.toLowerCase() !== "bearer") return "";
  return token;
}

function isProxyAuthorized(req) {
  if (!PROXY_API_KEY) return true;
  const token = getBearerToken(req.headers.authorization);
  return token === PROXY_API_KEY;
}

function getUpstreamToken(providerConfig, req) {
  const clientToken = getBearerToken(req.headers.authorization);
  if (providerConfig.authMode === "provider_key") {
    return providerConfig.apiKey;
  }
  if (providerConfig.authMode === "client_bearer") {
    return providerConfig.passThroughClientAuth ? clientToken : "";
  }
  return providerConfig.apiKey || (providerConfig.passThroughClientAuth ? clientToken : "");
}

function buildUpstreamHeaders(req, requestId, contentLength, providerConfig) {
  const headers = {};

  for (const [name, value] of Object.entries(req.headers)) {
    if (!value) continue;
    const lowerName = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerName)) continue;
    if (lowerName === "authorization") continue;
    if (lowerName === "content-length") continue;
    headers[name] = Array.isArray(value) ? value.join(",") : value;
  }

  headers["x-proxy-request-id"] = requestId;
  headers["content-length"] = String(contentLength);

  const upstreamToken = getUpstreamToken(providerConfig, req);

  if (!upstreamToken) {
    throw new Error(`Missing upstream API key for provider '${providerConfig.id}'.`);
  }

  headers.authorization = `Bearer ${upstreamToken}`;
  for (const [key, value] of Object.entries(providerConfig.extraHeaders ?? {})) {
    if (!key || value === undefined || value === null) continue;
    headers[key] = String(value);
  }
  if (!headers["content-type"]) {
    headers["content-type"] = "application/json";
  }

  return headers;
}

function buildUpstreamGetHeaders(req, requestId, providerConfig) {
  const headers = {};

  for (const [name, value] of Object.entries(req.headers)) {
    if (!value) continue;
    const lowerName = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerName)) continue;
    if (lowerName === "authorization") continue;
    headers[name] = Array.isArray(value) ? value.join(",") : value;
  }

  headers["x-proxy-request-id"] = requestId;
  const upstreamToken = getUpstreamToken(providerConfig, req);
  if (!upstreamToken) {
    throw new Error(`Missing upstream API key for provider '${providerConfig.id}'.`);
  }
  headers.authorization = `Bearer ${upstreamToken}`;

  for (const [key, value] of Object.entries(providerConfig.extraHeaders ?? {})) {
    if (!key || value === undefined || value === null) continue;
    headers[key] = String(value);
  }

  return headers;
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function copyUpstreamHeaders(upstreamRes, clientRes) {
  for (const [name, value] of upstreamRes.headers.entries()) {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    clientRes.setHeader(name, value);
  }
}

function parseJsonBody(buffer) {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    return null;
  }
}

function looksHighRiskForSafeMode(text) {
  if (!text) return false;
  const highRiskPatterns = [
    /```/, // fenced code
    /^diff --git/m,
    /^@@\s/m,
    /^\+\+\+\s/m,
    /^---\s/m,
    /Traceback \(most recent call last\):/,
    /Exception:/,
    /^\s*\{[\s\S]*\}\s*$/m,
    /^\s*\[[\s\S]*\]\s*$/m
  ];
  return highRiskPatterns.some((pattern) => pattern.test(text));
}

function buildTokenCompanyCompressUrl() {
  const base = TOKEN_COMPANY_BASE_URL;
  if (base.endsWith("/v1")) {
    return `${base}/compress`;
  }
  return `${base}/v1/compress`;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function parseJsonObject(rawValue, fallbackValue) {
  if (!rawValue || !rawValue.trim()) return fallbackValue;
  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object") {
      return fallbackValue;
    }
    return parsed;
  } catch {
    return fallbackValue;
  }
}

function parseJsonArray(rawValue, fallbackValue) {
  if (!rawValue || !rawValue.trim()) return fallbackValue;
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return fallbackValue;
    return parsed;
  } catch {
    return fallbackValue;
  }
}

const PROVIDER_AUTH_MODES = new Set(["provider_key", "client_bearer", "provider_or_client"]);
const BLOCKED_PROVIDER_HEADER_KEYS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "content-length",
  "host",
  "connection"
]);

function normalizeProviderHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const safeHeaders = {};
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    const key = String(rawKey).trim();
    if (!key) continue;
    const lower = key.toLowerCase();
    if (BLOCKED_PROVIDER_HEADER_KEYS.has(lower)) continue;
    if (!(lower.startsWith("x-") || lower.startsWith("openrouter-"))) continue;
    safeHeaders[key] = String(rawValue);
  }
  return safeHeaders;
}

function normalizeProviderDefinition(providerId, definition) {
  if (!definition || typeof definition !== "object") return null;
  const baseURL = String(definition.baseURL ?? "").replace(/\/$/, "");
  if (!baseURL) return null;

  const authModeRaw = String(definition.authMode ?? "provider_or_client").trim().toLowerCase();
  const authMode = PROVIDER_AUTH_MODES.has(authModeRaw) ? authModeRaw : "provider_or_client";
  const apiKeyEnv = String(definition.apiKeyEnv ?? "").trim();
  const apiKeyFromEnv = apiKeyEnv ? String(process.env[apiKeyEnv] ?? "") : "";

  return {
    id: providerId,
    baseURL,
    apiKey: String(definition.apiKey ?? "") || apiKeyFromEnv,
    apiKeyEnv,
    authMode,
    passThroughClientAuth: definition.passThroughClientAuth !== false,
    extraHeaders: normalizeProviderHeaders(definition.headers)
  };
}

function buildProviderRegistry() {
  const providers = new Map();
  providers.set("default", {
    id: "default",
    baseURL: UPSTREAM_BASE_URL,
    apiKey: UPSTREAM_API_KEY,
    apiKeyEnv: "",
    authMode: "provider_or_client",
    passThroughClientAuth: true,
    extraHeaders: {}
  });

  const configured = parseJsonObject(UPSTREAM_PROVIDERS_JSON, {});
  for (const [providerId, definition] of Object.entries(configured)) {
    const normalized = normalizeProviderDefinition(providerId, definition);
    if (normalized) {
      providers.set(providerId, normalized);
    }
  }

  return providers;
}

const PROVIDER_REGISTRY = buildProviderRegistry();

function validateProviderRegistry(registry) {
  const errors = [];
  const warnings = [];
  for (const [providerId, provider] of registry.entries()) {
    if (provider.authMode === "provider_key" && !provider.apiKey) {
      errors.push(`Provider '${providerId}' requires authMode=provider_key but apiKey is missing.`);
    }
    if (provider.authMode === "provider_or_client" && !provider.apiKey && !provider.passThroughClientAuth) {
      errors.push(`Provider '${providerId}' cannot authenticate: no apiKey and client pass-through disabled.`);
    }
    if (provider.authMode === "client_bearer" && provider.apiKey) {
      warnings.push(`Provider '${providerId}' sets authMode=client_bearer and ignores configured apiKey.`);
    }
  }
  return { errors, warnings };
}

const PROVIDER_REGISTRY_VALIDATION = validateProviderRegistry(PROVIDER_REGISTRY);

function parseRouteRules() {
  const parsed = parseJsonObject(MODEL_ROUTE_RULES_JSON, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((rule) => {
      if (!rule || typeof rule !== "object") return null;
      const provider = String(rule.provider ?? "").trim();
      const match = String(rule.match ?? "").trim().toLowerCase();
      const value = String(rule.value ?? "").trim();
      if (!provider || !match || !value) return null;
      return {
        provider,
        match,
        value,
        model: typeof rule.model === "string" ? rule.model.trim() : ""
      };
    })
    .filter(Boolean);
}

const MODEL_ROUTE_RULES = parseRouteRules();

function parseFallbackRules() {
  const parsed = parseJsonObject(MODEL_FALLBACK_RULES_JSON, {});
  const output = new Map();
  for (const [key, value] of Object.entries(parsed)) {
    if (!Array.isArray(value)) continue;
    const entries = value.map((entry) => String(entry).trim()).filter(Boolean);
    if (entries.length > 0) {
      output.set(key, entries);
    }
  }
  return output;
}

const MODEL_FALLBACK_RULES = parseFallbackRules();
const MODEL_ALIASES = parseJsonObject(MODELS_ALIASES_JSON, {});
const STATIC_MODELS = parseJsonArray(MODELS_STATIC_JSON, []);
const modelCatalogCache = {
  expiresAt: 0,
  payload: null
};

function parseFallbackMap(rawValue) {
  const result = new Map();
  if (!rawValue.trim()) return result;

  for (const segment of rawValue.split(";")) {
    const trimmedSegment = segment.trim();
    if (!trimmedSegment) continue;
    const separatorIndex = trimmedSegment.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmedSegment.slice(0, separatorIndex).trim();
    const values = trimmedSegment
      .slice(separatorIndex + 1)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (key && values.length > 0) {
      result.set(key, values);
    }
  }

  return result;
}

const UPSTREAM_FALLBACKS = parseFallbackMap(UPSTREAM_FALLBACKS_RAW);

function ruleMatchesModel(rule, modelName) {
  const value = rule.value;
  if (rule.match === "exact") return modelName === value;
  if (rule.match === "prefix") return modelName.startsWith(value);
  if (rule.match === "glob") {
    const escaped = value.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    const regex = new RegExp(`^${escaped}$`);
    return regex.test(modelName);
  }
  return false;
}

function resolveModelRoute(modelName) {
  for (const rule of MODEL_ROUTE_RULES) {
    if (!ruleMatchesModel(rule, modelName)) continue;
    const provider = PROVIDER_REGISTRY.get(rule.provider);
    if (!provider) continue;
    return {
      provider,
      model: rule.model || modelName,
      reason: `rule_${rule.match}`
    };
  }

  const defaultProvider = PROVIDER_REGISTRY.get(MODEL_DEFAULT_PROVIDER) ?? PROVIDER_REGISTRY.get("default");
  return {
    provider: defaultProvider,
    model: modelName,
    reason: "default_provider"
  };
}

function parseFallbackEntry(entry, currentProviderId) {
  if (!entry) return null;
  const separator = entry.indexOf(":");
  if (separator > 0) {
    return {
      providerId: entry.slice(0, separator),
      model: entry.slice(separator + 1)
    };
  }
  return {
    providerId: currentProviderId,
    model: entry
  };
}

function getFallbackRoutes(primaryRoute, originalModel) {
  const fallbackKeys = [
    `${primaryRoute.provider.id}:${primaryRoute.model}`,
    primaryRoute.model,
    originalModel,
    "*"
  ];

  const fallbackEntries = [];
  for (const key of fallbackKeys) {
    const entries = MODEL_FALLBACK_RULES.get(key);
    if (entries && entries.length) {
      fallbackEntries.push(...entries);
    }
  }

  const legacyFallbackModels = [
    ...(UPSTREAM_FALLBACKS.get(primaryRoute.model) ?? []),
    ...(UPSTREAM_FALLBACKS.get(originalModel) ?? []),
    ...(UPSTREAM_FALLBACKS.get("*") ?? [])
  ];
  fallbackEntries.push(...legacyFallbackModels);

  const uniqueRoutes = [];
  const seen = new Set([`${primaryRoute.provider.id}:${primaryRoute.model}`]);
  for (const rawEntry of fallbackEntries) {
    const parsed = parseFallbackEntry(String(rawEntry).trim(), primaryRoute.provider.id);
    if (!parsed || !parsed.providerId || !parsed.model) continue;
    const provider = PROVIDER_REGISTRY.get(parsed.providerId);
    if (!provider) continue;

    const key = `${provider.id}:${parsed.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRoutes.push({ provider, model: parsed.model, reason: "configured_fallback" });
  }

  return uniqueRoutes;
}

function isRetriableUpstreamStatus(statusCode) {
  if (UPSTREAM_NON_RETRYABLE_STATUS_CODES.has(statusCode)) return false;
  return UPSTREAM_RETRY_STATUS_CODES.has(statusCode);
}

function isStreamRequested(payload) {
  return Boolean(payload && typeof payload === "object" && payload.stream === true);
}

function withModelOverride(payload, modelName) {
  if (!payload || typeof payload !== "object") return payload;
  if (!modelName || payload.model === modelName) return payload;
  return {
    ...payload,
    model: modelName
  };
}

async function waitForFirstChunk(reader) {
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      return chunk;
    }

    if (chunk.value && chunk.value.byteLength > 0) {
      return chunk;
    }
  }
}

function createRequestCompressionState() {
  return {
    enabled: ENABLE_COMPRESSION,
    attempted_count: 0,
    applied_count: 0,
    fallback_count: 0,
    skipped_count: 0,
    input_chars_before: 0,
    input_chars_after: 0,
    reason_codes: []
  };
}

function pushCompressionReason(state, reason) {
  if (!reason) return;
  state.reason_codes.push(reason);
}

async function compressTextSafe(text, requestCompression) {
  if (!ENABLE_COMPRESSION || !TOKEN_COMPANY_API_KEY) return { text, changed: false, reason: "disabled_or_missing_key" };
  if (text.length < COMPRESSION_MIN_CHARS) return { text, changed: false, reason: "below_threshold" };
  if (looksHighRiskForSafeMode(text)) return { text, changed: false, reason: "high_risk_content" };

  stats.compression_attempted_count += 1;
  stats.estimated_input_size_before += text.length;
  requestCompression.attempted_count += 1;
  requestCompression.input_chars_before += text.length;

  const maxRetries = Number.isFinite(TOKEN_COMPANY_MAX_RETRIES) ? Math.max(0, TOKEN_COMPANY_MAX_RETRIES) : 1;
  const maxAttempts = maxRetries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TOKEN_COMPANY_TIMEOUT_MS);
    try {
    const requestPayload = {
      model: TOKEN_COMPANY_MODEL,
      input: text,
      compression_settings: {
        aggressiveness: Number.isFinite(TOKEN_COMPANY_AGGRESSIVENESS) ? TOKEN_COMPANY_AGGRESSIVENESS : 0.1
      }
    };

    let body;
    const headers = {
      authorization: `Bearer ${TOKEN_COMPANY_API_KEY}`,
      "content-type": "application/json"
    };

    if (TOKEN_COMPANY_USE_GZIP) {
      headers["content-encoding"] = "gzip";
      body = gzipSync(Buffer.from(JSON.stringify(requestPayload), "utf8"));
    } else {
      body = JSON.stringify(requestPayload);
    }

    const response = await fetch(buildTokenCompanyCompressUrl(), {
      method: "POST",
      headers,
      body,
      signal: controller.signal
    });

    if (!response.ok) {
      const isRetriableStatus = response.status >= 500 || response.status === 429;
      if (isRetriableStatus && attempt < maxAttempts) {
        pushCompressionReason(requestCompression, `ttc_retry_http_${response.status}`);
        await sleep(TOKEN_COMPANY_RETRY_BACKOFF_MS * attempt);
        continue;
      }

      stats.compression_fallback_count += 1;
      stats.last_error_code = `ttc_http_${response.status}`;
      requestCompression.fallback_count += 1;
      pushCompressionReason(requestCompression, `ttc_http_${response.status}`);
      return { text, changed: false, reason: "ttc_http_error" };
    }

    const payload = await response.json();
    if (!payload || typeof payload.output !== "string") {
      stats.compression_fallback_count += 1;
      stats.last_error_code = "ttc_bad_payload";
      requestCompression.fallback_count += 1;
      pushCompressionReason(requestCompression, "ttc_bad_payload");
      return { text, changed: false, reason: "ttc_bad_payload" };
    }

    stats.estimated_input_size_after += payload.output.length;
    requestCompression.input_chars_after += payload.output.length;

    if (payload.output.length >= text.length) {
      stats.compression_skipped_count += 1;
      requestCompression.skipped_count += 1;
      pushCompressionReason(requestCompression, "no_size_reduction");
      return { text, changed: false, reason: "no_size_reduction" };
    }

    stats.compression_applied_count += 1;
    requestCompression.applied_count += 1;
    pushCompressionReason(requestCompression, "compressed");
    return { text: payload.output, changed: true, reason: "compressed" };
    } catch (error) {
      const timeoutError = error && error.name === "AbortError";
      const reason = timeoutError ? "ttc_timeout" : "ttc_request_failed";

      if (attempt < maxAttempts) {
        pushCompressionReason(requestCompression, `ttc_retry_${reason}`);
        await sleep(TOKEN_COMPANY_RETRY_BACKOFF_MS * attempt);
        continue;
      }

      stats.compression_fallback_count += 1;
      stats.last_error_code = reason;
      requestCompression.fallback_count += 1;
      pushCompressionReason(requestCompression, reason);
      return { text, changed: false, reason };
    } finally {
      clearTimeout(timeout);
    }
  }

  stats.compression_fallback_count += 1;
  stats.last_error_code = "ttc_retry_exhausted";
  requestCompression.fallback_count += 1;
  pushCompressionReason(requestCompression, "ttc_retry_exhausted");
  return { text, changed: false, reason: "ttc_retry_exhausted" };
}

async function maybeCompressMessageContent(content, requestCompression) {
  if (typeof content === "string") {
    return compressTextSafe(content, requestCompression);
  }

  if (Array.isArray(content)) {
    let anyChanged = false;
    const next = [];

    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        part.type === "text" &&
        typeof part.text === "string"
      ) {
        const compressed = await compressTextSafe(part.text, requestCompression);
        next.push({ ...part, text: compressed.text });
        if (compressed.changed) anyChanged = true;
      } else {
        next.push(part);
      }
    }

    return { text: next, changed: anyChanged, reason: anyChanged ? "compressed" : "unchanged" };
  }

  return { text: content, changed: false, reason: "unsupported_content" };
}

async function maybeCompressChatPayload(payload, requestCompression) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.messages)) {
    return { payload, changed: false };
  }

  let changed = false;
  const nextMessages = [];

  for (const message of payload.messages) {
    if (!message || typeof message !== "object") {
      nextMessages.push(message);
      continue;
    }

    if (!COMPRESS_ROLES.has(String(message.role ?? ""))) {
      nextMessages.push(message);
      continue;
    }

    const compressed = await maybeCompressMessageContent(message.content, requestCompression);
    nextMessages.push({ ...message, content: compressed.text });
    if (compressed.changed) {
      changed = true;
    }
  }

  if (!changed) {
    return { payload, changed: false };
  }

  return {
    payload: {
      ...payload,
      messages: nextMessages
    },
    changed: true
  };
}

async function maybeCompressResponsesPayload(payload, requestCompression) {
  if (!payload || typeof payload !== "object") {
    return { payload, changed: false };
  }

  if (typeof payload.input === "string") {
    const compressed = await compressTextSafe(payload.input, requestCompression);
    if (!compressed.changed) return { payload, changed: false };
    return {
      payload: {
        ...payload,
        input: compressed.text
      },
      changed: true
    };
  }

  if (Array.isArray(payload.input)) {
    let changed = false;
    const nextInput = [];
    for (const item of payload.input) {
      if (!item || typeof item !== "object") {
        nextInput.push(item);
        continue;
      }

      if (typeof item.content === "string") {
        const compressed = await compressTextSafe(item.content, requestCompression);
        nextInput.push({ ...item, content: compressed.text });
        if (compressed.changed) changed = true;
        continue;
      }

      if (Array.isArray(item.content)) {
        const contentResult = await maybeCompressMessageContent(item.content, requestCompression);
        nextInput.push({ ...item, content: contentResult.text });
        if (contentResult.changed) changed = true;
        continue;
      }

      nextInput.push(item);
    }

    if (!changed) {
      return { payload, changed: false };
    }

    return {
      payload: {
        ...payload,
        input: nextInput
      },
      changed: true
    };
  }

  return { payload, changed: false };
}

async function maybeCompressEmbeddingsPayload(payload, requestCompression) {
  if (!ENABLE_EMBEDDINGS_COMPRESSION) {
    return { payload, changed: false };
  }

  if (!payload || typeof payload !== "object") {
    return { payload, changed: false };
  }

  if (typeof payload.input === "string") {
    const compressed = await compressTextSafe(payload.input, requestCompression);
    if (!compressed.changed) return { payload, changed: false };
    return {
      payload: {
        ...payload,
        input: compressed.text
      },
      changed: true
    };
  }

  if (Array.isArray(payload.input)) {
    let changed = false;
    const nextInputs = [];
    for (const value of payload.input) {
      if (typeof value !== "string") {
        nextInputs.push(value);
        continue;
      }
      const compressed = await compressTextSafe(value, requestCompression);
      nextInputs.push(compressed.text);
      if (compressed.changed) changed = true;
    }

    if (!changed) return { payload, changed: false };
    return {
      payload: {
        ...payload,
        input: nextInputs
      },
      changed: true
    };
  }

  return { payload, changed: false };
}

async function readUpstreamBody(upstreamRes) {
  const buffer = Buffer.from(await upstreamRes.arrayBuffer());
  return buffer;
}

async function prepareStreamingStart(upstreamRes, firstChunkTimeoutMs, attemptController) {
  if (!upstreamRes.body) {
    return {
      reader: null,
      firstChunk: null,
      done: true,
      firstChunkTimeout: false,
      error: null
    };
  }

  const reader = upstreamRes.body.getReader();
  let firstChunkTimeout = false;
  const firstChunkTimer = setTimeout(() => {
    firstChunkTimeout = true;
    attemptController.abort(new Error("upstream_first_chunk_timeout"));
  }, firstChunkTimeoutMs);

  try {
    const firstRead = await waitForFirstChunk(reader);
    clearTimeout(firstChunkTimer);
    return {
      reader,
      firstChunk: firstRead.value ?? null,
      done: Boolean(firstRead.done),
      firstChunkTimeout: false,
      error: null
    };
  } catch (error) {
    clearTimeout(firstChunkTimer);
    return {
      reader,
      firstChunk: null,
      done: false,
      firstChunkTimeout,
      error
    };
  }
}

async function streamRemainingChunks(reader, res) {
  while (true) {
    const nextChunk = await reader.read();
    if (nextChunk.done) {
      return;
    }
    res.write(Buffer.from(nextChunk.value));
  }
}

function buildUpstreamAttemptHeaders(req, requestId, bodyLength, providerConfig) {
  return buildUpstreamHeaders(req, requestId, bodyLength, providerConfig);
}

function markUpstreamTimeout() {
  stats.upstream_timeout_count += 1;
}

function markFirstChunkTimeout() {
  stats.stream_first_chunk_timeout_count += 1;
}

async function proxyRoutedRequest({
  req,
  res,
  requestId,
  traceId,
  startedAt,
  effectivePayload,
  rawBody,
  requestCompression,
  buildUpstreamUrl
}) {
  const upstreamSummary = {
    attempts: 0,
    retries: 0,
    fallbacks: 0,
    selected_model: null,
    selected_provider: null,
    selected_status: null,
    reason_codes: []
  };

  const modelFromPayload = String(effectivePayload?.model ?? "");
  const primaryRoute = resolveModelRoute(modelFromPayload);
  const fallbackRoutes = getFallbackRoutes(primaryRoute, modelFromPayload);
  const candidateRoutes = [primaryRoute, ...fallbackRoutes];
  upstreamSummary.reason_codes.push(`route_${primaryRoute.reason}`);
  const maxRetries = Number.isFinite(UPSTREAM_MAX_RETRIES) ? Math.max(0, UPSTREAM_MAX_RETRIES) : 0;

  for (let routeIndex = 0; routeIndex < candidateRoutes.length; routeIndex += 1) {
    const selectedRoute = candidateRoutes[routeIndex];
    if (routeIndex > 0) {
      stats.upstream_fallback_count += 1;
      upstreamSummary.fallbacks += 1;
      upstreamSummary.reason_codes.push(`upstream_model_fallback_${selectedRoute.reason}`);
    }

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      stats.upstream_attempt_count += 1;
      upstreamSummary.attempts += 1;

      const modelPayload = selectedRoute.model && effectivePayload
        ? withModelOverride(effectivePayload, selectedRoute.model)
        : effectivePayload;
      const requestBuffer = modelPayload
        ? Buffer.from(JSON.stringify(modelPayload), "utf8")
        : rawBody;
      const requestText = requestBuffer.toString("utf8");

      let baseUpstreamHeaders;
      try {
        baseUpstreamHeaders = buildUpstreamAttemptHeaders(req, requestId, rawBody.byteLength, selectedRoute.provider);
      } catch {
        upstreamSummary.reason_codes.push(`missing_upstream_key_${selectedRoute.provider.id}`);
        break;
      }

      const upstreamUrl = buildUpstreamUrl(selectedRoute.provider);
      const upstreamHeaders = {
        ...baseUpstreamHeaders,
        "content-length": String(requestBuffer.byteLength)
      };

      const attemptController = new AbortController();
      const totalTimeout = setTimeout(() => {
        attemptController.abort(new Error("upstream_total_timeout"));
      }, UPSTREAM_TOTAL_TIMEOUT_MS);

      let upstreamRes;
      try {
        upstreamRes = await fetch(upstreamUrl, {
          method: "POST",
          headers: upstreamHeaders,
          body: requestText,
          signal: attemptController.signal
        });
      } catch (error) {
        clearTimeout(totalTimeout);
        const isAbort = error?.name === "AbortError";
        if (isAbort) {
          markUpstreamTimeout();
          upstreamSummary.reason_codes.push("upstream_total_timeout");
        } else {
          upstreamSummary.reason_codes.push("upstream_network_error");
        }

        const canRetry = attempt < maxRetries;
        if (canRetry) {
          stats.upstream_retry_count += 1;
          upstreamSummary.retries += 1;
          await sleep(UPSTREAM_RETRY_BACKOFF_MS * (attempt + 1));
          continue;
        }

        break;
      }

      const shouldRetryStatus = isRetriableUpstreamStatus(upstreamRes.status);
      const streamMode = isStreamRequested(modelPayload);

      if (!streamMode) {
        const responseBuffer = await readUpstreamBody(upstreamRes);
        clearTimeout(totalTimeout);

        if (shouldRetryStatus) {
          upstreamSummary.reason_codes.push(`upstream_retry_status_${upstreamRes.status}`);
          if (attempt < maxRetries) {
            stats.upstream_retry_count += 1;
            upstreamSummary.retries += 1;
            await sleep(UPSTREAM_RETRY_BACKOFF_MS * (attempt + 1));
            continue;
          }
          break;
        }

        upstreamSummary.selected_model = selectedRoute.model || modelFromPayload || null;
        upstreamSummary.selected_provider = selectedRoute.provider.id;
        upstreamSummary.selected_status = upstreamRes.status;
        res.statusCode = upstreamRes.status;
        copyUpstreamHeaders(upstreamRes, res);
        res.setHeader("x-proxy-request-id", requestId);
        res.end(responseBuffer);
        const durationMs = Date.now() - startedAt;
        const reductionPct =
          requestCompression.input_chars_before > 0
            ? Number(
                (
                  ((requestCompression.input_chars_before - requestCompression.input_chars_after) /
                    requestCompression.input_chars_before) *
                  100
                ).toFixed(2)
              )
            : 0;

        logEvent("info", "proxy.request.completed", {
          request_id: requestId,
          trace_id: traceId,
          method: req.method,
          path: req.url,
          status_code: upstreamRes.status,
          upstream_status_code: upstreamRes.status,
          duration_ms: durationMs,
          outcome: upstreamRes.status >= 400 ? "upstream_error" : "success",
          upstream: {
            attempts: upstreamSummary.attempts,
            retries: upstreamSummary.retries,
            fallbacks: upstreamSummary.fallbacks,
            selected_model: upstreamSummary.selected_model,
            selected_provider: upstreamSummary.selected_provider,
            selected_status: upstreamSummary.selected_status,
            reason_codes: Array.from(new Set(upstreamSummary.reason_codes))
          },
          compression: {
            enabled: ENABLE_COMPRESSION,
            attempted_count: requestCompression.attempted_count,
            applied_count: requestCompression.applied_count,
            fallback_count: requestCompression.fallback_count,
            skipped_count: requestCompression.skipped_count,
            reason_codes: Array.from(new Set(requestCompression.reason_codes)),
            model: TOKEN_COMPANY_MODEL,
            aggressiveness: TOKEN_COMPANY_AGGRESSIVENESS,
            input_chars_before: requestCompression.input_chars_before,
            input_chars_after: requestCompression.input_chars_after,
            reduction_pct: reductionPct
          }
        });
        return true;
      }

      if (shouldRetryStatus) {
        clearTimeout(totalTimeout);
        upstreamSummary.reason_codes.push(`upstream_retry_status_${upstreamRes.status}`);
        if (attempt < maxRetries) {
          stats.upstream_retry_count += 1;
          upstreamSummary.retries += 1;
          await sleep(UPSTREAM_RETRY_BACKOFF_MS * (attempt + 1));
          continue;
        }
        break;
      }

      const streamStart = await prepareStreamingStart(
        upstreamRes,
        UPSTREAM_STREAM_FIRST_CHUNK_TIMEOUT_MS,
        attemptController
      );
      if (streamStart.firstChunkTimeout) {
        clearTimeout(totalTimeout);
        markFirstChunkTimeout();
        upstreamSummary.reason_codes.push("upstream_first_chunk_timeout");
        if (attempt < maxRetries) {
          stats.upstream_retry_count += 1;
          upstreamSummary.retries += 1;
          await sleep(UPSTREAM_RETRY_BACKOFF_MS * (attempt + 1));
          continue;
        }
        break;
      }

      if (streamStart.error) {
        clearTimeout(totalTimeout);
        upstreamSummary.reason_codes.push("upstream_stream_start_failed");
        if (attempt < maxRetries) {
          stats.upstream_retry_count += 1;
          upstreamSummary.retries += 1;
          await sleep(UPSTREAM_RETRY_BACKOFF_MS * (attempt + 1));
          continue;
        }
        break;
      }

      res.statusCode = upstreamRes.status;
      copyUpstreamHeaders(upstreamRes, res);
      res.setHeader("x-proxy-request-id", requestId);

      let streamError = null;
      if (streamStart.firstChunk) {
        res.write(Buffer.from(streamStart.firstChunk));
      }

      if (!streamStart.done && streamStart.reader) {
        try {
          await streamRemainingChunks(streamStart.reader, res);
        } catch (error) {
          streamError = error;
          if (!res.destroyed) {
            res.destroy(error);
          }
        }
      }
      clearTimeout(totalTimeout);

      upstreamSummary.selected_model = selectedRoute.model || modelFromPayload || null;
      upstreamSummary.selected_provider = selectedRoute.provider.id;
      upstreamSummary.selected_status = upstreamRes.status;

      if (streamError) {
        upstreamSummary.reason_codes.push("stream_terminated_after_start");
      }

      if (!res.destroyed) {
        res.end();
      }

      const durationMs = Date.now() - startedAt;
      const reductionPct =
        requestCompression.input_chars_before > 0
          ? Number(
              (
                ((requestCompression.input_chars_before - requestCompression.input_chars_after) /
                  requestCompression.input_chars_before) *
                100
              ).toFixed(2)
            )
          : 0;

      logEvent("info", "proxy.request.completed", {
        request_id: requestId,
        trace_id: traceId,
        method: req.method,
        path: req.url,
        status_code: upstreamRes.status,
        upstream_status_code: upstreamRes.status,
        duration_ms: durationMs,
        outcome: streamError ? "stream_error" : "success",
        upstream: {
          attempts: upstreamSummary.attempts,
          retries: upstreamSummary.retries,
          fallbacks: upstreamSummary.fallbacks,
          selected_model: upstreamSummary.selected_model,
          selected_provider: upstreamSummary.selected_provider,
          selected_status: upstreamSummary.selected_status,
          reason_codes: Array.from(new Set(upstreamSummary.reason_codes))
        },
        compression: {
          enabled: ENABLE_COMPRESSION,
          attempted_count: requestCompression.attempted_count,
          applied_count: requestCompression.applied_count,
          fallback_count: requestCompression.fallback_count,
          skipped_count: requestCompression.skipped_count,
          reason_codes: Array.from(new Set(requestCompression.reason_codes)),
          model: TOKEN_COMPANY_MODEL,
          aggressiveness: TOKEN_COMPANY_AGGRESSIVENESS,
          input_chars_before: requestCompression.input_chars_before,
          input_chars_after: requestCompression.input_chars_after,
          reduction_pct: reductionPct
        }
      });
      return true;
    }
  }

  logEvent("error", "proxy.request.failed", {
    request_id: requestId,
    trace_id: traceId,
    method: req.method,
    path: req.url,
    status_code: 502,
    outcome: "upstream_retries_exhausted",
    upstream: {
      attempts: upstreamSummary.attempts,
      retries: upstreamSummary.retries,
      fallbacks: upstreamSummary.fallbacks,
      reason_codes: Array.from(new Set(upstreamSummary.reason_codes))
    }
  });
  sendJson(res, 502, openAiError("Upstream request failed after retries/fallbacks", "api_error", "upstream_unreachable"));
  return false;
}

async function handleChatCompletions(req, res) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const traceId = String(req.headers["x-trace-id"] ?? "");
  const requestCompression = createRequestCompressionState();
  stats.requests_total += 1;

  if (!isProxyAuthorized(req)) {
    logEvent("warn", "proxy.request.failed", {
      request_id: requestId,
      trace_id: traceId,
      method: req.method,
      path: req.url,
      status_code: 401,
      outcome: "unauthorized"
    });
    sendJson(res, 401, openAiError("Invalid proxy API key", "authentication_error", "invalid_api_key"));
    return;
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch {
    logEvent("warn", "proxy.request.failed", {
      request_id: requestId,
      trace_id: traceId,
      method: req.method,
      path: req.url,
      status_code: 400,
      outcome: "invalid_body"
    });
    sendJson(res, 400, openAiError("Failed to read request body", "invalid_request_error", "invalid_body"));
    return;
  }

  const incomingPayload = parseJsonBody(rawBody);
  let effectivePayload = incomingPayload;
  if (incomingPayload) {
    stats.requests_compression_eligible += 1;
    const compressionResult = await maybeCompressChatPayload(incomingPayload, requestCompression);
    if (compressionResult.changed) {
      effectivePayload = compressionResult.payload;
      rawBody = Buffer.from(JSON.stringify(effectivePayload), "utf8");
      stats.requests_compression_applied += 1;
    }
  }

  await proxyRoutedRequest({
    req,
    res,
    requestId,
    traceId,
    startedAt,
    effectivePayload,
    rawBody,
    requestCompression,
    buildUpstreamUrl: buildUpstreamChatCompletionsUrl
  });
}

async function handleResponses(req, res) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const traceId = String(req.headers["x-trace-id"] ?? "");
  const requestCompression = createRequestCompressionState();
  stats.requests_total += 1;

  if (!isProxyAuthorized(req)) {
    logEvent("warn", "proxy.request.failed", {
      request_id: requestId,
      trace_id: traceId,
      method: req.method,
      path: req.url,
      status_code: 401,
      outcome: "unauthorized"
    });
    sendJson(res, 401, openAiError("Invalid proxy API key", "authentication_error", "invalid_api_key"));
    return;
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch {
    logEvent("warn", "proxy.request.failed", {
      request_id: requestId,
      trace_id: traceId,
      method: req.method,
      path: req.url,
      status_code: 400,
      outcome: "invalid_body"
    });
    sendJson(res, 400, openAiError("Failed to read request body", "invalid_request_error", "invalid_body"));
    return;
  }

  const incomingPayload = parseJsonBody(rawBody);
  let effectivePayload = incomingPayload;
  if (incomingPayload) {
    stats.requests_compression_eligible += 1;
    const compressionResult = await maybeCompressResponsesPayload(incomingPayload, requestCompression);
    if (compressionResult.changed) {
      effectivePayload = compressionResult.payload;
      rawBody = Buffer.from(JSON.stringify(effectivePayload), "utf8");
      stats.requests_compression_applied += 1;
    }
  }

  await proxyRoutedRequest({
    req,
    res,
    requestId,
    traceId,
    startedAt,
    effectivePayload,
    rawBody,
    requestCompression,
    buildUpstreamUrl: buildUpstreamResponsesUrl
  });
}

async function handleEmbeddings(req, res) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const traceId = String(req.headers["x-trace-id"] ?? "");
  const requestCompression = createRequestCompressionState();
  stats.requests_total += 1;

  if (!isProxyAuthorized(req)) {
    logEvent("warn", "proxy.request.failed", {
      request_id: requestId,
      trace_id: traceId,
      method: req.method,
      path: req.url,
      status_code: 401,
      outcome: "unauthorized"
    });
    sendJson(res, 401, openAiError("Invalid proxy API key", "authentication_error", "invalid_api_key"));
    return;
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch {
    logEvent("warn", "proxy.request.failed", {
      request_id: requestId,
      trace_id: traceId,
      method: req.method,
      path: req.url,
      status_code: 400,
      outcome: "invalid_body"
    });
    sendJson(res, 400, openAiError("Failed to read request body", "invalid_request_error", "invalid_body"));
    return;
  }

  const incomingPayload = parseJsonBody(rawBody);
  let effectivePayload = incomingPayload;
  if (incomingPayload) {
    if (ENABLE_EMBEDDINGS_COMPRESSION) {
      stats.requests_compression_eligible += 1;
    }
    const compressionResult = await maybeCompressEmbeddingsPayload(incomingPayload, requestCompression);
    if (compressionResult.changed) {
      effectivePayload = compressionResult.payload;
      rawBody = Buffer.from(JSON.stringify(effectivePayload), "utf8");
      stats.requests_compression_applied += 1;
    }
  }

  await proxyRoutedRequest({
    req,
    res,
    requestId,
    traceId,
    startedAt,
    effectivePayload,
    rawBody,
    requestCompression,
    buildUpstreamUrl: buildUpstreamEmbeddingsUrl
  });
}

function buildUpstreamChatCompletionsUrl(providerConfig) {
  const base = providerConfig.baseURL;
  if (base.endsWith("/v1")) {
    return `${base}/chat/completions`;
  }
  return `${base}/v1/chat/completions`;
}

function buildUpstreamModelsUrl(providerConfig) {
  const base = providerConfig.baseURL;
  if (base.endsWith("/v1")) {
    return `${base}/models`;
  }
  return `${base}/v1/models`;
}

function buildUpstreamResponsesUrl(providerConfig) {
  const base = providerConfig.baseURL;
  if (base.endsWith("/v1")) {
    return `${base}/responses`;
  }
  return `${base}/v1/responses`;
}

function buildUpstreamEmbeddingsUrl(providerConfig) {
  const base = providerConfig.baseURL;
  if (base.endsWith("/v1")) {
    return `${base}/embeddings`;
  }
  return `${base}/v1/embeddings`;
}

function normalizeModelEntry(rawModel, aliasMap) {
  if (!rawModel || typeof rawModel !== "object") return null;
  const id = String(rawModel.id ?? "").trim();
  if (!id) return null;
  return {
    id,
    object: "model",
    created: Number.isInteger(rawModel.created) ? rawModel.created : Math.floor(Date.now() / 1000),
    owned_by: String(rawModel.owned_by ?? "proxy"),
    name: aliasMap[id] ? String(aliasMap[id]) : undefined
  };
}

function applyModelFilters(models) {
  return models.filter((model) => {
    if (MODELS_ALLOWLIST.size > 0 && !MODELS_ALLOWLIST.has(model.id)) {
      return false;
    }
    if (MODELS_DENYLIST.has(model.id)) {
      return false;
    }
    return true;
  });
}

function toOpenAiModelsPayload(models) {
  return {
    object: "list",
    data: models.map((model) => {
      const out = {
        id: model.id,
        object: "model",
        created: model.created,
        owned_by: model.owned_by
      };
      if (model.name) {
        out.name = model.name;
      }
      return out;
    })
  };
}

async function fetchModelsFromProvider(req, requestId, providerConfig) {
  const headers = buildUpstreamGetHeaders(req, requestId, providerConfig);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("models_timeout")), UPSTREAM_TOTAL_TIMEOUT_MS);
  try {
    const response = await fetch(buildUpstreamModelsUrl(providerConfig), {
      method: "GET",
      headers,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`models_http_${response.status}`);
    }

    const payload = await response.json();
    if (!payload || !Array.isArray(payload.data)) {
      throw new Error("models_bad_payload");
    }

    return payload.data;
  } finally {
    clearTimeout(timeout);
  }
}

async function buildModelsCatalog(req, requestId) {
  if (MODELS_SOURCE_MODE === "static") {
    const staticModels = STATIC_MODELS.map((model) => normalizeModelEntry(model, MODEL_ALIASES)).filter(Boolean);
    return toOpenAiModelsPayload(applyModelFilters(staticModels));
  }

  if (MODELS_SOURCE_MODE === "passthrough") {
    const provider = PROVIDER_REGISTRY.get(MODEL_DEFAULT_PROVIDER) ?? PROVIDER_REGISTRY.get("default");
    const models = await fetchModelsFromProvider(req, requestId, provider);
    const normalized = models.map((model) => normalizeModelEntry(model, MODEL_ALIASES)).filter(Boolean);
    return toOpenAiModelsPayload(applyModelFilters(normalized));
  }

  const allModels = [];
  for (const provider of PROVIDER_REGISTRY.values()) {
    try {
      const providerModels = await fetchModelsFromProvider(req, requestId, provider);
      for (const model of providerModels) {
        const normalized = normalizeModelEntry(model, MODEL_ALIASES);
        if (!normalized) continue;
        allModels.push({ ...normalized, owned_by: provider.id });
      }
    } catch {
      stats.models_aggregate_error_count += 1;
      logEvent("warn", "proxy.models.provider_fetch_failed", {
        request_id: requestId,
        provider: provider.id
      });
    }
  }

  const deduped = new Map();
  for (const model of allModels) {
    if (!deduped.has(model.id)) {
      deduped.set(model.id, model);
    }
  }

  return toOpenAiModelsPayload(applyModelFilters(Array.from(deduped.values())));
}

async function handleModels(req, res) {
  const requestId = randomUUID();
  const now = Date.now();
  if (modelCatalogCache.payload && modelCatalogCache.expiresAt > now) {
    stats.models_cache_hit_count += 1;
    sendJson(res, 200, modelCatalogCache.payload);
    return;
  }

  stats.models_cache_miss_count += 1;
  try {
    const payload = await buildModelsCatalog(req, requestId);
    modelCatalogCache.payload = payload;
    modelCatalogCache.expiresAt = now + Math.max(0, MODELS_CACHE_TTL_MS);
    sendJson(res, 200, payload);
  } catch (error) {
    logEvent("error", "proxy.models.failed", {
      request_id: requestId,
      reason: String(error?.message ?? "models_failed")
    });
    sendJson(res, 502, openAiError("Failed to fetch model catalog", "api_error", "models_unavailable"));
  }
}

function getFilteredLogs(urlObj) {
  const level = String(urlObj.searchParams.get("level") ?? "").toLowerCase();
  const requestId = String(urlObj.searchParams.get("request_id") ?? "");
  const since = String(urlObj.searchParams.get("since") ?? "");
  const limitRaw = Number.parseInt(urlObj.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

  let filtered = [...logBuffer];
  if (level) {
    filtered = filtered.filter((event) => String(event.level) === level);
  }
  if (requestId) {
    filtered = filtered.filter((event) => String(event.request_id ?? "") === requestId);
  }
  if (since) {
    const sinceTs = Date.parse(since);
    if (!Number.isNaN(sinceTs)) {
      filtered = filtered.filter((event) => {
        const ts = Date.parse(String(event.timestamp ?? ""));
        return Number.isFinite(ts) && ts >= sinceTs;
      });
    }
  }
  return filtered.slice(-limit);
}

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendJson(res, 400, openAiError("Invalid request", "invalid_request_error", "bad_request"));
    return;
  }

  const urlObj = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const path = urlObj.pathname;

  if (req.method === "GET" && path === "/healthz") {
    sendJson(res, 200, {
      ok: true,
      service: "token-company-proxy",
      milestone: 4
    });
    return;
  }

  if (req.method === "GET" && path === "/v1/models") {
    if (!isProxyAuthorized(req)) {
      sendJson(res, 401, openAiError("Invalid proxy API key", "authentication_error", "invalid_api_key"));
      return;
    }
    await handleModels(req, res);
    return;
  }

  if (req.method === "GET" && path === "/stats") {
    sendJson(res, 200, {
      ...stats,
      compression_enabled: ENABLE_COMPRESSION,
      token_company_configured: Boolean(TOKEN_COMPANY_API_KEY),
      compression_roles: Array.from(COMPRESS_ROLES),
      upstream_retries_enabled: UPSTREAM_MAX_RETRIES > 0,
      upstream_retry_status_codes: Array.from(UPSTREAM_RETRY_STATUS_CODES).sort((a, b) => a - b),
      upstream_fallback_rules: Object.fromEntries(UPSTREAM_FALLBACKS.entries()),
      configured_providers: Array.from(PROVIDER_REGISTRY.keys()),
      model_default_provider: MODEL_DEFAULT_PROVIDER,
      model_route_rules_count: MODEL_ROUTE_RULES.length,
      model_fallback_rules: Object.fromEntries(MODEL_FALLBACK_RULES.entries()),
      models_source_mode: MODELS_SOURCE_MODE,
      models_cache_ttl_ms: MODELS_CACHE_TTL_MS,
      models_allowlist_count: MODELS_ALLOWLIST.size,
      models_denylist_count: MODELS_DENYLIST.size
    });
    return;
  }

  if (req.method === "GET" && path === "/debug/logs") {
    if (!LOG_LOCAL_ENDPOINT) {
      sendJson(res, 404, openAiError("Endpoint not found", "invalid_request_error", "not_found"));
      return;
    }

    if (!isProxyAuthorized(req)) {
      sendJson(res, 401, openAiError("Invalid proxy API key", "authentication_error", "invalid_api_key"));
      return;
    }

    const events = getFilteredLogs(urlObj);
    sendJson(res, 200, {
      total: logBuffer.length,
      returned: events.length,
      events
    });
    return;
  }

  if (req.method === "POST" && path === "/v1/chat/completions") {
    await handleChatCompletions(req, res);
    return;
  }

  if (req.method === "POST" && path === "/v1/responses") {
    await handleResponses(req, res);
    return;
  }

  if (req.method === "POST" && path === "/v1/embeddings") {
    await handleEmbeddings(req, res);
    return;
  }

  sendJson(res, 404, openAiError("Endpoint not found", "invalid_request_error", "not_found"));
});

if (PROVIDER_CONFIG_STRICT && PROVIDER_REGISTRY_VALIDATION.errors.length > 0) {
  throw new Error(`Provider config validation failed: ${PROVIDER_REGISTRY_VALIDATION.errors.join(" | ")}`);
}

server.listen(PORT, () => {
  logEvent("info", "proxy.server.started", {
    listen_url: `http://localhost:${PORT}`,
    upstream_base_url: UPSTREAM_BASE_URL,
    proxy_auth_required: Boolean(PROXY_API_KEY),
    local_test_mode: LOCAL_TEST_MODE,
    compression_enabled: ENABLE_COMPRESSION,
    upstream_max_retries: UPSTREAM_MAX_RETRIES,
    upstream_stream_first_chunk_timeout_ms: UPSTREAM_STREAM_FIRST_CHUNK_TIMEOUT_MS,
    upstream_total_timeout_ms: UPSTREAM_TOTAL_TIMEOUT_MS,
    configured_providers: Array.from(PROVIDER_REGISTRY.keys()),
    model_route_rules_count: MODEL_ROUTE_RULES.length,
    model_default_provider: MODEL_DEFAULT_PROVIDER,
    models_source_mode: MODELS_SOURCE_MODE,
    models_cache_ttl_ms: MODELS_CACHE_TTL_MS,
    provider_validation_warnings: PROVIDER_REGISTRY_VALIDATION.warnings,
    provider_validation_errors: PROVIDER_REGISTRY_VALIDATION.errors,
    log_level: LOG_LEVEL,
    log_local_endpoint_enabled: LOG_LOCAL_ENDPOINT
  });

  for (const warning of PROVIDER_REGISTRY_VALIDATION.warnings) {
    logEvent("warn", "proxy.provider.validation_warning", { message: warning });
  }
  for (const error of PROVIDER_REGISTRY_VALIDATION.errors) {
    logEvent("error", "proxy.provider.validation_error", { message: error });
  }
});
