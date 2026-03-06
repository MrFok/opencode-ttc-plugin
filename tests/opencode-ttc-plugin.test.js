import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTtcPluginConfig,
  getSkipReasonForText,
  transformMessagesWithTtc
} from "../opencode-plugins/ttc-message-transform-core.js";
import TtcMessageTransformPlugin from "../opencode-plugins/ttc-message-transform.js";

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
  assert.equal(parsed.baseUrl, "https://example.com");
  assert.equal(parsed.minChars, 222);
  assert.equal(parsed.useGzip, false);
  assert.equal(parsed.compressSystem, true);
  assert.equal(parsed.compressHistory, true);
  assert.equal(parsed.cacheMaxEntries, 50);
  assert.equal(parsed.toastOnActive, false);
  assert.equal(parsed.toastOnIdleSummary, false);
});

test("shows activation and idle summary toasts in TUI", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    TTC_API_KEY: process.env.TTC_API_KEY,
    TTC_MIN_CHARS: process.env.TTC_MIN_CHARS,
    TTC_TOAST_ON_ACTIVE: process.env.TTC_TOAST_ON_ACTIVE,
    TTC_TOAST_ON_IDLE_SUMMARY: process.env.TTC_TOAST_ON_IDLE_SUMMARY
  };

  process.env.TTC_API_KEY = "ttc_test_key";
  process.env.TTC_MIN_CHARS = "10";
  process.env.TTC_TOAST_ON_ACTIVE = "true";
  process.env.TTC_TOAST_ON_IDLE_SUMMARY = "true";

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
  }
});
