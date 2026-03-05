import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

let nextPort = 35000;
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
    UPSTREAM_API_KEY: "",
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

function completionResponse(content = "ok") {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "test-model",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }]
  };
}

test("provider authMode=client_bearer forwards client authorization token", async () => {
  const upstreamPort = randomPort();
  const proxyPort = randomPort();
  let authHeader = "";

  const upstreamServer = createServer(async (req, res) => {
    await readJsonBody(req);
    authHeader = String(req.headers.authorization ?? "");
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(completionResponse()));
  });
  await once(upstreamServer.listen(upstreamPort), "listening");

  const proxy = startProxy(proxyPort, `http://127.0.0.1:${upstreamPort}`, {
    UPSTREAM_PROVIDERS_JSON: JSON.stringify({
      providerA: {
        baseURL: `http://127.0.0.1:${upstreamPort}`,
        authMode: "client_bearer",
        passThroughClientAuth: true
      }
    }),
    MODEL_ROUTE_RULES_JSON: JSON.stringify([{ match: "exact", value: "m1", provider: "providerA" }]),
    MODEL_DEFAULT_PROVIDER: "providerA"
  });

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer client-token-123"
      },
      body: JSON.stringify({ model: "m1", stream: false, messages: [{ role: "user", content: "hello" }] })
    });

    assert.equal(response.status, 200);
    assert.equal(authHeader, "Bearer client-token-123");
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => upstreamServer.close(resolve));
  }
});

test("provider authMode=provider_key uses provider api key over client auth", async () => {
  const upstreamPort = randomPort();
  const proxyPort = randomPort();
  let authHeader = "";

  const upstreamServer = createServer(async (req, res) => {
    await readJsonBody(req);
    authHeader = String(req.headers.authorization ?? "");
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(completionResponse()));
  });
  await once(upstreamServer.listen(upstreamPort), "listening");

  const proxy = startProxy(proxyPort, `http://127.0.0.1:${upstreamPort}`, {
    UPSTREAM_PROVIDERS_JSON: JSON.stringify({
      providerA: {
        baseURL: `http://127.0.0.1:${upstreamPort}`,
        authMode: "provider_key",
        apiKey: "provider-secret"
      }
    }),
    MODEL_ROUTE_RULES_JSON: JSON.stringify([{ match: "exact", value: "m2", provider: "providerA" }]),
    MODEL_DEFAULT_PROVIDER: "providerA"
  });

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer client-token-ignored"
      },
      body: JSON.stringify({ model: "m2", stream: false, messages: [{ role: "user", content: "hello" }] })
    });

    assert.equal(response.status, 200);
    assert.equal(authHeader, "Bearer provider-secret");
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => upstreamServer.close(resolve));
  }
});

test("strict provider config mode exits process when required provider key is missing", async () => {
  const proxyPort = randomPort();
  const proxy = startProxy(proxyPort, "http://127.0.0.1:1", {
    PROVIDER_CONFIG_STRICT: "true",
    UPSTREAM_PROVIDERS_JSON: JSON.stringify({
      broken: {
        baseURL: "http://127.0.0.1:1",
        authMode: "provider_key",
        apiKey: ""
      }
    }),
    MODEL_DEFAULT_PROVIDER: "broken"
  });

  const [code] = await once(proxy, "exit");
  assert.notEqual(code, 0);
});
