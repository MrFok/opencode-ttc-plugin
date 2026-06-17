import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  AUTH_PROVIDER_ID,
  LEGACY_AUTH_PROVIDER_IDS,
  getAuthStorePath,
  hasAuthEntry,
  writeAuthEntry,
  removeAuthEntry
} from "../lib/auth-store.js";

export const TTC_SETTINGS_COMMAND_VALUE = "ttc.settings";
export const TTC_SETTINGS_COMMAND_TITLE = "Token Compression: Settings";
export const TTC_LOGIN_COMMAND_VALUE = "ttc.login";
export const TTC_LOGIN_COMMAND_TITLE = "Token Compression: Login";
export const TTC_LOGOUT_COMMAND_VALUE = "ttc.logout";
export const TTC_LOGOUT_COMMAND_TITLE = "Token Compression: Logout";

export const COMPRESSION_LEVELS = {
  low: 0.05,
  balanced: 0.1,
  high: 0.2,
  max: 0.3
};

export { AUTH_PROVIDER_ID, LEGACY_AUTH_PROVIDER_IDS };

export const KNOWN_MODELS = [
  { id: "bear-2", label: "bear-2 (Recommended)", description: "Most accurate compression. Best quality preservation." },
  { id: "bear-1.2", label: "bear-1.2", description: "Faster compression. Lower latency per request." }
];

const DEFAULT_SETTINGS = {
  enabled: true,
  compressionLevel: "balanced",
  aggressiveness: 0.1,
  minChars: 400,
  model: "bear-1.2"
};

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function getTtcSettingsConfigPath(env = process.env) {
  const xdgConfigHome = String(env.XDG_CONFIG_HOME ?? "").trim();
  const configHome = xdgConfigHome || join(homedir(), ".config");
  return join(configHome, "opencode", "ttc-plugin.json");
}

export {
  getAuthStorePath,
  hasAuthEntry as hasTtcAuthKey,
  writeAuthEntry,
  removeAuthEntry
};

