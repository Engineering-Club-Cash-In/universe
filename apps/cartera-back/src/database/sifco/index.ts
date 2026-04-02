import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as sifcoSchema from "./schema";

const connectionString = process.env.SIFCO_DB_URL;

let sifcoClient: Pool | null = null;
let sifcoDb: ReturnType<typeof drizzle<typeof sifcoSchema>> | null = null;

if (!connectionString) {
  console.warn("⚠️ SIFCO_DB_URL no está configurada. La conexión a SIFCO no estará disponible.");
} else {
  sifcoClient = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  sifcoDb = drizzle(sifcoClient, { schema: sifcoSchema });
  console.log("Conexión a la base de datos SIFCO establecida");
}

export { sifcoClient, sifcoDb };
