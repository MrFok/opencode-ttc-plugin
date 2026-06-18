#!/usr/bin/env node

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { Writable } from "node:stream";
import {
  AUTH_PROVIDER_ID,
  LEGACY_AUTH_PROVIDER_IDS,
  getAuthStorePath,
  hasAuthEntry,
  writeAuthEntry,
  removeAuthEntry
} from "../lib/auth-store.js";

const PLUGIN_FILENAME = "ttc-message-transform.js";
const DEFAULT_AGGRESSIVENESS = 0.1;
const KNOWN_MODELS = [
  { id: "bear-2", description: "Most accurate compression. Recommended per TTC docs." },
  { id: "bear-1.2", description: "Faster compression. Lower latency per request." }
];
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
  toastOnActive: false,
  toastOnIdleSummary: false
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
const packageJsonPath = resolve(repoRoot, "package.json");
const tuiEntrypointPath = resolve(repoRoot, "tui", "index.tsx");
const pluginsDir = resolve(homedir(), ".config", "opencode", "plugins");
const installedPluginPath = resolve(pluginsDir, PLUGIN_FILENAME);

function getPluginConfigPath() {
  const xdgConfigHome = String(process.env.XDG_CONFIG_HOME ?? "").trim();
  const configHome = xdgConfigHome || resolve(homedir(), ".config");
  return resolve(configHome, "opencode", "ttc-plugin.json");
}

function getSidebarStateDir() {
  const xdgStateHome = String(process.env.XDG_STATE_HOME ?? "").trim();
  const stateHome = xdgStateHome || resolve(homedir(), ".local", "state");
  return resolve(stateHome, "opencode", "ttc-plugin");
}

function readPackageJson() {
  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch {
    return {};
  }
}

function hasPluginTarget(packageJson, target) {
  return Array.isArray(packageJson?.["oc-plugin"]) && packageJson["oc-plugin"].some((entry) => {
    if (entry === target) return true;
    return Array.isArray(entry) && entry[0] === target;
  });
}

function checkStateDirWritable() {
  const stateDir = getSidebarStateDir();
  const status = existsSync(stateDir) ? "exists" : "created at runtime";
  return { ok: true, path: `${stateDir} (${status})` };
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
  const entry = hasAuthEntrySync(authPath);
  return { hasKey: Boolean(entry), path: authPath, providerID: entry?.providerID ?? null };
}

function hasAuthEntrySync(authPath) {
  try {
    const raw = readFileSync(authPath, "utf8");
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) return null;
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    for (const candidateID of [AUTH_PROVIDER_ID, ...LEGACY_AUTH_PROVIDER_IDS]) {
      const auth = parsed[candidateID];
      if (auth && auth.type === "api" && String(auth.key ?? "").trim()) {
        return { providerID: candidateID, key: String(auth.key).trim() };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function printUsage() {
  console.log("Usage: opencode-ttc-plugin <install|doctor|uninstall|config|login|logout>");
  console.log("       opencode-ttc-plugin doctor [--verbose]");
  console.log("       opencode-ttc-plugin config get");
  console.log("       opencode-ttc-plugin config set level <low|balanced|high|max>");
  console.log("       opencode-ttc-plugin config set aggressiveness <0..1>");
  console.log("       opencode-ttc-plugin config set <setting> <value>");
  console.log("       opencode-ttc-plugin config reset");
  console.log("       opencode-ttc-plugin login [--stdin]    (key from stdin, no echo)");
  console.log("       opencode-ttc-plugin logout");
}

function promptSecret(query) {
  return new Promise((onResolve) => {
    const input = process.stdin;
    const realOutput = process.stdout;
    if (!input.isTTY) {
      onResolve("");
      return;
    }
    realOutput.write(query);
    const mutedOutput = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      }
    });
    const rl = readline.createInterface({
      input,
      output: mutedOutput,
      terminal: true,
      prompt: ""
    });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { rl.close(); } catch { /* ignore */ }
      realOutput.write("\n");
      onResolve(value);
    };
    rl.question("", (answer) => {
      finish(String(answer ?? "").replace(/\r?\n$/, ""));
    });
    rl.on("SIGINT", () => finish(""));
  });
}

