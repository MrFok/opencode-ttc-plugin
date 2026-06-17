import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";

import TtcMessageTransformPlugin from "../opencode-plugins/ttc-message-transform.js";
import {
  buildTtcPluginConfig,
  buildSidebarState,
  createSessionStats,
  getPluginConfigPath,
  getSidebarStatePath,
  hydrateSessionStatsFromSidebarState,
  getAuthStorePath,
  getSkipReasonForText,
  recordProcessedPart,
  recordSkipReason,
  resolveBehaviorConfig,
  resolveCompressionConfig,
  resolveLockedBaseUrl,
  resolvePluginSettings,
  resolveRuntimeConfig,
  resolveApiKeyFromAuthStore,
  resolveEffectiveApiKey,
  resolveSessionIDFromTransformInput,
  resetLastMessageStats,
  writeSidebarState,
  transformMessagesWithTtc
} from "../opencode-plugins/ttc-message-transform-core.js";
import {
  formatMetricValue,
  formatPartLine,
  getStatusDotColor,
  emptySidebarStateText,
  loadAuthStatus,
  loadSidebarState,
  shouldRenderSidebarState,
  statusText
} from "../tui/sidebar-state.js";
import {
  getTtcSettingsConfigPath,
  hasTtcAuthKey,
  openTtcSettingsMenu,
  registerTtcSettingsCommand,
  resetTtcSettings,
  updateTtcSetting,
  removeAuthEntry as removeTuiAuthEntry,
  AUTH_PROVIDER_ID as TUI_AUTH_PROVIDER_ID,
  KNOWN_MODELS as TUI_KNOWN_MODELS
} from "../tui/settings.js";
import { writeAuthEntry as writeTuiAuthEntry } from "../lib/auth-store.js";

function createOutput(text) {
  return {
    messages: [
      {
        info: {
          id: "msg-1",
          sessionID: "sess-1",
          role: "user"
        },
        parts: [
          {
            id: "part-1",
            type: "text",
            text
          }
        ]
      }
    ]
  };
}

function createClient() {
  const logs = [];
  const toasts = [];
  return {
    logs,
    toasts,
    app: {
      async log({ body }) {
        logs.push(body);
      }
    },
    tui: {
      async showToast({ body }) {
        toasts.push(body);
      }
    }
  };
}

const baseConfig = {
  enabled: true,
  apiKey: "ttc_test_key",
  baseUrl: "https://api.thetokencompany.com",
  model: "bear-1.2",
  aggressiveness: 0.1,
  minChars: 10,
  timeoutMs: 50,
  maxRetries: 1,
  retryBackoffMs: 1,
  useGzip: false,
  compressSystem: false,
  compressHistory: false,
  debug: true,
  cacheMaxEntries: 100
};

test("compresses eligible user text parts through TTC", async () => {
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      async json() {
        return {
          output: "short compressed text"
        };
      }
    };
  };
  const output = createOutput("this is a long user message that should be compressed");
  const client = createClient();

  await transformMessagesWithTtc({
    output,
    client,
    config: baseConfig,
    cache: new Map(),
    fetchImpl
  });

  assert.equal(fetchCalls, 1);
  assert.equal(output.messages[0].parts[0].text, "short compressed text");
  assert.equal(client.logs.some((log) => log.message === "ttc.plugin.request"), true);
  assert.equal(client.logs.some((log) => log.message === "ttc.plugin.response"), true);
});

test("skips synthetic/high-risk content and does not call TTC", async () => {
  const client = createClient();
  let fetchCalls = 0;
  const output = {
    messages: [
      {
        info: { id: "msg-1", sessionID: "sess-1", role: "user" },
        parts: [
          { id: "part-1", type: "text", text: "```js\nconsole.log('x')\n```" },
          { id: "part-2", type: "text", text: "{\"schema\":{\"type\":\"object\"}}" },
          { id: "part-3", type: "text", text: "synthetic data", synthetic: true }
        ]
      }
    ]
  };

  await transformMessagesWithTtc({
    output,
    client,
    config: baseConfig,
    cache: new Map(),
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("fetch should not be called");
    }
  });

  assert.equal(fetchCalls, 0);
  assert.equal(getSkipReasonForText(output.messages[0].parts[0].text, output.messages[0].parts[0], baseConfig), "code_fence");
  assert.equal(getSkipReasonForText(output.messages[0].parts[1].text, output.messages[0].parts[1], baseConfig), "json_blob");
  assert.equal(getSkipReasonForText(output.messages[0].parts[2].text, output.messages[0].parts[2], baseConfig), "synthetic_part");
});

test("retries on timeout and fails open without blocking", async () => {
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    const timeoutError = new Error("aborted");
    timeoutError.name = "AbortError";
    throw timeoutError;
  };
  const output = createOutput("this message should fail-open after retries");
  const client = createClient();

  await transformMessagesWithTtc({
    output,
    client,
    config: {
      ...baseConfig,
      maxRetries: 1,
      retryBackoffMs: 1
    },
    cache: new Map(),
    fetchImpl
  });

  assert.equal(fetchCalls, 2);
  assert.equal(output.messages[0].parts[0].text, "this message should fail-open after retries");
  assert.equal(client.logs.some((log) => log.message === "ttc.plugin.fallback"), true);
});

test("uses cache for repeated session/message/part text", async () => {
  const cache = new Map();
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      async json() {
        return {
          output: "cached compressed value"
        };
      }
    };
  };
  const client = createClient();
  const outputFirst = createOutput("this text should be cached after first compression");
  const outputSecond = createOutput("this text should be cached after first compression");

  await transformMessagesWithTtc({
    output: outputFirst,
    client,
    config: baseConfig,
    cache,
    fetchImpl
  });

  await transformMessagesWithTtc({
    output: outputSecond,
    client,
    config: baseConfig,
    cache,
    fetchImpl
  });

  assert.equal(fetchCalls, 1);
  assert.equal(outputSecond.messages[0].parts[0].text, "cached compressed value");
  assert.equal(client.logs.some((log) => log.message === "ttc.plugin.response" && log.extra?.cache_hit === true), true);
});

