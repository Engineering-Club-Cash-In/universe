/**
 * Aplica el plan generado por `preview_ajuste_conta.py`.
 *
 * Cubre los dos lotes:
 *   · lote "conta"       → lo que contabilidad autorizó (capital del crédito y/o espejo).
 *   · lote "saneamiento" → coherencia interna, sin tocar el capital del crédito.
 *
 * Por cada crédito, en UNA transacción:
 *   1. Si el item trae `padre`: UPDATE creditos.capital (si cambia) + creditos_inversionistas
 *      de Autocash. El update del crédito va dentro de withCapitalContext para que el trigger
 *      trg_historial_capital_credito deje el rastro.
 *   2. Si trae `espejo`: UPDATE creditos_inversionistas_espejo de Autocash.
 *      Se puede alinear sin riesgo porque Autocash NUNCA ha sido liquidado.
 *   3. `otros_movidos`: solo los inversionistas que el plan trae explícitos
 *      (hoy: Cube en Crhistian Herrera, autorizado por conta).
 *
 * Después, solo para los créditos donde CAMBIÓ creditos.capital, llama a
 * recalcularPagosCredito({ numero_credito_sifco }) — sin numero_cuota, así toca
 * únicamente las cuotas no pagadas y los pagos pendientes de validar.
 *
 * Modo seco por defecto. Para escribir: --apply.
 *
 * Uso:
 *   bun run src/scripts/autocash/aplicarAjusteConta.ts --plan=plan_ajuste_conta.json
 *   bun run src/scripts/autocash/aplicarAjusteConta.ts --plan=... --apply --incluir-opcionales
 */
import { readFileSync, writeFileSync } from "node:fs";
import Big from "big.js";
import { and, eq } from "drizzle-orm";

import { db } from "../../database";
import {
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  inversionistas,
} from "../../database/db";
import { recalcularPagosCredito } from "../../controllers/updateCredit";
import { withCapitalContext } from "../../utils/withAuditContext";

const INVERSIONISTA = "Autocash S.A.";
const FUENTE_HISTORIAL = "AJUSTE_EXCEL_AUTOCASH";
const TOL = new Big("0.05"); // margen al verificar el plan contra la base viva

interface Item {
  numero_credito_sifco: string;
  cliente: string;
  status: string;
  lote: "conta" | "saneamiento";
  opcional: boolean;
  accion: string;
  capital_objetivo: number | null;
  padre: { capital_antes: number; capital_despues: number; autocash_antes: number; autocash_despues: number } | null;
  espejo: { autocash_antes: number; autocash_despues: number } | null;
  otros_movidos: { nombre: string; padre_antes: number; padre_despues: number; espejo_antes: number; espejo_despues: number }[];
  recalcular_pagos: boolean;
  notas: string[];
}

function arg(n: string) {
  const p = process.argv.find((a) => a.startsWith(`--${n}=`));
  return p ? p.slice(n.length + 3) : undefined;
}
const flag = (n: string) => process.argv.includes(`--${n}`);

