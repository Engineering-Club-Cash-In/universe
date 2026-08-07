/**
 * Corrección del lote de conta: los créditos que traían DOS montos.
 *
 * En el comparativo que marcó contabilidad, cuatro filas traían dos cifras: una en la
 * columna "capital correcto" (T, la de la izquierda) y otra un par de columnas más a la
 * derecha. `preview_ajuste_conta.py` le dio prioridad a la de la derecha y así se aplicó
 * el 2026-08-06. Conta avisó que **la buena era la de la izquierda**.
 *
 * Este script lleva el capital de esos créditos al monto de la columna izquierda.
 *
 * Mismas reglas que el lote original:
 *   · Solo se mueve el `monto_aportado` de AUTOCASH, que absorbe la diferencia para que
 *     `SUM(creditos_inversionistas.monto_aportado) == creditos.capital` siga cerrando.
 *     Los demás inversionistas (Cube en Crhistian) NO se tocan.
 *   · El espejo de Autocash se alinea al padre — se puede porque Autocash nunca ha sido
 *     liquidado (0 filas en `cartera.liquidaciones`). El script lo verifica y aborta si no.
 *   · Al cambiar el capital se llama a `recalcularPagosCredito`, que solo toca cuotas no
 *     pagadas y pagos pendientes de validar.
 *
 * Y algo que el lote original NO hacía: al mover el espejo hay que dejar un snapshot nuevo
 * en `historico_liquidaciones_espejo`, si no /calcularPagosEspejo vuelve a reventar con
 * [MONTO_ESPEJO_INCONSISTENTE]. Ver src/scripts/espejo/alinearEspejoHistorico.ts.
 *
 * ESTADO DE AUTORIZACIÓN
 *   · Regina (01010214109740) — CONFIRMADO por conta, entra por defecto.
 *   · Los otros tres van marcados `pendiente` y solo entran con --incluir-pendientes.
 *
 * Modo seco por defecto. Para escribir: --apply.
 *
 * Uso:
 *   bun run src/scripts/autocash/corregirCapitalColumnaIzquierda.ts
 *   bun run src/scripts/autocash/corregirCapitalColumnaIzquierda.ts --apply
 *   bun run src/scripts/autocash/corregirCapitalColumnaIzquierda.ts --apply --permitir-prod
 */
import Big from "big.js";
import { and, desc, eq } from "drizzle-orm";

import { db } from "../../database";
import {
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  historico_liquidaciones_espejo,
  inversionistas,
  liquidaciones,
} from "../../database/db";
import { recalcularPagosCredito } from "../../controllers/updateCredit";
import { withCapitalContext } from "../../utils/withAuditContext";

const INVERSIONISTA = "Autocash S.A.";
const FUENTE = "AJUSTE_EXCEL_AUTOCASH";
const MOTIVO =
  "Corrección del lote del 2026-08-06: conta confirmó que el monto bueno es el de la " +
  "columna izquierda del comparativo, no el segundo";
const TOL = new Big("0.05"); // margen al revalidar el estado vivo contra lo esperado

interface Objetivo {
  sifco: string;
  cliente: string;
  /** Capital que debe tener HOY, antes de corregir. Si no coincide, el crédito se salta. */
  capital_actual: number;
  /** Monto de la columna izquierda del comparativo de conta. */
  capital_objetivo: number;
  confirmado: boolean;
  nota?: string;
}

