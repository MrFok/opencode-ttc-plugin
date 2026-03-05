import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

let nextPort = 30000;
function randomPort() {
  nextPort += 1;
  return nextPort;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function waitForHealthy(port) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.status === 200) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Proxy failed health check");
}

function startProxy(port, baseURL, extraEnv = {}) {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    LOCAL_TEST_MODE: "false",
    PORT: String(port),
    UPSTREAM_BASE_URL: baseURL,
    UPSTREAM_API_KEY: "base-key",
    ENABLE_COMPRESSION: "false",
    LOG_LEVEL: "error",
    LOG_LOCAL_ENDPOINT: "false",
    ...extraEnv
  };

  return spawn("node", ["src/server.js"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function completionResponse(model, content) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }]
  };
}

test("routes model by exact rule to configured provider", async () => {
  const defaultPort = randomPort();
  const openrouterPort = randomPort();
  const proxyPort = randomPort();

  let defaultCalls = 0;
  let openrouterCalls = 0;

  const defaultServer = createServer(async (req, res) => {
    defaultCalls += 1;
    const payload = await readJsonBody(req);
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(completionResponse(payload.model, "from-default")));
  });

  const openrouterServer = createServer(async (req, res) => {
    openrouterCalls += 1;
    const payload = await readJsonBody(req);
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(completionResponse(payload.model, "from-openrouter")));
  });

  await once(defaultServer.listen(defaultPort), "listening");
  await once(openrouterServer.listen(openrouterPort), "listening");

  const proxy = startProxy(proxyPort, `http://127.0.0.1:${defaultPort}`, {
    UPSTREAM_PROVIDERS_JSON: JSON.stringify({
      openrouter: {
        baseURL: `http://127.0.0.1:${openrouterPort}`,
        apiKey: "or-key",
        passThroughClientAuth: false
      }
    }),
    MODEL_ROUTE_RULES_JSON: JSON.stringify([
      { match: "exact", value: "arcee-ai/trinity-large-preview:free", provider: "openrouter" }
    ]),
    MODEL_DEFAULT_PROVIDER: "default"
  });

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "arcee-ai/trinity-large-preview:free",
        stream: false,
        messages: [{ role: "user", content: "hello" }]
      })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.choices[0].message.content, "from-openrouter");
    assert.equal(defaultCalls, 0);
    assert.equal(openrouterCalls, 1);
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => defaultServer.close(resolve));
    await new Promise((resolve) => openrouterServer.close(resolve));
  }
});

test("uses default provider when no route rule matches", async () => {
  const defaultPort = randomPort();
  const proxyPort = randomPort();

  let defaultCalls = 0;
  const defaultServer = createServer(async (req, res) => {
    defaultCalls += 1;
    const payload = await readJsonBody(req);
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(completionResponse(payload.model, "default-only")));
  });

  await once(defaultServer.listen(defaultPort), "listening");
  const proxy = startProxy(proxyPort, `http://127.0.0.1:${defaultPort}`);

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "unknown/model",
        stream: false,
        messages: [{ role: "user", content: "hello" }]
      })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.choices[0].message.content, "default-only");
    assert.equal(defaultCalls, 1);
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => defaultServer.close(resolve));
  }
});

test("falls back across providers using configured fallback rules", async () => {
  const primaryPort = randomPort();
  const backupPort = randomPort();
  const proxyPort = randomPort();
  const calls = [];

  const primaryServer = createServer(async (req, res) => {
    const payload = await readJsonBody(req);
    calls.push(`primary:${payload.model}`);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "primary-fail" }));
  });

  const backupServer = createServer(async (req, res) => {
    const payload = await readJsonBody(req);
    calls.push(`backup:${payload.model}`);
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(completionResponse(payload.model, "from-backup-provider")));
  });

  await once(primaryServer.listen(primaryPort), "listening");
  await once(backupServer.listen(backupPort), "listening");

  const proxy = startProxy(proxyPort, `http://127.0.0.1:${primaryPort}`, {
    UPSTREAM_PROVIDERS_JSON: JSON.stringify({
      backup: {
        baseURL: `http://127.0.0.1:${backupPort}`,
        apiKey: "backup-key"
      }
    }),
    MODEL_ROUTE_RULES_JSON: JSON.stringify([
      { match: "exact", value: "primary/model", provider: "default" }
    ]),
    MODEL_FALLBACK_RULES_JSON: JSON.stringify({
      "primary/model": ["backup:backup/model"]
    }),
    UPSTREAM_MAX_RETRIES: "0"
  });

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "primary/model",
        stream: false,
        messages: [{ role: "user", content: "hello" }]
      })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.choices[0].message.content, "from-backup-provider");
    assert.deepEqual(calls, ["primary:primary/model", "backup:backup/model"]);
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => primaryServer.close(resolve));
    await new Promise((resolve) => backupServer.close(resolve));
  }
});
