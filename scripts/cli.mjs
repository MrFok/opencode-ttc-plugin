#!/usr/bin/env node

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_FILENAME = "ttc-message-transform.js";
const AUTH_PROVIDER_ID = "the-token-company-plugin";
const DEFAULT_AGGRESSIVENESS = 0.1;
const COMPRESSION_LEVELS = {
  low: 0.05,
  balanced: 0.1,
  high: 0.2,
  max: 0.3
};

const DEFAULT_BEHAVIOR_SETTINGS = {
  enabled: true,
  model: "bear-1.2",
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

const BEHAVIOR_ENV_KEYS = {
  enabled: "TTC_ENABLED",
  model: "TTC_MODEL",
  minChars: "TTC_MIN_CHARS",
  timeoutMs: "TTC_TIMEOUT_MS",
  maxRetries: "TTC_MAX_RETRIES",
  retryBackoffMs: "TTC_RETRY_BACKOFF_MS",
  useGzip: "TTC_USE_GZIP",
  compressSystem: "TTC_COMPRESS_SYSTEM",
  compressHistory: "TTC_COMPRESS_HISTORY",
  debug: "TTC_DEBUG",
  cacheMaxEntries: "TTC_CACHE_MAX_ENTRIES",
  toastOnActive: "TTC_TOAST_ON_ACTIVE",
  toastOnIdleSummary: "TTC_TOAST_ON_IDLE_SUMMARY"
};

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(currentFile), "..");
const sourcePluginPath = resolve(repoRoot, "opencode-plugins", PLUGIN_FILENAME);
const pluginsDir = resolve(homedir(), ".config", "opencode", "plugins");
const installedPluginPath = resolve(pluginsDir, PLUGIN_FILENAME);

function getAuthStorePath() {
  const xdgDataHome = String(process.env.XDG_DATA_HOME ?? "").trim();
  const dataHome = xdgDataHome || resolve(homedir(), ".local", "share");
  return resolve(dataHome, "opencode", "auth.json");
}

function getPluginConfigPath() {
  const xdgConfigHome = String(process.env.XDG_CONFIG_HOME ?? "").trim();
  const configHome = xdgConfigHome || resolve(homedir(), ".config");
  return resolve(configHome, "opencode", "ttc-plugin.json");
}

function normalizeCompressionLevel(level) {
  const normalized = String(level ?? "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(COMPRESSION_LEVELS, normalized) ? normalized : "";
}

function parseAggressiveness(value) {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0 || parsed > 1) return null;
  return parsed;
}

function parseBoolean(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return null;
}

function parseInteger(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function hasEnvValue(rawValue) {
  if (rawValue === undefined || rawValue === null) return false;
  return String(rawValue).trim() !== "";
}

function readPluginSettings() {
  const configPath = getPluginConfigPath();
  if (!existsSync(configPath)) {
    return { path: configPath, settings: {} };
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return { path: configPath, settings: {} };
    }
    return { path: configPath, settings: parsed };
  } catch {
    return { path: configPath, settings: {} };
  }
}

function writePluginSettings(settings) {
  const configPath = getPluginConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return configPath;
}

function resolveCompressionFromSources(settings) {
  if (hasEnvValue(process.env.TTC_AGGRESSIVENESS)) {
    const envAgg = parseAggressiveness(process.env.TTC_AGGRESSIVENESS);
    return {
      aggressiveness: envAgg ?? DEFAULT_AGGRESSIVENESS,
      source: "env",
      level: ""
    };
  }

  const fileAgg = parseAggressiveness(settings?.aggressiveness);
  if (fileAgg !== null) {
    return {
      aggressiveness: fileAgg,
      source: "plugin-config",
      level: ""
    };
  }

  const fileLevel = normalizeCompressionLevel(settings?.compressionLevel);
  if (fileLevel) {
    return {
      aggressiveness: COMPRESSION_LEVELS[fileLevel],
      source: "plugin-config",
      level: fileLevel
    };
  }

  return {
    aggressiveness: DEFAULT_AGGRESSIVENESS,
    source: "default",
    level: "balanced"
  };
}

function resolveBehaviorFromSources(settings) {
  const parseBySetting = {
    enabled: parseBoolean,
    model: (value) => {
      const parsed = String(value ?? "").trim();
      return parsed || null;
    },
    minChars: parseInteger,
    timeoutMs: parseInteger,
    maxRetries: parseInteger,
    retryBackoffMs: parseInteger,
    useGzip: parseBoolean,
    compressSystem: parseBoolean,
    compressHistory: parseBoolean,
    debug: parseBoolean,
    cacheMaxEntries: parseInteger,
    toastOnActive: parseBoolean,
    toastOnIdleSummary: parseBoolean
  };

  const resolved = {};
  for (const [settingKey, defaultValue] of Object.entries(DEFAULT_BEHAVIOR_SETTINGS)) {
    const envKey = BEHAVIOR_ENV_KEYS[settingKey];
    const envRawValue = process.env[envKey];
    const parse = parseBySetting[settingKey];

    if (hasEnvValue(envRawValue)) {
      const parsed = parse(envRawValue);
      resolved[settingKey] = {
        value: parsed === null ? defaultValue : parsed,
        source: "env"
      };
      continue;
    }

    const settingRawValue = settings?.[settingKey];
    if (settingRawValue !== undefined && settingRawValue !== null && String(settingRawValue).trim() !== "") {
      const parsed = parse(settingRawValue);
      resolved[settingKey] = {
        value: parsed === null ? defaultValue : parsed,
        source: "plugin-config"
      };
      continue;
    }

    resolved[settingKey] = {
      value: defaultValue,
      source: "default"
    };
  }

  return resolved;
}