const OBJETIVOS: Objetivo[] = [
  {
    sifco: "01010214109740",
    cliente: "Regina Jeteya Perez de Lopez / Alexander Josue Velasquez Silva",
    capital_actual: 38882.59,
    capital_objetivo: 39402.92,
    confirmado: true,
  },
  {
    sifco: "01010214112410",
    cliente: "Jackelinne Valeria Pérez Avila",
    capital_actual: 61514.63,
    capital_objetivo: 61988.48,
    confirmado: false,
  },
  {
    sifco: "01010214115040",
    cliente: "Crhistian Alexander Herrera Hernández",
    capital_actual: 107033.75,
    capital_objetivo: 107448.4,
    confirmado: false,
    nota: "Tiene a Cube (49,706.54). Cube NO se toca: Autocash absorbe la diferencia.",
  },
  {
    sifco: "01010214108630",
    cliente: "Agencia Independiente de Seguros Milenium",
    capital_actual: 26641.66,
    capital_objetivo: 27150.21,
    confirmado: false,
    nota: "Quedó FUERA del lote del 2026-08-06, nunca se ajustó. Su capital es el original.",
  },
];

const flag = (n: string) => process.argv.includes(`--${n}`);
function arg(n: string) {
  const p = process.argv.find((a) => a.startsWith(`--${n}=`));
  return p ? p.slice(n.length + 3) : undefined;
}

