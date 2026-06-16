import Big from "big.js";
import ExcelJS from "exceljs";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../database";
import { facturacion_snapshot_diario } from "../database/db/schema";
import { fetchImageBase64 } from "../utils/functions/internReportCancelations";

const LOGO_URL =
  process.env.LOGO_URL ||
  "https://pub-8081c8d6e5e743f9adfc9e0db92e5a88.r2.dev/reports/logo-cashin.png";

// ── Edición manual: whitelist de columnas editables + validación ──────────────
// Editables SOLO los grupos ROYALTY y OTROS INGRESOS, COMPLETOS (detalle por
// producto + total + administrativos + otros_cobros). Capital, Interés,
// Membresía, Mora, servicios/inversionistas/carros, metas y los acumulados/
// tendencias quedan read-only. `facturacion` se DERIVA (interes+membresia+
// otros_ingresos+mora+royalty, usando los totales editados) y los acumulados se
// auto-calculan (suma corrida). El front además solo deja editar HOY.
export const COLUMNAS_EDITABLES: ReadonlySet<string> = new Set([
  // Royalty (completo)
  "roy_autocompras","roy_sobre_vehiculo","nuevo_roy_autocompras","roy_hipotecario","roy_extra_financiamiento","roy_reestructura","royalty",
  // Otros ingresos (completo, incl. administrativos y otros_cobros)
  "oi_autocompras","oi_sobre_vehiculo","nuevo_oi_autocompras","oi_hipotecario","oi_extra_financiamiento","oi_reestructura","otros_ingresos","administrativos","otros_cobros",
]);

export function esColumnaEditable(col: string): boolean {
  return COLUMNAS_EDITABLES.has(col);
}

export function validarValores(valores: Record<string, unknown>): {
  ok: boolean;
  invalidas: string[];
} {
  const invalidas: string[] = [];
  for (const [col, val] of Object.entries(valores)) {
    if (!esColumnaEditable(col)) {
      invalidas.push(col);
      continue;
    }
    // Solo decimal plano (opcional signo): "123", "-12.50", "0". Rechaza "", null,
    // notación científica ("1e3"), hex ("0x10"), comas ("1,000") y basura — que
    // Number() aceptaría pero romperían el cast a numeric en el INSERT/UPDATE.
    const s = String(val ?? "").trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) {
      invalidas.push(col);
    }
  }
  return { ok: invalidas.length === 0, invalidas };
}

export type DiaAcumulable = {
  fecha: string;
  bloqueado: boolean;
  facturacion: string | number;
  servicios_seguro_gps: string | number;
  facturacion_inversionistas: string | number;
  ingreso_carros: string | number;
};

export type UpdateAcumulado = {
  fecha: string;
  facturacion_acumulado: string;
  acum_servicios_seguro_gps: string;
  acumulado_inversionistas: string;
  acumulado_total: string;
};

// Suma corrida sobre días YA ordenados por fecha. Emite el acumulado para CADA
// día (incluidos los bloqueados): los ACUMULADOS SIEMPRE SUMAN, no se congelan.
// El lock protege los valores DIARIOS (los salta generarSnapshotDiario), pero el
// acumulado de un día = suma corrida de las diarias hasta ese día. Así no hay
// discontinuidad cuando se edita+bloquea un día. No toca reserva_acumulada
// (es MTD desde pagos, sin columna diaria).
export function calcularAcumuladosCorridos(
  dias: DiaAcumulable[]
): UpdateAcumulado[] {
  let accFact = new Big(0);
  let accServ = new Big(0);
  let accInv = new Big(0);
  let accCarros = new Big(0);
  const updates: UpdateAcumulado[] = [];
  for (const d of dias) {
    accFact = accFact.plus(new Big(d.facturacion || 0));
    accServ = accServ.plus(new Big(d.servicios_seguro_gps || 0));
    accInv = accInv.plus(new Big(d.facturacion_inversionistas || 0));
    accCarros = accCarros.plus(new Big(d.ingreso_carros || 0));
    updates.push({
      fecha: d.fecha,
      facturacion_acumulado: accFact.toFixed(2),
      acum_servicios_seguro_gps: accServ.toFixed(2),
      acumulado_inversionistas: accInv.toFixed(2),
      acumulado_total: accFact.plus(accServ).plus(accCarros).toFixed(2),
    });
  }
  return updates;
}

// Re-deriva los totales DEL DÍA desde los rubros editados a mano:
//   facturacion = interes_cube + membresia + otros_ingresos + mora_cube + royalty
//   facturacion_mas_servicios = facturacion + servicios_seguro_gps
// (capital_total NO entra en facturacion.) Se usa tras editar rubros para que el
// total del día y los acumulados cuadren con lo que el usuario tipeó.
export async function recomputarTotalesDia(fecha: string, exec: any = db) {
  await exec.execute(sql`
    UPDATE cartera.facturacion_snapshot_diario SET
      facturacion = interes_cube + membresia + otros_ingresos + mora_cube + royalty,
      facturacion_mas_servicios =
        interes_cube + membresia + otros_ingresos + mora_cube + royalty + servicios_seguro_gps,
      -- NO se recalcula otros_cobros: ahora es columna EDITABLE (grupo Otros
      -- ingresos), el usuario la maneja a mano. Si la quiere = otros_ingresos −
      -- administrativos, la edita él (todo libre en ese grupo).
      updated_at = now()
    WHERE fecha = ${fecha}::date
  `);
}

