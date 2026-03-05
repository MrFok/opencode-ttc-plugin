import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

let nextPort = 36000;
function randomPort() {
  nextPort += 1;
  return nextPort;
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
    UPSTREAM_API_KEY: "test-key",
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

function createModelsServer(modelsData) {
  return createServer((req, res) => {
    if (req.url === "/v1/models" || req.url === "/models") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ object: "list", data: modelsData }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
}

test("/v1/models passthrough mode returns default provider models", async () => {
  const upstreamPort = randomPort();
  const proxyPort = randomPort();
  const upstream = createModelsServer([
    { id: "gpt-5.2", object: "model", created: 1, owned_by: "openai" },
    { id: "gpt-4.1", object: "model", created: 1, owned_by: "openai" }
  ]);
  await once(upstream.listen(upstreamPort), "listening");

  const proxy = startProxy(proxyPort, `http://127.0.0.1:${upstreamPort}`, {
    MODELS_SOURCE_MODE: "passthrough",
    MODELS_ALLOWLIST: "gpt-5.2"
  });

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/models`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.object, "list");
    assert.deepEqual(body.data.map((m) => m.id), ["gpt-5.2"]);
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("/v1/models aggregate mode merges providers and de-duplicates", async () => {
  const primaryPort = randomPort();
  const secondaryPort = randomPort();
  const proxyPort = randomPort();

  const primary = createModelsServer([
    { id: "model-a", object: "model", created: 1, owned_by: "primary" },
    { id: "shared-model", object: "model", created: 1, owned_by: "primary" }
  ]);
  const secondary = createModelsServer([
    { id: "model-b", object: "model", created: 1, owned_by: "secondary" },
    { id: "shared-model", object: "model", created: 1, owned_by: "secondary" }
  ]);
  await once(primary.listen(primaryPort), "listening");
  await once(secondary.listen(secondaryPort), "listening");

  const proxy = startProxy(proxyPort, `http://127.0.0.1:${primaryPort}`, {
    MODELS_SOURCE_MODE: "aggregate",
    UPSTREAM_PROVIDERS_JSON: JSON.stringify({
      secondary: {
        baseURL: `http://127.0.0.1:${secondaryPort}`,
        apiKey: "secondary-key",
        authMode: "provider_key"
      }
    }),
    MODELS_ALIASES_JSON: JSON.stringify({ "model-b": "Model B Alias" })
  });

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/models`);
    assert.equal(response.status, 200);
    const body = await response.json();
    const ids = body.data.map((m) => m.id).sort();
    assert.deepEqual(ids, ["model-a", "model-b", "shared-model"]);
    const modelB = body.data.find((item) => item.id === "model-b");
    assert.equal(modelB.name, "Model B Alias");
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => primary.close(resolve));
    await new Promise((resolve) => secondary.close(resolve));
  }
});

test("/v1/models static mode uses configured static model list", async () => {
  const proxyPort = randomPort();
  const proxy = startProxy(proxyPort, "http://127.0.0.1:1", {
    MODELS_SOURCE_MODE: "static",
    MODELS_STATIC_JSON: JSON.stringify([
      { id: "static-model-1", created: 1, owned_by: "proxy" },
      { id: "static-model-2", created: 1, owned_by: "proxy" }
    ]),
    MODELS_DENYLIST: "static-model-2"
  });

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/models`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.data.map((m) => m.id), ["static-model-1"]);
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
  }
});
