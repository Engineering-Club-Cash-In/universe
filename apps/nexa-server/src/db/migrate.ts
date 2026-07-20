import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const db = drizzle(pool);
const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

try {
  await migrate(db, { migrationsFolder });
  console.log("Nexa database migrations completed");
} finally {
  await pool.end();
}