import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as sifcoSchema from "./schema";

const connectionString = process.env.SIFCO_DB_URL;
if (!connectionString) {
  throw new Error("SIFCO_DB_URL environment variable not set");
}

const sifcoClient = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

console.log("Conexión a la base de datos SIFCO establecida");

export { sifcoClient };
export const sifcoDb = drizzle(sifcoClient, { schema: sifcoSchema });