const APLICAR = flag("apply");
const PENDIENTES = flag("incluir-pendientes");
const SIN_RECALCULO = flag("sin-recalculo");
const PERMITIR_PROD = flag("permitir-prod");
const SOLO = arg("solo")?.split(",").map((s) => s.trim()).filter(Boolean);

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

  const [inv] = await db
    .select({ id: inversionistas.inversionista_id })
    .from(inversionistas)
    .where(eq(inversionistas.nombre, INVERSIONISTA))
    .limit(1);
  if (!inv) {
    console.error(`⛔ No encontré al inversionista "${INVERSIONISTA}".`);
    process.exit(1);
  }

  // Reja: alinear el espejo al padre solo es inocuo si Autocash nunca se liquidó.
  const nLiq = (
    await db
      .select({ id: liquidaciones.liquidacion_id })
      .from(liquidaciones)
      .where(eq(liquidaciones.inversionista_id, inv.id))
  ).length;
  console.log(`👤 ${INVERSIONISTA} (id ${inv.id}) — liquidaciones: ${nLiq}`);
  if (nLiq > 0) {
    console.error(
      "\n⛔ Abortado: Autocash ya tiene liquidaciones. Alinear su espejo al padre pisaría\n" +
        "   pagos históricos. Hay que revisar el caso a mano."
    );
    process.exit(1);
  }

  const seleccion = OBJETIVOS.filter(
    (o) => (o.confirmado || PENDIENTES) && (!SOLO || SOLO.includes(o.sifco))
  );
  const fuera = OBJETIVOS.filter((o) => !seleccion.includes(o));

  const plan: {
    o: Objetivo;
    credito_id: number;
    capital_vivo: Big;
    autocash_antes: Big;
    autocash_despues: Big;
    espejo_antes: Big;
    suma_otros: Big;
    hist_ultimo: Big | null;
    problema?: string;
  }[] = [];

  for (const o of seleccion) {
    const [cred] = await db
      .select({ credito_id: creditos.credito_id, capital: creditos.capital })
      .from(creditos)
      .where(eq(creditos.numero_credito_sifco, o.sifco))
      .limit(1);
    if (!cred) {
      plan.push({
        o, credito_id: 0, capital_vivo: new Big(0), autocash_antes: new Big(0),
        autocash_despues: new Big(0), espejo_antes: new Big(0), suma_otros: new Big(0),
        hist_ultimo: null, problema: "no existe en la base",
      });
      continue;
    }

    const filasPadre = await db
      .select({
        inversionista_id: creditos_inversionistas.inversionista_id,
        monto: creditos_inversionistas.monto_aportado,
      })
      .from(creditos_inversionistas)
      .where(eq(creditos_inversionistas.credito_id, cred.credito_id));

    const [espejoRow] = await db
      .select({ monto: creditos_inversionistas_espejo.monto_aportado })
      .from(creditos_inversionistas_espejo)
      .where(
        and(
          eq(creditos_inversionistas_espejo.credito_id, cred.credito_id),
          eq(creditos_inversionistas_espejo.inversionista_id, inv.id)
        )
      )
      .limit(1);

    const [hist] = await db
      .select({ monto: historico_liquidaciones_espejo.monto_aportado })
      .from(historico_liquidaciones_espejo)
      .where(
        and(
          eq(historico_liquidaciones_espejo.credito_id, cred.credito_id),
          eq(historico_liquidaciones_espejo.inversionista_id, inv.id)
        )
      )
      .orderBy(desc(historico_liquidaciones_espejo.fecha))
      .limit(1);

    const capitalVivo = new Big(cred.capital ?? 0);
    const autocashRow = filasPadre.find((f) => f.inversionista_id === inv.id);
    const sumaOtros = filasPadre
      .filter((f) => f.inversionista_id !== inv.id)
      .reduce((a, f) => a.plus(new Big(f.monto ?? 0)), new Big(0));

    // Autocash cierra el crédito: así el invariante queda exacto aunque el estado
    // vivo venga con centavos de arrastre.
    const autocashDespues = new Big(o.capital_objetivo).minus(sumaOtros);

    let problema: string | undefined;
    if (!autocashRow) problema = "Autocash no participa en este crédito";
    else if (capitalVivo.minus(new Big(o.capital_actual)).abs().gt(TOL))
      problema = `el capital vivo (${capitalVivo.toFixed(2)}) no es el esperado (${o.capital_actual.toFixed(2)}) — algo se movió, regenerar`;
    else if (autocashDespues.lte(0))
      problema = `el monto de Autocash quedaría en ${autocashDespues.toFixed(2)}`;

    plan.push({
      o,
      credito_id: cred.credito_id,
      capital_vivo: capitalVivo,
      autocash_antes: new Big(autocashRow?.monto ?? 0),
      autocash_despues: autocashDespues,
      espejo_antes: new Big(espejoRow?.monto ?? 0),
      suma_otros: sumaOtros,
      hist_ultimo: hist ? new Big(hist.monto) : null,
      problema,
    });
  }

  // ── Reporte ────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(112)}`);
  console.log("PLAN");
  console.log("─".repeat(112));
  for (const p of plan) {
    console.log(`\n▸ ${p.o.cliente}`);
    console.log(`    SIFCO           ${p.o.sifco}   ${p.o.confirmado ? "✅ confirmado por conta" : "⏳ pendiente de confirmar"}`);
    console.log(`    Capital         ${q(p.capital_vivo)} → ${q(p.o.capital_objetivo)}   (${p.capital_vivo.gt(0) ? new Big(p.o.capital_objetivo).minus(p.capital_vivo).toFixed(2) : "?"})`);
    console.log(`    Autocash padre  ${q(p.autocash_antes)} → ${q(p.autocash_despues)}`);
    console.log(`    Autocash espejo ${q(p.espejo_antes)} → ${q(p.autocash_despues)}`);
    if (p.suma_otros.gt(0))
      console.log(`    Otros inv.      ${q(p.suma_otros)}   (no se tocan)`);
    console.log(
      `    Histórico       ${p.hist_ultimo ? q(p.hist_ultimo) : "        (sin snapshot)"}` +
        (p.hist_ultimo && !p.hist_ultimo.eq(p.autocash_despues) ? "  → se inserta snapshot nuevo" : "")
    );
    if (p.o.nota) console.log(`    Nota            ${p.o.nota}`);
    if (p.problema) console.log(`    ⛔ SE SALTA      ${p.problema}`);
  }

  if (fuera.length) {
    console.log(`\n⏳ Fuera de esta corrida (falta que conta los confirme; --incluir-pendientes los mete):`);
    for (const o of fuera)
      console.log(`   ${o.sifco}  ${o.cliente}  ${o.capital_actual.toFixed(2)} → ${o.capital_objetivo.toFixed(2)}`);
  }

  const aplicables = plan.filter((p) => !p.problema);
  console.log(`\n➡️  A corregir: ${aplicables.length}   Con problema: ${plan.length - aplicables.length}`);

  if (!APLICAR) {
    console.log("\n🧪 Modo seco. Nada se escribió. Agregá --apply para aplicar.");
    process.exit(0);
  }

  // ── Aplicar ────────────────────────────────────────────────────────────────
  const ahora = new Date();
  const recalcular: string[] = [];
  const errores: string[] = [];

  for (const p of aplicables) {
    try {
      await withCapitalContext(null, FUENTE, MOTIVO, async (tx) => {
        await tx
          .update(creditos)
          .set({ capital: new Big(p.o.capital_objetivo).toFixed(2) })
          .where(eq(creditos.credito_id, p.credito_id));

        await tx
          .update(creditos_inversionistas)
          .set({ monto_aportado: p.autocash_despues.toFixed(8) })
          .where(
            and(
              eq(creditos_inversionistas.credito_id, p.credito_id),
              eq(creditos_inversionistas.inversionista_id, inv.id)
            )
          );

        await tx
          .update(creditos_inversionistas_espejo)
          .set({ monto_aportado: p.autocash_despues.toFixed(8), updated_at: ahora })
          .where(
            and(
              eq(creditos_inversionistas_espejo.credito_id, p.credito_id),
              eq(creditos_inversionistas_espejo.inversionista_id, inv.id)
            )
          );

        // Sin este snapshot, /calcularPagosEspejo falla con MONTO_ESPEJO_INCONSISTENTE.
        if (p.hist_ultimo && !p.hist_ultimo.eq(p.autocash_despues)) {
          await tx.insert(historico_liquidaciones_espejo).values({
            monto_aportado: p.autocash_despues.toFixed(8),
            inversionista_id: inv.id,
            credito_id: p.credito_id,
            liquidacion_id: null,
            fecha: ahora,
          });
        }

        // Invariante, dentro de la misma transacción: si no cierra, revienta y revierte.
        const filas = await tx
          .select({ monto: creditos_inversionistas.monto_aportado })
          .from(creditos_inversionistas)
          .where(eq(creditos_inversionistas.credito_id, p.credito_id));
        const suma = filas.reduce((a, f) => a.plus(new Big(f.monto ?? 0)), new Big(0));
        if (suma.minus(new Big(p.o.capital_objetivo)).abs().gt("0.01")) {
          throw new Error(
            `invariante roto: suma inversionistas ${suma.toFixed(2)} ≠ capital ${p.o.capital_objetivo.toFixed(2)}`
          );
        }
      });

      console.log(`✅ ${p.o.sifco}  capital ${p.capital_vivo.toFixed(2)} → ${p.o.capital_objetivo.toFixed(2)}   Autocash ${p.autocash_antes.toFixed(2)} → ${p.autocash_despues.toFixed(2)}`);
      recalcular.push(p.o.sifco);
    } catch (e: any) {
      errores.push(`${p.o.sifco}: ${e?.message ?? e}`);
      console.error(`❌ ${p.o.sifco}: ${e?.message ?? e}`);
    }
  }

  if (!SIN_RECALCULO && recalcular.length) {
    console.log(`\n🔄 Recalculando pagos (${recalcular.length} créditos)...`);
    for (const sifco of recalcular) {
      try {
        const r: any = await recalcularPagosCredito({ numero_credito_sifco: sifco });
        console.log(`   ✅ ${sifco}: ${r?.pagosActualizados ?? r?.total ?? "ok"}`);
      } catch (e: any) {
        errores.push(`recálculo ${sifco}: ${e?.message ?? e}`);
        console.error(`   ❌ ${sifco}: ${e?.message ?? e}`);
      }
    }
  }

  console.log(`\n🏁 Corregidos: ${recalcular.length}   Errores: ${errores.length}`);
  process.exit(errores.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