test("buildTtcPluginConfig parses env values", () => {
  const parsed = buildTtcPluginConfig({
    TTC_ENABLED: "true",
    TTC_API_KEY: "abc",
    TTC_BASE_URL: "https://example.com/",
    TTC_MODEL: "bear-1.2",
    TTC_AGGRESSIVENESS: "0.2",
    TTC_MIN_CHARS: "222",
    TTC_TIMEOUT_MS: "444",
    TTC_MAX_RETRIES: "3",
    TTC_RETRY_BACKOFF_MS: "20",
    TTC_USE_GZIP: "false",
    TTC_COMPRESS_SYSTEM: "true",
    TTC_COMPRESS_HISTORY: "true",
    TTC_DEBUG: "true",
    TTC_CACHE_MAX_ENTRIES: "50",
    TTC_TOAST_ON_ACTIVE: "false",
    TTC_TOAST_ON_IDLE_SUMMARY: "false"
  });

  assert.equal(parsed.enabled, true);
  assert.equal(parsed.apiKey, "abc");
  assert.equal(parsed.baseUrl, "https://api.thetokencompany.com");
  assert.equal(parsed.baseUrlRejected, true);
  assert.equal(parsed.baseUrlRejectReason, "host_not_allowed");
  assert.equal(parsed.minChars, 222);
  assert.equal(parsed.useGzip, false);
  assert.equal(parsed.compressSystem, true);
  assert.equal(parsed.compressHistory, true);
  assert.equal(parsed.cacheMaxEntries, 50);
  assert.equal(parsed.toastOnActive, false);
  assert.equal(parsed.toastOnIdleSummary, false);
});

test("accepts only locked TTC https host for base url", () => {
  const resolved = resolveLockedBaseUrl("https://api.thetokencompany.com");
  assert.equal(resolved.baseUrl, "https://api.thetokencompany.com");
  assert.equal(resolved.rejected, false);
});

test("rejects non-https TTC base url", () => {
  const resolved = resolveLockedBaseUrl("http://api.thetokencompany.com");
  assert.equal(resolved.baseUrl, "https://api.thetokencompany.com");
  assert.equal(resolved.rejected, true);
  assert.equal(resolved.reason, "protocol_not_https");
});

test("rejects localhost, private IP, and custom domains for base url", () => {
  const localhost = resolveLockedBaseUrl("https://localhost:8080");
  assert.equal(localhost.rejected, true);
  assert.equal(localhost.reason, "host_not_allowed");

  const privateIp = resolveLockedBaseUrl("https://192.168.1.7");
  assert.equal(privateIp.rejected, true);
  assert.equal(privateIp.reason, "host_not_allowed");

  const customDomain = resolveLockedBaseUrl("https://example.com");
  assert.equal(customDomain.rejected, true);
  assert.equal(customDomain.reason, "host_not_allowed");
});

test("rejects malformed TTC_BASE_URL values", () => {
  const resolved = resolveLockedBaseUrl("not-a-url");
  assert.equal(resolved.rejected, true);
  assert.equal(resolved.reason, "malformed");
});

test("uses locked TTC host in requests and stays fail-open on request error", async () => {
  let calledUrl = "";
  let requestOptions = null;
  const output = createOutput("this message should fail-open when request fails");
  const client = createClient();
  const config = buildTtcPluginConfig({ TTC_API_KEY: "ttc_test_key", TTC_BASE_URL: "https://example.com" });

  await transformMessagesWithTtc({
    output,
    client,
    config: {
      ...baseConfig,
      ...config,
      minChars: 10,
      maxRetries: 0
    },
    cache: new Map(),
    fetchImpl: async (url, options) => {
      calledUrl = String(url);
      requestOptions = options;
      throw new Error("network down");
    }
  });

  assert.equal(calledUrl, "https://api.thetokencompany.com/v1/compress");
  assert.equal(requestOptions.redirect, "error");
  assert.equal(output.messages[0].parts[0].text, "this message should fail-open when request fails");
});

test("resolves plugin config path from XDG_CONFIG_HOME", () => {
  const path = getPluginConfigPath({ XDG_CONFIG_HOME: "/tmp/xdg-config" });
  assert.equal(path, "/tmp/xdg-config/opencode/ttc-plugin.json");
});

test("resolvePluginSettings returns empty object on malformed json", async () => {
  const settings = await resolvePluginSettings({
    readFileImpl: async () => "invalid-json"
  });
  assert.deepEqual(settings, {});
});

test("resolveCompressionConfig uses env override over plugin config", () => {
  const resolved = resolveCompressionConfig({
    env: { TTC_AGGRESSIVENESS: "0.42" },
    settings: { compressionLevel: "high", aggressiveness: 0.2 },
    defaultAggressiveness: 0.1
  });

  assert.equal(resolved.aggressiveness, 0.42);
  assert.equal(resolved.source, "env");
});

test("resolveCompressionConfig uses plugin compression level", () => {
  const resolved = resolveCompressionConfig({
    env: {},
    settings: { compressionLevel: "high" },
    defaultAggressiveness: 0.1
  });

  assert.equal(resolved.aggressiveness, 0.2);
  assert.equal(resolved.level, "high");
  assert.equal(resolved.source, "plugin_config");
});

test("resolveCompressionConfig falls back to default", () => {
  const resolved = resolveCompressionConfig({
    env: {},
    settings: {},
    defaultAggressiveness: 0.1
  });

  assert.equal(resolved.aggressiveness, 0.1);
  assert.equal(resolved.level, "balanced");
  assert.equal(resolved.source, "default");
});

