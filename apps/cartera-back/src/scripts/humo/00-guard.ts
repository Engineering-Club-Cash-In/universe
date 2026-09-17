/**
 * Candado. Nada de este humo corre si la base no es la copia local de trabajo.
 *
 * El `.env` de `cartera-back` ha apuntado a PROD dentro de una misma sesión, así
 * que no se hereda: la URL se construye acá a mano y se verifica contra la base
 * antes de escribir una sola fila. `smoke_rubros` es un nombre que producción no
 * puede tener.
 */
import postgres from "postgres";

export const URL_SMOKE = "postgresql://postgres:localdev123@localhost:5433/smoke_rubros";

export async function abrirBaseSegura() {
  const sql = postgres(URL_SMOKE, { max: 4 });

  const [fila] = await sql`
    SELECT current_database() AS db,
           inet_server_port()  AS puerto,
           (SELECT count(*) FROM cartera.creditos) AS creditos
  `;

  if (fila.db !== "smoke_rubros") {
    await sql.end();
    throw new Error(
      `🚨 ABORTADO: la base es "${fila.db}", no "smoke_rubros". NO se escribe nada.`
    );
  }

  console.log(
    `🔒 candado ok — base=${fila.db} puerto=${fila.puerto} créditos=${fila.creditos}`
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
