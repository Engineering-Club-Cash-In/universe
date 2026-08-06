/**
 * Limpia los recibos futuros que traen "plata fantasma".
 *
 * EL PROBLEMA
 * -----------
 * Hay créditos cuyos recibos de cuotas todavía NO vencidas/pagadas vienen sembrados
 * con `monto_aplicado` = el valor de la cuota, aunque `fecha_pago` sea NULL y nadie
 * haya pagado nada. En un crédito sano esas filas van con `monto_aplicado = 0.00`.
 *
 * Eso es una bomba: `recalcularPagosCredito` lee `monto_aplicado` y lo trata como
 * plata realmente cobrada (updateCredit.ts, rama `if (montoAplicado.gt(0))`). Cuando
 * alguien le da "Recalcular Pagos" al crédito, reparte ese monto fantasma contra
 * interés → IVA → seguro → GPS → membresías → capital, deja todos los saldos en 0,
 * `cuotaCerradaAhora()` devuelve true y estampa `pagado = true` en todo el calendario
 * futuro. A partir de ahí "Recalcular Cuota" revienta con
 * "No hay cuotas pendientes por actualizar", porque ya no encuentra cuotas pendientes.
 *
 * Fue lo que le pasó al crédito 279 (01010214120220) el 2026-08-06 a las 15:03 GT.
 *
 * QUÉ HACE ESTE SCRIPT
 * --------------------
 * Por cada crédito afectado (ACTIVO / MOROSO / EN_CONVENIO):
 *   1. Respalda TODAS sus filas de pagos_credito en una tabla de backup.
 *   2. En UNA transacción, sobre los recibos de cuotas NO pagadas y sin `fecha_pago`,
 *      deja la fila como recibo limpio:
 *        monto_aplicado, abono_capital, abono_interes, abono_iva_12,
 *        abono_seguro, abono_gps, pago_del_mes  →  0
 *        pagado                                 →  false
 *   3. Llama a `recalcularPagosCredito({ numero_credito_sifco })` — sin `numero_cuota`,
 *      así solo toca las cuotas no pagadas — para re-sembrar los `*_restante` contra
 *      el capital real del crédito.
 *
 * LO QUE NO TOCA
 * --------------
 *   · Recibos con `fecha_pago` (pagos reales) y recibos de cuotas ya pagadas.
 *   · `membresias` / `membresias_pago` / `membresias_mes`: se verificó que en los
 *     créditos afectados van en 0, así que no hay nada que corregir ahí y se dejan
 *     como están para no ampliar el radio del cambio.
 *   · `abono_interes_ci` / `abono_iva_ci`: no los escribe el recálculo.
 *   · `creditos.cuota` y los inversionistas. El "Recalcular Cuota" lo corre
 *     contabilidad desde la UI cuando termine este saneamiento.
 *
 * Por defecto corre en SECO (dry-run): imprime y reporta sin escribir.
 * Para escribir hay que pasar --apply, y si el destino es producción además
 * --permitir-prod.
 *
 * Uso:
 *   bun run src/scripts/saneamiento/limpiarRecibosFantasma.ts
 *   bun run src/scripts/saneamiento/limpiarRecibosFantasma.ts --apply --permitir-prod
 *   bun run src/scripts/saneamiento/limpiarRecibosFantasma.ts --solo=01010214120220 --apply
 *   bun run src/scripts/saneamiento/limpiarRecibosFantasma.ts --apply --sin-recalculo
 */
import { writeFileSync } from "node:fs";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { db } from "../../database";
import { creditos, cuotas_credito, pagos_credito } from "../../database/db";
import { recalcularPagosCredito } from "../../controllers/updateCredit";

// ─────────────────────────────────────────────────────────────── configuración
const ESTADOS_SANEABLES = ["ACTIVO", "MOROSO", "EN_CONVENIO"];

function arg(n: string) {
  const p = process.argv.find((a) => a.startsWith(`--${n}=`));
  return p ? p.slice(n.length + 3) : undefined;
}
const flag = (n: string) => process.argv.includes(`--${n}`);

