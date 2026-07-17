import "dotenv/config";
import { serve } from "bun";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createDependencies } from "./dependencies";
import { appVersion } from "./version";

const config = loadConfig();
const deps = createDependencies(config);
const app = createApp(config, deps);

serve({ port: config.port, fetch: app.fetch });

console.log(`Nexa server listening on :${config.port} (${appVersion})`);