export async function readTtcSettings({
  configPath = getTtcSettingsConfigPath(),
  readFileImpl = readFile
} = {}) {
  try {
    const content = await readFileImpl(configPath, "utf8");
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

export async function writeTtcSettings(settings, {
  configPath = getTtcSettingsConfigPath(),
  mkdirImpl = mkdir,
  writeFileImpl = writeFile
} = {}) {
  await mkdirImpl(dirname(configPath), { recursive: true });
  await writeFileImpl(configPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return configPath;
}

export async function resetTtcSettings({
  configPath = getTtcSettingsConfigPath(),
  rmImpl = rm
} = {}) {
  await rmImpl(configPath, { force: true });
  return configPath;
}

export function normalizeCompressionLevel(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return hasOwn(COMPRESSION_LEVELS, normalized) ? normalized : "";
}

export function parseAggressiveness(value) {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null;
  return parsed;
}

export function parseMinChars(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseModel(value) {
  const parsed = String(value ?? "").trim();
  if (!parsed || parsed.length > 120) return null;
  if (!/^[A-Za-z0-9._:/-]+$/.test(parsed)) return null;
  return parsed;
}

export function buildSettingsView(settings = {}) {
  const level = normalizeCompressionLevel(settings.compressionLevel);
  const aggressiveness = parseAggressiveness(settings.aggressiveness);
  const minChars = parseMinChars(settings.minChars);
  const model = parseModel(settings.model);

  return {
    enabled: typeof settings.enabled === "boolean" ? settings.enabled : DEFAULT_SETTINGS.enabled,
    compressionLevel: level || (aggressiveness === null ? DEFAULT_SETTINGS.compressionLevel : "custom"),
    aggressiveness: aggressiveness ?? (level ? COMPRESSION_LEVELS[level] : DEFAULT_SETTINGS.aggressiveness),
    minChars: minChars ?? DEFAULT_SETTINGS.minChars,
    model: model ?? DEFAULT_SETTINGS.model
  };
}

export async function updateTtcSetting(action, value, options = {}) {
  const settings = await readTtcSettings(options);

  if (action === "toggle-enabled") {
    settings.enabled = !Boolean(buildSettingsView(settings).enabled);
    await writeTtcSettings(settings, options);
    return { ok: true, settings, message: `Token compression ${settings.enabled ? "enabled" : "disabled"}.` };
  }

  if (action === "set-level") {
    const level = normalizeCompressionLevel(value);
    if (!level) return { ok: false, message: "Invalid compression level. Use low, balanced, high, or max." };
    delete settings.aggressiveness;
    settings.compressionLevel = level;
    await writeTtcSettings(settings, options);
    return { ok: true, settings, message: `Compression level set to ${level}.` };
  }

  if (action === "set-aggressiveness") {
    const aggressiveness = parseAggressiveness(value);
    if (aggressiveness === null) return { ok: false, message: "Invalid aggressiveness. Use a number from 0 to 1." };
    delete settings.compressionLevel;
    settings.aggressiveness = aggressiveness;
    await writeTtcSettings(settings, options);
    return { ok: true, settings, message: `Aggressiveness set to ${aggressiveness}.` };
  }

  if (action === "set-min-chars") {
    const minChars = parseMinChars(value);
    if (minChars === null) return { ok: false, message: "Invalid min chars. Use a non-negative integer." };
    settings.minChars = minChars;
    await writeTtcSettings(settings, options);
    return { ok: true, settings, message: `Min chars set to ${minChars}.` };
  }

  if (action === "set-model") {
    const model = parseModel(value);
    if (model === null) return { ok: false, message: "Invalid model. Use a model id with letters, numbers, dots, dashes, slashes, colons, or underscores." };
    settings.model = model;
    await writeTtcSettings(settings, options);
    return { ok: true, settings, message: `Model set to ${model}.` };
  }

  return { ok: false, message: "Unknown settings action." };
}

function toast(api, input) {
  api.ui?.toast?.(input);
}

function renderAlert(api, dialog, title, message) {
  dialog.replace(() => api.ui.DialogAlert({
    title,
    message,
    onConfirm: () => openTtcSettingsMenu(api, dialog)
  }));
}

async function saveAndReturn(api, dialog, action, value) {
  const result = await updateTtcSetting(action, value);
  toast(api, {
    variant: result.ok ? "success" : "error",
    message: result.message,
    duration: 4500
  });
  if (result.ok) {
    await openTtcSettingsMenu(api, dialog);
    return;
  }
  renderAlert(api, dialog, "Invalid Setting", result.message);
}

function promptValue(api, dialog, { title, placeholder, value, action }) {
  dialog.replace(() => api.ui.DialogPrompt({
    title,
    placeholder,
    value,
    onConfirm: (nextValue) => void saveAndReturn(api, dialog, action, nextValue),
    onCancel: () => openTtcSettingsMenu(api, dialog)
  }));
}

function selectLevel(api, dialog, current) {
  dialog.replace(() => api.ui.DialogSelect({
    title: "Compression Level",
    current,
    options: Object.entries(COMPRESSION_LEVELS).map(([level, aggressiveness]) => ({
      title: level,
      value: level,
      description: `Aggressiveness ${aggressiveness}`
    })),
    onSelect: (option) => void saveAndReturn(api, dialog, "set-level", option.value)
  }));
}

function selectModel(api, dialog, currentValue) {
  const knownIDs = KNOWN_MODELS.map((model) => model.id);
  const options = KNOWN_MODELS.map((model) => ({
    title: model.label,
    value: model.id,
    description: model.description
  }));
  const isCustom = currentValue && !knownIDs.includes(currentValue);
  if (isCustom) {
    options.push({
      title: `Custom: ${currentValue}`,
      value: currentValue,
      description: "Currently set to a non-standard model id"
    });
  }
  options.push({
    title: "Enter custom model id",
    value: "__custom__",
    description: "Specify a model id (e.g. an enterprise fine-tune)"
  });

  dialog.replace(() => api.ui.DialogSelect({
    title: "Compression Model",
    current: currentValue,
    options,
    onSelect: (option) => {
      if (option.value === "__custom__") {
        promptValue(api, dialog, {
          title: "Custom Model",
          placeholder: "bear-1.2",
          value: currentValue,
          action: "set-model"
        });
        return;
      }
      void saveAndReturn(api, dialog, "set-model", option.value);
    }
  }));
}

const LOGIN_FAILURE_MESSAGES = {
  empty_key: "Empty API key.",
  auth_store_corrupt: "opencode auth store is corrupt — refusing to overwrite. Back up and remove the file manually.",
  auth_store_not_regular_file: "opencode auth store path is not a regular file.",
  auth_store_read_failed: "Could not read the opencode auth store.",
  auth_store_write_failed: "Could not write the opencode auth store."
};

async function performLogin(api, dialog, keyValue) {
  const result = await writeAuthEntry({ apiKey: keyValue });
  if (result.ok) {
    const legacyNote = result.removedLegacyIDs?.length
      ? ` Also cleared stale legacy entries: ${result.removedLegacyIDs.join(", ")}.`
      : "";
    toast(api, {
      variant: "success",
      message: `TTC API key saved under '${result.providerID}'.${legacyNote} Restart opencode (or send a message) to activate.`,
      duration: 5000
    });
    await openTtcSettingsMenu(api, dialog);
    return;
  }
  const message = LOGIN_FAILURE_MESSAGES[result.reason] ?? `Login failed: ${result.reason}.`;
  toast(api, { variant: "error", message, duration: 5000 });
  renderAlert(api, dialog, "Login Failed", message);
}

function promptLogin(api, dialog) {
  dialog.replace(() => api.ui.DialogPrompt({
    title: "TTC API Key",
    placeholder: "ttc_...",
    value: "",
    onConfirm: (nextValue) => void performLogin(api, dialog, nextValue),
    onCancel: () => openTtcSettingsMenu(api, dialog)
  }));
}

const LOGOUT_FAILURE_MESSAGES = {
  auth_store_corrupt: "opencode auth store is corrupt — refusing to overwrite. Back up and remove the file manually.",
  auth_store_read_failed: "Could not read the opencode auth store.",
  auth_store_write_failed: "Could not write the opencode auth store."
};

async function confirmLogout(api, dialog) {
  dialog.replace(() => api.ui.DialogConfirm({
    title: "Remove TTC API Key",
    message: "Remove the TTC API key from the opencode auth store?",
    onConfirm: async () => {
      const result = await removeAuthEntry();
      if (!result.ok) {
        const message = LOGOUT_FAILURE_MESSAGES[result.reason] ?? `Logout failed: ${result.reason}.`;
        toast(api, { variant: "error", message, duration: 5000 });
        renderAlert(api, dialog, "Logout Failed", message);
        return;
      }
      toast(api, {
        variant: result.removedAny ? "success" : "info",
        message: result.removedAny
          ? "TTC API key removed. Restart opencode to fully clear active sessions."
          : "No TTC auth entry was present.",
        duration: 4500
      });
      await openTtcSettingsMenu(api, dialog);
    },
    onCancel: () => openTtcSettingsMenu(api, dialog)
  }));
}

function confirmReset(api, dialog) {
  dialog.replace(() => api.ui.DialogConfirm({
    title: "Reset Token Compression Settings",
    message: "Remove the plugin config file and return to defaults?",
    onConfirm: async () => {
      const configPath = await resetTtcSettings();
      toast(api, {
        variant: "success",
        message: `Reset token compression settings at ${configPath}.`,
        duration: 4500
      });
      await openTtcSettingsMenu(api, dialog);
    },
    onCancel: () => openTtcSettingsMenu(api, dialog)
  }));
}

export async function openTtcSettingsMenu(api, dialog = api.ui?.dialog) {
  if (!api?.ui || !dialog?.replace) return;

  const settings = await readTtcSettings();
  const auth = await hasAuthEntry();
  const view = buildSettingsView(settings);
  const authOption = auth.hasKey
    ? {
        title: "Remove API key",
        value: "ttc-logout",
        description: "Revoke saved key"
      }
    : {
        title: "Add API key",
        value: "ttc-login",
        description: "Required for compression"
      };
  dialog.setSize?.("medium");
  dialog.replace(() => api.ui.DialogSelect({
    title: "Token Compression Settings",
    options: [
      {
        title: `${view.enabled ? "Disable" : "Enable"} compression`,
        value: "toggle-enabled",
        description: `Currently ${view.enabled ? "enabled" : "disabled"}`
      },
      {
        title: "Compression level",
        value: "set-level",
        description: view.compressionLevel === "custom" ? "Custom aggressiveness" : view.compressionLevel
      },
      {
        title: "Custom aggressiveness",
        value: "set-aggressiveness",
        description: String(view.aggressiveness)
      },
      {
        title: "Min chars",
        value: "set-min-chars",
        description: String(view.minChars)
      },
      {
        title: "Model",
        value: "set-model",
        description: view.model
      },
      authOption,
      {
        title: "Reset config",
        value: "reset-config",
        description: "Remove plugin config file"
      }
    ],
    onSelect: (option) => {
      if (option.value === "toggle-enabled") {
        void saveAndReturn(api, dialog, "toggle-enabled");
        return;
      }
      if (option.value === "set-level") {
        selectLevel(api, dialog, normalizeCompressionLevel(settings.compressionLevel));
        return;
      }
      if (option.value === "set-aggressiveness") {
        promptValue(api, dialog, {
          title: "Custom Aggressiveness",
          placeholder: "0.1",
          value: String(view.aggressiveness),
          action: "set-aggressiveness"
        });
        return;
      }
      if (option.value === "set-min-chars") {
        promptValue(api, dialog, {
          title: "Min Chars",
          placeholder: "400",
          value: String(view.minChars),
          action: "set-min-chars"
        });
        return;
      }
      if (option.value === "set-model") {
        selectModel(api, dialog, view.model);
        return;
      }
      if (option.value === "ttc-login") {
        promptLogin(api, dialog);
        return;
      }
      if (option.value === "ttc-logout") {
        confirmLogout(api, dialog);
        return;
      }
      if (option.value === "reset-config") {
        confirmReset(api, dialog);
      }
    }
  }));
}

export function registerTtcSettingsCommand(api) {
  if (!api.command?.register) return () => {};
  return api.command.register(() => [
    {
      title: TTC_SETTINGS_COMMAND_TITLE,
      value: TTC_SETTINGS_COMMAND_VALUE,
      description: "Configure token compression",
      category: "Token Compression",
      slash: {
        name: "token-compression",
        aliases: ["ttc"]
      },
      onSelect: (dialog) => void openTtcSettingsMenu(api, dialog ?? api.ui?.dialog)
    },
    {
      title: TTC_LOGIN_COMMAND_TITLE,
      value: TTC_LOGIN_COMMAND_VALUE,
      description: "Set your TTC API key in the opencode auth store",
      category: "Token Compression",
      slash: {
        name: "ttc-login"
      },
      onSelect: (dialog) => void promptLogin(api, dialog ?? api.ui?.dialog)
    },
    {
      title: TTC_LOGOUT_COMMAND_TITLE,
      value: TTC_LOGOUT_COMMAND_VALUE,
      description: "Remove the TTC API key from the opencode auth store",
      category: "Token Compression",
      slash: {
        name: "ttc-logout"
      },
      onSelect: (dialog) => void confirmLogout(api, dialog ?? api.ui?.dialog)
    }
  ]);
}