const APLICAR = flag("apply");
const PERMITIR_PROD = flag("permitir-prod");
const SIN_RECALCULO = flag("sin-recalculo");
const SIN_BACKUP = flag("sin-backup");
const SOLO = (arg("solo") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const TABLA_BACKUP = arg("tabla-backup") ?? "backup_recibos_fantasma_20260806";
const RUTA_REPORTE = arg("reporte") ?? "reporte_recibos_fantasma.json";

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
  credito_id: number;
  sifco: string;
  status: string;
  recibos_limpiados: number;
  ya_marcados_pagado: number;
  monto_fantasma: string;
  estado: "aplicado" | "simulado" | "error";
  motivo?: string;
  pagos_recalculados?: boolean;
};

async function main() {
  verificarDestino();
  console.log(APLICAR ? "▶ MODO ESCRITURA (--apply)\n" : "▶ MODO SECO. Nada se escribe.\n");

  // 1️⃣ Detectar los recibos fantasma.
  //    Un recibo es fantasma si su cuota NO está pagada y no tiene fecha_pago,
  //    pero aun así trae monto_aplicado > 0 (la siembra original) o ya quedó
  //    marcado pagado=true (un recálculo previo que ya detonó la bomba).
  const filtros = [
    inArray(creditos.statusCredit, ESTADOS_SANEABLES),
    eq(cuotas_credito.pagado, false),
    isNull(pagos_credito.fecha_pago),
    or(
      sql`${pagos_credito.monto_aplicado}::numeric > 0`,
      eq(pagos_credito.pagado, true),
    ),
  ];
  if (SOLO.length) filtros.push(inArray(creditos.numero_credito_sifco, SOLO));

  const recibos = await db
    .select({
      credito_id: creditos.credito_id,
      sifco: creditos.numero_credito_sifco,
      status: creditos.statusCredit,
      pago_id: pagos_credito.pago_id,
      numero_cuota: cuotas_credito.numero_cuota,
      monto_aplicado: pagos_credito.monto_aplicado,
      pagado: pagos_credito.pagado,
    })
    .from(pagos_credito)
    .innerJoin(cuotas_credito, eq(cuotas_credito.cuota_id, pagos_credito.cuota_id))
    .innerJoin(creditos, eq(creditos.credito_id, pagos_credito.credito_id))
    .where(and(...filtros))
    .orderBy(creditos.credito_id, cuotas_credito.numero_cuota);

  if (!recibos.length) {
    console.log("✔ No hay recibos fantasma. Nada que hacer.");
    process.exit(0);
  }

  // Agrupar por crédito
  const porCredito = new Map<number, typeof recibos>();
  for (const r of recibos) {
    const lista = porCredito.get(r.credito_id) ?? [];
    lista.push(r);
    porCredito.set(r.credito_id, lista);
  }

  console.log(`Créditos afectados: ${porCredito.size}   ·   recibos: ${recibos.length}\n`);
  for (const [credito_id, filas] of porCredito) {
    const monto = filas.reduce((a, f) => a + Number(f.monto_aplicado ?? 0), 0);
    const marcados = filas.filter((f) => f.pagado).length;
    console.log(
      `  ${filas[0].sifco}  (id ${credito_id}, ${filas[0].status})  ` +
        `${filas.length} recibos  ·  Q${monto.toFixed(2)} fantasma` +
        (marcados ? `  ·  ⚠️ ${marcados} ya marcados pagado=true` : ""),
    );
  }

  // 2️⃣ Backup de las filas de pagos_credito de los créditos afectados.
  const creditoIds = [...porCredito.keys()];
  if (APLICAR && !SIN_BACKUP) {
    const tabla = sql.raw(`cartera.${TABLA_BACKUP}`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ${tabla} AS
      SELECT * FROM cartera.pagos_credito WHERE false
    `);
    await db.execute(sql`
      INSERT INTO ${tabla}
      SELECT * FROM cartera.pagos_credito
      WHERE credito_id IN (${sql.join(creditoIds.map((id) => sql`${id}`), sql`, `)})
    `);
    console.log(`\n✔ Backup en cartera.${TABLA_BACKUP}`);
  }

  // 3️⃣ Limpiar, un crédito por transacción.
  const resultados: Resultado[] = [];
  const paraRecalcular: string[] = [];

  console.log("");
  for (const [credito_id, filas] of porCredito) {
    const base = {
      credito_id,
      sifco: filas[0].sifco,
      status: filas[0].status,
      recibos_limpiados: filas.length,
      ya_marcados_pagado: filas.filter((f) => f.pagado).length,
      monto_fantasma: filas
        .reduce((a, f) => a + Number(f.monto_aplicado ?? 0), 0)
        .toFixed(2),
    };

    if (!APLICAR) {
      console.log(`  ○ ${base.sifco}: se limpiarían ${filas.length} recibos`);
      resultados.push({ ...base, estado: "simulado" });
      continue;
    }

    try {
      await db.transaction(async (tx) => {
        await tx
          .update(pagos_credito)
          .set({
            pagado: false,
            monto_aplicado: "0",
            abono_capital: "0",
            abono_interes: "0",
            abono_iva_12: "0",
            abono_seguro: "0",
            abono_gps: "0",
            pago_del_mes: "0",
          })
          .where(inArray(pagos_credito.pago_id, filas.map((f) => f.pago_id)));
      });

      console.log(`  ✔ ${base.sifco}: ${filas.length} recibos limpiados`);
      paraRecalcular.push(base.sifco);
      resultados.push({ ...base, estado: "aplicado" });
    } catch (e) {
      console.error(`  ✖ ${base.sifco}: ${String(e)}`);
      resultados.push({ ...base, estado: "error", motivo: String(e) });
    }
  }

  // 4️⃣ Recalcular pagos: re-siembra los *_restante contra el capital real.
  //    Sin numero_cuota → solo cuotas no pagadas.
  if (APLICAR && !SIN_RECALCULO && paraRecalcular.length) {
    console.log(`\n▶ Recalculando pagos de ${paraRecalcular.length} créditos\n`);
    for (const s of paraRecalcular) {
      try {
        await recalcularPagosCredito({ numero_credito_sifco: s });
        const r = resultados.find((x) => x.sifco === s);
        if (r) r.pagos_recalculados = true;
        console.log(`  ✔ ${s}`);
      } catch (e) {
        console.error(`  ✖ recálculo ${s}: ${String(e)}`);
        const r = resultados.find((x) => x.sifco === s);
        if (r) {
          r.pagos_recalculados = false;
          r.motivo = `limpiado pero FALLÓ el recálculo: ${String(e)}`;
        }
      }
    }
  }

  // 5️⃣ Reporte
  const n = (e: Resultado["estado"]) => resultados.filter((r) => r.estado === e).length;
  const reporte = {
    corrida: new Date().toISOString(),
    modo: APLICAR ? "apply" : "dry-run",
    tabla_backup: APLICAR && !SIN_BACKUP ? `cartera.${TABLA_BACKUP}` : null,
    resumen: {
      creditos: resultados.length,
      aplicados: n("aplicado"),
      simulados: n("simulado"),
      errores: n("error"),
      recibos: recibos.length,
      pagos_recalculados: resultados.filter((r) => r.pagos_recalculados).length,
    },
    resultados,
  };
  writeFileSync(RUTA_REPORTE, JSON.stringify(reporte, null, 2), "utf-8");

  console.log("\n──────── resumen ────────");
  for (const [k, v] of Object.entries(reporte.resumen)) console.log(`  ${k}: ${v}`);
  for (const r of resultados.filter((x) => x.estado === "error"))
    console.log(`  · ${r.sifco} [error]: ${r.motivo}`);
  console.log(`\nReporte: ${RUTA_REPORTE}`);
  if (!APLICAR) console.log("Nada se escribió. Corré con --apply cuando estés listo.");
  console.log(
    "\nRecordá: el 'Recalcular Cuota' de los créditos lo corre contabilidad desde la UI.",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