test("resolveBehaviorConfig uses plugin config when env is absent", () => {
  const resolved = resolveBehaviorConfig({
    env: {},
    settings: {
      minChars: 123,
      timeoutMs: 555,
      compressSystem: true,
      toastOnActive: false,
      model: "bear-1.1"
    }
  });

  assert.equal(resolved.values.minChars, 123);
  assert.equal(resolved.values.timeoutMs, 555);
  assert.equal(resolved.values.compressSystem, true);
  assert.equal(resolved.values.toastOnActive, false);
  assert.equal(resolved.values.model, "bear-1.1");
  assert.equal(resolved.sources.minChars, "plugin_config");
});

test("resolveBehaviorConfig keeps env override precedence", () => {
  const resolved = resolveBehaviorConfig({
    env: {
      TTC_MIN_CHARS: "777",
      TTC_USE_GZIP: "false"
    },
    settings: {
      minChars: 222,
      useGzip: true
    }
  });

  assert.equal(resolved.values.minChars, 777);
  assert.equal(resolved.values.useGzip, false);
  assert.equal(resolved.sources.minChars, "env");
  assert.equal(resolved.sources.useGzip, "env");
});

test("resolveRuntimeConfig combines current plugin config with env and auth precedence", async () => {
  const files = new Map([
    [
      "/tmp/ttc-plugin.json",
      JSON.stringify({
        enabled: false,
        minChars: 123,
        compressionLevel: "high"
      })
    ],
    [
      "/tmp/auth.json",
      JSON.stringify({
        "the-token-company-plugin": {
          type: "api",
          key: "auth_store_key"
        }
      })
    ]
  ]);

  const runtime = await resolveRuntimeConfig({
    env: {
      TTC_API_KEY: "env_key",
      TTC_MIN_CHARS: "777"
    },
    settingsFilePath: "/tmp/ttc-plugin.json",
    authFilePath: "/tmp/auth.json",
    readFileImpl: async (path) => files.get(path)
  });

  assert.equal(runtime.config.enabled, false);
  assert.equal(runtime.config.minChars, 777);
  assert.equal(runtime.config.aggressiveness, 0.2);
  assert.equal(runtime.config.apiKey, "env_key");
  assert.equal(runtime.apiKeyResolution.source, "env");
  assert.equal(runtime.behaviorResolution.sources.enabled, "plugin_config");
  assert.equal(runtime.behaviorResolution.sources.minChars, "env");
  assert.equal(runtime.compressionResolution.source, "plugin_config");
});

test("plugin transform reloads config changes without recreating plugin factory", async () => {
  const originalFetch = globalThis.fetch;
  const tempConfigHome = await mkdtemp(join(tmpdir(), "ttc-plugin-config-"));
  const tempStateHome = await mkdtemp(join(tmpdir(), "ttc-plugin-state-"));
  const configPath = join(tempConfigHome, "opencode", "ttc-plugin.json");
  const originalEnv = {
    TTC_API_KEY: process.env.TTC_API_KEY,
    TTC_MIN_CHARS: process.env.TTC_MIN_CHARS,
    TTC_ENABLED: process.env.TTC_ENABLED,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME
  };

  process.env.TTC_API_KEY = "ttc_test_key";
  delete process.env.TTC_MIN_CHARS;
  delete process.env.TTC_ENABLED;
  process.env.XDG_CONFIG_HOME = tempConfigHome;
  process.env.XDG_STATE_HOME = tempStateHome;

  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      async json() {
        return {
          output: "dynamic compressed text"
        };
      }
    };
  };

  try {
    await mkdir(join(tempConfigHome, "opencode"), { recursive: true });
    await writeFile(configPath, `${JSON.stringify({ enabled: false, minChars: 10 })}\n`, "utf8");
    const plugin = await TtcMessageTransformPlugin({ client: createClient() });

    const disabledOutput = createOutput("this prompt should pass through while plugin config disables ttc");
    await plugin["experimental.chat.messages.transform"]({}, disabledOutput);
    assert.equal(fetchCalls, 0);
    assert.equal(disabledOutput.messages[0].parts[0].text, "this prompt should pass through while plugin config disables ttc");

    await writeFile(configPath, `${JSON.stringify({ enabled: true, minChars: 10 })}\n`, "utf8");

    const enabledOutput = createOutput("this prompt should compress after plugin config is changed");
    await plugin["experimental.chat.messages.transform"]({}, enabledOutput);

    assert.equal(fetchCalls, 1);
    assert.equal(enabledOutput.messages[0].parts[0].text, "dynamic compressed text");
  } finally {
    globalThis.fetch = originalFetch;

    if (originalEnv.TTC_API_KEY === undefined) delete process.env.TTC_API_KEY;
    else process.env.TTC_API_KEY = originalEnv.TTC_API_KEY;

    if (originalEnv.TTC_MIN_CHARS === undefined) delete process.env.TTC_MIN_CHARS;
    else process.env.TTC_MIN_CHARS = originalEnv.TTC_MIN_CHARS;

    if (originalEnv.TTC_ENABLED === undefined) delete process.env.TTC_ENABLED;
    else process.env.TTC_ENABLED = originalEnv.TTC_ENABLED;

    if (originalEnv.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalEnv.XDG_CONFIG_HOME;

    if (originalEnv.XDG_STATE_HOME === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = originalEnv.XDG_STATE_HOME;

    await rm(tempConfigHome, { recursive: true, force: true });
    await rm(tempStateHome, { recursive: true, force: true });
  }
});

test("resolves auth store path from XDG_DATA_HOME", () => {
  const path = getAuthStorePath({ XDG_DATA_HOME: "/tmp/xdg-data" });
  assert.equal(path, "/tmp/xdg-data/opencode/auth.json");
});