// Refresca las columnas de acumulado de TODOS los días del mes (incluidos los
// bloqueados: sus acumulados también suman, ver calcularAcumuladosCorridos),
// como suma corrida de las diarias guardadas. No lee la fuente ni toca diarias
// → seguro para días históricos importados del Excel.
export async function recomputarAcumuladosMes(
  anio: number,
  mes: number,
  exec: any = db
) {
  // Filtramos por RANGO de fecha (no por anio/mes) porque esas columnas helper
  // pueden venir NULL en filas importadas → quedarían fuera del SUM y romperían
  // la continuidad del acumulado.
  const inicioMes = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const res = await exec.execute(sql`
    SELECT fecha::text AS fecha, bloqueado,
           facturacion, servicios_seguro_gps, facturacion_inversionistas, ingreso_carros
    FROM cartera.facturacion_snapshot_diario
    WHERE fecha >= ${inicioMes}::date
      AND fecha < (${inicioMes}::date + INTERVAL '1 month')
    ORDER BY fecha
  `);
  const dias = ((res as any).rows ?? res) as DiaAcumulable[];
  const updates = calcularAcumuladosCorridos(dias);
  for (const u of updates) {
    await exec.execute(sql`
      UPDATE cartera.facturacion_snapshot_diario SET
        facturacion_acumulado = ${u.facturacion_acumulado},
        acum_servicios_seguro_gps = ${u.acum_servicios_seguro_gps},
        acumulado_inversionistas = ${u.acumulado_inversionistas},
        acumulado_total = ${u.acumulado_total},
        -- Proyecciones y % meta derivan del acumulado → refrescar o quedan stale.
        tendencia_fin_mes = CASE WHEN EXTRACT(DAY FROM fecha) > 0
          THEN ${u.facturacion_acumulado}::numeric / EXTRACT(DAY FROM fecha)
               * EXTRACT(DAY FROM (date_trunc('month', fecha) + INTERVAL '1 month - 1 day'))
          ELSE 0 END,
        tendencia_semanal = CASE WHEN EXTRACT(DAY FROM fecha) > 0
          THEN ${u.facturacion_acumulado}::numeric / EXTRACT(DAY FROM fecha) * 5
          ELSE 0 END,
        porcentaje_meta_mensual = CASE WHEN meta_facturacion_mensual > 0
          THEN ROUND(${u.facturacion_acumulado}::numeric / meta_facturacion_mensual * 100, 4)
          ELSE 0 END,
        updated_at = now()
      WHERE fecha = ${u.fecha}::date
    `);
  }
  return { success: true, dias_actualizados: updates.length };
}

// ============================================================================
// 📸 SNAPSHOT DIARIO DE FACTURACIÓN (tipo Excel "Reuniones diarias")
//    Calcula y CONGELA una fila por día con las columnas A→BK.
//    Fuentes: facturacion_desglose (CUBE + genéricas: otros, royalty facturado,
//    inversionistas), gastos_administrativos, ingresos_carros,
//    pagos_credito.reserva, metas_facturacion. Upsert por fecha (regenerable).
// ============================================================================

// Prefijo de columna por rubro (lo que factura CUBE).
const RUBRO_PREFIX: Record<string, string> = {
  CAPITAL: "cap",
  INTERES: "int",
  MEMBRESIA: "mem",
  OTROS: "oi",
  MORA: "mora",
  ROYALTY: "roy",
};

// categoría BD -> producto Excel (sufijo). "__NUEVO__" usa el patrón nuevo_<prefijo>_autocompras.
// Claves NORMALIZADas (trim + lowercase) porque la data trae variantes de mayúsculas
// (p. ej. "CV Vehículo nuevo" y "CV Vehículo Nuevo").
// ⚠️ Pendiente de confirmar: Extra financiamiento (¿Fiduciario/Contraseña?) y Reestructura.
const CAT_PROD: Record<string, string> = {
  "cv vehículo": "autocompras",
  "cv vehículo nuevo": "__NUEVO__",
  "vehículo": "sobre_vehiculo",
  "hipotecario": "hipotecario",
};

const PRODS = [
  "autocompras",
  "sobre_vehiculo",
  "hipotecario",
  "extra_financiamiento",
  "reestructura",
];

function colProducto(prefix: string, categoria: string): string | null {
  const p = CAT_PROD[(categoria ?? "").trim().toLowerCase()];
  if (!p) return null; // categoría sin mapear: no va a columna de producto (igual cuenta en el total)
  if (p === "__NUEVO__") return `nuevo_${prefix}_autocompras`;
  return `${prefix}_${p}`;
}

