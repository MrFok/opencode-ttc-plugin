const baseUrl = (process.env.PROXY_BASE_URL ?? "http://localhost:8080/v1").replace(/\/$/, "");
const model = process.env.PROXY_TEST_MODEL ?? "arcee-ai/trinity-large-preview:free";
const apiKey = process.env.PROXY_TEST_API_KEY ?? "";
const concurrency = Number.parseInt(process.env.LOAD_CONCURRENCY ?? "3", 10);
const requestsPerWorker = Number.parseInt(process.env.LOAD_REQUESTS_PER_WORKER ?? "10", 10);
const stream = process.env.LOAD_STREAM === "true";

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function headers() {
  const h = { "Content-Type": "application/json" };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

async function runOne() {
  const started = Date.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model,
      stream,
      messages: [{ role: "user", content: "Reply with exactly: load test ok" }]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`status=${response.status} body=${body.slice(0, 200)}`);
  }

  if (stream) {
    await response.text();
  } else {
    await response.json();
  }

  return Date.now() - started;
}

async function worker(index) {
  const latencies = [];
  let errors = 0;
  for (let i = 0; i < requestsPerWorker; i += 1) {
    try {
      const ms = await runOne();
      latencies.push(ms);
    } catch (error) {
      errors += 1;
      console.error(`[load] worker=${index} req=${i} error=${error.message}`);
    }
  }
  return { latencies, errors };
}

async function main() {
  console.log(`[load] base=${baseUrl} model=${model} stream=${stream}`);
  console.log(`[load] concurrency=${concurrency} requests_per_worker=${requestsPerWorker}`);

  const started = Date.now();
  const results = await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i + 1)));
  const totalMs = Date.now() - started;

  const latencies = results.flatMap((r) => r.latencies);
  const errors = results.reduce((sum, r) => sum + r.errors, 0);
  const totalRequests = concurrency * requestsPerWorker;
  const success = latencies.length;

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const avg = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

  console.log(`[load] total_requests=${totalRequests} success=${success} errors=${errors}`);
  console.log(`[load] duration_ms=${totalMs} throughput_rps=${(success / (totalMs / 1000)).toFixed(2)}`);
  console.log(`[load] latency_ms p50=${p50} p95=${p95} p99=${p99} avg=${avg}`);

  const errorRate = totalRequests > 0 ? (errors / totalRequests) * 100 : 0;
  if (errorRate > 5) {
    console.error(`[load] FAIL error_rate=${errorRate.toFixed(2)}%`);
    process.exit(1);
  }

  console.log(`[load] PASS error_rate=${errorRate.toFixed(2)}%`);
}

main().catch((error) => {
  console.error(`[load] FAIL ${error.message}`);
  process.exit(1);
});
