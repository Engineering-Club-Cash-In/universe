import "dotenv/config";
import { buildSamplePaymentTokenWebhookPayload } from "../webhooks/sample-payload";

const token = process.argv[2];
const reference = process.argv[3] ?? String(Date.now());
const amount = Number(process.argv[4] ?? 50);

if (!token) {
  throw new Error("Usage: bun run webhook:simulate <token-16-digits> [reference] [amount]");
}

const baseUrl = process.env.LOCAL_NEXA_SERVER_URL ?? `http://localhost:${process.env.PORT ?? 7010}`;
const flowId = process.env.NEXA_WEBHOOK_FLOW_ID;
const bearerToken = process.env.NEXA_WEBHOOK_BEARER_TOKEN;

if (!flowId || !bearerToken) {
  throw new Error("NEXA_WEBHOOK_FLOW_ID and NEXA_WEBHOOK_BEARER_TOKEN are required");
}

const response = await fetch(`${baseUrl.replace(/\/$/, "")}/webhook/v1/payment-token`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    flowId,
    Authorization: `Bearer ${bearerToken}`,
  },
  body: JSON.stringify(buildSamplePaymentTokenWebhookPayload({ id: reference, reference, token, amount })),
});

const text = await response.text();
console.log(`${response.status} ${response.statusText}`);
console.log(text);

if (!response.ok) {
  process.exit(1);
}
