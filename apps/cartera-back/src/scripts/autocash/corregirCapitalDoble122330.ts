/**
 * Corrección del crédito 01010214122330 (Jorge Mario Calderón / Rocio Palomo):
 * el capital quedó DOBLADO en la importación.
 *
 * El Excel de cartera (Cartera.xlsx) parte el crédito en dos tramos desde Febrero 2026:
 *   · 01010214122330    → 39,269.20  (Cube, 100% Cash-In)
 *   · 01010214122330_2  →  2,693.91  (Delfina, 25% CI / 75% inversionista)
 *   · Total real        → 41,963.11
 *
 * La importación le asignó a CADA inversionista el total (41,963.11 a Cube y
 * 41,963.11 a Delfina), así que `creditos.capital` quedó en 83,926.22 — el doble —
 * y como SUM(inversionistas) == capital cierra, ningún check lo detectó.
 *
 * El espejo nació BIEN (tramos del Excel) y el de Delfina ya viene amortizando con
 * las liquidaciones mensuales (hoy 2,242.53), así que:
 *   · Delfina PADRE   41,963.11 → 2,693.91     (espejo NO SE TOCA)
 *   · Cube    PADRE   41,963.11 → 39,269.20
 *   · Cube    ESPEJO  se alinea al padre (hoy ya está en 39,269.20 → no-op esperado)
 *   · creditos.capital 83,926.22 → 41,963.11
 *
 * Cube cierra el crédito con `objetivo - monto_delfina` para que el invariante
 * SUM(creditos_inversionistas) == creditos.capital quede exacto.
 *
 * Si el espejo de Cube SÍ cambiara, se deja snapshot nuevo en
 * `historico_liquidaciones_espejo` (si no, /calcularPagosEspejo revienta con
 * [MONTO_ESPEJO_INCONSISTENTE]).
 *
 * Antes de escribir se respaldan las filas en `_bk_c4856_capdoble_<fecha>_*`.
 *
 * Modo seco por defecto. Para escribir: --apply.
 *
 * Uso:
 *   bun run src/scripts/autocash/corregirCapitalDoble122330.ts
 *   bun run src/scripts/autocash/corregirCapitalDoble122330.ts --apply
 *   bun run src/scripts/autocash/corregirCapitalDoble122330.ts --apply --permitir-prod
 */
import Big from "big.js";
import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../database";
import {
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  historico_liquidaciones_espejo,
  liquidaciones,
} from "../../database/db";
import { recalcularPagosCredito } from "../../controllers/updateCredit";
import { withCapitalContext } from "../../utils/withAuditContext";

const SIFCO = "01010214122330";
const DELFINA_ID = 34; // INVERSIONES DELFINA , S.A.
const CUBE_ID = 86; // Cube Investments S.A.

const FUENTE = "CORRECCION_CAPITAL_DUPLICADO";
const MOTIVO =
  "Crédito importado con el capital doblado: cada inversionista traía el total (41,963.11). " +
  "Se llevan los montos a los tramos del Excel (Cube 39,269.20 / Delfina 2,693.91) y el " +
  "capital a 41,963.11. El espejo de Delfina no se toca (ya viene amortizando).";

// Estado que DEBE tener hoy — si algo no coincide, el script aborta sin escribir.
const ESPERADO = {
  capital: new Big("83926.22"),
  delfina_padre: new Big("41963.11"),
  cube_padre: new Big("41963.11"),
  cube_espejo: new Big("39269.20"),
};

// Objetivos (tramos del Excel, Julio 2026).
const CAPITAL_OBJETIVO = new Big("41963.11");
const DELFINA_OBJETIVO = new Big("2693.91");
// Cube cierra el crédito para que el invariante quede exacto.
const CUBE_OBJETIVO = CAPITAL_OBJETIVO.minus(DELFINA_OBJETIVO); // 39,269.20

const TOL = new Big("0.05");

const APLICAR = process.argv.includes("--apply");
const SIN_RECALCULO = process.argv.includes("--sin-recalculo");
const PERMITIR_PROD = process.argv.includes("--permitir-prod");

