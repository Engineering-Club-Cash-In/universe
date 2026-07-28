import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './db/schema';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable not set');
}

// SSL solo para conexiones remotas (Supabase). El Postgres local no habla SSL.
const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
const client = new Pool({
  connectionString,
  ssl: isLocalDb ? false : { rejectUnauthorized: false }, // Importante si usas Supabase
});

console.log('Conexión a la base de datos establecida');

// Pool DEDICADO para advisory locks (pg_advisory_lock por crédito).
// Tiene que ser un pool aparte del de trabajo: un waiter bloqueado en
// pg_advisory_lock retiene su conexión mientras espera; si esos waiters
// vivieran en `client`, podrían agotarlo y el que SÍ tiene el lock ya no
// conseguiría conexión para sus queries (drizzle usa `client`) → deadlock
// de pool: nadie avanza, nadie suelta. Separados, los waiters solo llenan
// este pool y el trabajo del ganador siempre respira.
const lockPool = new Pool({
  connectionString,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
  max: 10,
});

export { client, lockPool };
export const db = drizzle(client, { schema });
