import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

let nextPort = 25000;
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
    PROXY_API_KEY: "",
    ENABLE_COMPRESSION: "false",
    TOKEN_COMPANY_API_KEY: "",
    LOG_LEVEL: "error",
    LOG_LOCAL_ENDPOINT: "false",
    UPSTREAM_MAX_RETRIES: "1",
    UPSTREAM_RETRY_BACKOFF_MS: "20",
    UPSTREAM_RETRY_STATUS_CODES: "429,500,502,503,504",
    UPSTREAM_STREAM_FIRST_CHUNK_TIMEOUT_MS: "120",
    UPSTREAM_TOTAL_TIMEOUT_MS: "5000",
    ...extraEnv
  };

  return spawn("node", ["src/server.js"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

test("retries upstream on 500 and succeeds", async () => {
  const upstreamPort = randomPort();
  const proxyPort = randomPort();
  let calls = 0;

  const upstreamServer = createServer(async (req, res) => {
    calls += 1;
    const payload = await readJsonBody(req);
    if (calls === 1) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "retry me" }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "ok",
        object: "chat.completion",
        created: 1,
        model: payload.model,
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }]
      })
    );
  });

  await once(upstreamServer.listen(upstreamPort), "listening");
  const proxy = startProxy(proxyPort, `http://127.0.0.1:${upstreamPort}`);

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "primary", stream: false, messages: [{ role: "user", content: "hello" }] })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.choices[0].message.content, "ok");
    assert.equal(calls, 2);
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => upstreamServer.close(resolve));
  }
});

test("does not retry upstream on 401", async () => {
  const upstreamPort = randomPort();
  const proxyPort = randomPort();
  let calls = 0;

  const upstreamServer = createServer(async (req, res) => {
    calls += 1;
    for await (const _chunk of req) {
      // drain body
    }
    res.statusCode = 401;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "unauthorized" }));
  });

  await once(upstreamServer.listen(upstreamPort), "listening");
  const proxy = startProxy(proxyPort, `http://127.0.0.1:${upstreamPort}`);

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "primary", stream: false, messages: [{ role: "user", content: "hello" }] })
    });

    assert.equal(response.status, 401);
    assert.equal(calls, 1);
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => upstreamServer.close(resolve));
  }
});

test("falls back to backup model when primary exhausts retries", async () => {
  const upstreamPort = randomPort();
  const proxyPort = randomPort();
  const seenModels = [];

  const upstreamServer = createServer(async (req, res) => {
    const payload = await readJsonBody(req);
    seenModels.push(payload.model);

    if (payload.model === "primary") {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "primary down" }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "ok",
        object: "chat.completion",
        created: 1,
        model: payload.model,
        choices: [{ index: 0, message: { role: "assistant", content: `from-${payload.model}` }, finish_reason: "stop" }]
      })
    );
  });

  await once(upstreamServer.listen(upstreamPort), "listening");
  const proxy = startProxy(proxyPort, `http://127.0.0.1:${upstreamPort}`, {
    UPSTREAM_MAX_RETRIES: "0",
    UPSTREAM_FALLBACKS: "primary=backup"
  });

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "primary", stream: false, messages: [{ role: "user", content: "hello" }] })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.choices[0].message.content, "from-backup");
    assert.deepEqual(seenModels, ["primary", "backup"]);
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => upstreamServer.close(resolve));
  }
});

test("does not fallback after first streamed bytes are sent", async () => {
  const upstreamPort = randomPort();
  const proxyPort = randomPort();
  const seenModels = [];

  const upstreamServer = createServer(async (req, res) => {
    const payload = await readJsonBody(req);
    seenModels.push(payload.model);

    if (payload.model === "primary") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain");
      res.write("first-");
      setTimeout(() => {
        req.socket.destroy();
      }, 20);
      return;
    }

    res.statusCode = 200;
    res.setHeader("content-type", "text/plain");
    res.end("backup");
  });

  await once(upstreamServer.listen(upstreamPort), "listening");
  const proxy = startProxy(proxyPort, `http://127.0.0.1:${upstreamPort}`, {
    UPSTREAM_MAX_RETRIES: "1",
    UPSTREAM_FALLBACKS: "primary=backup"
  });

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "primary", stream: true, messages: [{ role: "user", content: "hello" }] })
    });

    const reader = response.body?.getReader();
    if (reader) {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
        }
      } catch {
        // expected if stream is terminated
      }
    }

    assert.deepEqual(seenModels, ["primary"]);
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => upstreamServer.close(resolve));
  }
});

test("first chunk timeout can route to fallback before stream starts", async () => {
  const upstreamPort = randomPort();
  const proxyPort = randomPort();
  const seenModels = [];

  const upstreamServer = createServer(async (req, res) => {
    const payload = await readJsonBody(req);
    seenModels.push(payload.model);

    res.statusCode = 200;
    res.setHeader("content-type", "text/plain");
    if (payload.model === "primary") {
      res.flushHeaders();
      setTimeout(() => {
        res.end("late-primary");
      }, 300);
      return;
    }

    res.end("backup-stream");
  });

  await once(upstreamServer.listen(upstreamPort), "listening");
  const proxy = startProxy(proxyPort, `http://127.0.0.1:${upstreamPort}`, {
    UPSTREAM_MAX_RETRIES: "0",
    UPSTREAM_FALLBACKS: "primary=backup",
    UPSTREAM_STREAM_FIRST_CHUNK_TIMEOUT_MS: "80"
  });

  try {
    await waitForHealthy(proxyPort);
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "primary", stream: true, messages: [{ role: "user", content: "hello" }] })
    });

    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(body, "backup-stream");
    assert.deepEqual(seenModels, ["primary", "backup"]);
  } finally {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
    await new Promise((resolve) => upstreamServer.close(resolve));
  }
});