test("auth store path falls back to $HOME when XDG_DATA_HOME is relative", () => {
  const expected = join(homedir(), ".local", "share", "opencode", "auth.json");
  assert.equal(getAuthStorePath({ XDG_DATA_HOME: "relative/data" }), expected);
  assert.equal(getAuthStorePath({ XDG_DATA_HOME: "./data" }), expected);
  assert.equal(getAuthStorePath({ XDG_DATA_HOME: "data" }), expected);
  assert.equal(getAuthStorePath({ XDG_DATA_HOME: "" }), expected);
  assert.equal(getAuthStorePath({}), expected);
});

test("resolves api key from OpenCode auth store for provider id", async () => {
  const key = await resolveApiKeyFromAuthStore({
    readFileImpl: async () => JSON.stringify({
      "the-token-company-plugin": {
        type: "api",
        key: "auth_store_key"
      }
    })
  });

  assert.equal(key, "auth_store_key");
});

test("ignores malformed auth store data and non-api auth entries", async () => {
  const malformed = await resolveApiKeyFromAuthStore({
    readFileImpl: async () => "not-json"
  });
  assert.equal(malformed, "");

  const oauth = await resolveApiKeyFromAuthStore({
    readFileImpl: async () => JSON.stringify({
      "the-token-company-plugin": {
        type: "oauth",
        access: "x"
      }
    })
  });
  assert.equal(oauth, "");
});

test("uses env key over auth store key", () => {
  const resolved = resolveEffectiveApiKey("env_key", "auth_store_key");
  assert.equal(resolved.apiKey, "env_key");
  assert.equal(resolved.source, "env");
});

test("falls back to auth store key when env key missing", () => {
  const resolved = resolveEffectiveApiKey("", "auth_store_key");
  assert.equal(resolved.apiKey, "auth_store_key");
  assert.equal(resolved.source, "auth_store");
});

test("builds redacted sidebar state without prompt text or secrets", () => {
  const stats = createSessionStats();
  resetLastMessageStats(stats);
  recordProcessedPart(stats, {
    charsBefore: 1200,
    charsAfter: 600,
    compressed: true,
    fallback: false,
    cacheHit: false,
    tokenSavingsExact: 150
  });

  const state = buildSidebarState({
    stats,
    config: {
      ...baseConfig,
      apiKey: "ttc_secret_key"
    },
    sessionID: "sess-secret",
    authSource: "auth_store"
  });

  const serialized = JSON.stringify(state);
  assert.equal(state.status, "compressed");
  assert.equal(state.config.hasApiKey, true);
  assert.equal(state.config.authSource, "auth_store");
  assert.equal(state.lastMessage.tokensSaved, 150);
  assert.equal(serialized.includes("ttc_secret_key"), false);
  assert.equal(serialized.includes("this is a long user message"), false);
  assert.equal(serialized.includes("sess-secret"), false);
});

test("records skipped sidebar state and formats skip reason", () => {
  const stats = createSessionStats();
  resetLastMessageStats(stats);
  recordSkipReason(stats, "code_fence");

  const state = buildSidebarState({
    stats,
    config: baseConfig,
    sessionID: "sess-1"
  });

  assert.equal(state.status, "skipped");
  assert.equal(statusText(state), "skipped: code fence");
});

test("writes and loads sidebar state by hashed session path", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ttc-sidebar-state-"));
  try {
    const stats = createSessionStats();
    recordProcessedPart(stats, {
      charsBefore: 100,
      charsAfter: 40,
      compressed: true,
      fallback: false,
      cacheHit: false,
      tokenSavingsExact: null
    });

    const statePath = getSidebarStatePath("sess-1", { XDG_STATE_HOME: tempDir });
    await writeSidebarState({
      stats,
      config: baseConfig,
      sessionID: "sess-1",
      statePath
    });

    assert.equal(statePath.includes("sess-1"), false);
    const loaded = await loadSidebarState("sess-1", { statePath });
    assert.equal(loaded.status, "compressed");
    assert.equal(loaded.session.charsSaved, 60);

    const content = await readFile(statePath, "utf8");
    assert.equal(content.includes("ttc_test_key"), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("hydrates session stats from persisted sidebar state before writing new resume metrics", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ttc-resume-state-"));

  try {
    const priorStats = createSessionStats();
    recordProcessedPart(priorStats, {
      charsBefore: 1000,
      charsAfter: 400,
      compressed: true,
      fallback: false,
      cacheHit: false,
      tokenSavingsExact: 150
    });

    const statePath = getSidebarStatePath("sess-1", { XDG_STATE_HOME: tempDir });
    await writeSidebarState({
      stats: priorStats,
      config: baseConfig,
      sessionID: "sess-1",
      statePath
    });

    const persisted = await loadSidebarState("sess-1", { statePath });
    const hydrated = hydrateSessionStatsFromSidebarState(persisted);
    assert.equal(hydrated.processed, 1);
    assert.equal(hydrated.charsBefore, 1000);
    assert.equal(hydrated.charsAfter, 400);
    assert.equal(hydrated.exactTokensSaved, 150);

    const output = createOutput("this resumed session prompt should add to the existing persisted metrics");
    await transformMessagesWithTtc({
      output,
      client: createClient(),
      config: baseConfig,
      cache: new Map(),
      sessionStats: new Map(),
      env: { XDG_STATE_HOME: tempDir },
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return {
            output: "compressed after resume",
            input_tokens: 200,
            output_tokens: 80
          };
        }
      })
    });

    const updated = await loadSidebarState("sess-1", { statePath });
    assert.equal(updated.session.processed, 2);
    assert.equal(updated.session.compressed, 2);
    assert.equal(updated.session.charsBefore, 1000 + "this resumed session prompt should add to the existing persisted metrics".length);
    assert.equal(updated.session.charsAfter, 400 + "compressed after resume".length);
    assert.equal(updated.session.exactTokensSaved, 270);
    assert.equal(updated.lastMessage.charsAfter, "compressed after resume".length);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("concurrent first-use hydration shares one persisted session stats object", async () => {
  const priorStats = createSessionStats();
  recordProcessedPart(priorStats, {
    charsBefore: 1000,
    charsAfter: 400,
    compressed: true,
    fallback: false,
    cacheHit: false,
    tokenSavingsExact: 150
  });
  const persistedState = JSON.stringify(buildSidebarState({
    stats: priorStats,
    config: baseConfig,
    sessionID: "sess-1"
  }));
  const sessionStats = new Map();
  const writes = [];
  let readCalls = 0;
  let releaseHydration;
  const hydrationStarted = new Promise((resolve) => {
    releaseHydration = resolve;
  });

  const makeTransform = (text, compressedText) => transformMessagesWithTtc({
    output: createOutput(text),
    client: createClient(),
    config: baseConfig,
    cache: new Map(),
    sessionStats,
    readSidebarStateImpl: async () => {
      readCalls += 1;
      await hydrationStarted;
      return persistedState;
    },
    writeSidebarStateImpl: async ({ stats, config, sessionID, authSource }) => {
      writes.push(buildSidebarState({ stats, config, sessionID, authSource }));
    },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          output: compressedText
        };
      }
    })
  });

  const first = makeTransform("first resumed prompt should keep prior cumulative metrics", "first compressed");
  const second = makeTransform("second resumed prompt should share hydrated metrics too", "second compressed");
  releaseHydration();
  await Promise.all([first, second]);

  assert.equal(readCalls, 1);
  assert.equal(writes.at(-1).session.processed, 3);
  assert.equal(writes.at(-1).session.compressed, 3);
  assert.equal(sessionStats.get("sess-1").processed, 3);
});