export async function generarSnapshotDiario(fecha: string) {
  // Si el día está bloqueado (editado a mano), NO se sobreescribe.
  const lockRes = await db.execute(sql`
    SELECT bloqueado FROM cartera.facturacion_snapshot_diario
    WHERE fecha = ${fecha}::date
  `);
  const lockRow = ((lockRes as any).rows ?? lockRes)[0];
  if (lockRow?.bloqueado === true) {
    return { success: true, skipped: true, reason: "bloqueado", fecha };
  }

  // "YYYY-MM-DD"
  const [y, m, d] = fecha.split("-").map(Number);
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dayOfMonth = d;

  // Acumulador de columnas (Big.js)
  const C: Record<string, Big> = {};
  const add = (col: string | null, v: any) => {
    if (!col) return;
    C[col] = (C[col] ?? new Big(0)).plus(v || 0);
  };
  const g = (col: string) => C[col] ?? new Big(0);

  // 1) Desglose del día: por categoría × rubro. LEFT JOIN para incluir también las
  //    GENÉRICAS (pago_id NULL): para esas la categoría sale de la columna guardada
  //    `fd.categoria` (resuelta por NIT al facturar); las de pago la derivan por JOIN.
  const desg = await db.execute(sql`
    SELECT COALESCE(u.categoria, fd.categoria) AS categoria, fd.rubro AS rubro, SUM(fd.monto_total) AS total
    FROM cartera.facturacion_desglose fd
    LEFT JOIN cartera.pagos_credito p ON p.pago_id   = fd.pago_id
    LEFT JOIN cartera.creditos      c ON c.credito_id = p.credito_id
    LEFT JOIN cartera.usuarios      u ON u.usuario_id = c.usuario_id
    WHERE fd.fecha_aplicado_gt = ${fecha}::date
      -- una fila de PAGO huérfana (credito/usuario borrado) no debe sumar al
      -- total; las GENÉRICAS (pago_id NULL) sí entran.
      AND (fd.pago_id IS NULL OR p.pago_id IS NOT NULL)
    GROUP BY COALESCE(u.categoria, fd.categoria), fd.rubro
  `);
  for (const r of (desg as any).rows ?? []) {
    const cat = r.categoria as string;
    const rubro = r.rubro as string;
    const total = r.total;
    if (rubro === "SEGURO" || rubro === "GPS") {
      add("servicios_seguro_gps", total);
      continue;
    }
    const prefix = RUBRO_PREFIX[rubro];
    if (!prefix) continue;
    // total por rubro (columna *_cube / total)
    const totalCol =
      rubro === "CAPITAL"
        ? "capital_total"
        : rubro === "INTERES"
        ? "interes_cube"
        : rubro === "MEMBRESIA"
        ? "membresia"
        : rubro === "OTROS"
        ? "otros_ingresos"
        : rubro === "ROYALTY"
        ? "royalty"
        : "mora_cube"; // MORA
    add(totalCol, total);
    add(colProducto(prefix, cat), total);
  }

  // 2) Royalty del día = SOLO lo REALMENTE facturado (rubro ROYALTY del desglose,
  //    ya sumado en el bloque 1). Decisión de diseño: NO se usa creditos.royalti de
  //    respaldo — lo facturado es la fuente correcta (creditos.royalti difería de
  //    contabilidad) y el respaldo causaba doble conteo. Crédito sin royalty
  //    facturado genérico → no suma royalty (0).

  // 3) Gastos administrativos del día
  const adm = await db.execute(sql`
    SELECT COALESCE(SUM(monto), 0) AS total
    FROM cartera.gastos_administrativos WHERE fecha = ${fecha}::date
  `);
  const administrativos = new Big((adm as any).rows?.[0]?.total || 0);

  // 3.1) Ingresos por carros del día
  const carr = await db.execute(sql`
    SELECT COALESCE(SUM(monto), 0) AS total
    FROM cartera.ingresos_carros WHERE fecha = ${fecha}::date
  `);
  const ingresoCarros = new Big((carr as any).rows?.[0]?.total || 0);

  // 4) Facturación a inversionistas del día = rubro INTERES_INVERSIONISTAS del
  //    desglose (el residuo del interés que NO factura CUBE, ya con IVA, que
  //    cofidi guarda por pago). Se lee del desglose —no de pci— para tener una
  //    sola fuente y la misma fecha (COALESCE fecha_aplicado/fecha_pago).
  const inv = await db.execute(sql`
    SELECT COALESCE(SUM(monto_total), 0) AS total
    FROM cartera.facturacion_desglose
    WHERE rubro::text = 'INTERES_INVERSIONISTAS'
      AND fecha_aplicado_gt = ${fecha}::date
  `);
  const factInv = new Big((inv as any).rows?.[0]?.total || 0);

  // 5) Totales derivados del día
  const interes_cube = g("interes_cube");
  const membresia = g("membresia");
  const otros_ingresos = g("otros_ingresos");
  const mora_cube = g("mora_cube");
  const royalty = g("royalty");
  const servicios = g("servicios_seguro_gps");
  const otros_cobros = otros_ingresos.minus(administrativos);
  const facturacion = royalty
    .plus(mora_cube)
    .plus(otros_ingresos)
    .plus(membresia)
    .plus(interes_cube);
  const facturacion_mas_servicios = facturacion.plus(servicios);

  // 6) Acumulados del MES = SUMA CORRIDA de las columnas DIARIAS del snapshot
  //    [1º del mes … este día]: días PREVIOS ya guardados + lo de HOY (recién
  //    calculado). Así el acumulado SUMA TODO EL MES y enlaza CONTINUO aunque
  //    parte del mes venga del Excel importado y parte del sistema. Las diarias
  //    de los días viejos quedan intactas → no se recalculan desde el desglose.
  //    reserva NO (sin columna diaria; pagos_credito tiene histórico → MTD de pagos).
  const prev = await db.execute(sql`
    SELECT
      COALESCE(SUM(facturacion), 0)                AS fact,
      COALESCE(SUM(servicios_seguro_gps), 0)       AS serv,
      COALESCE(SUM(facturacion_inversionistas), 0) AS inv,
      COALESCE(SUM(ingreso_carros), 0)             AS carros
    FROM cartera.facturacion_snapshot_diario
    WHERE fecha >= ${monthStart}::date AND fecha < ${fecha}::date
  `);
  const P = (prev as any).rows?.[0] ?? {};
  const facturacion_acumulado = new Big(P.fact || 0).plus(facturacion);
  const acum_servicios = new Big(P.serv || 0).plus(servicios);
  const acumulado_inversionistas = new Big(P.inv || 0).plus(factInv);
  const ingresoCarrosMtd = new Big(P.carros || 0).plus(ingresoCarros);
  // AY (Excel): facturación + servicios + ingreso carros (acumulado del mes).
  const acumulado_total = facturacion_acumulado
    .plus(acum_servicios)
    .plus(ingresoCarrosMtd);
  // Reserva acumulada (MTD) desde pagos_credito.reserva (pagos tiene histórico → sin corte).
  const reservaMtd = await db.execute(sql`
    SELECT COALESCE(SUM(reserva), 0) AS total FROM cartera.pagos_credito
    WHERE (fecha_aplicado AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date BETWEEN ${monthStart}::date AND ${fecha}::date
  `);
  const reserva_acumulada = new Big((reservaMtd as any).rows[0].total);

  // 7) Tendencias (proyección lineal sobre MTD)
  const tendencia_fin_mes =
    dayOfMonth > 0
      ? facturacion_acumulado.div(dayOfMonth).times(daysInMonth)
      : new Big(0);
  const tendencia_semanal =
    dayOfMonth > 0 ? facturacion_acumulado.div(dayOfMonth).times(5) : new Big(0);

  // 8) Metas del mes
  const meta = await db.execute(sql`
    SELECT * FROM cartera.metas_facturacion WHERE anio = ${y} AND mes = ${m} LIMIT 1
  `);
  const M = (meta as any).rows?.[0] || {};
  const meta_mensual = new Big(M.meta_mensual || 0);
  const meta_semanal = new Big(M.meta_semanal || 0);
  const meta_diaria = new Big(M.meta_diaria || 0);
  const porcentaje_meta_mensual = meta_mensual.gt(0)
    ? facturacion_acumulado.div(meta_mensual).times(100)
    : new Big(0);

  // 9) Semana del año
  const wk = await db.execute(sql`SELECT EXTRACT(WEEK FROM ${fecha}::date)::int AS w`);
  const semana = (wk as any).rows[0].w;

  // ───────────────── armar la fila completa ─────────────────
  const f2 = (b: Big) => b.round(2).toString();
  const f4 = (b: Big) => b.round(4).toString();

  const row: Record<string, any> = {
    fecha,
    anio: y,
    mes: m,
    semana,
    capital_total: f2(g("capital_total")),
    interes_cube: f2(interes_cube),
    membresia: f2(membresia),
    otros_ingresos: f2(otros_ingresos),
    administrativos: f2(administrativos),
    otros_cobros: f2(otros_cobros),
    mora_cube: f2(mora_cube),
    royalty: f2(royalty),
    facturacion: f2(facturacion),
    facturacion_acumulado: f2(facturacion_acumulado),
    servicios_seguro_gps: f2(servicios),
    acum_servicios_seguro_gps: f2(acum_servicios),
    facturacion_mas_servicios: f2(facturacion_mas_servicios),
    acumulado_total: f2(acumulado_total),
    facturacion_inversionistas: f2(factInv),
    acumulado_inversionistas: f2(acumulado_inversionistas),
    tendencia_fin_mes: f2(tendencia_fin_mes),
    tendencia_semanal: f2(tendencia_semanal),
    ingreso_carros: f2(ingresoCarros),
    reserva_acumulada: f2(reserva_acumulada),
    meta_facturacion_mensual: f2(meta_mensual),
    meta_facturacion_semanal: f2(meta_semanal),
    meta_facturacion_diaria: f2(meta_diaria),
    porcentaje_meta_mensual: f4(porcentaje_meta_mensual),
    meta_diaria: f2(meta_diaria),
    updated_at: new Date(),
  };

  // Columnas por producto (incluye las pendientes en 0)
  for (const prefix of [...Object.values(RUBRO_PREFIX), "roy"]) {
    for (const pr of PRODS) row[`${prefix}_${pr}`] = f2(g(`${prefix}_${pr}`));
    row[`nuevo_${prefix}_autocompras`] = f2(g(`nuevo_${prefix}_autocompras`));
  }

  // Upsert por fecha
  const setObj: Record<string, any> = { ...row };
  delete setObj.fecha;

  const [saved] = await db
    .insert(facturacion_snapshot_diario)
    .values(row as any)
    .onConflictDoUpdate({
      target: facturacion_snapshot_diario.fecha,
      set: setObj,
    })
    .returning();

  return { success: true, data: saved };
}