async function readStdinSecret() {
  let data = "";
  for await (const chunk of process.stdin) {
    data += String(chunk);
  }
  return data.replace(/\r?\n$/, "").trim();
}

async function persistKey(apiKey) {
  if (!apiKey) {
    console.error("Login cancelled: no key entered.");
    process.exitCode = 1;
    return;
  }
  const result = await writeAuthEntry({ apiKey });
  if (!result.ok) {
    console.error(`Login failed: ${result.reason}${result.error ? ` (${result.error.message})` : ""}`);
    if (result.reason === "auth_store_corrupt") {
      console.error(`Refusing to overwrite corrupt auth store at ${result.authFilePath}. Back it up and remove it manually.`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Saved TTC API key under '${result.providerID}' at ${result.authFilePath}`);
  if (result.removedLegacyIDs?.length) {
    console.log(`Removed stale legacy entries: ${result.removedLegacyIDs.join(", ")}`);
  }
  console.log("Restart opencode for sessions to pick up the new key.");
}

async function loginCommand(args) {
  const useStdin = args.includes("--stdin");
  if (useStdin) {
    if (process.stdin.isTTY) {
      console.error('Login --stdin requires the key to be piped (e.g. printf %s "$KEY" | opencode-ttc-plugin login --stdin).');
      process.exitCode = 1;
      return;
    }
    const apiKey = await readStdinSecret();
    await persistKey(apiKey);
    return;
  }

  if (process.stdin.isTTY) {
    const apiKey = await promptSecret("Enter TTC API key (from thetokencompany.com): ");
    await persistKey(apiKey);
    return;
  }

  console.error('Login requires --stdin when stdin is not a TTY (e.g. printf %s "$KEY" | opencode-ttc-plugin login --stdin).');
  process.exitCode = 1;
}

async function logoutCommand() {
  const result = await removeAuthEntry();
  if (!result.ok) {
    console.error(`Logout failed: ${result.reason}${result.error ? ` (${result.error.message})` : ""}`);
    process.exitCode = 1;
    return;
  }
  if (!result.removedAny) {
    console.log(`No TTC auth entry found at ${result.authFilePath}`);
    return;
  }
  console.log(`Removed TTC auth entries at ${result.authFilePath}`);
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
  const packageJson = readPackageJson();
  const stateDir = checkStateDirWritable();
  const compression = resolveCompressionFromSources(settings);
  const behavior = resolveBehaviorFromSources(settings);
  const envHasKey = Boolean(process.env.TTC_API_KEY);
  const authSource = envHasKey ? "env" : authStore.hasKey ? "auth-store" : "missing";
  const hasUsableAuth = authSource !== "missing";
  const checks = [
    { label: "source plugin", ok: existsSync(sourcePluginPath), value: sourcePluginPath },
    { label: "TUI entrypoint", ok: existsSync(tuiEntrypointPath), value: tuiEntrypointPath },
    {
      label: "OpenCode plugin targets",
      ok: hasPluginTarget(packageJson, "server") && hasPluginTarget(packageJson, "tui"),
      value: JSON.stringify(packageJson["oc-plugin"] ?? [])
    },
    { label: "plugins dir", ok: existsSync(pluginsDir), value: pluginsDir },
    { label: "installed plugin", ok: existsSync(installedPluginPath), value: installedPluginPath },
    { label: "sidebar state dir", ok: stateDir.ok, value: stateDir.path },
    { label: "TTC_API_KEY env (optional override)", ok: true, value: envHasKey ? "set" : "missing" },
    {
      label: `auth store (${AUTH_PROVIDER_ID})`,
      ok: true,
      value: authStore.hasKey
        ? `set under '${authStore.providerID}' (${authStore.path})`
        : `missing (${authStore.path})`
    },
    {
      label: "known TTC models",
      ok: true,
      value: KNOWN_MODELS.map((model) => model.id).join(", ")
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

async function main() {
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

  if (command === "login") {
    await loginCommand(args);
    return;
  }

  if (command === "logout") {
    await logoutCommand();
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main();
