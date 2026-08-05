/**
 * FASE 2 — Aplica el plan generado por `generar_plan_ajuste_autocash.py`.
 *
 * Qué hace por cada crédito del plan:
 *   1. Re-lee el estado vivo de la base y verifica que siga coincidiendo con el plan
 *      (si alguien movió el crédito entre medio, se salta y se reporta: plan viejo).
 *   2. En UNA transacción:
 *        · creditos.capital  ← capital del Excel
 *        · creditos.cuota    ← cuota del Excel
 *        · creditos_inversionistas (SOLO la fila de Autocash):
 *            monto_aportado      ← absorbe la diferencia para que la suma cuadre
 *            cuota_inversionista ← idem contra creditos.cuota
 *        · creditos_inversionistas_espejo (SOLO la fila de Autocash):
 *            se empareja con los mismos valores que el padre, para que el espejo
 *            no quede desalineado (es el que manda para liquidación).
 *      El UPDATE del crédito va envuelto en withCapitalContext para que el trigger
 *      trg_historial_capital_credito deje registro con fuente y motivo.
 *   3. Llama a recalcularPagosCredito({ numero_credito_sifco }) — sin numero_cuota,
 *      así solo recalcula las cuotas NO pagadas (y los pagos pendientes de validar).
 *
 * Lo que NUNCA toca:
 *   · Ningún inversionista que no sea Autocash (ni en el padre ni en el espejo).
 *   · Créditos fuera de ACTIVO / MOROSO / EN_CONVENIO.
 *   · Filas espejo que no existan: no se crean, se reportan.
 *
 * Por defecto corre en SECO (dry-run): imprime y reporta sin escribir.
 * Para escribir hay que pasar --apply explícitamente.
 *
 * Uso:
 *   bun run src/scripts/autocash/aplicarPlanAjusteAutocash.ts --plan=plan_ajuste_autocash.json
 *   bun run src/scripts/autocash/aplicarPlanAjusteAutocash.ts --plan=... --apply
 *   bun run src/scripts/autocash/aplicarPlanAjusteAutocash.ts --plan=... --solo=01010214117220 --apply
 */
import { readFileSync, writeFileSync } from "node:fs";
import Big from "big.js";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../../database";
import {
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  inversionistas,
} from "../../database/db";
import { recalcularPagosCredito } from "../../controllers/updateCredit";
import { withCapitalContext } from "../../utils/withAuditContext";

// ─────────────────────────────────────────────────────────────── configuración
const ESTADOS_AJUSTABLES = ["ACTIVO", "MOROSO", "EN_CONVENIO"] as const;
const FUENTE_HISTORIAL = "AJUSTE_EXCEL_AUTOCASH";
const TOLERANCIA_VERIFICACION = new Big("0.05"); // margen al comparar el plan contra la base viva

type Movimiento = { actual: number; objetivo: number; delta: number };

interface ItemPlan {
  numero_credito_sifco: string;
  credito_id: number;
  cliente: string;
  status: string;
  hoja_excel: string;
  sifcos_excel: string[];
  capital: Movimiento;
  cuota: Movimiento;
  autocash: {
    inversionista_id: number;
    credito_inversionista_id: number;
    monto_aportado: Movimiento;
    cuota_inversionista: Movimiento;
    tiene_espejo: boolean;
  };
  otros_inversionistas: unknown[];
  avisos: string[];
}

interface Plan {
  generado_en: string;
  excel: string;
  inversionista_objetivo: string;
  estados_ajustables: string[];
  tolerancia: number;
  resumen: Record<string, number>;
  aplicar: ItemPlan[];
  excluidos: unknown[];
  revisar_manual: unknown[];
}

// ───────────────────────────────────────────────────────────────── argumentos
function arg(nombre: string): string | undefined {
  const p = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return p ? p.slice(nombre.length + 3) : undefined;
}
const flag = (nombre: string) => process.argv.includes(`--${nombre}`);