// ✅ Aplica SOLO carros + administrativos al snapshot de un día (sin recalcular
//    los montos importados). Si el día no tiene fila, la genera primero.
//    - administrativos = SUM(gastos del día); otros_cobros = otros_ingresos − administrativos
//    - ingreso_carros = SUM(carros del día); acumulado_total = fact_acum + acum_servicios + carros MTD
//    SÍ respeta el lock: administrativos y otros_cobros son EDITABLES (grupo Otros
//    ingresos), así que en un día bloqueado NO debe pisarlos → salta días bloqueados.
export async function aplicarManualesEnSnapshotDia(fecha: string) {
  const existe = await db
    .select({ id: facturacion_snapshot_diario.id })
    .from(facturacion_snapshot_diario)
    .where(eq(facturacion_snapshot_diario.fecha, fecha))
    .limit(1);
  if (!existe.length) await generarSnapshotDiario(fecha); // día nuevo: sin montos que perder

  await db.execute(sql`
    UPDATE cartera.facturacion_snapshot_diario s
    SET administrativos = COALESCE((
          SELECT SUM(monto) FROM cartera.gastos_administrativos g WHERE g.fecha = ${fecha}::date), 0),
        otros_cobros = s.otros_ingresos - COALESCE((
          SELECT SUM(monto) FROM cartera.gastos_administrativos g WHERE g.fecha = ${fecha}::date), 0),
        ingreso_carros = COALESCE((
          SELECT SUM(monto) FROM cartera.ingresos_carros c WHERE c.fecha = ${fecha}::date), 0),
        -- carros acumulado consistente con la suma corrida: días PREVIOS del mes
        -- desde la columna del snapshot (incluye lo importado del Excel) + lo de HOY
        -- desde la tabla de ingresos_carros.
        acumulado_total = s.facturacion_acumulado + s.acum_servicios_seguro_gps
          + COALESCE((SELECT SUM(d.ingreso_carros) FROM cartera.facturacion_snapshot_diario d
                      WHERE d.fecha >= make_date(EXTRACT(YEAR FROM ${fecha}::date)::int, EXTRACT(MONTH FROM ${fecha}::date)::int, 1)
                        AND d.fecha < ${fecha}::date), 0)
          + COALESCE((SELECT SUM(monto) FROM cartera.ingresos_carros c WHERE c.fecha = ${fecha}::date), 0),
        updated_at = now()
    WHERE s.fecha = ${fecha}::date
      AND s.bloqueado = false
  `);
  return { success: true };
}

