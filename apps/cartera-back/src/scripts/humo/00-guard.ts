/**
 * Candado. Nada de este humo corre si la base no es la copia local de trabajo.
 *
 * El `.env` de `cartera-back` ha apuntado a PROD dentro de una misma sesión, así
 * que no se hereda: la URL se construye acá a mano. `smoke_rubros` es un nombre
 * que producción no puede tener.
 *
 * ⚠️ Verificar SÓLO esta conexión no alcanza, y esa era la trampa: los scripts
 * importan los controladores de verdad (`insertPayment`, `reversePayment`), y
 * esos NO usan esta conexión — abren la suya en `src/database/index.ts`, que lee
 * `process.env.SUPABASE_DB_URL` al cargar el módulo. Con el `.env` apuntando a
 * prod, el candado daba "ok" contra la copia local y el controlador escribía en
 * PRODUCCIÓN. Es exactamente el desastre que este archivo dice evitar.
 *
 * Por eso ahora el candado gobierna la variable de entorno antes de que se
 * importe cualquier controlador, y lo comprueba por el mismo camino que ellos
 * usan en vez de creerle a la cadena de conexión.
 */
import postgres from "postgres";

export const URL_SMOKE = "postgresql://postgres:localdev123@localhost:5433/smoke_rubros";

/** El nombre de base que producción no puede tener. */
const BASE_ESPERADA = "smoke_rubros";

function nombreDeBase(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/^\//, "") || null;
  } catch {
    return null;
  }
}

export async function abrirBaseSegura() {
  /**
   * Primero la variable de entorno, ANTES de que nadie importe un controlador.
   *
   * Si no está, se pone la del humo. Si está y apunta a otra base, se aborta: no
   * se la pisa en silencio, porque quien la puso a propósito merece saber que la
   * corrida no era la que creía.
   */
  const env = process.env.SUPABASE_DB_URL;
  if (!env) {
    process.env.SUPABASE_DB_URL = URL_SMOKE;
  } else if (nombreDeBase(env) !== BASE_ESPERADA) {
    throw new Error(
      `🚨 ABORTADO: SUPABASE_DB_URL apunta a la base "${nombreDeBase(env) ?? "(ilegible)"}", ` +
        `no a "${BASE_ESPERADA}".\n` +
        `   Los controladores abren SU conexión con esa variable, así que verificar ` +
        `sólo la del candado no sirve de nada.\n` +
        `   Corré con: SUPABASE_DB_URL="${URL_SMOKE}" bun run <script>`
    );
  }

  const sql = postgres(URL_SMOKE, { max: 4 });

  const [fila] = await sql`
    SELECT current_database() AS db,
           inet_server_port()  AS puerto,
           (SELECT count(*) FROM cartera.creditos) AS creditos
  `;

  if (fila.db !== BASE_ESPERADA) {
    await sql.end();
    throw new Error(
      `🚨 ABORTADO: la base es "${fila.db}", no "${BASE_ESPERADA}". NO se escribe nada.`
    );
  }

  /**
   * Y la comprobación que de verdad importa: por el MISMO camino que usan los
   * controladores, no por la cadena de conexión. Que el texto de la URL diga
   * `smoke_rubros` no prueba a qué servidor llegó — un pooler, un túnel o un
   * `/etc/hosts` la pueden mandar a otro lado. Se le pregunta a la conexión.
   */
  const { db } = await import("../../database/index");
  const { sql: crudo } = await import("drizzle-orm");
  const filas = await db.execute(crudo`SELECT current_database() AS db`);
  const primera = (Array.isArray(filas) ? filas[0] : (filas as { rows?: unknown[] })?.rows?.[0]);
  const baseDelControlador = (primera as { db?: string })?.db;
  if (baseDelControlador !== BASE_ESPERADA) {
    await sql.end();
    throw new Error(
      `🚨 ABORTADO: la conexión de los CONTROLADORES está en "${baseDelControlador}", ` +
        `no en "${BASE_ESPERADA}". NO se escribe nada.`
    );
  }

  console.log(
    `🔒 candado ok — base=${fila.db} puerto=${fila.puerto} créditos=${fila.creditos} ` +
      `(controladores en ${baseDelControlador})`
  );
  return sql;
}

/** Imprime una tabla de comprobaciones y devuelve si TODAS pasaron. */
export function verificar(
  titulo: string,
  checks: { que: string; esperado: unknown; obtenido: unknown }[]
): boolean {
  console.log(`\n── ${titulo} ──`);
  let todo = true;
  for (const c of checks) {
    // Los numéricos de postgres vuelven como `300`, no `"300.00"`: se comparan
    // como números cuando los dos lados lo son, y como texto si no.
    const nEsp = Number(c.esperado);
    const nObt = Number(c.obtenido);
    const ok =
      c.esperado !== null && c.obtenido !== null &&
      c.esperado !== undefined && c.obtenido !== undefined &&
      !Number.isNaN(nEsp) && !Number.isNaN(nObt)
        ? nEsp === nObt
        : String(c.esperado) === String(c.obtenido);
    if (!ok) todo = false;
    console.log(
      `  ${ok ? "✅" : "🔴"} ${c.que}: esperado ${c.esperado}, obtenido ${c.obtenido}`
    );
  }
  return todo;
}
