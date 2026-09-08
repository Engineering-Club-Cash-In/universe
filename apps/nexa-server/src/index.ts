import "dotenv/config";
import { serve } from "bun";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createDependencies } from "./dependencies";
import { startPaymentLifecycle } from "./lifecycle";
import { appVersion } from "./version";

const config = loadConfig();
const deps = createDependencies(config);
const app = createApp(config, deps);

const server = serve({ port: config.port, fetch: app.fetch });
const stopLifecycle = startPaymentLifecycle(config, deps);

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  stopLifecycle();
  server.stop();
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);

console.log(`Nexa server listening on :${config.port} (${appVersion})`);
