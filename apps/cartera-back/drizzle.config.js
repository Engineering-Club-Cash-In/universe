import config from "./src/config";
import { defineConfig } from "drizzle-kit";
 
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/database/turso/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    host: config.postgres.host,
    port: config.postgres.port,
    database: config.postgres.database,
    user: config.postgres.username,
    password: config.postgres.password,
    ssl: {rejectUnauthorized:false}
  },
});