const q = (v: Big | number | string) => new Big(v).toFixed(2).padStart(13);

async function main() {
  const url = process.env.SUPABASE_DB_URL ?? "";
  const esProd = /supabase\.com/i.test(url);
  console.log(
    `\n🔌 Base: ${url.replace(/^.*@/, "").split("/")[0] || "(desconocida)"}${esProd ? "  ⚠️  PRODUCCIÓN" : ""}`
  );
  if (esProd && APLICAR && !PERMITIR_PROD) {
    console.error("⛔ Abortado: escribir contra producción exige --permitir-prod.");
    process.exit(1);
  }

  // ── Estado actual ──────────────────────────────────────────────────────────
  const [cred] = await db
    .select({ credito_id: creditos.credito_id, capital: creditos.capital })
    .from(creditos)
    .where(eq(creditos.numero_credito_sifco, SIFCO))
    .limit(1);
  if (!cred) {
    console.error(`⛔ No existe el crédito ${SIFCO} en esta base.`);
    process.exit(1);
  }

  const padre = await db
    .select({
      inversionista_id: creditos_inversionistas.inversionista_id,
      monto: creditos_inversionistas.monto_aportado,
    })
    .from(creditos_inversionistas)
    .where(eq(creditos_inversionistas.credito_id, cred.credito_id));

  const espejo = await db
    .select({
      inversionista_id: creditos_inversionistas_espejo.inversionista_id,
      monto: creditos_inversionistas_espejo.monto_aportado,
    })
    .from(creditos_inversionistas_espejo)
    .where(eq(creditos_inversionistas_espejo.credito_id, cred.credito_id));

  const capitalVivo = new Big(cred.capital ?? 0);
  const delfinaPadre = padre.find((f) => f.inversionista_id === DELFINA_ID);
  const cubePadre = padre.find((f) => f.inversionista_id === CUBE_ID);
  const delfinaEspejo = espejo.find((f) => f.inversionista_id === DELFINA_ID);
  const cubeEspejo = espejo.find((f) => f.inversionista_id === CUBE_ID);

  const problemas: string[] = [];
  const chequear = (nombre: string, actual: Big | null, esperado: Big) => {
    if (actual === null) problemas.push(`${nombre}: no existe la fila`);
    else if (actual.minus(esperado).abs().gt(TOL))
      problemas.push(`${nombre}: tiene ${actual.toFixed(2)}, esperaba ${esperado.toFixed(2)}`);
  };
  chequear("capital vivo", capitalVivo, ESPERADO.capital);
  chequear("Delfina padre", delfinaPadre ? new Big(delfinaPadre.monto ?? 0) : null, ESPERADO.delfina_padre);
  chequear("Cube padre", cubePadre ? new Big(cubePadre.monto ?? 0) : null, ESPERADO.cube_padre);
  chequear("Cube espejo", cubeEspejo ? new Big(cubeEspejo.monto ?? 0) : null, ESPERADO.cube_espejo);
  if (padre.length !== 2)
    problemas.push(`el padre tiene ${padre.length} inversionistas, esperaba 2 (Cube y Delfina)`);

  const cubeEspejoActual = cubeEspejo ? new Big(cubeEspejo.monto ?? 0) : new Big(0);
  const espejoCambia = !cubeEspejoActual.eq(CUBE_OBJETIVO);

  // Si el espejo de Cube sí se moviera, solo es inocuo si Cube nunca se liquidó.
  if (espejoCambia) {
    const nLiq = (
      await db
        .select({ id: liquidaciones.liquidacion_id })
        .from(liquidaciones)
        .where(eq(liquidaciones.inversionista_id, CUBE_ID))
    ).length;
    if (nLiq > 0)
      problemas.push(
        `el espejo de Cube cambiaría (${cubeEspejoActual.toFixed(2)} → ${CUBE_OBJETIVO.toFixed(2)}) ` +
          `pero Cube tiene ${nLiq} liquidaciones — revisar a mano`
      );
  }

  const [histCube] = await db
    .select({ monto: historico_liquidaciones_espejo.monto_aportado })
    .from(historico_liquidaciones_espejo)
    .where(
      and(
        eq(historico_liquidaciones_espejo.credito_id, cred.credito_id),
        eq(historico_liquidaciones_espejo.inversionista_id, CUBE_ID)
      )
    )
    .orderBy(desc(historico_liquidaciones_espejo.fecha))
    .limit(1);

  // ── Plan ───────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(96)}`);
  console.log(`PLAN — ${SIFCO} (credito_id ${cred.credito_id})`);
  console.log("─".repeat(96));
  console.log(`  Capital           ${q(capitalVivo)} → ${q(CAPITAL_OBJETIVO)}`);
  console.log(`  Cube padre        ${q(cubePadre?.monto ?? 0)} → ${q(CUBE_OBJETIVO)}`);
  console.log(
    `  Cube espejo       ${q(cubeEspejoActual)} → ${q(CUBE_OBJETIVO)}${espejoCambia ? "" : "   (sin cambio)"}`
  );
  console.log(`  Delfina padre     ${q(delfinaPadre?.monto ?? 0)} → ${q(DELFINA_OBJETIVO)}`);
  console.log(
    `  Delfina espejo    ${q(delfinaEspejo?.monto ?? 0)}   ← NO SE TOCA (viene amortizando)`
  );
  console.log(
    `  Hist. espejo Cube ${histCube ? q(histCube.monto) : "  (sin snapshot)"}` +
      (espejoCambia && histCube && !new Big(histCube.monto).eq(CUBE_OBJETIVO)
        ? "  → se inserta snapshot nuevo"
        : "")
  );
  console.log(
    `  Invariante        ${CUBE_OBJETIVO.toFixed(2)} + ${DELFINA_OBJETIVO.toFixed(2)} = ${CUBE_OBJETIVO.plus(DELFINA_OBJETIVO).toFixed(2)} == capital objetivo ✔`
  );

  if (problemas.length) {
    console.error(`\n⛔ Abortado, el estado vivo no es el esperado:`);
    for (const p of problemas) console.error(`   · ${p}`);
    process.exit(1);
  }

  if (!APLICAR) {
    console.log("\n🧪 Modo seco. Nada se escribió. Agregá --apply para aplicar.");
    process.exit(0);
  }

  // ── Backup ─────────────────────────────────────────────────────────────────
  const hoy = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const bk = (suf: string) => `cartera._bk_c${cred.credito_id}_capdoble_${hoy}_${suf}`;
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS ${bk("credito")} AS SELECT * FROM cartera.creditos WHERE credito_id = ${cred.credito_id}`
    )
  );
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS ${bk("ci")} AS SELECT * FROM cartera.creditos_inversionistas WHERE credito_id = ${cred.credito_id}`
    )
  );
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS ${bk("cie")} AS SELECT * FROM cartera.creditos_inversionistas_espejo WHERE credito_id = ${cred.credito_id}`
    )
  );
  console.log(`\n💾 Backup: ${bk("credito")}, ${bk("ci")}, ${bk("cie")}`);

  // ── Aplicar ────────────────────────────────────────────────────────────────
  const ahora = new Date();
  await withCapitalContext(null, FUENTE, MOTIVO, async (tx) => {
    await tx
      .update(creditos)
      .set({ capital: CAPITAL_OBJETIVO.toFixed(2) })
      .where(eq(creditos.credito_id, cred.credito_id));

    await tx
      .update(creditos_inversionistas)
      .set({ monto_aportado: DELFINA_OBJETIVO.toFixed(8) })
      .where(
        and(
          eq(creditos_inversionistas.credito_id, cred.credito_id),
          eq(creditos_inversionistas.inversionista_id, DELFINA_ID)
        )
      );

    await tx
      .update(creditos_inversionistas)
      .set({ monto_aportado: CUBE_OBJETIVO.toFixed(8) })
      .where(
        and(
          eq(creditos_inversionistas.credito_id, cred.credito_id),
          eq(creditos_inversionistas.inversionista_id, CUBE_ID)
        )
      );

    // El espejo de Cube solo se escribe si de verdad cambia (hoy ya está bien).
    if (espejoCambia) {
      await tx
        .update(creditos_inversionistas_espejo)
        .set({ monto_aportado: CUBE_OBJETIVO.toFixed(8), updated_at: ahora })
        .where(
          and(
            eq(creditos_inversionistas_espejo.credito_id, cred.credito_id),
            eq(creditos_inversionistas_espejo.inversionista_id, CUBE_ID)
          )
        );
      if (histCube && !new Big(histCube.monto).eq(CUBE_OBJETIVO)) {
        await tx.insert(historico_liquidaciones_espejo).values({
          monto_aportado: CUBE_OBJETIVO.toFixed(8),
          inversionista_id: CUBE_ID,
          credito_id: cred.credito_id,
          liquidacion_id: null,
          fecha: ahora,
        });
      }
    }

    // Invariante dentro de la misma transacción: si no cierra, revienta y revierte.
    const filas = await tx
      .select({ monto: creditos_inversionistas.monto_aportado })
      .from(creditos_inversionistas)
      .where(eq(creditos_inversionistas.credito_id, cred.credito_id));
    const suma = filas.reduce((a, f) => a.plus(new Big(f.monto ?? 0)), new Big(0));
    if (suma.minus(CAPITAL_OBJETIVO).abs().gt("0.01")) {
      throw new Error(
        `invariante roto: suma inversionistas ${suma.toFixed(2)} ≠ capital ${CAPITAL_OBJETIVO.toFixed(2)}`
      );
    }
  });
  console.log(
    `✅ ${SIFCO}  capital ${capitalVivo.toFixed(2)} → ${CAPITAL_OBJETIVO.toFixed(2)}   ` +
      `Cube ${new Big(cubePadre!.monto!).toFixed(2)} → ${CUBE_OBJETIVO.toFixed(2)}   ` +
      `Delfina ${new Big(delfinaPadre!.monto!).toFixed(2)} → ${DELFINA_OBJETIVO.toFixed(2)}`
  );

  if (!SIN_RECALCULO) {
    console.log(`\n🔄 Recalculando pagos...`);
    try {
      const r: any = await recalcularPagosCredito({ numero_credito_sifco: SIFCO });
      console.log(`   ✅ ${r?.pagosActualizados ?? r?.total ?? "ok"}`);
    } catch (e: any) {
      console.error(`   ❌ recálculo: ${e?.message ?? e}`);
      process.exit(1);
    }
  }

  // ── Cómo quedó ─────────────────────────────────────────────────────────────
  const [credFinal] = await db
    .select({ capital: creditos.capital })
    .from(creditos)
    .where(eq(creditos.credito_id, cred.credito_id))
    .limit(1);
  const padreFinal = await db
    .select({
      inversionista_id: creditos_inversionistas.inversionista_id,
      monto: creditos_inversionistas.monto_aportado,
    })
    .from(creditos_inversionistas)
    .where(eq(creditos_inversionistas.credito_id, cred.credito_id));
  const espejoFinal = await db
    .select({
      inversionista_id: creditos_inversionistas_espejo.inversionista_id,
      monto: creditos_inversionistas_espejo.monto_aportado,
    })
    .from(creditos_inversionistas_espejo)
    .where(eq(creditos_inversionistas_espejo.credito_id, cred.credito_id));

  const nom = (id: number) => (id === CUBE_ID ? "Cube   " : id === DELFINA_ID ? "Delfina" : `inv ${id}`);
  console.log(`\n${"─".repeat(96)}`);
  console.log("CÓMO QUEDÓ");
  console.log("─".repeat(96));
  console.log(`  Capital  ${q(credFinal?.capital ?? 0)}`);
  for (const f of padreFinal) console.log(`  Padre    ${nom(f.inversionista_id)}  ${q(f.monto ?? 0)}`);
  for (const f of espejoFinal) console.log(`  Espejo   ${nom(f.inversionista_id)}  ${q(f.monto ?? 0)}`);
  console.log("\n🏁 Listo.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
