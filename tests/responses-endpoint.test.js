import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

let nextPort = 38000;
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

test("/v1/responses supports fallback routing across providers", async () => {
  const primaryPort = randomPort();
  const backupPort = randomPort();
  const proxyPort = randomPort();
  const calls = [];

  const primary = createServer(async (req, res) => {
    const payload = await readJsonBody(req);
    calls.push(`primary:${payload.model}`);
    if (req.url === "/v1/responses") {
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
    if (req.url === "/v1/responses") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "resp_123",
          object: "response",
          model: payload.model,
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "backup response" }]
            }
          ]
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
    MODEL_ROUTE_RULES_JSON: JSON.stringify([{ match: "exact", value: "m-response", provider: "default" }]),
    MODEL_FALLBACK_RULES_JSON: JSON.stringify({ "m-response": ["backup:m-response-b"] }),
    UPSTREAM_MAX_RETRIES: "0"
  });

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "m-response", input: "hello", stream: false })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.model, "m-response-b");
    assert.equal(body.output[0].content[0].text, "backup response");
    assert.deepEqual(calls, ["primary:m-response", "backup:m-response-b"]);
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => primary.close(resolve));
    await new Promise((resolve) => backup.close(resolve));
  }
});

test("/v1/responses streams upstream response chunks", async () => {
  const upstreamPort = randomPort();
  const proxyPort = randomPort();

  const upstream = createServer(async (req, res) => {
    await readJsonBody(req);
    if (req.url === "/v1/responses") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      res.write("data: {\"delta\":\"hello\"}\n\n");
      setTimeout(() => {
        res.end("data: [DONE]\n\n");
      }, 20);
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await once(upstream.listen(upstreamPort), "listening");
  const proxy = startProxy(proxyPort, `http://127.0.0.1:${upstreamPort}`);

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "stream-model", input: "hello", stream: true })
    });

    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /data: \{\"delta\":\"hello\"\}/);
    assert.match(text, /data: \[DONE\]/);
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => upstream.close(resolve));
  }
});
