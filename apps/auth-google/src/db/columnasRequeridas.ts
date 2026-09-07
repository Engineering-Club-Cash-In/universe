import { sql } from "drizzle-orm";
import { db } from "./connection";

/**
 * Columnas que el código lee en CADA consulta de sesión y que, si faltan,
 * tumban el login entero.
 *
 * Por qué existe esto y no basta con el archivo `.sql`: el despliegue de
 * producción (`.github/workflows/deploy-prod.yaml`) construye la imagen y
 * dispara el redeploy de Coolify, y no corre migraciones — ninguna app de este
 * repo las corre desde CI, se aplican a mano. Con cualquier otra columna eso es
 * una molestia; con esta es una caída total del portal, porque el adaptador de
 * Drizzle hace `select()` de la tabla completa y `"auth-google".users` se
 * consulta en cada petición autenticada. Un despliegue en el orden equivocado
 * dejaba a todo el mundo fuera con `column does not exist`.
 *
 * Esto NO es un runner de migraciones y no pretende serlo: es una sola sentencia
 * idempotente, sobre una columna anulable, que en Postgres no reescribe la
 * tabla. El `.sql` sigue siendo la migración de verdad y se sigue corriendo a
 * mano; esto es la red por si el despliegue llega antes.
 */

interface ColumnaRequerida {
  descripcion: string;
  ddl: ReturnType<typeof sql>;
}

const COLUMNAS: ColumnaRequerida[] = [
  {
    descripcion: '"auth-google".users.password_provisionada_at',
    ddl: sql`ALTER TABLE "auth-google"."users"
      ADD COLUMN IF NOT EXISTS "password_provisionada_at" timestamp`,
  },
];

/**
 * Se asegura de que estén, antes de atender la primera petición.
 *
 * No tira: si el usuario de base no tiene permisos de DDL, el arranque sigue y
 * el log dice exactamente qué correr. Tirar aquí cambiaría una caída por otra.
 */
export async function asegurarColumnasRequeridas(): Promise<void> {
  for (const columna of COLUMNAS) {
    try {
      await db.execute(columna.ddl);
    } catch (error) {
      console.error(
        `❌ No se pudo asegurar ${columna.descripcion}. Si la columna no existe, el login se va a caer: corré apps/auth-google/migrations/ a mano.`,
        error,
      );
    }
  }
}
