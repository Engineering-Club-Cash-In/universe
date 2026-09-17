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
  esquema: string;
  tabla: string;
  columna: string;
  ddl: ReturnType<typeof sql>;
}

const COLUMNAS: ColumnaRequerida[] = [
  {
    esquema: "auth-google",
    tabla: "users",
    columna: "password_provisionada_at",
    ddl: sql`ALTER TABLE "auth-google"."users"
      ADD COLUMN IF NOT EXISTS "password_provisionada_at" timestamp`,
  },
];

const nombreDe = (c: ColumnaRequerida) => `"${c.esquema}".${c.tabla}.${c.columna}`;

/**
 * Lo que decide si el servicio puede atender: que la columna ESTÉ, no que el
 * DDL haya corrido.
 *
 * La diferencia importa en los dos sentidos. Un rol de base que no es dueño de
 * la tabla no puede correr ni un `ADD COLUMN IF NOT EXISTS` que sobra —Postgres
 * exige propiedad antes de mirar el `IF NOT EXISTS`—, así que dar por rota la
 * base porque el DDL falló tumbaría un despliegue perfectamente sano. Y al
 * revés: que el DDL no tire tampoco prueba que la columna quedó.
 */
const columnaExiste = async (c: ColumnaRequerida): Promise<boolean> => {
  const filas: any = await db.execute(sql`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = ${c.esquema}
      AND table_name = ${c.tabla}
      AND column_name = ${c.columna}
    LIMIT 1
  `);

  const cuantas = Array.isArray(filas) ? filas.length : (filas?.rows?.length ?? 0);
  return cuantas > 0;
};

/**
 * Se asegura de que estén, ANTES de atender la primera petición.
 *
 * Tira si al final la columna no está, y esa es la corrección: antes se tragaba
 * el fallo del DDL y el arranque seguía, así que el contenedor levantaba,
 * `/health` decía que todo bien —solo mira la conexión— y Coolify le mandaba
 * tráfico a un servicio donde CADA consulta de sesión reventaba. Un
 * despliegue que no arranca deja viva la versión anterior; uno que arranca roto
 * saca a todo el mundo del portal.
 */
export async function asegurarColumnasRequeridas(): Promise<void> {
  for (const columna of COLUMNAS) {
    const nombre = nombreDe(columna);

    try {
      await db.execute(columna.ddl);
    } catch (error) {
      // Todavía no es un fallo: puede ser un rol sin propiedad sobre una tabla
      // que ya tiene la columna. Lo decide la comprobación de abajo.
      console.warn(
        `⚠️  No se pudo ejecutar el ALTER de ${nombre}; se comprueba si ya existe.`,
        error,
      );
    }

    if (await columnaExiste(columna)) continue;

    throw new Error(
      `Falta ${nombre} y no se pudo crear. El login se cae sin ella: corré apps/auth-google/migrations/ contra esta base y volvé a desplegar.`,
    );
  }
}