function hasAuthStoreKey() {
  const authPath = getAuthStorePath();
  if (!existsSync(authPath)) {
    return { hasKey: false, path: authPath };
  }

  try {
    const parsed = JSON.parse(readFileSync(authPath, "utf8"));
    const auth = parsed?.[AUTH_PROVIDER_ID];
    const hasKey = Boolean(auth && auth.type === "api" && String(auth.key ?? "").trim());
    return { hasKey, path: authPath };
  } catch {
    return { hasKey: false, path: authPath };
  }
}

function printUsage() {
  console.log("Usage: opencode-ttc-plugin <install|doctor|uninstall|config>");
  console.log("       opencode-ttc-plugin doctor [--verbose]");
  console.log("       opencode-ttc-plugin config get");
  console.log("       opencode-ttc-plugin config set level <low|balanced|high|max>");
  console.log("       opencode-ttc-plugin config set aggressiveness <0..1>");
  console.log("       opencode-ttc-plugin config set <setting> <value>");
  console.log("       opencode-ttc-plugin config reset");
}

function detectCommand(argv, scriptName) {
  const explicit = argv[2];
  if (explicit) return explicit;
  if (scriptName.endsWith("-install")) return "install";
  if (scriptName.endsWith("-doctor")) return "doctor";
  if (scriptName.endsWith("-uninstall")) return "uninstall";
  return "";
}

function install() {
  if (!existsSync(sourcePluginPath)) {
    throw new Error(`Missing source plugin at ${sourcePluginPath}`);
  }

  mkdirSync(pluginsDir, { recursive: true });
  copyFileSync(sourcePluginPath, installedPluginPath);
  chmodSync(installedPluginPath, 0o644);

  console.log(`Installed ${PLUGIN_FILENAME} to ${installedPluginPath}`);
}

function doctor(options = { verbose: false }) {
  const authStore = hasAuthStoreKey();
  const { path: configPath, settings } = readPluginSettings();
  const compression = resolveCompressionFromSources(settings);
  const behavior = resolveBehaviorFromSources(settings);
  const envHasKey = Boolean(process.env.TTC_API_KEY);
  const authSource = envHasKey ? "env" : authStore.hasKey ? "auth-store" : "missing";
  const hasUsableAuth = authSource !== "missing";
  const checks = [
    { label: "source plugin", ok: existsSync(sourcePluginPath), value: sourcePluginPath },
    { label: "plugins dir", ok: existsSync(pluginsDir), value: pluginsDir },
    { label: "installed plugin", ok: existsSync(installedPluginPath), value: installedPluginPath },
    { label: "TTC_API_KEY env (optional override)", ok: true, value: envHasKey ? "set" : "missing" },
    {
      label: `auth store (${AUTH_PROVIDER_ID})`,
      ok: true,
      value: authStore.hasKey ? `set (${authStore.path})` : `missing (${authStore.path})`
    },
    { label: "effective auth source", ok: hasUsableAuth, value: authSource },
    {
      label: "effective aggressiveness",
      ok: true,
      value: `${compression.aggressiveness} (${compression.source}${compression.level ? `:${compression.level}` : ""})`
    },
    {
      label: "effective min chars",
      ok: true,
      value: `${behavior.minChars.value} (${behavior.minChars.source})`
    },
    {
      label: "effective timeout ms",
      ok: true,
      value: `${behavior.timeoutMs.value} (${behavior.timeoutMs.source})`
    }
  ];

  let hasFailure = false;
  for (const check of checks) {
    const status = check.ok ? "OK" : "MISSING";
    console.log(`[${status}] ${check.label}: ${check.value}`);
    if (!check.ok) hasFailure = true;
  }

  if (hasFailure) {
    process.exitCode = 1;
  }

  if (options.verbose) {
    console.log(`[INFO] plugin config path: ${configPath}`);
    console.log(`[INFO] plugin config keys: ${Object.keys(settings).sort().join(",") || "none"}`);
    console.log(`[INFO] resolution order: env -> plugin-config -> default`);
    for (const key of Object.keys(DEFAULT_BEHAVIOR_SETTINGS)) {
      const entry = behavior[key];
      console.log(`[INFO] effective ${key}: ${entry.value} (${entry.source})`);
    }
  }
}

