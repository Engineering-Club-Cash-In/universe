import Big from "big.js";
import { eq, and, ilike, or, inArray } from "drizzle-orm";
import { db } from "../database";
import {
  boletas,
  creditos,
  creditos_inversionistas,
  cuotas_credito,
  inversionistas,
  pagos_credito,
  pagos_credito_inversionistas,
} from "../database/db";
import { findOrCreateAdvisorByName } from "./advisor";
import { findOrCreateUserByName } from "./users";
import { marcarCuotasPagadasHastaNumero } from "./migratePayments";
import { updateAllInstallments } from "./updateCredit";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export interface ExcelRowFull {
  CreditoSIFCO: string;
  Nombre?: string;
  Capital?: any;
  porcentaje?: any;
  Cuotas?: any;
  Plazo?: any;
  Cuota?: any;
  GPS?: any;
  Seguro10Cuotas?: any;
  Membresias?: any;
  MembresiasPago?: any;
  Otros?: any;
  Observaciones?: any;
  NumeroPoliza?: any;
  PorcentajeRoyalty?: any;
  Royalty?: any;
  Categoria?: any;
  NIT?: any;
  ComoSeEntero?: any;
  Asesor?: any;
  Inversionista?: any;
  PorcentajeCashIn?: any;
  PorcentajeInversionista?: any;
  CuotaInversionista?: any;
  Fecha?: any;
  Numero?: any;
  FormatoCredito?: any;
  [key: string]: any;
}

