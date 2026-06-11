import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/database/sifco/schema.ts",
  out: "./drizzle/sifco",
  dbCredentials: {
    url: process.env.SIFCO_DB_URL!,
  },
  schemaFilter: ["sifco"],
});
