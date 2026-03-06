import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildTtcPluginConfig, transformMessagesWithTtc } from "../opencode-plugins/ttc-message-transform-core.js";

function readDotEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return {};

  const content = readFileSync(envPath, "utf8");
  const parsed = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }

  return parsed;
}

function buildSmokeOutput() {
  const seed = [
    "Please summarize this planning note into a concise execution brief.",
    "Include goals, constraints, and acceptance criteria.",
    "Keep all requirements preserved and avoid dropping important details.",
    "This is intentionally long to trigger TTC compression eligibility.",
    "The final output should still preserve intent and instruction fidelity."
  ].join(" ");
  const text = `${seed} ${seed} ${seed} ${seed}`;

  return {
    text,
    output: {
      messages: [
        {
          info: {
            id: "smoke-msg-1",
            sessionID: "smoke-session-1",
            role: "user"
          },
          parts: [
            {
              id: "smoke-part-1",
              type: "text",
              text
            }
          ]
        }
      ]
    }
  };
}

async function main() {
  const envLocal = readDotEnvLocal();
  const mergedEnv = {
    ...envLocal,
    ...process.env
  };
  const config = buildTtcPluginConfig(mergedEnv);

  if (!config.apiKey) {
    console.error("Missing TTC_API_KEY.");
    console.error("Set it in .env.local at repo root or export it in your shell.");
    process.exitCode = 1;
    return;
  }

  const clientLogs = [];
  const client = {
    app: {
      async log({ body }) {
        clientLogs.push(body);
      }
    }
  };

  const cache = new Map();
  const { text: originalText, output } = buildSmokeOutput();

  await transformMessagesWithTtc({
    output,
    client,
    config,
    cache,
    fetchImpl: fetch
  });

  const transformed = output.messages[0].parts[0].text;
  const responseEvent = [...clientLogs].reverse().find((entry) => {
    return entry.message === "ttc.plugin.response" || entry.message === "ttc.plugin.fallback";
  });

  const reason = responseEvent?.extra?.reason_code ?? "unknown";
  const before = originalText.length;
  const after = transformed.length;
  const changed = transformed !== originalText;

  console.log("TTC plugin smoke result");
  console.log(`- changed: ${changed}`);
  console.log(`- chars_before: ${before}`);
  console.log(`- chars_after: ${after}`);
  console.log(`- reason: ${reason}`);
}

main().catch((error) => {
  console.error("Smoke test failed.");
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