export interface CreditoAgrupadoExcel {
  creditoBase: string;
  cliente: string;
  filas: ExcelRowFull[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers numéricos
// ─────────────────────────────────────────────────────────────────────────────

const clean = (v: any): string => {
  if (v === null || v === undefined) return "0";
  return String(v).replace(/[Q$,()"\s]/g, "").replace(/^-/, "").trim() || "0";
};

const toBig = (v: any, def: string | number = "0"): Big => {
  try {
    return new Big(clean(v) || String(def));
  } catch {
    return new Big(def);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de nombre
// ─────────────────────────────────────────────────────────────────────────────

const normNombre = (n: string): string =>
  n
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,\-_()]/g, " ")
    .replace(/\b(s\.?a\.?|sa|ltda|inc|corp)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

function levenshteinSim(s1: string, s2: string): number {
  if (s1 === s2) return 100;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 100;
  const m: number[][] = Array.from({ length: s1.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= s2.length; j++) m[0][j] = j;
  for (let i = 1; i <= s1.length; i++)
    for (let j = 1; j <= s2.length; j++)
      m[i][j] = Math.min(
        m[i - 1][j] + 1,
        m[i][j - 1] + 1,
        m[i - 1][j - 1] + (s1[i - 1] === s2[j - 1] ? 0 : 1)
      );
  return Math.round(((maxLen - m[s1.length][s2.length]) / maxLen) * 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Buscar inversionista por nombre (exact → LIKE → fuzzy)
// ─────────────────────────────────────────────────────────────────────────────

async function buscarInversionistaId(nombre: string): Promise<number | null> {
  const norm = normNombre(nombre);

  const todos = await db
    .select({ inversionista_id: inversionistas.inversionista_id, nombre: inversionistas.nombre })
    .from(inversionistas);

  // 1. Exact
  for (const inv of todos)
    if (normNombre(inv.nombre) === norm) return inv.inversionista_id;

  // 2. LIKE por palabras clave
  const palabras = norm.split(" ").filter((p) => p.length >= 3);
  if (palabras.length > 0) {
    const results = await db
      .select({ inversionista_id: inversionistas.inversionista_id, nombre: inversionistas.nombre })
      .from(inversionistas)
      .where(or(...palabras.map((p) => ilike(inversionistas.nombre, `%${p}%`))));

    if (results.length === 1) return results[0].inversionista_id;
    if (results.length > 1) {
      const best = results
        .map((r) => ({ ...r, sim: levenshteinSim(norm, normNombre(r.nombre)) }))
        .sort((a, b) => b.sim - a.sim)[0];
      if (best.sim >= 50) return best.inversionista_id;
    }
  }

  // 3. Fuzzy full scan
  const best = todos
    .map((r) => ({ ...r, sim: levenshteinSim(norm, normNombre(r.nombre)) }))
    .filter((r) => r.sim >= 50)
    .sort((a, b) => b.sim - a.sim)[0];

  return best?.inversionista_id ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generar fechas de pago comenzando desde startDate
// cuota 0 = startDate (desembolso)
// cuota 1..N = mes a mes, día 30 (o último día del mes si < 30)
// ─────────────────────────────────────────────────────────────────────────────

function generatePaymentDates(plazo: number, startDate: Date): string[] {
  const fmt = (d: Date) =>
    d.toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });

  const fechas: string[] = [fmt(startDate)];

  for (let i = 0; i < plazo; i++) {
    const year = startDate.getFullYear();
    const month = startDate.getMonth() + i + 1;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const day = Math.min(30, lastDay);
    fechas.push(fmt(new Date(year, month, day, 12, 0, 0)));
  }

  return fechas;
}

// Si hasta_cuota = 2 y Fecha = "2026-02-15":
//   startDate = Feb 2026 - 2 meses = Dic 2025
//   cuota 0 = Dic 2025, cuota 1 = Ene 2026, cuota 2 = Feb 2026 ✓
function calcularStartDate(fechaActual: any, hastaCuota: number): Date {
  let fecha: Date;
  try {
    fecha = new Date(fechaActual);
    if (isNaN(fecha.getTime())) fecha = new Date();
  } catch {
    fecha = new Date();
  }

  const start = new Date(fecha);
  start.setDate(1); // normalizar al día 1 para evitar desbordamientos de mes
  start.setMonth(start.getMonth() - hastaCuota);
  return start;
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCIÓN PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

export async function procesarCreditoDesdeExcelFull(
  creditoAgrupado: CreditoAgrupadoExcel,
  hasta_cuota?: number
) {
  const { creditoBase, cliente, filas } = creditoAgrupado;

  if (!filas || filas.length === 0)
    return { success: false, error: `Sin filas para ${creditoBase}` };

  const filaRef = filas[0];

  console.log(`\n🚀 ======= PROCESANDO: ${creditoBase} =======`);
  console.log(`👤 Cliente: ${cliente}`);
  console.log(`📋 Filas: ${filas.length}`);
  if (hasta_cuota !== undefined) console.log(`📌 Hasta cuota: ${hasta_cuota}`);

  // ───────────────────────────────────────────────────────
  // 1. Calcular datos financieros desde Excel
  // ───────────────────────────────────────────────────────

  // Capital total = suma de todos los capitales de las filas (pool = múltiples inversionistas)
  const capitalTotal = filas.reduce(
    (acc, row) => acc + toBig(row.Capital).toNumber(),
    0
  );
  const capital = new Big(capitalTotal);

  const porcentajeInteres = toBig(filaRef.porcentaje, "1.5");
  const gps = toBig(filaRef.GPS, 0);
  const seguro10Cuotas = toBig(filaRef.Seguro10Cuotas, 0);
  const membresias = toBig(filaRef.Membresias, 0).gt(0)
    ? toBig(filaRef.Membresias, 0)
    : toBig(filaRef.MembresiasPago, 0);
  const otros = toBig(filaRef.Otros, 0);

  const cuotaInteres = capital.times(porcentajeInteres.div(100)).round(2);
  const iva12 = cuotaInteres.times(0.12).round(2);
  const deudaTotal = capital
    .plus(cuotaInteres)
    .plus(iva12)
    .plus(seguro10Cuotas)
    .plus(gps)
    .plus(membresias)
    .plus(otros)
    .round(2);

  const cuotaTotal = toBig(filaRef.Cuota, "0").gt(0)
    ? toBig(filaRef.Cuota, "0")
    : deudaTotal;

  const plazo = Math.max(
    parseInt(clean(filaRef.Plazo || filaRef.Cuotas || "12")) || 12,
    1
  );

  console.log(`💰 Capital total: ${capital.toFixed(2)}`);
  console.log(`📊 Interés: ${porcentajeInteres.toFixed(4)}%`);
  console.log(`🗓️  Plazo: ${plazo} cuotas`);
  console.log(`💳 Cuota mensual: ${cuotaTotal.toFixed(2)}`);

  // ───────────────────────────────────────────────────────
  // 2. Usuario + Asesor
  // ───────────────────────────────────────────────────────

  const nombreCliente = (filaRef.Nombre || cliente || "").split("/")[0].trim();
  const user = await findOrCreateUserByName(
    nombreCliente,
    filaRef.Categoria || null,
    filaRef.NIT || null,
    filaRef.ComoSeEntero || null
  );
  const advisor = await findOrCreateAdvisorByName(filaRef.Asesor || "", true);

  // ───────────────────────────────────────────────────────
  // 3. Upsert crédito (limpia pagos/cuotas/inversionistas si existe)
  // ───────────────────────────────────────────────────────

  const formatoCredito =
    filas.length > 1 ? "Pool" : filaRef.FormatoCredito || "Individual";

  // fecha_creacion desde Excel (Fecha column)
  const fechaCreacion = (() => {
    try {
      const d = new Date(filaRef.Fecha);
      return isNaN(d.getTime()) ? new Date() : d;
    } catch {
      return new Date();
    }
  })();

  const creditData = {
    usuario_id: user.usuario_id,
    numero_credito_sifco: creditoBase,
    fecha_creacion: fechaCreacion,
    capital: capital.toFixed(2),
    porcentaje_interes: porcentajeInteres.toFixed(4),
    cuota_interes: cuotaInteres.toFixed(2),
    cuota: cuotaTotal.toFixed(2),
    iva_12: iva12.toFixed(2),
    deudatotal: deudaTotal.toFixed(2),
    seguro_10_cuotas: seguro10Cuotas.toFixed(2),
    gps: gps.toFixed(2),
    membresias_pago: membresias.toFixed(2),
    membresias: membresias.toFixed(2),
    otros: otros.toFixed(2),
    observaciones: String(filaRef.Observaciones || ""),
    no_poliza: String(filaRef.NumeroPoliza || ""),
    como_se_entero: String(filaRef.ComoSeEntero || ""),
    asesor_id: advisor.asesor_id,
    plazo,
    porcentaje_royalti: toBig(filaRef.PorcentajeRoyalty, 0).toFixed(4),
    royalti: toBig(filaRef.Royalty, 0).toFixed(2),
    formato_credito: formatoCredito as "Pool" | "Individual",
    tipoCredito: "Nuevo",
    mora: "0",
  };

  // Limpiar datos previos si el crédito ya existe
  const [existing] = await db
    .select({ credito_id: creditos.credito_id })
    .from(creditos)
    .where(eq(creditos.numero_credito_sifco, creditoBase))
    .limit(1);

  if (existing) {
    console.log(`🔄 Crédito existente (ID ${existing.credito_id}) — limpiando...`);
    const pagosExistentes = await db
      .select({ pago_id: pagos_credito.pago_id })
      .from(pagos_credito)
      .where(eq(pagos_credito.credito_id, existing.credito_id));

    const pagoIds = pagosExistentes.map((p) => p.pago_id);
    if (pagoIds.length > 0) {
      await db.delete(boletas).where(inArray(boletas.pago_id, pagoIds));
      await db
        .delete(pagos_credito_inversionistas)
        .where(inArray(pagos_credito_inversionistas.pago_id, pagoIds));
    }
    await db
      .delete(pagos_credito)
      .where(eq(pagos_credito.credito_id, existing.credito_id));
    await db
      .delete(cuotas_credito)
      .where(eq(cuotas_credito.credito_id, existing.credito_id));
    await db
      .delete(creditos_inversionistas)
      .where(eq(creditos_inversionistas.credito_id, existing.credito_id));
    console.log(`✅ Limpieza completada`);
  }

  const [newCredit] = await db
    .insert(creditos)
    .values(creditData)
    .onConflictDoUpdate({ target: creditos.numero_credito_sifco, set: creditData })
    .returning();

  const creditoId = newCredit.credito_id;
  console.log(`✅ Crédito ID: ${creditoId}`);

  // ───────────────────────────────────────────────────────
  // 4. Inversionistas (SIN espejo)
  // ───────────────────────────────────────────────────────

  // Deduplicar por nombre normalizado — cada fila es un inversionista distinto
  const filasPorInv = new Map<string, ExcelRowFull>();
  for (const fila of filas) {
    const nombre = String(fila.Inversionista || "").trim();
    if (!nombre) continue;
    const key = normNombre(nombre);
    if (!filasPorInv.has(key)) filasPorInv.set(key, fila);
  }

  const inversionistasNoEncontrados: string[] = [];
  const inversionistasData = [];

  for (const [, fila] of filasPorInv) {
    const nombreInv = String(fila.Inversionista).trim();
    const invId = await buscarInversionistaId(nombreInv);

    if (!invId) {
      console.warn(`⚠️  Inversionista no encontrado: "${nombreInv}"`);
      inversionistasNoEncontrados.push(nombreInv);
      continue;
    }

    // Capital de esta fila = monto_aportado de este inversionista
    const montoAportado = toBig(fila.Capital, 0);

    // Porcentajes: pueden venir en 0.20 o en 20 — normalizamos a 0-100
    const pctCashInRaw = toBig(fila.PorcentajeCashIn, 0);
    const pctInvRaw = toBig(fila.PorcentajeInversionista, 0);
    const pctCashIn = pctCashInRaw.gt(1) ? pctCashInRaw : pctCashInRaw.times(100);
    const pctInv = pctInvRaw.gt(1) ? pctInvRaw : pctInvRaw.times(100);

    const interes = porcentajeInteres.div(100);
    const cuotaInteresInv = montoAportado.times(interes);
    const montoInv = cuotaInteresInv.times(pctInv).div(100).round(2);
    const montoCashIn = cuotaInteresInv.times(pctCashIn).div(100).round(2);
    const ivaInv = montoInv.gt(0) ? montoInv.times(0.12).round(2) : new Big(0);
    const ivaCashIn = montoCashIn.gt(0) ? montoCashIn.times(0.12).round(2) : new Big(0);
    const cuotaInv = toBig(fila.CuotaInversionista, cuotaTotal.toString()).gt(0)
      ? toBig(fila.CuotaInversionista, cuotaTotal.toString())
      : cuotaTotal;

    inversionistasData.push({
      credito_id: creditoId,
      inversionista_id: invId,
      monto_aportado: montoAportado.toFixed(2),
      porcentaje_cash_in: pctCashIn.toFixed(2),
      porcentaje_participacion_inversionista: pctInv.toFixed(2),
      monto_inversionista: montoInv.toFixed(2),
      monto_cash_in: montoCashIn.toFixed(2),
      iva_inversionista: ivaInv.toFixed(2),
      iva_cash_in: ivaCashIn.toFixed(2),
      fecha_creacion: new Date(),
      cuota_inversionista: cuotaInv.toFixed(2),
    });

    console.log(`✅ Inversionista: "${nombreInv}" → ID ${invId} | Capital: ${montoAportado.toFixed(2)}`);
  }

  if (inversionistasData.length > 0) {
    await db.insert(creditos_inversionistas).values(inversionistasData);
    // ⚡ NO se inserta en creditos_inversionistas_espejo (intencional)
    console.log(`✅ ${inversionistasData.length} inversionistas insertados (sin espejo)`);
  }

  // ───────────────────────────────────────────────────────
  // 5. Calcular startDate desde Fecha del Excel y hasta_cuota
  //    Ejemplo: Fecha = Feb-2026, hasta_cuota = 2
  //    → cuota 0 = Dic-2025, cuota 1 = Ene-2026, cuota 2 = Feb-2026 ✓
  // ───────────────────────────────────────────────────────

  // Usar la columna Pago (fecha de vencimiento de ESA cuota) como referencia.
  // Ejemplo: Pago = "2026-02-28", hasta_cuota = 2
  //   → startDate = Feb-2026 - 2 meses = Dic-2025
  //   → cuota 1 = Ene-2026, cuota 2 = Feb-2026 (min(30,28)=28) ✓
  const fechaRef = filaRef.Pago || filaRef.Fecha;
  const startDate =
    hasta_cuota !== undefined && hasta_cuota > 0
      ? calcularStartDate(fechaRef, hasta_cuota)
      : (() => {
          try {
            const d = new Date(fechaRef);
            return isNaN(d.getTime()) ? new Date() : d;
          } catch {
            return new Date();
          }
        })();

  console.log(`📅 Start date calculado: ${startDate.toISOString().split("T")[0]}`);

  const fechas = generatePaymentDates(plazo, startDate);

  // ───────────────────────────────────────────────────────
  // 6. Insertar cuotas (0 + 1..plazo)
  // ───────────────────────────────────────────────────────

  const [cuota0Row] = await db
    .insert(cuotas_credito)
    .values({ credito_id: creditoId, numero_cuota: 0, fecha_vencimiento: fechas[0], pagado: true })
    .returning();

  const cuotasRegulares = Array.from({ length: plazo }, (_, i) => ({
    credito_id: creditoId,
    numero_cuota: i + 1,
    fecha_vencimiento: fechas[i + 1] || fechas[fechas.length - 1],
    pagado: false,
  }));

  const cuotasInsertadas = await db
    .insert(cuotas_credito)
    .values(cuotasRegulares)
    .returning({
      cuota_id: cuotas_credito.cuota_id,
      numero_cuota: cuotas_credito.numero_cuota,
      fecha_vencimiento: cuotas_credito.fecha_vencimiento,
    });

  console.log(`✅ ${cuotasInsertadas.length + 1} cuotas insertadas`);

  // ───────────────────────────────────────────────────────
  // 7. Insertar pagos con amortización (igual que createCredit.ts)
  // ───────────────────────────────────────────────────────

  const seguroFijo = seguro10Cuotas;
  const gpsFijo = gps;
  const membresiasFijo = membresias;
  const pctInteres = porcentajeInteres.div(100);
  let capitalMemoria = capital;

  const pagos: any[] = [];

  // Pago 0 — desembolso (siempre pagado)
  pagos.push({
    credito_id: creditoId,
    cuota_id: cuota0Row.cuota_id,
    cuota: "0",
    cuota_interes: cuotaInteres.toFixed(2),
    fecha_pago: new Date(fechas[0]),
    abono_capital: "0",
    abono_interes: cuotaInteres.toFixed(2),
    abono_iva_12: iva12.toFixed(2),
    abono_interes_ci: "0",
    abono_iva_ci: "0",
    abono_seguro: "0",
    abono_gps: "0",
    pago_del_mes: "0",
    monto_boleta: "0",
    fecha_vencimiento: fechas[0],
    renuevo_o_nuevo: "",
    capital_restante: capital.toFixed(2),
    interes_restante: "0",
    iva_12_restante: "0",
    seguro_restante: seguroFijo.toFixed(2),
    gps_restante: gpsFijo.toFixed(2),
    total_restante: deudaTotal.toFixed(2),
    membresias: membresias.toFixed(2),
    membresias_pago: "0",
    membresias_mes: "0",
    otros: otros.toFixed(2),
    mora: "0",
    monto_boleta_cuota: "0",
    seguro_total: seguroFijo.toFixed(2),
    pagado: true,
    facturacion: "si",
    mes_pagado: "",
    seguro_facturado: seguroFijo.toFixed(2),
    gps_facturado: gpsFijo.toFixed(2),
    reserva: "0",
    observaciones: "pago inicial",
    paymentFalse: false,
    pagoConvenio: "0",
    registerBy: "EXCEL_MIGRATION",
    validationStatus: "validated" as const,
    fecha_boleta: fechas[0],
    monto_aplicado: "0",
  });

  // Pagos regulares — amortización mes a mes
  for (let i = 0; i < cuotasInsertadas.length; i++) {
    const cuota = cuotasInsertadas[i];

    const interesMes = capitalMemoria.times(pctInteres).round(2);
    const ivaMes = interesMes.times(0.12).round(2);
    const montosExtras = interesMes
      .plus(ivaMes)
      .plus(seguroFijo)
      .plus(gpsFijo)
      .plus(membresiasFijo);
    const abonoCapital = cuotaTotal.minus(montosExtras).round(2);

    capitalMemoria = capitalMemoria.minus(abonoCapital);
    if (capitalMemoria.lt(0)) capitalMemoria = new Big(0);

    pagos.push({
      credito_id: creditoId,
      cuota_id: cuota.cuota_id,
      cuota: cuotaTotal.toFixed(2),
      cuota_interes: cuotaInteres.toFixed(2),
      fecha_pago: null,
      abono_capital: "0",
      abono_interes: "0",
      abono_iva_12: "0",
      abono_interes_ci: "0",
      abono_iva_ci: "0",
      abono_seguro: "0",
      abono_gps: "0",
      pago_del_mes: cuotaTotal.toFixed(2),
      monto_boleta: "0",
      fecha_vencimiento: cuota.fecha_vencimiento,
      renuevo_o_nuevo: "",
      capital_restante: abonoCapital.toFixed(2),
      interes_restante: interesMes.toFixed(2),
      iva_12_restante: ivaMes.toFixed(2),
      seguro_restante: seguroFijo.toFixed(2),
      gps_restante: gpsFijo.toFixed(2),
      total_restante: capitalMemoria.toFixed(2),
      membresias: membresiasFijo.toFixed(2),
      membresias_pago: membresiasFijo.toFixed(2),
      membresias_mes: membresiasFijo.toFixed(2),
      otros: "",
      mora: "0",
      monto_boleta_cuota: "0",
      seguro_total: seguroFijo.toFixed(2),
      pagado: false,
      facturacion: "si",
      mes_pagado: "",
      seguro_facturado: seguroFijo.toFixed(2),
      gps_facturado: gpsFijo.toFixed(2),
      reserva: "0",
      observaciones: `cuota ${cuota.numero_cuota}`,
      paymentFalse: false,
      pagoConvenio: "0",
      registerBy: "EXCEL_MIGRATION",
      validationStatus: "no_required" as const,
      fecha_boleta: cuota.fecha_vencimiento,
      monto_aplicado: "0",
    });
  }

  await db.insert(pagos_credito).values(pagos);
  console.log(`✅ ${pagos.length} pagos insertados`);

  // ───────────────────────────────────────────────────────
  // 8. Marcar cuotas pagadas + recalcular
  // ───────────────────────────────────────────────────────

  let cuotasMarcadas = 0;
  if (hasta_cuota !== undefined && hasta_cuota > 0) {
    console.log(`\n📌 Marcando cuotas pagadas hasta cuota ${hasta_cuota}...`);
    await marcarCuotasPagadasHastaNumero({
      numero_credito_sifco: creditoBase,
      hasta_cuota,
    });
    cuotasMarcadas = hasta_cuota;
    console.log(`✅ Cuotas 1–${hasta_cuota} marcadas como pagadas`);
  }

  console.log(`\n🔄 Recalculando cuotas para ${creditoBase}...`);
  await updateAllInstallments({ numero_credito_sifco: creditoBase });
  console.log(`✅ Recálculo completado`);

  return {
    success: true,
    creditoBase,
    credito_id: creditoId,
    cliente,
    capital: capital.toFixed(2),
    plazo,
    cuota: cuotaTotal.toFixed(2),
    start_date: startDate.toISOString().split("T")[0],
    inversionistas_insertados: inversionistasData.length,
    inversionistas_no_encontrados: inversionistasNoEncontrados,
    cuotas_insertadas: cuotasInsertadas.length + 1,
    pagos_insertados: pagos.length,
    cuotas_marcadas_pagadas: cuotasMarcadas,
  };
}