const RUTA_PLAN = arg("plan") ?? "plan_ajuste_autocash.json";
const APLICAR = flag("apply");
const SIN_RECALCULO = flag("sin-recalculo");
const SIN_ESPEJO = flag("sin-espejo");
const PERMITIR_PROD = flag("permitir-prod");
const LIMITE = Number(arg("limite") ?? 0) || 0;
const SOLO = (arg("solo") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const RUTA_REPORTE = arg("reporte") ?? "reporte_ajuste_autocash.json";

// ───────────────────────────────────────────────────────────── guarda de prod
function verificarDestino() {
  const url = process.env.SUPABASE_DB_URL ?? "";
  const host = url.replace(/^[a-z]+:\/\/[^@]*@/i, "").split(/[/:?]/)[0] ?? "(desconocido)";
  const esProd = /supabase\.com/i.test(url);
  console.log(`Base destino: ${host}${esProd ? "  ⚠️  ESTO ES PRODUCCIÓN" : ""}`);
  if (esProd && APLICAR && !PERMITIR_PROD) {
    console.error(
      "\n⛔ Abortado: el destino es producción (supabase.com) y este script escribe.\n" +
        "   Corré las pruebas contra dev. Si de verdad querés aplicar en prod, pasá --permitir-prod.",
    );
    process.exit(1);
  }
}

// ───────────────────────────────────────────────────────────────── utilidades
const big = (v: unknown) => new Big(String(v ?? 0));
const cerca = (a: Big, b: Big) => a.minus(b).abs().lte(TOLERANCIA_VERIFICACION);
const q2 = (v: Big) => v.round(2).toString();

type Resultado = {
  numero_credito_sifco: string;
  cliente: string;
  status: string;
  estado: "aplicado" | "simulado" | "omitido" | "error";
  motivo?: string;
  capital?: { antes: string; despues: string };
  cuota?: { antes: string; despues: string };
  autocash?: {
    monto_aportado: { antes: string; despues: string };
    cuota_inversionista: { antes: string; despues: string };
  };
  espejo?: {
    estado: "emparejado" | "sin_fila" | "omitido";
    monto_aportado?: { antes: string; despues: string };
    cuota_inversionista?: { antes: string; despues: string };
  };
  pagos_recalculados?: boolean;
  avisos?: string[];
};

// ─────────────────────────────────────────────────────────────────── principal
async function main() {
  verificarDestino();

  const plan: Plan = JSON.parse(readFileSync(RUTA_PLAN, "utf-8"));
  console.log(`\nPlan: ${RUTA_PLAN}  (generado ${plan.generado_en})`);
  console.log(`Excel de origen: ${plan.excel}`);
  console.log(`Inversionista objetivo: ${plan.inversionista_objetivo}`);
  console.log(
    `Items: ${plan.aplicar.length} a aplicar · ${plan.excluidos.length} excluidos · ` +
      `${plan.revisar_manual.length} inversionistas para revisión manual`,
  );
  console.log(APLICAR ? "\n▶ MODO ESCRITURA (--apply)\n" : "\n▶ MODO SECO (dry-run). Nada se escribe.\n");

  // El id de Autocash cambia entre ambientes: se resuelve por nombre, no se fija.
  const [inv] = await db
    .select({ id: inversionistas.inversionista_id, nombre: inversionistas.nombre })
    .from(inversionistas)
    .where(eq(inversionistas.nombre, plan.inversionista_objetivo))
    .limit(1);
  if (!inv) throw new Error(`No existe el inversionista "${plan.inversionista_objetivo}" en esta base`);
  console.log(`Inversionista objetivo resuelto: ${inv.nombre} (id ${inv.id})\n`);

  let items = plan.aplicar;
  if (SOLO.length) items = items.filter((i) => SOLO.includes(i.numero_credito_sifco));
  if (LIMITE) items = items.slice(0, LIMITE);

  const resultados: Resultado[] = [];
  const paraRecalcular: string[] = [];

  for (const item of items) {
    const base: Resultado = {
      numero_credito_sifco: item.numero_credito_sifco,
      cliente: item.cliente,
      status: item.status,
      estado: "omitido",
      avisos: item.avisos,
    };

    try {
      // 1️⃣ Releer el estado vivo
      const [cred] = await db
        .select({
          credito_id: creditos.credito_id,
          capital: creditos.capital,
          cuota: creditos.cuota,
          status: creditos.statusCredit,
        })
        .from(creditos)
        .where(eq(creditos.numero_credito_sifco, item.numero_credito_sifco))
        .limit(1);

      if (!cred) {
        resultados.push({ ...base, motivo: "el crédito ya no existe en esta base" });
        continue;
      }
      if (!ESTADOS_AJUSTABLES.includes(cred.status as (typeof ESTADOS_AJUSTABLES)[number])) {
        resultados.push({ ...base, motivo: `status ${cred.status} no ajustable` });
        continue;
      }

      const filas = await db
        .select({
          id: creditos_inversionistas.id,
          inversionista_id: creditos_inversionistas.inversionista_id,
          monto_aportado: creditos_inversionistas.monto_aportado,
          cuota_inversionista: creditos_inversionistas.cuota_inversionista,
        })
        .from(creditos_inversionistas)
        .where(eq(creditos_inversionistas.credito_id, cred.credito_id));

      const fAuto = filas.find((f) => f.inversionista_id === inv.id);
      if (!fAuto) {
        resultados.push({ ...base, motivo: "el crédito ya no tiene participación de Autocash" });
        continue;
      }

      const [fEspejo] = await db
        .select({
          id: creditos_inversionistas_espejo.id,
          monto_aportado: creditos_inversionistas_espejo.monto_aportado,
          cuota_inversionista: creditos_inversionistas_espejo.cuota_inversionista,
        })
        .from(creditos_inversionistas_espejo)
        .where(
          and(
            eq(creditos_inversionistas_espejo.credito_id, cred.credito_id),
            eq(creditos_inversionistas_espejo.inversionista_id, inv.id),
          ),
        )
        .limit(1);

      // 2️⃣ El plan tiene que seguir describiendo la realidad
      const capActual = big(cred.capital);
      const cuoActual = big(cred.cuota);
      const autoAportActual = big(fAuto.monto_aportado);
      const autoCuotaActual = big(fAuto.cuota_inversionista);

      const desfases: string[] = [];
      if (!cerca(capActual, big(item.capital.actual))) desfases.push(`capital ${capActual} ≠ plan ${item.capital.actual}`);
      if (!cerca(cuoActual, big(item.cuota.actual))) desfases.push(`cuota ${cuoActual} ≠ plan ${item.cuota.actual}`);
      if (!cerca(autoAportActual, big(item.autocash.monto_aportado.actual)))
        desfases.push(`monto_aportado Autocash ${autoAportActual} ≠ plan ${item.autocash.monto_aportado.actual}`);
      if (!cerca(autoCuotaActual, big(item.autocash.cuota_inversionista.actual)))
        desfases.push(`cuota_inversionista Autocash ${autoCuotaActual} ≠ plan ${item.autocash.cuota_inversionista.actual}`);

      if (desfases.length) {
        resultados.push({
          ...base,
          motivo: `el plan quedó viejo, la base cambió: ${desfases.join("; ")}. Regenerá el plan.`,
        });
        continue;
      }

      // 3️⃣ Recalcular objetivos contra la base viva (no confiar ciegamente en el plan)
      const capObjetivo = big(item.capital.objetivo);
      const cuoObjetivo = big(item.cuota.objetivo);
      const sumaAport = filas.reduce((a, f) => a.plus(big(f.monto_aportado)), new Big(0));
      const sumaCuotaInv = filas.reduce((a, f) => a.plus(big(f.cuota_inversionista)), new Big(0));
      const autoAportObjetivo = autoAportActual.plus(capObjetivo.minus(sumaAport)).round(2);
      const autoCuotaObjetivo = autoCuotaActual.plus(cuoObjetivo.minus(sumaCuotaInv)).round(2);

      if (autoAportObjetivo.lt(0) || autoCuotaObjetivo.lt(0)) {
        resultados.push({
          ...base,
          motivo:
            `el ajuste dejaría a Autocash en negativo ` +
            `(monto_aportado ${autoAportObjetivo}, cuota ${autoCuotaObjetivo}); requiere revisión manual`,
        });
        continue;
      }

      const detalle: Resultado = {
        ...base,
        estado: APLICAR ? "aplicado" : "simulado",
        capital: { antes: q2(capActual), despues: q2(capObjetivo) },
        cuota: { antes: q2(cuoActual), despues: q2(cuoObjetivo) },
        autocash: {
          monto_aportado: { antes: q2(autoAportActual), despues: q2(autoAportObjetivo) },
          cuota_inversionista: { antes: q2(autoCuotaActual), despues: q2(autoCuotaObjetivo) },
        },
        espejo: !fEspejo
          ? { estado: "sin_fila" }
          : SIN_ESPEJO
            ? { estado: "omitido" }
            : {
                estado: "emparejado",
                monto_aportado: { antes: q2(big(fEspejo.monto_aportado)), despues: q2(autoAportObjetivo) },
                cuota_inversionista: {
                  antes: q2(big(fEspejo.cuota_inversionista)),
                  despues: q2(autoCuotaObjetivo),
                },
              },
      };

      console.log(
        `${APLICAR ? "APLICANDO" : "simulando"}  ${item.numero_credito_sifco}  ${item.cliente.slice(0, 34).padEnd(34)} ` +
          `[${cred.status}]  cap ${q2(capActual)} → ${q2(capObjetivo)}  ·  cuota ${q2(cuoActual)} → ${q2(cuoObjetivo)}`,
      );
      console.log(
        `            Autocash: aportado ${q2(autoAportActual)} → ${q2(autoAportObjetivo)}  ·  ` +
          `cuota_inv ${q2(autoCuotaActual)} → ${q2(autoCuotaObjetivo)}`,
      );
      if (!fEspejo) {
        console.log("            ⚠  Autocash no tiene fila ESPEJO en este crédito: no se crea, revisar a mano.");
      } else if (SIN_ESPEJO) {
        console.log("            ·  espejo omitido por --sin-espejo");
      } else {
        console.log(
          `            Espejo:   aportado ${q2(big(fEspejo.monto_aportado))} → ${q2(autoAportObjetivo)}  ·  ` +
            `cuota_inv ${q2(big(fEspejo.cuota_inversionista))} → ${q2(autoCuotaObjetivo)}`,
        );
      }
      for (const a of item.avisos ?? []) console.log(`            ⚠  ${a}`);

      if (!APLICAR) {
        resultados.push(detalle);
        continue;
      }

      // 4️⃣ Escritura: todo el crédito en una sola transacción
      const motivo =
        `Ajuste masivo contra Excel de cartera (hoja ${item.hoja_excel}). ` +
        `Filas Excel: ${item.sifcos_excel.join(", ")}.`;

      await withCapitalContext(null, FUENTE_HISTORIAL, motivo, async (tx) => {
        await tx
          .update(creditos)
          .set({ capital: q2(capObjetivo), cuota: q2(cuoObjetivo) })
          .where(eq(creditos.credito_id, cred.credito_id));

        await tx
          .update(creditos_inversionistas)
          .set({
            monto_aportado: autoAportObjetivo.toString(),
            cuota_inversionista: q2(autoCuotaObjetivo),
          })
          .where(
            and(
              eq(creditos_inversionistas.credito_id, cred.credito_id),
              eq(creditos_inversionistas.inversionista_id, inv.id),
            ),
          );

        // El espejo se empareja con el padre: es el registro que manda para
        // liquidación, y dejarlo con los montos viejos descuadraría los pagos
        // al inversionista. Si la fila no existe NO se crea: crearla implicaría
        // inventar porcentajes y modalidad de facturación.
        if (fEspejo && !SIN_ESPEJO) {
          await tx
            .update(creditos_inversionistas_espejo)
            .set({
              monto_aportado: autoAportObjetivo.toString(),
              cuota_inversionista: q2(autoCuotaObjetivo),
              updated_at: new Date(),
            })
            .where(eq(creditos_inversionistas_espejo.id, fEspejo.id));
        }
      });

      paraRecalcular.push(item.numero_credito_sifco);
      resultados.push(detalle);
    } catch (e) {
      console.error(`  ✖ ${item.numero_credito_sifco}: ${String(e)}`);
      resultados.push({ ...base, estado: "error", motivo: String(e) });
    }
  }

  // 5️⃣ Recálculo de las cuotas NO pagadas, crédito por crédito
  if (APLICAR && !SIN_RECALCULO && paraRecalcular.length) {
    console.log(`\n▶ Recalculando pagos no pagados de ${paraRecalcular.length} créditos...\n`);
    for (const sifco of paraRecalcular) {
      try {
        await recalcularPagosCredito({ numero_credito_sifco: sifco });
        const r = resultados.find((x) => x.numero_credito_sifco === sifco);
        if (r) r.pagos_recalculados = true;
      } catch (e) {
        console.error(`  ✖ recálculo ${sifco}: ${String(e)}`);
        const r = resultados.find((x) => x.numero_credito_sifco === sifco);
        if (r) {
          r.pagos_recalculados = false;
          r.motivo = `crédito ajustado pero FALLÓ el recálculo de pagos: ${String(e)}`;
        }
      }
    }
  }

  // 6️⃣ Verificación post-ajuste: el espejo tiene que haber quedado igual al padre.
  //     Si acá sale algo es que quedó desalineado (fila espejo inexistente, --sin-espejo,
  //     o algo escribió en medio) y hay que revisarlo a mano.
  const idsAjustados = resultados
    .filter((r) => r.estado === "aplicado")
    .map((r) => items.find((i) => i.numero_credito_sifco === r.numero_credito_sifco)!.credito_id);

  let espejosDesalineados: unknown[] = [];
  if (idsAjustados.length) {
    const padres = await db
      .select({
        credito_id: creditos_inversionistas.credito_id,
        monto_aportado: creditos_inversionistas.monto_aportado,
        cuota_inversionista: creditos_inversionistas.cuota_inversionista,
      })
      .from(creditos_inversionistas)
      .where(
        and(
          inArray(creditos_inversionistas.credito_id, idsAjustados),
          eq(creditos_inversionistas.inversionista_id, inv.id),
        ),
      );
    const espejos = await db
      .select({
        credito_id: creditos_inversionistas_espejo.credito_id,
        monto_aportado: creditos_inversionistas_espejo.monto_aportado,
        cuota_inversionista: creditos_inversionistas_espejo.cuota_inversionista,
      })
      .from(creditos_inversionistas_espejo)
      .where(
        and(
          inArray(creditos_inversionistas_espejo.credito_id, idsAjustados),
          eq(creditos_inversionistas_espejo.inversionista_id, inv.id),
        ),
      );
    const porCredito = new Map(espejos.map((e) => [e.credito_id, e]));
    espejosDesalineados = padres
      .map((p) => {
        const e = porCredito.get(p.credito_id);
        if (!e) return null;
        const dCap = big(p.monto_aportado).minus(big(e.monto_aportado));
        const dCuo = big(p.cuota_inversionista).minus(big(e.cuota_inversionista));
        if (dCap.abs().lte("0.01") && dCuo.abs().lte("0.01")) return null;
        return {
          credito_id: p.credito_id,
          padre_monto_aportado: q2(big(p.monto_aportado)),
          espejo_monto_aportado: q2(big(e.monto_aportado)),
          dif_monto_aportado: q2(dCap),
          padre_cuota_inversionista: q2(big(p.cuota_inversionista)),
          espejo_cuota_inversionista: q2(big(e.cuota_inversionista)),
          dif_cuota_inversionista: q2(dCuo),
        };
      })
      .filter(Boolean);
  }

  // 7️⃣ Reporte
  const cuenta = (e: Resultado["estado"]) => resultados.filter((r) => r.estado === e).length;
  const reporte = {
    corrida: new Date().toISOString(),
    modo: APLICAR ? "apply" : "dry-run",
    plan: RUTA_PLAN,
    plan_generado_en: plan.generado_en,
    inversionista: { id: inv.id, nombre: inv.nombre },
    resumen: {
      procesados: resultados.length,
      aplicados: cuenta("aplicado"),
      simulados: cuenta("simulado"),
      omitidos: cuenta("omitido"),
      errores: cuenta("error"),
      pagos_recalculados: resultados.filter((r) => r.pagos_recalculados).length,
      espejos_emparejados: resultados.filter((r) => r.espejo?.estado === "emparejado").length,
      creditos_sin_fila_espejo: resultados.filter((r) => r.espejo?.estado === "sin_fila").length,
      espejos_desalineados: espejosDesalineados.length,
    },
    resultados,
    espejos_desalineados: espejosDesalineados,
    revisar_manual: plan.revisar_manual,
    excluidos: plan.excluidos,
  };
  writeFileSync(RUTA_REPORTE, JSON.stringify(reporte, null, 2), "utf-8");

  console.log("\n──────── resumen ────────");
  for (const [k, v] of Object.entries(reporte.resumen)) console.log(`  ${k}: ${v}`);
  for (const r of resultados.filter((x) => x.estado === "omitido" || x.estado === "error")) {
    console.log(`  · ${r.numero_credito_sifco} [${r.estado}]: ${r.motivo}`);
  }
  const sinEspejo = resultados.filter((r) => r.espejo?.estado === "sin_fila").length;
  if (sinEspejo) {
    console.log(
      `\n⚠  ${sinEspejo} créditos donde Autocash no tiene fila espejo. No se creó ninguna: revisar a mano.`,
    );
  }
  if (espejosDesalineados.length) {
    console.log(
      `\n⚠  ${espejosDesalineados.length} filas espejo NO quedaron iguales al padre después del ajuste. ` +
        "Revisar: no debería pasar salvo que se haya corrido con --sin-espejo.",
    );
  }
  console.log(`\nReporte: ${RUTA_REPORTE}`);
  if (!APLICAR) console.log("Nada se escribió. Volvé a correr con --apply cuando estés listo.");

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
