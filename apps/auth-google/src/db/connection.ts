import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { env } from "../config/env";

// Configuración del pool de conexiones de PostgreSQL
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 20,
  min: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Crear instancia de Drizzle con el pool de pg
export const db = drizzle(pool, { schema });

// Función para verificar la conexión
export async function testConnection() {
  try {
    const client = await pool.connect();
    console.log("✅ Database connection successful");
    client.release();
    return true;
  } catch (error) {
    console.error("❌ Database connection failed:", error);
    return false;
  }
}

// Función para cerrar la conexión
export async function closeConnection() {
  await pool.end();
  console.log("Database connection closed");
}

// Manejar cierre graceful
process.on("SIGINT", async () => {
  await closeConnection();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeConnection();
  process.exit(0);
});