test("loadSidebarState returns null for malformed or missing state", async () => {
  const missing = await loadSidebarState("missing-session", {
    readFileImpl: async () => {
      throw new Error("missing");
    }
  });
  assert.equal(missing, null);

  const malformed = await loadSidebarState("bad-session", {
    readFileImpl: async () => "not-json"
  });
  assert.equal(malformed, null);
});

test("sidebar session switch helpers avoid rendering stale state as zeroed metrics", () => {
  const currentState = { session: { processed: 2 } };

  assert.equal(shouldRenderSidebarState(currentState, "session-a", "session-a"), true);
  assert.equal(shouldRenderSidebarState(currentState, "session-a", "session-b"), false);
  assert.equal(shouldRenderSidebarState(null, "session-a", "session-a"), false);
  assert.equal(emptySidebarStateText({ loading: true, messageCount: 0 }), "loading session metrics");
  assert.equal(emptySidebarStateText({ loading: false, messageCount: 0 }), "new session");
  assert.equal(emptySidebarStateText({ loading: false, messageCount: 3 }), "waiting for first compression");
});

test("transform writes sidebar state after processing a session message", async () => {
  let capturedState = null;
  const sessionStats = new Map();
  const output = createOutput("this message should be compressed and reflected in sidebar state");

  await transformMessagesWithTtc({
    output,
    client: createClient(),
    config: baseConfig,
    cache: new Map(),
    sessionStats,
    authSource: "env",
    writeSidebarStateImpl: async ({ stats, config, sessionID, authSource }) => {
      capturedState = buildSidebarState({ stats, config, sessionID, authSource });
    },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          output: "compressed sidebar text"
        };
      }
    })
  });

  assert.equal(capturedState.status, "compressed");
  assert.equal(capturedState.config.authSource, "env");
  assert.equal(capturedState.lastMessage.charsBefore > capturedState.lastMessage.charsAfter, true);
  assert.equal(JSON.stringify(capturedState).includes("this message should be compressed"), false);
});

test("transform writes missing auth sidebar state before returning fail-open", async () => {
  let capturedState = null;
  const output = createOutput("this message should pass through because auth is missing");

  await transformMessagesWithTtc({
    output,
    client: createClient(),
    config: {
      ...baseConfig,
      apiKey: ""
    },
    cache: new Map(),
    sessionStats: new Map(),
    authSource: "missing",
    writeSidebarStateImpl: async ({ stats, config, sessionID, authSource }) => {
      capturedState = buildSidebarState({ stats, config, sessionID, authSource });
    },
    fetchImpl: async () => {
      throw new Error("fetch should not be called");
    }
  });

  assert.equal(output.messages[0].parts[0].text, "this message should pass through because auth is missing");
  assert.equal(capturedState.status, "missing_auth");
  assert.equal(capturedState.config.authSource, "missing");
});

test("transform uses current input session when message info omits session id", async () => {
  const writes = [];
  const sessionStats = new Map();
  const output = createOutput("this message should be compressed under the active session id");
  delete output.messages[0].info.sessionID;

  await transformMessagesWithTtc({
    input: { sessionID: "active-session-1" },
    output,
    client: createClient(),
    config: baseConfig,
    cache: new Map(),
    sessionStats,
    writeSidebarStateImpl: async ({ stats, config, sessionID, authSource }) => {
      writes.push({ sessionID, state: buildSidebarState({ stats, config, sessionID, authSource }) });
    },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          output: "compressed active session text"
        };
      }
    })
  });

  assert.deepEqual([...sessionStats.keys()], ["active-session-1"]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].sessionID, "active-session-1");
  assert.equal(writes[0].state.status, "compressed");
});

test("resolves transform session id from OpenCode input shapes", () => {
  assert.equal(resolveSessionIDFromTransformInput({ sessionID: "sess-a" }), "sess-a");
  assert.equal(resolveSessionIDFromTransformInput({ session_id: "sess-b" }), "sess-b");
  assert.equal(resolveSessionIDFromTransformInput({ session: { id: "sess-c" } }), "sess-c");
  assert.equal(resolveSessionIDFromTransformInput({ properties: { sessionId: "sess-d" } }), "sess-d");
});