// ✅ Aplica SOLO las columnas de meta a los snapshots del mes (sin recalcular
//    los montos importados). Recalcula el % meta con el acumulado existente.
//    NO lleva guard de bloqueado: las columnas de meta no son editables a mano →
//    deben refrescar también en días bloqueados (el lock vive en generarSnapshotDiario).
export async function aplicarMetaEnSnapshotsMes(anio: number, mes: number) {
  const res = await db.execute(sql`
    UPDATE cartera.facturacion_snapshot_diario s
    SET meta_facturacion_mensual = m.meta_mensual,
        meta_facturacion_semanal = m.meta_semanal,
        meta_facturacion_diaria  = m.meta_diaria,
        meta_diaria              = m.meta_diaria,
        porcentaje_meta_mensual  = CASE
          WHEN m.meta_mensual > 0
          THEN ROUND(s.facturacion_acumulado / m.meta_mensual * 100, 4)
          ELSE 0 END,
        updated_at = now()
    FROM cartera.metas_facturacion m
    WHERE m.anio = ${anio} AND m.mes = ${mes}
      AND s.fecha >= make_date(${anio}, ${mes}, 1)
      AND s.fecha < (make_date(${anio}, ${mes}, 1) + INTERVAL '1 month')
  `);
  return { success: true, actualizados: (res as any).rowCount ?? 0 };
}

// Genera el snapshot del día SOLO si todavía no existe (job de respaldo).
export async function asegurarSnapshotDiario(fecha: string) {
  const existe = await db
    .select({ id: facturacion_snapshot_diario.id })
    .from(facturacion_snapshot_diario)
    .where(eq(facturacion_snapshot_diario.fecha, fecha))
    .limit(1);
  if (existe.length) return { success: true, created: false, fecha };
  await generarSnapshotDiario(fecha);
  return { success: true, created: true, fecha };
}

