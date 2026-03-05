const baseUrl = (process.env.PROXY_BASE_URL ?? "http://localhost:8080/v1").replace(/\/$/, "");
const rootUrl = baseUrl.endsWith("/v1") ? baseUrl.slice(0, -3) : baseUrl;
const model = process.env.PROXY_TEST_MODEL ?? "arcee-ai/trinity-large-preview:free";
const apiKey = process.env.PROXY_TEST_API_KEY ?? "";

function authHeaders() {
  if (!apiKey) return {};
  return { Authorization: `Bearer ${apiKey}` };
}

async function expectStatus(name, response, expected) {
  if (response.status !== expected) {
    const body = await response.text();
    throw new Error(`${name} expected ${expected}, got ${response.status}: ${body.slice(0, 300)}`);
  }
}

async function main() {
  console.log(`[smoke] base=${baseUrl}`);

  const healthRes = await fetch(`${rootUrl}/healthz`, { headers: authHeaders() });
  await expectStatus("health", healthRes, 200);
  console.log("[smoke] healthz ok");

  const modelsRes = await fetch(`${baseUrl}/models`, { headers: authHeaders() });
  await expectStatus("models", modelsRes, 200);
  const modelsPayload = await modelsRes.json();
  const modelIds = Array.isArray(modelsPayload.data) ? modelsPayload.data.map((item) => item.id) : [];
  console.log(`[smoke] models listed: ${modelIds.length}`);

  const chatRes = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: "user", content: "Reply with exactly: smoke chat ok" }]
    })
  });
  await expectStatus("chat", chatRes, 200);
  const chatPayload = await chatRes.json();
  const chatText = chatPayload?.choices?.[0]?.message?.content ?? "";
  console.log(`[smoke] chat ok (${String(chatText).slice(0, 40)})`);

  const responsesRes = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify({
      model,
      stream: false,
      input: "Reply with exactly: smoke responses ok"
    })
  });
  await expectStatus("responses", responsesRes, 200);
  console.log("[smoke] responses ok");

  const embeddingsRes = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify({
      model: process.env.PROXY_TEST_EMBEDDING_MODEL ?? "text-embedding-3-small",
      input: "smoke embeddings"
    })
  });
  if (embeddingsRes.status === 200) {
    console.log("[smoke] embeddings ok");
  } else {
    console.log(`[smoke] embeddings skipped (${embeddingsRes.status})`);
  }

  const statsRes = await fetch(`${rootUrl}/stats`, { headers: authHeaders() });
  if (statsRes.status === 200) {
    const stats = await statsRes.json();
    console.log(
      `[smoke] stats requests=${stats.requests_total} upstream_retries=${stats.upstream_retry_count} compression_applied=${stats.compression_applied_count}`
    );
  } else {
    console.log(`[smoke] stats unavailable (${statsRes.status})`);
  }

  console.log("[smoke] PASS");
}

main().catch((error) => {
  console.error(`[smoke] FAIL: ${error.message}`);
  process.exit(1);
});