test("formats sidebar metric values with signed savings and compact ratios", () => {
  assert.equal(formatMetricValue(406, 421), "-4% (406/421)");
  assert.equal(formatMetricValue(241000, 290000), "-17% (241k/290k)");
  assert.equal(formatMetricValue(undefined, 0), "0% (0/0)");
  assert.equal(formatPartLine({ compressed: 5, processed: 5 }), "5/5 parts compressed");
});

test("maps sidebar status dot colors to action state", () => {
  const theme = {
    success: "green",
    error: "red",
    text: "white",
    textMuted: "gray"
  };

  for (const status of ["compressed", "skipped", "fallback", "no_reduction", "waiting", undefined]) {
    assert.equal(getStatusDotColor(status, theme), "green");
  }

  for (const status of ["missing_auth", "disabled"]) {
    assert.equal(getStatusDotColor(status, theme), "red");
  }
});

test("registers plugin auth provider for /connect flow", async () => {
  const client = createClient();
  const plugin = await TtcMessageTransformPlugin({ client });

  assert.equal(plugin.auth.provider, "opencode-ttc-plugin");
  assert.equal(Array.isArray(plugin.auth.methods), true);
  assert.equal(plugin.auth.methods.length > 0, true);
  assert.equal(plugin.auth.methods[0].type, "api");
});

test("reads legacy auth store entries written under the old provider id", async () => {
  const key = await resolveApiKeyFromAuthStore({
    readFileImpl: async () => JSON.stringify({
      "the-token-company-plugin": {
        type: "api",
        key: "legacy_key"
      }
    })
  });
  assert.equal(key, "legacy_key");
});

test("prefers new provider id when both legacy and current entries exist", async () => {
  const key = await resolveApiKeyFromAuthStore({
    readFileImpl: async () => JSON.stringify({
      "the-token-company-plugin": { type: "api", key: "legacy_key" },
      "opencode-ttc-plugin": { type: "api", key: "current_key" }
    })
  });
  assert.equal(key, "current_key");
});

test("shows activation and idle summary toasts in TUI", async () => {
  const originalFetch = globalThis.fetch;
  const tempStateHome = await mkdtemp(join(tmpdir(), "ttc-plugin-state-"));
  const originalEnv = {
    TTC_API_KEY: process.env.TTC_API_KEY,
    TTC_MIN_CHARS: process.env.TTC_MIN_CHARS,
    TTC_TOAST_ON_ACTIVE: process.env.TTC_TOAST_ON_ACTIVE,
    TTC_TOAST_ON_IDLE_SUMMARY: process.env.TTC_TOAST_ON_IDLE_SUMMARY,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME
  };

  process.env.TTC_API_KEY = "ttc_test_key";
  process.env.TTC_MIN_CHARS = "10";
  process.env.TTC_TOAST_ON_ACTIVE = "true";
  process.env.TTC_TOAST_ON_IDLE_SUMMARY = "true";
  process.env.XDG_STATE_HOME = tempStateHome;

  globalThis.fetch = async () => {
    return {
      ok: true,
      async json() {
        return {
          output: "toast compressed text"
        };
      }
    };
  };

  try {
    const client = createClient();
    const plugin = await TtcMessageTransformPlugin({ client });
    const output = createOutput("this is a long user message that should be compressed");

    await plugin["experimental.chat.messages.transform"]({}, output);
    assert.equal(client.toasts.some((toast) => toast.message === "TTC active for this session."), true);

    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "sess-1" } } });
    const idleSummaryToasts = client.toasts.filter((toast) => String(toast.message).startsWith("TTC: saved"));
    assert.equal(idleSummaryToasts.length, 1);

    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "sess-1" } } });
    const idleSummaryToastsAfterRepeat = client.toasts.filter((toast) => String(toast.message).startsWith("TTC: saved"));
    assert.equal(idleSummaryToastsAfterRepeat.length, 1);
  } finally {
    globalThis.fetch = originalFetch;

    if (originalEnv.TTC_API_KEY === undefined) delete process.env.TTC_API_KEY;
    else process.env.TTC_API_KEY = originalEnv.TTC_API_KEY;

    if (originalEnv.TTC_MIN_CHARS === undefined) delete process.env.TTC_MIN_CHARS;
    else process.env.TTC_MIN_CHARS = originalEnv.TTC_MIN_CHARS;

    if (originalEnv.TTC_TOAST_ON_ACTIVE === undefined) delete process.env.TTC_TOAST_ON_ACTIVE;
    else process.env.TTC_TOAST_ON_ACTIVE = originalEnv.TTC_TOAST_ON_ACTIVE;

    if (originalEnv.TTC_TOAST_ON_IDLE_SUMMARY === undefined) delete process.env.TTC_TOAST_ON_IDLE_SUMMARY;
    else process.env.TTC_TOAST_ON_IDLE_SUMMARY = originalEnv.TTC_TOAST_ON_IDLE_SUMMARY;

    if (originalEnv.XDG_STATE_HOME === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = originalEnv.XDG_STATE_HOME;

    await rm(tempStateHome, { recursive: true, force: true });
  }
});

test("registers TUI settings command and slash aliases", () => {
  let registeredCallback = null;
  const api = {
    command: {
      register(callback) {
        registeredCallback = callback;
        return () => {};
      }
    },
    ui: {
      dialog: {},
      toast() {}
    }
  };

  const dispose = registerTtcSettingsCommand(api);
  const commands = registeredCallback();
  const command = commands[0];

  assert.equal(typeof dispose, "function");
  assert.equal(command.title, "Token Compression: Settings");
  assert.equal(command.value, "ttc.settings");
  assert.equal(command.slash.name, "token-compression");
  assert.deepEqual(command.slash.aliases, ["ttc"]);
  assert.equal(typeof command.onSelect, "function");
});

