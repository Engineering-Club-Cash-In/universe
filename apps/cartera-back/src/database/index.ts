import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './db/schema';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable not set');
}

const client = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // Importante si usas Supabase
});

console.log('Conexión a la base de datos establecida');

export { client };
export const db = drizzle(client, { schema });