// Regenera (force, upsert) el snapshot de CADA día en [fechaInicio, fechaFin].
// A diferencia de asegurarSnapshotDiario, SIEMPRE recalcula aunque la fila ya
// exista — útil para refrescar días pre-creados (p. ej. del import del Excel)
// o capturar facturación que entró con fecha atrasada.
export async function regenerarSnapshotRango(
  fechaInicio: string,
  fechaFin: string
) {
  const dias: string[] = [];
  const d = new Date(`${fechaInicio}T00:00:00Z`);
  const fin = new Date(`${fechaFin}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(fin.getTime()) || d > fin) {
    return { success: false, message: "Rango de fechas inválido" };
  }
  while (d <= fin) {
    dias.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
    if (dias.length > 400) break; // tope defensivo
  }
  for (const f of dias) await generarSnapshotDiario(f);
  return {
    success: true,
    regenerados: dias.length,
    desde: dias[0],
    hasta: dias[dias.length - 1],
  };
}

// ============================================================================
// 📥 EXPORTAR A EXCEL (diseño tipo Reuniones diarias, con logo y totales)
// ============================================================================
const prodCols = (p: string) => [
  { k: `${p}_autocompras`, l: "Autocompras" },
  { k: `${p}_sobre_vehiculo`, l: "Sobre vehículo" },
  { k: `nuevo_${p}_autocompras`, l: "Nuevo Autocompras" },
  { k: `${p}_hipotecario`, l: "Hipotecario" },
  { k: `${p}_extra_financiamiento`, l: "Extra financ." },
  { k: `${p}_reestructura`, l: "Reestructura" },
];

const EXCEL_GRUPOS: { label: string; color: string; cols: { k: string; l: string }[] }[] = [
  { label: "Capital", color: "FF1E40AF", cols: [...prodCols("cap"), { k: "capital_total", l: "Capital total" }] },
  { label: "Interés", color: "FF1D4ED8", cols: [...prodCols("int"), { k: "interes_cube", l: "Interés Cube" }] },
  { label: "Membresía", color: "FF2563EB", cols: [...prodCols("mem"), { k: "membresia", l: "Membresía" }] },
  {
    label: "Otros ingresos",
    color: "FF1E40AF",
    cols: [...prodCols("oi"), { k: "otros_ingresos", l: "Otros ingresos" }, { k: "administrativos", l: "Administrativos" }, { k: "otros_cobros", l: "Otros cobros" }],
  },
  { label: "Mora", color: "FF1D4ED8", cols: [...prodCols("mora"), { k: "mora_cube", l: "Mora Cube" }] },
  { label: "Royalty", color: "FF2563EB", cols: [...prodCols("roy"), { k: "royalty", l: "Royalty" }] },
  {
    label: "Totales / Acumulados",
    color: "FF0F766E",
    cols: [
      { k: "facturacion", l: "Facturación" },
      { k: "facturacion_acumulado", l: "Fact. acumulada" },
      { k: "servicios_seguro_gps", l: "Servicios (Seg+GPS)" },
      { k: "acum_servicios_seguro_gps", l: "Acum. servicios" },
      { k: "facturacion_mas_servicios", l: "Fact. + Servicios" },
      { k: "acumulado_total", l: "Acumulado total" },
      { k: "facturacion_inversionistas", l: "Fact. Inversionistas" },
      { k: "acumulado_inversionistas", l: "Acum. inversionistas" },
      { k: "tendencia_fin_mes", l: "Tendencia fin mes" },
      { k: "tendencia_semanal", l: "Tendencia semanal" },
      { k: "ingreso_carros", l: "Ingreso Carros" },
      { k: "reserva_acumulada", l: "Reserva acumulada" },
    ],
  },
  {
    label: "Metas",
    color: "FF7C3AED",
    cols: [
      { k: "meta_facturacion_mensual", l: "Meta mensual" },
      { k: "meta_facturacion_semanal", l: "Meta semanal" },
      { k: "meta_facturacion_diaria", l: "Meta diaria" },
      { k: "porcentaje_meta_mensual", l: "% Meta" },
      { k: "meta_diaria", l: "Meta diaria (BK)" },
    ],
  },
];

export async function generarExcelFacturacionDiaria(
  fechaInicio?: string,
  fechaFin?: string
): Promise<Buffer> {
  const { data, totales } = await getSnapshotsDiarios({ fechaInicio, fechaFin });
  const filas: any[] = [...data].sort((a, b) => a.fecha.localeCompare(b.fecha));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Facturación Diaria", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 6 }],
  });

  const flat = [{ k: "fecha", l: "Fecha" }, ...EXCEL_GRUPOS.flatMap((g) => g.cols)];
  const nCols = flat.length;

  // Logo (A1:B3)
  const logo = await fetchImageBase64(LOGO_URL);
  if (logo) {
    const imgId = wb.addImage({ base64: logo.data, extension: logo.ext });
    ws.addImage(imgId, "A1:B3");
  }
  for (let r = 1; r <= 3; r++) ws.getRow(r).height = 20;

  // Título
  ws.mergeCells(1, 3, 1, nCols);
  const t = ws.getCell(1, 3);
  t.value = "Facturación Diaria";
  t.font = { bold: true, size: 18, color: { argb: "FF1E3A8A" } };
  ws.mergeCells(2, 3, 2, nCols);
  const st = ws.getCell(2, 3);
  st.value = `Del ${fechaInicio ?? "—"} al ${fechaFin ?? "—"}`;
  st.font = { italic: true, size: 11, color: { argb: "FF64748B" } };

  const HEADER_GROUP_ROW = 5;
  const HEADER_COL_ROW = 6;
  const border = {
    top: { style: "thin" as const, color: { argb: "FFCBD5E1" } },
    left: { style: "thin" as const, color: { argb: "FFCBD5E1" } },
    bottom: { style: "thin" as const, color: { argb: "FFCBD5E1" } },
    right: { style: "thin" as const, color: { argb: "FFCBD5E1" } },
  };

  // Encabezado "Fecha" (vertical merge)
  ws.mergeCells(HEADER_GROUP_ROW, 1, HEADER_COL_ROW, 1);
  const fh = ws.getCell(HEADER_GROUP_ROW, 1);
  fh.value = "Fecha";
  fh.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
  fh.font = { bold: true, color: { argb: "FFFFFFFF" } };
  fh.alignment = { vertical: "middle", horizontal: "center" };
  fh.border = border;

  // Grupos + columnas
  let col = 2;
  for (const g of EXCEL_GRUPOS) {
    const start = col;
    for (const c of g.cols) {
      const cell = ws.getCell(HEADER_COL_ROW, col);
      cell.value = c.l;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };
      cell.font = { bold: true, size: 9, color: { argb: "FF1E3A8A" } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = border;
      ws.getColumn(col).width = 15;
      col++;
    }
    ws.mergeCells(HEADER_GROUP_ROW, start, HEADER_GROUP_ROW, col - 1);
    const gc = ws.getCell(HEADER_GROUP_ROW, start);
    gc.value = g.label;
    gc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: g.color } };
    gc.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    gc.alignment = { vertical: "middle", horizontal: "center" };
    gc.border = border;
  }
  ws.getColumn(1).width = 13;

  // Datos
  let r = HEADER_COL_ROW + 1;
  for (const row of filas) {
    ws.getCell(r, 1).value = row.fecha;
    ws.getCell(r, 1).font = { bold: true, color: { argb: "FF1E3A8A" } };
    ws.getCell(r, 1).border = border;
    let cc = 2;
    for (const g of EXCEL_GRUPOS) {
      for (const c of g.cols) {
        const cell = ws.getCell(r, cc);
        cell.value = Number(row[c.k] ?? 0);
        cell.numFmt = c.k === "porcentaje_meta_mensual" ? '#,##0.00"%"' : "#,##0.00";
        cell.alignment = { horizontal: "right" };
        cell.border = border;
        if (c.k.endsWith("_total") || c.k === "interes_cube" || c.k === "mora_cube" || c.k === "facturacion" || c.k === "royalty" || c.k === "membresia") {
          cell.font = { bold: true, color: { argb: "FF1E3A8A" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
        }
        cc++;
      }
    }
    if ((r - HEADER_COL_ROW) % 2 === 0) {
      // zebra suave en la col fecha ya va; dejamos números limpios
    }
    r++;
  }

  // Totales
  const tcell = ws.getCell(r, 1);
  tcell.value = "TOTALES";
  tcell.font = { bold: true, color: { argb: "FFFFFFFF" } };
  tcell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
  tcell.alignment = { horizontal: "center" };
  tcell.border = border;
  let tc = 2;
  for (const g of EXCEL_GRUPOS) {
    for (const c of g.cols) {
      const cell = ws.getCell(r, tc);
      if (c.k in totales) {
        cell.value = totales[c.k];
        cell.numFmt = "#,##0.00";
      }
      cell.font = { bold: true, color: { argb: "FF1E3A8A" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFBFDBFE" } };
      cell.alignment = { horizontal: "right" };
      cell.border = border;
      tc++;
    }
  }

  ws.getRow(HEADER_GROUP_ROW).height = 22;
  ws.getRow(HEADER_COL_ROW).height = 30;

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function getSnapshotsDiarios(opts: {
  fechaInicio?: string;
  fechaFin?: string;
}) {
  const where = [];
  if (opts.fechaInicio)
    where.push(gte(facturacion_snapshot_diario.fecha, opts.fechaInicio));
  if (opts.fechaFin)
    where.push(lte(facturacion_snapshot_diario.fecha, opts.fechaFin));

  const rows = await db
    .select()
    .from(facturacion_snapshot_diario)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(facturacion_snapshot_diario.fecha));

  // 🧮 Totales por columna (solo columnas ADITIVAS: montos diarios).
  //    Se excluyen acumulados, tendencias, metas y % (no tiene sentido sumarlos).
  const NO_SUMAR = new Set([
    "id",
    "fecha",
    "anio",
    "mes",
    "semana",
    "bloqueado",
    "bloqueado_por",
    "bloqueado_at",
    "facturacion_acumulado",
    "acum_servicios_seguro_gps",
    "acumulado_total",
    "acumulado_inversionistas",
    "tendencia_fin_mes",
    "tendencia_semanal",
    "reserva_acumulada",
    "meta_facturacion_mensual",
    "meta_facturacion_semanal",
    "meta_facturacion_diaria",
    "porcentaje_meta_mensual",
    "meta_diaria",
    "created_at",
    "updated_at",
  ]);
  const totales: Record<string, number> = {};
  for (const r of rows as any[]) {
    for (const [k, v] of Object.entries(r)) {
      if (NO_SUMAR.has(k)) continue;
      const n = Number(v ?? 0);
      if (!Number.isFinite(n)) continue;
      totales[k] = (totales[k] ?? 0) + n;
    }
  }
  for (const k of Object.keys(totales)) {
    totales[k] = Math.round(totales[k] * 100) / 100;
  }

  return { success: true, data: rows, totales };
}

// ============================================================================
// ✏️ EDICIÓN MANUAL DE CELDAS (lock por fila + auditoría). Solo ADMIN (gate en router).
// ============================================================================

type CambioDia = { fecha: string; valores: Record<string, unknown> };

// Guarda (upsert) las celdas tocadas por día, bloquea el día, audita cada cambio
// y refresca los acumulados de los meses afectados. Solo columnas del whitelist.
export async function guardarCeldasSnapshot(input: {
  cambios: CambioDia[];
  usuarioId: number | null;
}) {
  const { cambios, usuarioId } = input;
  if (!Array.isArray(cambios) || cambios.length === 0) {
    return { success: false, message: "Sin cambios" };
  }
  // Validar todo antes de escribir.
  for (const c of cambios) {
    const v = validarValores(c.valores);
    if (!v.ok) {
      return {
        success: false,
        message: `Columnas inválidas en ${c.fecha}`,
        invalidas: v.invalidas,
      };
    }
  }

  // Si un día NO tiene fila aún, generarlo COMPLETO primero (columnas source:
  // detalle por producto, servicios, inversionistas, metas, reserva, semana) y
  // LUEGO editar+bloquear. Si no, quedaría una fila sparse en 0 y el cron no la
  // llenaría (la salta por bloqueado). Mismo patrón que aplicarManualesEnSnapshotDia.
  for (const c of cambios) {
    const ex = await db.execute(sql`
      SELECT 1 FROM cartera.facturacion_snapshot_diario WHERE fecha = ${c.fecha}::date LIMIT 1
    `);
    if ((((ex as any).rows ?? ex) as any[]).length === 0) {
      await generarSnapshotDiario(c.fecha);
    }
  }

  const mesesAfectados = new Set<string>();
  const diasAfectados = new Set<string>();

  await db.transaction(async (tx) => {
    for (const c of cambios) {
      const [y, m] = c.fecha.split("-");
      const anio = Number(y);
      const mes = Number(m);
      mesesAfectados.add(`${anio}-${mes}`);
      diasAfectados.add(c.fecha);

      // Fila actual (para valores viejos + saber si ya estaba bloqueado).
      const prevRes = await tx.execute(sql`
        SELECT * FROM cartera.facturacion_snapshot_diario WHERE fecha = ${c.fecha}::date
      `);
      const prev = ((prevRes as any).rows ?? prevRes)[0] ?? null;

      const cols = Object.keys(c.valores);
      // Valor canónico (trim) — validarValores ya garantizó que es decimal plano.
      const valOf = (col: string) => String(c.valores[col] ?? "").trim();
      // SET dinámico de las columnas tocadas. sql.raw para el nombre de columna
      // (YA validado contra el whitelist) y bind del valor.
      const sets = cols.map((col) => sql`${sql.raw(col)} = ${valOf(col)}`);

      if (prev) {
        await tx.execute(sql`
          UPDATE cartera.facturacion_snapshot_diario
          SET ${sql.join(sets, sql`, `)},
              bloqueado = true, bloqueado_por = ${usuarioId}, bloqueado_at = now(), updated_at = now()
          WHERE fecha = ${c.fecha}::date
        `);
      } else {
        const insertCols = [
          "fecha",
          "anio",
          "mes",
          ...cols,
          "bloqueado",
          "bloqueado_por",
          "bloqueado_at",
        ];
        const insertVals = [
          sql`${c.fecha}::date`,
          sql`${anio}`,
          sql`${mes}`,
          ...cols.map((col) => sql`${valOf(col)}`),
          sql`true`,
          sql`${usuarioId}`,
          sql`now()`,
        ];
        await tx.execute(sql`
          INSERT INTO cartera.facturacion_snapshot_diario (${sql.join(
            insertCols.map((x) => sql.raw(x)),
            sql`, `
          )})
          VALUES (${sql.join(insertVals, sql`, `)})
        `);
      }

      // Auditoría por celda.
      for (const col of cols) {
        const anterior = prev ? prev[col] ?? null : null;
        await tx.execute(sql`
          INSERT INTO cartera.facturacion_snapshot_auditoria (fecha, columna, valor_anterior, valor_nuevo, accion, usuario_id)
          VALUES (${c.fecha}::date, ${col}, ${
          anterior === null ? null : String(anterior)
        }, ${valOf(col)}, 'edit', ${usuarioId})
        `);
      }
      // Auditoría de lock si no estaba bloqueado.
      if (!prev || prev.bloqueado !== true) {
        await tx.execute(sql`
          INSERT INTO cartera.facturacion_snapshot_auditoria (fecha, columna, valor_anterior, valor_nuevo, accion, usuario_id)
          VALUES (${c.fecha}::date, '*', NULL, NULL, 'lock', ${usuarioId})
        `);
      }

      // Recomputes DENTRO de la transacción (con tx) para que la edición, la
      // re-derivación del total y los acumulados sean atómicos: si algo falla,
      // rollback completo (nada de día bloqueado con totales/acumulados stale).
    }

    // 1) Re-derivar el total del día (facturacion + fact_mas_servicios) desde
    //    los rubros editados, en cada día tocado.
    for (const f of diasAfectados) await recomputarTotalesDia(f, tx);

    // 2) Refrescar acumulados de cada mes afectado (suma corrida).
    for (const k of mesesAfectados) {
      const [anio, mes] = k.split("-").map(Number);
      await recomputarAcumuladosMes(anio, mes, tx);
    }
  });

  return { success: true, dias: cambios.length, meses: mesesAfectados.size };
}

export async function desbloquearDiaSnapshot(
  fecha: string,
  usuarioId: number | null
) {
  const [y, m] = fecha.split("-");
  const anio = Number(y);
  const mes = Number(m);
  await db.execute(sql`
    UPDATE cartera.facturacion_snapshot_diario
    SET bloqueado = false, bloqueado_por = ${usuarioId}, bloqueado_at = now(), updated_at = now()
    WHERE fecha = ${fecha}::date
  `);
  await db.execute(sql`
    INSERT INTO cartera.facturacion_snapshot_auditoria (fecha, columna, valor_anterior, valor_nuevo, accion, usuario_id)
    VALUES (${fecha}::date, '*', NULL, NULL, 'unlock', ${usuarioId})
  `);
  // Vuelve a valores del sistema y refresca acumulados.
  await generarSnapshotDiario(fecha);
  await recomputarAcumuladosMes(anio, mes);
  return { success: true, fecha };
}

// Historial de cambios manuales (tabla de auditoría), más reciente primero.
// Une al usuario del sistema (platform_users) para mostrar el email de quién editó.
export async function listarAuditoriaSnapshot(opts: {
  fechaInicio?: string;
  fechaFin?: string;
  limit?: number;
}) {
  const n = Number(opts.limit);
  const lim = Number.isFinite(n) ? Math.min(Math.max(n, 1), 1000) : 200;
  const conds: any[] = [];
  if (opts.fechaInicio) conds.push(sql`a.fecha >= ${opts.fechaInicio}::date`);
  if (opts.fechaFin) conds.push(sql`a.fecha <= ${opts.fechaFin}::date`);
  const whereSql = conds.length
    ? sql`WHERE ${sql.join(conds, sql` AND `)}`
    : sql``;
  const res = await db.execute(sql`
    SELECT a.id, a.fecha::text AS fecha, a.columna, a.valor_anterior, a.valor_nuevo,
           a.accion, a.usuario_id, u.email AS usuario_email, a.created_at
    FROM cartera.facturacion_snapshot_auditoria a
    LEFT JOIN cartera.platform_users u ON u.id = a.usuario_id
    ${whereSql}
    ORDER BY a.created_at DESC
    LIMIT ${lim}
  `);
  return { success: true, data: (res as any).rows ?? res };
}