test("registers /ttc-login and /ttc-logout slash commands", () => {
  let registeredCallback = null;
  registerTtcSettingsCommand({
    command: {
      register(callback) {
        registeredCallback = callback;
        return () => {};
      }
    },
    ui: { dialog: {}, toast() {} }
  });

  const commands = registeredCallback();
  const login = commands.find((cmd) => cmd.value === "ttc.login");
  const logout = commands.find((cmd) => cmd.value === "ttc.logout");

  assert.equal(Boolean(login), true);
  assert.equal(login.slash.name, "ttc-login");
  assert.equal(typeof login.onSelect, "function");
  assert.equal(Boolean(logout), true);
  assert.equal(logout.slash.name, "ttc-logout");
  assert.equal(typeof logout.onSelect, "function");
});

test("settings menu shows one compact auth row based on auth state", async () => {
  const tempDataHome = await mkdtemp(join(tmpdir(), "ttc-menu-auth-data-"));
  const tempConfigHome = await mkdtemp(join(tmpdir(), "ttc-menu-auth-config-"));
  const originalEnv = {
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME
  };
  process.env.XDG_DATA_HOME = tempDataHome;
  process.env.XDG_CONFIG_HOME = tempConfigHome;

  let latestSelect = null;
  const api = {
    ui: {
      DialogSelect(input) {
        latestSelect = input;
        return input;
      },
      dialog: {
        setSize() {},
        replace(render) { render(); }
      },
      toast() {}
    }
  };

  try {
    await openTtcSettingsMenu(api, api.ui.dialog);
    // No custom "Add API key" row — only one flow: opencode auth login
    let authRows = latestSelect.options.filter((option) => option.value === "ttc-logout");
    assert.equal(authRows.length, 0);

    await writeTuiAuthEntry({ apiKey: "ttc_existing_key" });
    await openTtcSettingsMenu(api, api.ui.dialog);
    authRows = latestSelect.options.filter((option) => option.value === "ttc-logout");
    assert.equal(authRows.length, 1);
    assert.equal(authRows[0].title, "Remove API key");
    assert.equal(authRows[0].description, "Revoke saved key");
  } finally {
    if (originalEnv.XDG_DATA_HOME === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = originalEnv.XDG_DATA_HOME;

    if (originalEnv.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalEnv.XDG_CONFIG_HOME;

    await rm(tempDataHome, { recursive: true, force: true });
    await rm(tempConfigHome, { recursive: true, force: true });
  }
});

test("TUI settings path follows existing XDG config resolution", () => {
  const path = getTtcSettingsConfigPath({ XDG_CONFIG_HOME: "/tmp/xdg-config" });
  assert.equal(path, "/tmp/xdg-config/opencode/ttc-plugin.json");
});

test("TUI settings helper validates and writes editable config values", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ttc-tui-settings-"));
  const configPath = join(tempDir, "opencode", "ttc-plugin.json");

  try {
    let result = await updateTtcSetting("toggle-enabled", undefined, { configPath });
    assert.equal(result.ok, true);
    assert.equal(result.settings.enabled, false);

    result = await updateTtcSetting("set-level", "balanced", { configPath });
    assert.equal(result.ok, true);
    assert.equal(result.settings.compressionLevel, "balanced");
    assert.equal(Object.prototype.hasOwnProperty.call(result.settings, "aggressiveness"), false);

    result = await updateTtcSetting("set-aggressiveness", "0.33", { configPath });
    assert.equal(result.ok, true);
    assert.equal(result.settings.aggressiveness, 0.33);
    assert.equal(Object.prototype.hasOwnProperty.call(result.settings, "compressionLevel"), false);

    result = await updateTtcSetting("set-min-chars", "250", { configPath });
    assert.equal(result.ok, true);
    assert.equal(result.settings.minChars, 250);

    result = await updateTtcSetting("set-model", "bear-1.2", { configPath });
    assert.equal(result.ok, true);
    assert.equal(result.settings.model, "bear-1.2");

    const written = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(written.enabled, false);
    assert.equal(written.aggressiveness, 0.33);
    assert.equal(written.minChars, 250);
    assert.equal(written.model, "bear-1.2");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("TUI settings helper rejects invalid values and resets config", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ttc-tui-settings-invalid-"));
  const configPath = join(tempDir, "opencode", "ttc-plugin.json");

  try {
    const invalidAggressiveness = await updateTtcSetting("set-aggressiveness", "1.5", { configPath });
    assert.equal(invalidAggressiveness.ok, false);

    const invalidMinChars = await updateTtcSetting("set-min-chars", "-1", { configPath });
    assert.equal(invalidMinChars.ok, false);

    const invalidModel = await updateTtcSetting("set-model", "bear secret prompt", { configPath });
    assert.equal(invalidModel.ok, false);

    await updateTtcSetting("set-model", "bear-1.2", { configPath });
    await resetTtcSettings({ configPath });

    const resetContent = await readFile(configPath, "utf8").catch(() => "");
    assert.equal(resetContent, "");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("TUI auth helpers write/remove key under current provider id with secure file mode", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ttc-tui-auth-"));
  const authPath = join(tempDir, "opencode", "auth.json");

  try {
    const written = await writeTuiAuthEntry({
      apiKey: "ttc_example_key",
      authFilePath: authPath
    });
    assert.equal(written.ok, true);
    assert.equal(written.providerID, "opencode-ttc-plugin");

    const stored = JSON.parse(await readFile(authPath, "utf8"));
    assert.equal(stored["opencode-ttc-plugin"].type, "api");
    assert.equal(stored["opencode-ttc-plugin"].key, "ttc_example_key");

    const { statSync } = await import("node:fs");
    const mode = statSync(authPath).mode & 0o777;
    assert.equal(mode, 0o600, `auth file should be 0o600, got 0o${mode.toString(8)}`);

    const hasAfter = await hasTtcAuthKey({ authFilePath: authPath });
    assert.equal(hasAfter.hasKey, true);
    assert.equal(hasAfter.providerID, "opencode-ttc-plugin");

    const removed = await removeTuiAuthEntry({ authFilePath: authPath });
    assert.equal(removed.ok, true);
    assert.equal(removed.removedAny, true);

    const hasAfterRemove = await hasTtcAuthKey({ authFilePath: authPath });
    assert.equal(hasAfterRemove.hasKey, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("auth store refuses to overwrite a corrupt file", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ttc-tui-auth-corrupt-"));
  const authPath = join(tempDir, "opencode", "auth.json");
  await mkdir(dirname(authPath), { recursive: true });
  await writeFile(authPath, "{ not valid json,,,", "utf8");

  try {
    const result = await writeTuiAuthEntry({
      apiKey: "ttc_new_key",
      authFilePath: authPath
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "auth_store_corrupt");

    const preserved = await readFile(authPath, "utf8");
    assert.equal(preserved, "{ not valid json,,,");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("auth store write is atomic — concurrent writer does not lose entries", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ttc-tui-auth-race-"));
  const authPath = join(tempDir, "opencode", "auth.json");

  try {
    await writeTuiAuthEntry({
      apiKey: "ttc_first_key",
      authFilePath: authPath
    });
    const intermediate = JSON.parse(await readFile(authPath, "utf8"));
    intermediate["another-provider"] = { type: "api", key: "other_key" };
    const { writeFile: realWriteFile, rename: realRename } = await import("node:fs/promises");
    await realWriteFile(authPath, JSON.stringify(intermediate, null, 2), "utf8");

    const result = await writeTuiAuthEntry({
      apiKey: "ttc_second_key",
      authFilePath: authPath
    });
    assert.equal(result.ok, true);

    const final = JSON.parse(await readFile(authPath, "utf8"));
    assert.equal(final["opencode-ttc-plugin"].key, "ttc_second_key");
    assert.equal(final["another-provider"].key, "other_key");
    void realRename;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("login rotates away stale legacy TTC entries and leaves unrelated providers intact", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ttc-tui-auth-rotate-"));
  const authPath = join(tempDir, "opencode", "auth.json");
  await mkdir(dirname(authPath), { recursive: true });
  await writeFile(
    authPath,
    JSON.stringify({
      "the-token-company-plugin": { type: "api", key: "ttc_old_legacy" },
      "opencode-ttc-plugin": { type: "api", key: "ttc_old_current" },
      "anthropic": { type: "api", key: "sk-ant-keepMe" },
      "openai": { type: "api", key: "sk-oai-keepMe" }
    }, null, 2),
    "utf8"
  );

  try {
    const result = await writeTuiAuthEntry({
      apiKey: "ttc_rotated",
      authFilePath: authPath
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.removedLegacyIDs, ["the-token-company-plugin"]);

    const final = JSON.parse(await readFile(authPath, "utf8"));
    assert.equal(final["opencode-ttc-plugin"].key, "ttc_rotated");
    assert.equal(final["the-token-company-plugin"], undefined, "legacy id should be cleared on rotation");
    assert.equal(final["anthropic"].key, "sk-ant-keepMe", "unrelated providers must be preserved");
    assert.equal(final["openai"].key, "sk-oai-keepMe", "unrelated providers must be preserved");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("login with no legacy entry present reports empty removedLegacyIDs", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ttc-tui-auth-fresh-"));
  const authPath = join(tempDir, "opencode", "auth.json");

  try {
    const result = await writeTuiAuthEntry({
      apiKey: "ttc_brand_new",
      authFilePath: authPath
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.removedLegacyIDs, []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("loadAuthStatus recognises legacy provider entries", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ttc-tui-authstatus-"));
  const authPath = join(tempDir, "opencode", "auth.json");
  await mkdir(dirname(authPath), { recursive: true });
  await writeFile(
    authPath,
    JSON.stringify({ "the-token-company-plugin": { type: "api", key: "legacy" } }),
    "utf8"
  );

  try {
    const status = await loadAuthStatus({ authFilePath: authPath });
    assert.equal(status.hasKey, true);
    assert.equal(status.providerID, "the-token-company-plugin");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("loadAuthStatus and hasAuthEntry treat TTC_API_KEY env as valid auth source", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ttc-env-auth-"));
  const authPath = join(tempDir, "opencode", "auth.json");
  await mkdir(dirname(authPath), { recursive: true });
  // no key file present -> store reports no key

  const envWithKey = { TTC_API_KEY: "ttc_env_key_123" };
  const envNoKey = {};

  try {
    // env short-circuits regardless of store
    const statusEnv = await loadAuthStatus({ env: envWithKey, authFilePath: authPath });
    assert.equal(statusEnv.hasKey, true);
    assert.equal(statusEnv.providerID, "env");

    const statusNoEnv = await loadAuthStatus({ env: envNoKey, authFilePath: authPath });
    assert.equal(statusNoEnv.hasKey, false);

    // hasAuthEntry (TUI hasTtcAuthKey) also respects env
    const hasEnv = await hasTtcAuthKey({ env: envWithKey, authFilePath: authPath });
    assert.equal(hasEnv.hasKey, true);
    assert.equal(hasEnv.providerID, "env");

    const hasNoEnv = await hasTtcAuthKey({ env: envNoKey, authFilePath: authPath });
    assert.equal(hasNoEnv.hasKey, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("known TTC model list is grounded in current docs", () => {
  const ids = TUI_KNOWN_MODELS.map((model) => model.id);
  assert.deepEqual(ids.sort(), ["bear-1.2", "bear-2"].sort());
  assert.equal(TUI_AUTH_PROVIDER_ID, "opencode-ttc-plugin");
});