function configGet() {
  const { path: configPath, settings } = readPluginSettings();
  const compression = resolveCompressionFromSources(settings);
  const behavior = resolveBehaviorFromSources(settings);
  console.log(`Config path: ${configPath}`);
  console.log(JSON.stringify(settings, null, 2));
  console.log(`Effective aggressiveness: ${compression.aggressiveness} (${compression.source}${compression.level ? `:${compression.level}` : ""})`);
  for (const key of Object.keys(DEFAULT_BEHAVIOR_SETTINGS)) {
    const entry = behavior[key];
    console.log(`Effective ${key}: ${entry.value} (${entry.source})`);
  }
}

function configSetLevel(level) {
  const normalizedLevel = normalizeCompressionLevel(level);
  if (!normalizedLevel) {
    console.error("Invalid compression level. Use one of: low, balanced, high, max");
    process.exitCode = 1;
    return;
  }

  const { settings } = readPluginSettings();
  delete settings.aggressiveness;
  settings.compressionLevel = normalizedLevel;
  const configPath = writePluginSettings(settings);
  console.log(`Saved compressionLevel=${normalizedLevel} at ${configPath}`);
}

function configSetAggressiveness(value) {
  const parsed = parseAggressiveness(value);
  if (parsed === null) {
    console.error("Invalid aggressiveness. Use a number from 0 to 1 (eg. 0.1)");
    process.exitCode = 1;
    return;
  }

  const { settings } = readPluginSettings();
  delete settings.compressionLevel;
  settings.aggressiveness = parsed;
  const configPath = writePluginSettings(settings);
  console.log(`Saved aggressiveness=${parsed} at ${configPath}`);
}

const CONFIG_SETTERS = {
  enabled: { settingKey: "enabled", parse: parseBoolean, usage: "true|false" },
  model: {
    settingKey: "model",
    parse: (value) => {
      const parsed = String(value ?? "").trim();
      return parsed || null;
    },
    usage: "<model-id>"
  },
  "min-chars": { settingKey: "minChars", parse: parseInteger, usage: "<int>" },
  "timeout-ms": { settingKey: "timeoutMs", parse: parseInteger, usage: "<int>" },
  "max-retries": { settingKey: "maxRetries", parse: parseInteger, usage: "<int>" },
  "retry-backoff-ms": { settingKey: "retryBackoffMs", parse: parseInteger, usage: "<int>" },
  "use-gzip": { settingKey: "useGzip", parse: parseBoolean, usage: "true|false" },
  "compress-system": { settingKey: "compressSystem", parse: parseBoolean, usage: "true|false" },
  "compress-history": { settingKey: "compressHistory", parse: parseBoolean, usage: "true|false" },
  debug: { settingKey: "debug", parse: parseBoolean, usage: "true|false" },
  "cache-max-entries": { settingKey: "cacheMaxEntries", parse: parseInteger, usage: "<int>" },
  "toast-on-active": { settingKey: "toastOnActive", parse: parseBoolean, usage: "true|false" },
  "toast-on-idle-summary": { settingKey: "toastOnIdleSummary", parse: parseBoolean, usage: "true|false" }
};

function configSetBehaviorSetting(key, value) {
  const descriptor = CONFIG_SETTERS[key];
  if (!descriptor) {
    return false;
  }

  const parsed = descriptor.parse(value);
  if (parsed === null) {
    console.error(`Invalid value for ${key}. Expected ${descriptor.usage}`);
    process.exitCode = 1;
    return true;
  }

  const { settings } = readPluginSettings();
  settings[descriptor.settingKey] = parsed;
  const configPath = writePluginSettings(settings);
  console.log(`Saved ${descriptor.settingKey}=${parsed} at ${configPath}`);
  return true;
}

function configReset() {
  const configPath = getPluginConfigPath();
  if (!existsSync(configPath)) {
    console.log(`Nothing to reset at ${configPath}`);
    return;
  }
  rmSync(configPath);
  console.log(`Removed ${configPath}`);
}

function configCommand(args) {
  const subcommand = args[0] ?? "";
  if (subcommand === "get") {
    configGet();
    return;
  }

  if (subcommand === "set") {
    const key = args[1] ?? "";
    const value = args[2] ?? "";
    if (key === "level") {
      configSetLevel(value);
      return;
    }
    if (key === "aggressiveness") {
      configSetAggressiveness(value);
      return;
    }
    if (configSetBehaviorSetting(key, value)) return;
    console.error(`Invalid config set usage. Supported settings: ${Object.keys(CONFIG_SETTERS).join(", ")}`);
    return;
  }

  if (subcommand === "reset") {
    configReset();
    return;
  }

  console.error("Invalid config command. Use: get, set, or reset");
  process.exitCode = 1;
}

function uninstall() {
  if (!existsSync(installedPluginPath)) {
    console.log(`Nothing to uninstall at ${installedPluginPath}`);
    return;
  }

  rmSync(installedPluginPath);
  console.log(`Removed ${installedPluginPath}`);
}

function main() {
  const scriptName = basename(process.argv[1] ?? "");
  const command = detectCommand(process.argv, scriptName);
  const args = process.argv.slice(3);

  if (command === "install") {
    install();
    return;
  }

  if (command === "doctor") {
    doctor({ verbose: process.argv.includes("--verbose") });
    return;
  }

  if (command === "uninstall") {
    uninstall();
    return;
  }

  if (command === "config") {
    configCommand(args);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main();
