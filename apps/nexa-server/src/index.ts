import "dotenv/config";
import { serve } from "bun";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createDependencies } from "./dependencies";
import { startPaymentPolling } from "./jobs/scheduler";
import { appVersion } from "./version";

const config = loadConfig();
const deps = createDependencies(config);
const app = createApp(config, deps);

startPaymentPolling({
  intervalSeconds: config.nexaPollIntervalSeconds,
  lookbackDays: config.nexaPollLookbackDays,
  nexa: deps.nexa,
  cartera: deps.cartera,
  transactions: deps.transactions,
  tokenUsers: deps.tokenUsers,
  pollRuns: deps.pollRuns,
});

serve({ port: config.port, fetch: app.fetch });

console.log(`Nexa server listening on :${config.port} (${appVersion})`);
