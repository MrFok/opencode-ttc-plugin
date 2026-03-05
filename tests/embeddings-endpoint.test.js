import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

let nextPort = 39000;
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

test("/v1/embeddings routes and returns embeddings payload", async () => {
  const upstreamPort = randomPort();
  const proxyPort = randomPort();

  const upstream = createServer(async (req, res) => {
    const payload = await readJsonBody(req);
    if (req.url === "/v1/embeddings") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          object: "list",
          data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] }],
          model: payload.model,
          usage: { prompt_tokens: 4, total_tokens: 4 }
        })
      );
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await once(upstream.listen(upstreamPort), "listening");
  const proxy = startProxy(proxyPort, `http://127.0.0.1:${upstreamPort}`);

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-large", input: "hello" })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.object, "list");
    assert.equal(body.data[0].object, "embedding");
    assert.equal(body.model, "text-embedding-3-large");
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("/v1/embeddings falls back to secondary provider on primary failure", async () => {
  const primaryPort = randomPort();
  const backupPort = randomPort();
  const proxyPort = randomPort();
  const calls = [];

  const primary = createServer(async (req, res) => {
    const payload = await readJsonBody(req);
    calls.push(`primary:${payload.model}`);
    if (req.url === "/v1/embeddings") {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "primary fail" }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  const backup = createServer(async (req, res) => {
    const payload = await readJsonBody(req);
    calls.push(`backup:${payload.model}`);
    if (req.url === "/v1/embeddings") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          object: "list",
          data: [{ object: "embedding", index: 0, embedding: [0.9, 0.8] }],
          model: payload.model,
          usage: { prompt_tokens: 2, total_tokens: 2 }
        })
      );
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await once(primary.listen(primaryPort), "listening");
  await once(backup.listen(backupPort), "listening");

  const proxy = startProxy(proxyPort, `http://127.0.0.1:${primaryPort}`, {
    UPSTREAM_PROVIDERS_JSON: JSON.stringify({
      backup: { baseURL: `http://127.0.0.1:${backupPort}`, apiKey: "backup-key", authMode: "provider_key" }
    }),
    MODEL_ROUTE_RULES_JSON: JSON.stringify([{ match: "exact", value: "embed-primary", provider: "default" }]),
    MODEL_FALLBACK_RULES_JSON: JSON.stringify({ "embed-primary": ["backup:embed-backup"] }),
    UPSTREAM_MAX_RETRIES: "0"
  });

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "embed-primary", input: "hi" })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.model, "embed-backup");
    assert.deepEqual(calls, ["primary:embed-primary", "backup:embed-backup"]);
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => primary.close(resolve));
    await new Promise((resolve) => backup.close(resolve));
  }
});
