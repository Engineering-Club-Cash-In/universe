/**
 * Corrige el capital de uno o varios créditos de AUTOCASH al monto que indique
 * contabilidad, con las mismas reglas del cuadre:
 *
 *   · Solo se mueve el `monto_aportado` de Autocash, que CIERRA el crédito:
 *     `autocash = objetivo − suma_de_los_demás_inversionistas`. Así el invariante
 *     `SUM(creditos_inversionistas.monto_aportado) == creditos.capital` queda exacto
 *     aunque el estado vivo venga con centavos de arrastre. Los demás no se tocan.
 *   · El espejo de Autocash se alinea al padre — se puede porque Autocash nunca ha
 *     sido liquidado (0 filas en `cartera.liquidaciones`). El script lo verifica.
 *   · Se deja un snapshot nuevo en `historico_liquidaciones_espejo` si el último no
 *     coincide; sin eso /calcularPagosEspejo revienta con MONTO_ESPEJO_INCONSISTENTE.
 *   · Al final, `recalcularPagosCredito` de los créditos cuyo capital cambió: sin
 *     `numero_cuota` solo toca cuotas no pagadas y pagos pendientes de validar.
 *
 * Todo por crédito va en UNA transacción, con el invariante verificado adentro: si no
 * cierra, revienta y revierte.
 *
 * A diferencia de `corregirCapitalColumnaIzquierda.ts` (que trae la lista quemada del
 * lote de conta del 2026-08-06), acá los objetivos entran por línea de comandos.
 *
 * Modo seco por defecto. Para escribir: --apply.
 *
 * Uso:
 *   bun run src/scripts/autocash/corregirCapitalAutocash.ts --set=01010214117200=69625.61,01010214117420=15397.39
 *   bun run src/scripts/autocash/corregirCapitalAutocash.ts --set=... --apply
 *   bun run src/scripts/autocash/corregirCapitalAutocash.ts --set=... --apply --permitir-prod
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

const flag = (n: string) => process.argv.includes(`--${n}`);
function arg(n: string) {
  const p = process.argv.find((a) => a.startsWith(`--${n}=`));
  return p ? p.slice(n.length + 3) : undefined;
}

const APLICAR = flag("apply");
const SIN_RECALCULO = flag("sin-recalculo");
const PERMITIR_PROD = flag("permitir-prod");
const MOTIVO = arg("motivo") ?? "Corrección de capital autorizada por contabilidad";

const q = (v: Big | number | string) => new Big(v).toFixed(2).padStart(13);

function parsearObjetivos(): { sifco: string; objetivo: Big }[] {
  const raw = arg("set");
  if (!raw) {
    console.error("Falta --set=SIFCO=MONTO[,SIFCO=MONTO...]");
    process.exit(1);
  }
  return raw.split(",").map((par) => {
    const [sifco, monto] = par.split("=").map((s) => s.trim());
    if (!sifco || !monto || Number.isNaN(Number(monto))) {
      console.error(`No pude leer el objetivo "${par}". Formato: SIFCO=MONTO`);
      process.exit(1);
    }
    return { sifco, objetivo: new Big(monto) };
  });
}

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

  const objetivos = parsearObjetivos();

  const [inv] = await db
    .select({ id: inversionistas.inversionista_id })
    .from(inversionistas)
    .where(eq(inversionistas.nombre, INVERSIONISTA))
    .limit(1);
  if (!inv) {
    console.error(`⛔ No encontré al inversionista "${INVERSIONISTA}".`);
    process.exit(1);
  }

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

  const plan: {
    sifco: string;
    cliente: string;
    credito_id: number;
    capital_antes: Big;
    capital_despues: Big;
    autocash_antes: Big;
    autocash_despues: Big;
    espejo_antes: Big;
    suma_otros: Big;
    otros: string[];
    hist_ultimo: Big | null;
    problema?: string;
  }[] = [];

  for (const o of objetivos) {
    const [cred] = await db
      .select({
        credito_id: creditos.credito_id,
        capital: creditos.capital,
        usuario_id: creditos.usuario_id,
      })
      .from(creditos)
      .where(eq(creditos.numero_credito_sifco, o.sifco))
      .limit(1);
    if (!cred) {
      plan.push({
        sifco: o.sifco, cliente: "", credito_id: 0,
        capital_antes: new Big(0), capital_despues: o.objetivo,
        autocash_antes: new Big(0), autocash_despues: new Big(0),
        espejo_antes: new Big(0), suma_otros: new Big(0), otros: [],
        hist_ultimo: null, problema: "no existe en la base",
      });
      continue;
    }

    const filas = await db
      .select({
        inversionista_id: creditos_inversionistas.inversionista_id,
        nombre: inversionistas.nombre,
        monto: creditos_inversionistas.monto_aportado,
      })
      .from(creditos_inversionistas)
      .innerJoin(
        inversionistas,
        eq(inversionistas.inversionista_id, creditos_inversionistas.inversionista_id)
      )
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
      .orderBy(desc(historico_liquidaciones_espejo.fecha), desc(historico_liquidaciones_espejo.id))
      .limit(1);

    const autocashRow = filas.find((f) => f.inversionista_id === inv.id);
    const otras = filas.filter((f) => f.inversionista_id !== inv.id);
    const sumaOtros = otras.reduce((a, f) => a.plus(new Big(f.monto ?? 0)), new Big(0));
    const autocashDespues = o.objetivo.minus(sumaOtros);

    plan.push({
      sifco: o.sifco,
      cliente: "",
      credito_id: cred.credito_id,
      capital_antes: new Big(cred.capital ?? 0),
      capital_despues: o.objetivo,
      autocash_antes: new Big(autocashRow?.monto ?? 0),
      autocash_despues: autocashDespues,
      espejo_antes: new Big(espejoRow?.monto ?? 0),
      suma_otros: sumaOtros,
      otros: otras.map((f) => `${f.nombre}=${new Big(f.monto ?? 0).toFixed(2)}`),
      hist_ultimo: hist ? new Big(hist.monto) : null,
      problema: !autocashRow
        ? "Autocash no participa en este crédito"
        : autocashDespues.lte(0)
          ? `el monto de Autocash quedaría en ${autocashDespues.toFixed(2)}`
          : undefined,
    });
  }

  // ── Reporte ────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(100)}`);
  console.log("PLAN");
  console.log("─".repeat(100));
  for (const p of plan) {
    console.log(`\n▸ ${p.sifco}`);
    console.log(`    Capital         ${q(p.capital_antes)} → ${q(p.capital_despues)}   (${p.capital_despues.minus(p.capital_antes).toFixed(2)})`);
    console.log(`    Autocash padre  ${q(p.autocash_antes)} → ${q(p.autocash_despues)}`);
    console.log(`    Autocash espejo ${q(p.espejo_antes)} → ${q(p.autocash_despues)}`);
    if (p.otros.length) console.log(`    Otros inv.      ${p.otros.join(" | ")}   (no se tocan)`);
    const invAntes = p.autocash_antes.plus(p.suma_otros).minus(p.capital_antes);
    if (invAntes.abs().gt("0.01"))
      console.log(`    ⚠️  El invariante venía roto por ${invAntes.toFixed(2)} — este ajuste lo cierra.`);
    console.log(
      `    Histórico       ${p.hist_ultimo ? q(p.hist_ultimo) : "  (sin snapshot)"}` +
        (p.hist_ultimo && !p.hist_ultimo.eq(p.autocash_despues) ? "  → se inserta snapshot nuevo" : "")
    );
    if (p.problema) console.log(`    ⛔ SE SALTA      ${p.problema}`);
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
          .set({ capital: p.capital_despues.toFixed(2) })
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

        if (p.hist_ultimo && !p.hist_ultimo.eq(p.autocash_despues)) {
          await tx.insert(historico_liquidaciones_espejo).values({
            monto_aportado: p.autocash_despues.toFixed(8),
            inversionista_id: inv.id,
            credito_id: p.credito_id,
            liquidacion_id: null,
            fecha: ahora,
          });
        }

        const filas = await tx
          .select({ monto: creditos_inversionistas.monto_aportado })
          .from(creditos_inversionistas)
          .where(eq(creditos_inversionistas.credito_id, p.credito_id));
        const suma = filas.reduce((a, f) => a.plus(new Big(f.monto ?? 0)), new Big(0));
        if (suma.minus(p.capital_despues).abs().gt("0.01")) {
          throw new Error(
            `invariante roto: suma inversionistas ${suma.toFixed(2)} ≠ capital ${p.capital_despues.toFixed(2)}`
          );
        }
      });

      console.log(
        `✅ ${p.sifco}  capital ${p.capital_antes.toFixed(2)} → ${p.capital_despues.toFixed(2)}   ` +
          `Autocash ${p.autocash_antes.toFixed(2)} → ${p.autocash_despues.toFixed(2)}`
      );
      recalcular.push(p.sifco);
    } catch (e: any) {
      errores.push(`${p.sifco}: ${e?.message ?? e}`);
      console.error(`❌ ${p.sifco}: ${e?.message ?? e}`);
    }
  }

  if (!SIN_RECALCULO && recalcular.length) {
    console.log(`\n🔄 Recalculando pagos (${recalcular.length} créditos)...`);
    for (const sifco of recalcular) {
      try {
        await recalcularPagosCredito({ numero_credito_sifco: sifco });
        console.log(`   ✅ ${sifco}`);
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
