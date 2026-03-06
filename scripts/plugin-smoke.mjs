import { buildTtcPluginConfig, transformMessagesWithTtc } from "../opencode-plugins/ttc-message-transform-core.js";

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
  const config = buildTtcPluginConfig(process.env);

  if (!config.apiKey) {
    console.error("Missing TTC_API_KEY.");
    console.error("Export it in your shell before running the smoke check.");
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
