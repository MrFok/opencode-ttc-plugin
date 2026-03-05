import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

let nextPort = 20000;
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

async function waitForHealthy(port, token) {
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, { headers: authHeaders });
      if (response.status === 200) return;
    } catch {
      // Retry
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Proxy on port ${port} did not become healthy in time`);
}

function startProxy(port, upstreamBaseUrl, extraEnv = {}) {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    LOCAL_TEST_MODE: "false",
    PORT: String(port),
    UPSTREAM_BASE_URL: upstreamBaseUrl,
    UPSTREAM_API_KEY: "test-upstream-key",
    PROXY_API_KEY: "test-proxy-key",
    ENABLE_COMPRESSION: "true",
    TOKEN_COMPANY_API_KEY: "test-ttc-key",
    TOKEN_COMPANY_TIMEOUT_MS: "200",
    TOKEN_COMPANY_MODEL: "bear-1.2",
    TOKEN_COMPANY_AGGRESSIVENESS: "0.1",
    TOKEN_COMPANY_USE_GZIP: "false",
    TOKEN_COMPANY_MAX_RETRIES: "1",
    TOKEN_COMPANY_RETRY_BACKOFF_MS: "20",
    COMPRESSION_MIN_CHARS: "50",
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

test("fail-open forwards original prompt when TTC is unreachable", async () => {
  const upstreamPort = randomPort();
  const proxyPort = randomPort();
  const originalPrompt = "This is a long plain text message intended to trigger compression threshold in fail-open test mode.";

  let upstreamReceived = "";
  const upstreamServer = createServer(async (req, res) => {
    const payload = await readJsonBody(req);
    upstreamReceived = payload.messages[0].content;
    const responseBody = {
      id: "chatcmpl-test",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: payload.model,
      choices: [{ index: 0, message: { role: "assistant", content: upstreamReceived }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(responseBody));
  });

  await once(upstreamServer.listen(upstreamPort), "listening");

  const proxy = startProxy(proxyPort, `http://127.0.0.1:${upstreamPort}`, {
    TOKEN_COMPANY_BASE_URL: "http://127.0.0.1:9"
  });

  try {
    await waitForHealthy(proxyPort, "test-proxy-key");

    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-proxy-key"
      },
      body: JSON.stringify({
        model: "arcee-ai/trinity-large-preview:free",
        stream: false,
        messages: [{ role: "user", content: originalPrompt }]
      })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.choices[0].message.content, originalPrompt);
    assert.equal(upstreamReceived, originalPrompt);
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => upstreamServer.close(resolve));
  }
});

test("TTC retried once after 500 then applies compression", async () => {
  const upstreamPort = randomPort();
  const ttcPort = randomPort();
  const proxyPort = randomPort();

  let upstreamReceived = "";
  let ttcCalls = 0;

  const upstreamServer = createServer(async (req, res) => {
    const payload = await readJsonBody(req);
    upstreamReceived = payload.messages[0].content;
    const responseBody = {
      id: "chatcmpl-test",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: payload.model,
      choices: [{ index: 0, message: { role: "assistant", content: upstreamReceived }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(responseBody));
  });

  const ttcServer = createServer(async (req, res) => {
    if (req.url !== "/v1/compress") {
      res.statusCode = 404;
      res.end();
      return;
    }

    ttcCalls += 1;
    await readJsonBody(req);
    if (ttcCalls === 1) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "temporary" }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        output: "COMPRESSED_TEXT",
        output_tokens: 2,
        original_input_tokens: 10
      })
    );
  });

  await once(upstreamServer.listen(upstreamPort), "listening");
  await once(ttcServer.listen(ttcPort), "listening");

  const proxy = startProxy(proxyPort, `http://127.0.0.1:${upstreamPort}`, {
    TOKEN_COMPANY_BASE_URL: `http://127.0.0.1:${ttcPort}`,
    TOKEN_COMPANY_MAX_RETRIES: "1"
  });

  try {
    await waitForHealthy(proxyPort, "test-proxy-key");
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-proxy-key"
      },
      body: JSON.stringify({
        model: "arcee-ai/trinity-large-preview:free",
        stream: false,
        messages: [
          {
            role: "user",
            content: "This is a long plain text message that should trigger compression and be replaced after retry succeeds."
          }
        ]
      })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.choices[0].message.content, "COMPRESSED_TEXT");
    assert.equal(upstreamReceived, "COMPRESSED_TEXT");
    assert.equal(ttcCalls, 2);
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => upstreamServer.close(resolve));
    await new Promise((resolve) => ttcServer.close(resolve));
  }
});
