import type { Config } from "drizzle-kit";
import dotenv from "dotenv";

dotenv.config();

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
  schemaFilter: ["auth-google"], // Solo gestiona el schema auth-google
  tablesFilter: ["auth-google.*"], // Solo gestiona las tablas del schema auth-google
} satisfies Config;
