import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

let nextPort = 39500;
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

function startProxy(port, upstreamBaseUrl, extraEnv = {}) {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    LOCAL_TEST_MODE: "false",
    PORT: String(port),
    UPSTREAM_BASE_URL: upstreamBaseUrl,
    UPSTREAM_API_KEY: "test-upstream-key",
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

test("returns OpenAI-style error schema for unauthorized requests", async () => {
  const upstreamPort = randomPort();
  const proxyPort = randomPort();

  const upstream = createServer((_req, res) => {
    res.statusCode = 500;
    res.end();
  });
  await once(upstream.listen(upstreamPort), "listening");

  const proxy = startProxy(proxyPort, `http://127.0.0.1:${upstreamPort}`, {
    PROXY_API_KEY: "required-key"
  });

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] })
    });

    assert.equal(response.status, 401);
    const body = await response.json();
    assert.ok(body.error);
    assert.equal(typeof body.error.message, "string");
    assert.equal(body.error.type, "authentication_error");
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("forwards tools payload unchanged to upstream", async () => {
  const upstreamPort = randomPort();
  const proxyPort = randomPort();

  let seenTools = null;
  const upstream = createServer(async (req, res) => {
    const payload = await readJsonBody(req);
    seenTools = payload.tools;
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "chatcmpl-tool",
        object: "chat.completion",
        created: 1,
        model: payload.model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop"
          }
        ]
      })
    );
  });
  await once(upstream.listen(upstreamPort), "listening");

  const proxy = startProxy(proxyPort, `http://127.0.0.1:${upstreamPort}`);

  try {
    await waitForHealthy(proxyPort);
    const tools = [
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Read a file",
          parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
        }
      }
    ];

    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "m-tools",
        stream: false,
        tools,
        messages: [{ role: "user", content: "test tools" }]
      })
    });

    assert.equal(response.status, 200);
    assert.deepEqual(seenTools, tools);
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("chat streaming contract preserves SSE framing", async () => {
  const upstreamPort = randomPort();
  const proxyPort = randomPort();

  const upstream = createServer(async (req, res) => {
    await readJsonBody(req);
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream");
    res.write("data: {\"id\":\"chunk-1\"}\n\n");
    setTimeout(() => {
      res.end("data: [DONE]\n\n");
    }, 20);
  });
  await once(upstream.listen(upstreamPort), "listening");

  const proxy = startProxy(proxyPort, `http://127.0.0.1:${upstreamPort}`);

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "m-stream",
        stream: true,
        messages: [{ role: "user", content: "stream test" }]
      })
    });

    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /data: \{\"id\":\"chunk-1\"\}/);
    assert.match(text, /data: \[DONE\]/);
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("single relay mode forwards unknown /v1 routes", async () => {
  const upstreamPort = randomPort();
  const proxyPort = randomPort();

  let seenPath = "";
  let seenBody = null;
  const upstream = createServer(async (req, res) => {
    seenPath = String(req.url ?? "");
    seenBody = await readJsonBody(req);
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, echoed: seenBody?.input ?? null }));
  });
  await once(upstream.listen(upstreamPort), "listening");

  const proxy = startProxy(proxyPort, `http://127.0.0.1:${upstreamPort}`, {
    RELAY_MODE: "single_base_url"
  });

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/realtime/sessions?mode=test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "hello relay" })
    });

    assert.equal(response.status, 200);
    assert.equal(seenPath, "/v1/realtime/sessions?mode=test");
    assert.deepEqual(seenBody, { input: "hello relay" });
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.echoed, "hello relay");
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("supports separate proxy auth header and upstream bearer passthrough", async () => {
  const upstreamPort = randomPort();
  const proxyPort = randomPort();

  let upstreamAuth = "";
  const upstream = createServer(async (req, res) => {
    await readJsonBody(req);
    upstreamAuth = String(req.headers.authorization ?? "");
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "chatcmpl-auth",
        object: "chat.completion",
        created: 1,
        model: "m-auth",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }]
      })
    );
  });
  await once(upstream.listen(upstreamPort), "listening");

  const proxy = startProxy(proxyPort, `http://127.0.0.1:${upstreamPort}`, {
    PROXY_API_KEY: "proxy-secret",
    PROXY_API_KEY_HEADER: "x-proxy-key",
    UPSTREAM_API_KEY: ""
  });

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Proxy-Key": "proxy-secret",
        Authorization: "Bearer upstream-client-token"
      },
      body: JSON.stringify({
        model: "m-auth",
        stream: false,
        messages: [{ role: "user", content: "auth test" }]
      })
    });

    assert.equal(response.status, 200);
    assert.equal(upstreamAuth, "Bearer upstream-client-token");
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => upstream.close(resolve));
  }
});