const RUTA_PLAN = arg("plan") ?? "plan_ajuste_conta.json";
const APLICAR = flag("apply");
const OPCIONALES = flag("incluir-opcionales");
const SIN_RECALCULO = flag("sin-recalculo");
const PERMITIR_PROD = flag("permitir-prod");
const SOLO = (arg("solo") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SOLO_LOTE = arg("lote");
const RUTA_REPORTE = arg("reporte") ?? "reporte_ajuste_conta.json";

const big = (v: unknown) => new Big(String(v ?? 0));
const q2 = (v: Big) => v.round(2).toString();
const cerca = (a: Big, b: Big) => a.minus(b).abs().lte(TOL);

function verificarDestino() {
  const url = process.env.SUPABASE_DB_URL ?? "";
  const host = url.replace(/^[a-z]+:\/\/[^@]*@/i, "").split(/[/:?]/)[0] ?? "(desconocido)";
  const esProd = /supabase\.com/i.test(url);
  console.log(`Base destino: ${host}${esProd ? "   ⚠️  PRODUCCIÓN" : ""}`);
  if (esProd && APLICAR && !PERMITIR_PROD) {
    console.error(
      "\n⛔ Abortado: el destino es producción y este script escribe.\n" +
        "   Para aplicar en prod hay que pasar --permitir-prod a propósito.",
    );
    process.exit(1);
  }
}

type Resultado = {
  sifco: string; cliente: string; lote: string;
  estado: "aplicado" | "simulado" | "omitido" | "error";
  motivo?: string;
  cambios?: string[];
  pagos_recalculados?: boolean;
};

async function main() {
  verificarDestino();
  const plan = JSON.parse(readFileSync(RUTA_PLAN, "utf-8")) as { generado_en: string; items: Item[] };
  console.log(`\nPlan: ${RUTA_PLAN} (generado ${plan.generado_en})`);
  console.log(APLICAR ? "▶ MODO ESCRITURA (--apply)\n" : "▶ MODO SECO. Nada se escribe.\n");

  const [inv] = await db
    .select({ id: inversionistas.inversionista_id, nombre: inversionistas.nombre })
    .from(inversionistas)
    .where(eq(inversionistas.nombre, INVERSIONISTA))
    .limit(1);
  if (!inv) throw new Error(`No existe "${INVERSIONISTA}" en esta base`);
  console.log(`${inv.nombre} = inversionista_id ${inv.id}\n`);

  let items = plan.items;
  if (!OPCIONALES) items = items.filter((i) => !i.opcional);
  if (SOLO_LOTE) items = items.filter((i) => i.lote === SOLO_LOTE);
  if (SOLO.length) items = items.filter((i) => SOLO.includes(i.numero_credito_sifco));

  const omitidosPorOpcional = plan.items.filter((i) => i.opcional && !OPCIONALES).length;
  if (omitidosPorOpcional) {
    console.log(`(${omitidosPorOpcional} item(s) opcional(es) fuera; usá --incluir-opcionales para meterlos)\n`);
  }

  const resultados: Resultado[] = [];
  const paraRecalcular: string[] = [];

  for (const it of items) {
    const base: Resultado = { sifco: it.numero_credito_sifco, cliente: it.cliente, lote: it.lote, estado: "omitido" };
    try {
      const [cred] = await db
        .select({ credito_id: creditos.credito_id, capital: creditos.capital, status: creditos.statusCredit })
        .from(creditos)
        .where(eq(creditos.numero_credito_sifco, it.numero_credito_sifco))
        .limit(1);
      if (!cred) { resultados.push({ ...base, motivo: "el crédito no existe en esta base" }); continue; }

      const [fAuto] = await db
        .select({ monto: creditos_inversionistas.monto_aportado })
        .from(creditos_inversionistas)
        .where(and(eq(creditos_inversionistas.credito_id, cred.credito_id),
                   eq(creditos_inversionistas.inversionista_id, inv.id)))
        .limit(1);
      if (!fAuto) { resultados.push({ ...base, motivo: "el crédito no tiene participación de Autocash" }); continue; }

      const [fEsp] = await db
        .select({ id: creditos_inversionistas_espejo.id, monto: creditos_inversionistas_espejo.monto_aportado })
        .from(creditos_inversionistas_espejo)
        .where(and(eq(creditos_inversionistas_espejo.credito_id, cred.credito_id),
                   eq(creditos_inversionistas_espejo.inversionista_id, inv.id)))
        .limit(1);

      // El plan tiene que seguir describiendo la base
      const desfases: string[] = [];
      if (it.padre) {
        if (!cerca(big(cred.capital), big(it.padre.capital_antes)))
          desfases.push(`capital ${cred.capital} ≠ plan ${it.padre.capital_antes}`);
        if (!cerca(big(fAuto.monto), big(it.padre.autocash_antes)))
          desfases.push(`monto_aportado ${fAuto.monto} ≠ plan ${it.padre.autocash_antes}`);
      }
      if (it.espejo) {
        if (!fEsp) desfases.push("el plan espera fila espejo de Autocash y no existe");
        else if (!cerca(big(fEsp.monto), big(it.espejo.autocash_antes)))
          desfases.push(`espejo ${fEsp.monto} ≠ plan ${it.espejo.autocash_antes}`);
      }
      if (desfases.length) {
        resultados.push({ ...base, motivo: `plan desactualizado: ${desfases.join("; ")}. Regenerá el plan.` });
        continue;
      }

      const cambios: string[] = [];
      if (it.padre) {
        if (it.padre.capital_antes !== it.padre.capital_despues)
          cambios.push(`capital ${it.padre.capital_antes.toFixed(2)} → ${it.padre.capital_despues.toFixed(2)}`);
        if (it.padre.autocash_antes !== it.padre.autocash_despues)
          cambios.push(`padre Autocash ${it.padre.autocash_antes.toFixed(2)} → ${it.padre.autocash_despues.toFixed(2)}`);
      }
      if (it.espejo)
        cambios.push(`espejo Autocash ${it.espejo.autocash_antes.toFixed(2)} → ${it.espejo.autocash_despues.toFixed(2)}`);
      for (const o of it.otros_movidos)
        cambios.push(`${o.nombre}: padre ${o.padre_antes.toFixed(2)} → ${o.padre_despues.toFixed(2)}, espejo ${o.espejo_antes.toFixed(2)} → ${o.espejo_despues.toFixed(2)}`);

      console.log(`${APLICAR ? "APLICANDO" : "simulando"}  ${it.numero_credito_sifco}  ${it.cliente.slice(0, 32).padEnd(32)} [${it.lote}]`);
      for (const c of cambios) console.log(`     · ${c}`);
      if (it.recalcular_pagos) console.log("     · recalcula pagos no pagados");

      if (!APLICAR) { resultados.push({ ...base, estado: "simulado", cambios }); continue; }

      const motivo = it.lote === "conta"
        ? `Ajuste autorizado por contabilidad (${it.accion}). ${it.notas.join(" ")}`
        : `Saneamiento interno de cartera Autocash. ${it.notas.join(" ")}`;

      await withCapitalContext(null, FUENTE_HISTORIAL, motivo, async (tx) => {
        if (it.padre) {
          if (it.padre.capital_antes !== it.padre.capital_despues) {
            await tx.update(creditos)
              .set({ capital: it.padre.capital_despues.toFixed(2) })
              .where(eq(creditos.credito_id, cred.credito_id));
          }
          await tx.update(creditos_inversionistas)
            .set({ monto_aportado: it.padre.autocash_despues.toFixed(2) })
            .where(and(eq(creditos_inversionistas.credito_id, cred.credito_id),
                       eq(creditos_inversionistas.inversionista_id, inv.id)));
        }
        if (it.espejo && fEsp) {
          await tx.update(creditos_inversionistas_espejo)
            .set({ monto_aportado: it.espejo.autocash_despues.toFixed(2), updated_at: new Date() })
            .where(eq(creditos_inversionistas_espejo.id, fEsp.id));
        }
        for (const o of it.otros_movidos) {
          const [otro] = await tx.select({ id: inversionistas.inversionista_id })
            .from(inversionistas).where(eq(inversionistas.nombre, o.nombre)).limit(1);
          if (!otro) throw new Error(`No existe el inversionista "${o.nombre}"`);
          await tx.update(creditos_inversionistas)
            .set({ monto_aportado: o.padre_despues.toFixed(2) })
            .where(and(eq(creditos_inversionistas.credito_id, cred.credito_id),
                       eq(creditos_inversionistas.inversionista_id, otro.id)));
          await tx.update(creditos_inversionistas_espejo)
            .set({ monto_aportado: o.espejo_despues.toFixed(2), updated_at: new Date() })
            .where(and(eq(creditos_inversionistas_espejo.credito_id, cred.credito_id),
                       eq(creditos_inversionistas_espejo.inversionista_id, otro.id)));
        }
      });

      if (it.recalcular_pagos) paraRecalcular.push(it.numero_credito_sifco);
      resultados.push({ ...base, estado: "aplicado", cambios });
    } catch (e) {
      console.error(`  ✖ ${it.numero_credito_sifco}: ${String(e)}`);
      resultados.push({ ...base, estado: "error", motivo: String(e) });
    }
  }

  if (APLICAR && !SIN_RECALCULO && paraRecalcular.length) {
    console.log(`\n▶ Recalculando pagos no pagados de ${paraRecalcular.length} créditos\n`);
    for (const s of paraRecalcular) {
      try {
        await recalcularPagosCredito({ numero_credito_sifco: s });
        const r = resultados.find((x) => x.sifco === s);
        if (r) r.pagos_recalculados = true;
      } catch (e) {
        console.error(`  ✖ recálculo ${s}: ${String(e)}`);
        const r = resultados.find((x) => x.sifco === s);
        if (r) { r.pagos_recalculados = false; r.motivo = `ajustado pero FALLÓ el recálculo: ${String(e)}`; }
      }
    }
  }

  const n = (e: Resultado["estado"]) => resultados.filter((r) => r.estado === e).length;
  const reporte = {
    corrida: new Date().toISOString(),
    modo: APLICAR ? "apply" : "dry-run",
    plan: RUTA_PLAN,
    resumen: {
      procesados: resultados.length, aplicados: n("aplicado"), simulados: n("simulado"),
      omitidos: n("omitido"), errores: n("error"),
      pagos_recalculados: resultados.filter((r) => r.pagos_recalculados).length,
    },
    resultados,
  };
  writeFileSync(RUTA_REPORTE, JSON.stringify(reporte, null, 2), "utf-8");

  console.log("\n──────── resumen ────────");
  for (const [k, v] of Object.entries(reporte.resumen)) console.log(`  ${k}: ${v}`);
  for (const r of resultados.filter((x) => x.estado === "omitido" || x.estado === "error"))
    console.log(`  · ${r.sifco} [${r.estado}]: ${r.motivo}`);
  console.log(`\nReporte: ${RUTA_REPORTE}`);
  if (!APLICAR) console.log("Nada se escribió. Corré con --apply cuando estés listo.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
