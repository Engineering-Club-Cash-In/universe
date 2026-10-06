import { sql } from "drizzle-orm";
import { db } from "../database";

import type { SQL } from "drizzle-orm";

// Rango de fecha de pago, inclusivo, en días de Guatemala. "" = sin límite.
export type RangoFechas = { desde: string; hasta: string };
export type NexaDashboardParams = RangoFechas & { q: string; page: number; pageSize: number };

const fechaValida = (valor: unknown) => {
  // Postgres `date` no tiene año 0000 (JavaScript sí): castearlo daría 500.
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor) || valor < "0001-01-01") return "";
  const fecha = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor ? valor : "";
};

export const parseRangoFechas = (query: Record<string, unknown>): RangoFechas => ({
  desde: fechaValida(query.desde),
  hasta: fechaValida(query.hasta),
});

export const parseNexaDashboardParams = (query: Record<string, unknown>): NexaDashboardParams => {
  const q = typeof query.q === "string" ? query.q.replace(/\u0000/g, "").trim().slice(0, 100) : "";
  const page = Math.min(10_000, Math.max(1, Math.trunc(Number(query.page) || 1)));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(query.pageSize) || 20)));
  return { q, page, pageSize, ...parseRangoFechas(query) };
};

// `columna` es un timestamp sin zona (hora de Guatemala). NULLIF evita castear "" a fecha.
const enRango = (columna: SQL, rango: RangoFechas) => sql`(${columna} >= COALESCE(NULLIF(${rango.desde}, '')::date, '-infinity'::date)
     AND ${columna} < COALESCE(NULLIF(${rango.hasta}, '')::date + 1, 'infinity'::date))`;
const conRango = (rango: RangoFechas) => rango.desde !== "" || rango.hasta !== "";
// Fecha de un evento Nexa: la del pago que generó (MIN de sus filas enlazadas); si no generó
// pago, cuándo llegó. La usan la tabla (rechazos) y el modal (eventos sin pago) para filtrar igual.
const eventoEnRango = (fechaPagos: SQL, createdAt: SQL, rango: RangoFechas) =>
  enRango(sql`COALESCE(${fechaPagos}, ${createdAt} AT TIME ZONE 'America/Guatemala')`, rango);

// Filas de pago vivas (no anuladas, con monto, sin fechas futuras),
// cada una con la boleta a la que pertenece. Una boleta Nexa es un evento. Una manual son
// las filas del mismo crédito, monto, quien registró y autorización grabadas con 60 s o menos
// entre una y la siguiente: cobros graba las filas de una boleta con segundos de diferencia.
// La usan la tabla y el modal, para que agrupen igual.
// Límite de futuro = "ahora en UTC": fecha_pago NO tiene una zona única. Los pagos manuales
// (~95%) la guardan en hora de pared de Guatemala, los de system/SIFCO/Nexa son fechas sin hora
// y ~4% (INSERT que omite la columna, default now()) guardan la hora UTC del servidor. "Ahora
// en UTC" es la cota máxima de una fila legítima (no oculta hasta 6 h de esas últimas) y sigue
// ocultando las filas SIFCO con años de adelanto.
const filasConBoleta = (filtroCredito: SQL, rango: RangoFechas) => sql`pagos_vivos AS (
  SELECT p.pago_id, p.credito_id, p.cuota_id, p.fecha_pago, p.monto_boleta, p.nexa_payment_event_id,
         p.registerby, p.numeroautorizacion, p.validation_status,
         COALESCE(p.registerby, '') AS por, COALESCE(NULLIF(p.numeroautorizacion, ''), '') AS aut
  FROM cartera.pagos_credito p
  WHERE ${filtroCredito}
    AND p.fecha_pago IS NOT NULL AND p.fecha_pago <= (now() AT TIME ZONE 'UTC')
    AND p.monto_boleta > 0 AND p."paymentFalse" IS NOT TRUE
    AND ${enRango(sql.raw("p.fecha_pago"), rango)}
), con_corte AS (
  SELECT pagos_vivos.*,
         CASE WHEN fecha_pago - LAG(fecha_pago) OVER islas <= interval '60 seconds' THEN 0 ELSE 1 END AS nueva
  FROM pagos_vivos
  WINDOW islas AS (PARTITION BY credito_id, monto_boleta, por, aut, (nexa_payment_event_id IS NULL) ORDER BY fecha_pago, pago_id)
), filas_boleta AS (
  SELECT con_corte.*,
         CASE WHEN nexa_payment_event_id IS NOT NULL THEN 'n' || nexa_payment_event_id
              -- json_build_array escapa cada campo: un '|' en registerby o en la autorización no
              -- puede hacer que dos tuplas distintas den la misma clave.
              ELSE 'm' || md5(json_build_array(monto_boleta, por, aut, SUM(nueva) OVER (
                PARTITION BY credito_id, monto_boleta, por, aut, (nexa_payment_event_id IS NULL) ORDER BY fecha_pago, pago_id))::text)
         END AS boleta
  FROM con_corte
)`;

export type NexaDashboardRow = {
  creditoId: number;
  numeroCreditoSifco: string;
  cliente: string;
  estado: string;
  nexaToken: string | null;
  bindingActivo: boolean;
  ultimoPagoFecha: string | null;
  ultimoPagoMonto: string | null;
  ultimoPagoNexa: boolean;
  pagosNexa: number;
  montoNexa: string;
  rechazosNexa: number;
  // Canal de los últimos 12 pagos, del más viejo al más nuevo: "N" Nexa, "M" manual.
  ultimosCanales: string;
};

export type NexaDashboardResponse = {
  totales: {
    creditos: number;
    conToken: number;
    pagosNexa: number;
    montoNexa: string;
    rechazosNexa: number;
    ultimoPagoNexa: number;
  };
  creditos: NexaDashboardRow[];
  total: number;
  page: number;
  pageSize: number;
};

export const mapNexaDashboardRows = (rows: Record<string, unknown>[], params: NexaDashboardParams): NexaDashboardResponse => {
  // Los totales vienen repetidos en todas las filas. Sin filas, cero.
  const firstRow = rows[0] ?? {};
  const totales = {
    creditos: Number(firstRow.total_creditos ?? 0),
    conToken: Number(firstRow.total_con_token ?? 0),
    pagosNexa: Number(firstRow.total_pagos_nexa ?? 0),
    montoNexa: String(firstRow.total_monto_nexa ?? "0"),
    rechazosNexa: Number(firstRow.total_rechazos_nexa ?? 0),
    ultimoPagoNexa: Number(firstRow.total_ultimo_pago_nexa ?? 0),
  };

  // Página vacía: la única fila trae los totales y credito_id NULL; no es un crédito.
  const creditos: NexaDashboardRow[] = rows.filter((row) => row.credito_id != null).map((row) => ({
    creditoId: Number(row.credito_id),
    numeroCreditoSifco: String(row.numero_credito_sifco ?? ""),
    cliente: String(row.cliente ?? ""),
    estado: String(row.estado ?? ""),
    nexaToken: row.nexa_token == null ? null : String(row.nexa_token),
    bindingActivo: Boolean(row.activo),
    ultimoPagoFecha: row.ultimo_pago_fecha == null ? null : String(row.ultimo_pago_fecha),
    ultimoPagoMonto: row.ultimo_pago_monto == null ? null : String(row.ultimo_pago_monto),
    ultimoPagoNexa: Boolean(row.ultimo_pago_nexa),
    pagosNexa: Number(row.pagos_nexa ?? 0),
    montoNexa: String(row.monto_nexa ?? "0"),
    rechazosNexa: Number(row.rechazos_nexa ?? 0),
    ultimosCanales: String(row.ultimos_canales ?? ""),
  }));

  return {
    totales,
    creditos,
    total: totales.creditos,
    page: params.page,
    pageSize: params.pageSize,
  };
};

export const getNexaDashboard = async (params: NexaDashboardParams): Promise<NexaDashboardResponse> => {
  const result = await db.execute(sql`
WITH base AS (
  SELECT b.credito_id, b.nexa_token, b.activo, c.numero_credito_sifco,
         c."statusCredit" AS estado, u.nombre AS cliente
  FROM cartera.nexa_credit_bindings b
  JOIN cartera.creditos c ON c.credito_id = b.credito_id
  LEFT JOIN cartera.usuarios u ON u.usuario_id = c.usuario_id
  WHERE ${params.q} = ''
     OR c.numero_credito_sifco ILIKE '%' || ${params.q} || '%'
     OR u.nombre ILIKE '%' || ${params.q} || '%'
), ${filasConBoleta(sql`p.credito_id IN (SELECT credito_id FROM base)`, params)}, boletas AS (
  SELECT credito_id, boleta, BOOL_OR(nexa_payment_event_id IS NOT NULL) AS es_nexa,
         MIN(fecha_pago) AS fecha, MAX(monto_boleta) AS monto, MIN(pago_id) AS primer_pago
  FROM filas_boleta
  GROUP BY credito_id, boleta
), ultimo AS (
  SELECT DISTINCT ON (credito_id) credito_id, fecha AS fecha_pago, monto AS monto_boleta, es_nexa
  FROM boletas
  ORDER BY credito_id, fecha DESC, primer_pago DESC
), nexa AS (
  SELECT e.credito_id,
         COUNT(*) FILTER (WHERE e.pago_id IS NOT NULL AND pe.vigente) AS pagos_nexa,
         COALESCE(SUM(e.amount) FILTER (WHERE e.pago_id IS NOT NULL AND pe.vigente), 0) AS monto_nexa,
         -- failed es rechazo siempre: el pago no se aplicó aunque hayan quedado filas pending colgando.
         -- manual_review con filas vigentes es incierto (pudo aplicarse): no cuenta como rechazo.
         COUNT(*) FILTER (WHERE e.pago_id IS NULL AND (e.status = 'failed'
           OR (e.status = 'manual_review' AND pe.vigente IS NOT TRUE))) AS rechazos_nexa
  FROM cartera.nexa_payment_events e
  JOIN base ON base.credito_id = e.credito_id
  -- Fecha del evento: la del pago que generó; si no generó pago, cuándo llegó.
  LEFT JOIN LATERAL (
    -- vigente: el pago no fue revertido (la reversa anula, pone en cero o borra las filas).
    SELECT MIN(pc.fecha_pago) AS fecha, BOOL_OR(pc."paymentFalse" IS NOT TRUE AND pc.monto_boleta > 0) AS vigente
    FROM cartera.pagos_credito pc WHERE pc.nexa_payment_event_id = e.id
  ) pe ON true
  WHERE ${eventoEnRango(sql.raw("pe.fecha"), sql.raw("e.created_at"), params)}
  GROUP BY e.credito_id
), canales AS (
  SELECT credito_id, string_agg(CASE WHEN es_nexa THEN 'N' ELSE 'M' END, '' ORDER BY fecha, primer_pago) AS ultimos_canales
  FROM (SELECT boletas.*, row_number() OVER (PARTITION BY credito_id ORDER BY fecha DESC, primer_pago DESC) AS n FROM boletas) recientes
  WHERE n <= 12
  GROUP BY credito_id
), filas AS (
  SELECT base.credito_id, base.nexa_token, base.activo, base.numero_credito_sifco, base.estado, base.cliente,
         -- Como texto: fecha_pago no tiene zona horaria y el driver la correría.
         to_char(ultimo.fecha_pago, 'YYYY-MM-DD"T"HH24:MI:SS') AS ultimo_pago_fecha, ultimo.monto_boleta AS ultimo_pago_monto,
         COALESCE(ultimo.es_nexa, false) AS ultimo_pago_nexa,
         COALESCE(nexa.pagos_nexa, 0) AS pagos_nexa,
         COALESCE(nexa.monto_nexa, 0) AS monto_nexa,
         COALESCE(nexa.rechazos_nexa, 0) AS rechazos_nexa,
         COALESCE(canales.ultimos_canales, '') AS ultimos_canales
  FROM base
  LEFT JOIN ultimo ON ultimo.credito_id = base.credito_id
  LEFT JOIN nexa ON nexa.credito_id = base.credito_id
  LEFT JOIN canales ON canales.credito_id = base.credito_id
  -- Con rango de fechas, solo los créditos con algún pago o algún rechazo Nexa en el período.
  WHERE ${!conRango(params)} OR ultimo.credito_id IS NOT NULL OR COALESCE(nexa.rechazos_nexa, 0) > 0
), totales AS (
  -- Aparte de la página: si la página pedida queda más allá del final, los totales siguen.
  SELECT COUNT(*) AS total_creditos,
         COUNT(*) FILTER (WHERE filas.nexa_token IS NOT NULL) AS total_con_token,
         COALESCE(SUM(filas.pagos_nexa), 0) AS total_pagos_nexa,
         COALESCE(SUM(filas.monto_nexa), 0) AS total_monto_nexa,
         COALESCE(SUM(filas.rechazos_nexa), 0) AS total_rechazos_nexa,
         COUNT(*) FILTER (WHERE filas.ultimo_pago_nexa) AS total_ultimo_pago_nexa
  FROM filas
)
-- Siempre al menos una fila (la de totales); sin página, sus columnas de crédito vienen NULL.
SELECT pagina.*, totales.*
FROM totales
LEFT JOIN (
  SELECT filas.* FROM filas
  ORDER BY filas.ultimo_pago_fecha DESC NULLS LAST, filas.credito_id
  LIMIT ${params.pageSize} OFFSET ${(params.page - 1) * params.pageSize}
) pagina ON true
ORDER BY pagina.ultimo_pago_fecha DESC NULLS LAST, pagina.credito_id
  `);

  return mapNexaDashboardRows(result.rows, params);
};

export type NexaCreditPayment = {
  fechaPago: string | null;
  montoBoleta: string;
  canal: "NEXA" | "MANUAL";
  registradoPor: string | null;
  autorizacion: string | null;
  validado: boolean;
  filas: number;
  eventoEstado: string | null;
  cuotas: number[];
};

export type NexaCreditRejectedEvent = {
  referencia: string;
  monto: string;
  estado: string;
  error: string | null;
  creado: string | null;
  /** failed con filas de pago vivas: Nexa devolvió el dinero, esas filas se anulan, no se validan. */
  tieneFilasVivas: boolean;
};

export type NexaCreditPaymentsResponse = {
  creditoId: number;
  pagos: NexaCreditPayment[];
  eventosSinPago: NexaCreditRejectedEvent[];
};

export const mapNexaCreditPayments = (
  creditoId: number,
  pagos: Record<string, unknown>[],
  eventos: Record<string, unknown>[],
): NexaCreditPaymentsResponse => ({
  creditoId,
  pagos: pagos.map((row) => ({
    fechaPago: row.fecha_pago == null ? null : String(row.fecha_pago),
    montoBoleta: String(row.monto_boleta ?? "0"),
    canal: row.es_nexa ? "NEXA" : "MANUAL",
    registradoPor: row.registrado_por == null ? null : String(row.registrado_por),
    autorizacion: row.autorizacion == null ? null : String(row.autorizacion),
    validado: Boolean(row.validado),
    filas: Number(row.filas ?? 0),
    eventoEstado: row.evento_estado == null ? null : String(row.evento_estado),
    cuotas: Array.isArray(row.cuotas) ? row.cuotas.map(Number) : [],
  })),
  eventosSinPago: eventos.map((row) => ({
    referencia: String(row.referencia ?? ""),
    monto: String(row.monto ?? "0"),
    estado: String(row.estado ?? ""),
    error: row.error == null ? null : String(row.error),
    creado: row.creado == null ? null : String(row.creado),
    tieneFilasVivas: Boolean(row.tiene_filas_vivas),
  })),
});

export const getNexaCreditPayments = async (
  creditoId: number,
  rango: RangoFechas = { desde: "", hasta: "" },
): Promise<NexaCreditPaymentsResponse> => {
  const pagos = await db.execute(sql`
WITH ${filasConBoleta(sql`p.credito_id = ${creditoId}`, rango)}
SELECT to_char(MIN(f.fecha_pago), 'YYYY-MM-DD"T"HH24:MI:SS') AS fecha_pago,
       MAX(f.monto_boleta) AS monto_boleta,
       BOOL_OR(f.nexa_payment_event_id IS NOT NULL) AS es_nexa,
       MAX(f.registerby) AS registrado_por,
       MAX(f.numeroautorizacion) AS autorizacion,
       BOOL_AND(f.validation_status IN ('validated', 'capital_validated', 'no_required')) AS validado,
       COUNT(*) AS filas,
       MAX(e.status) AS evento_estado,
       COALESCE(ARRAY_AGG(DISTINCT cc.numero_cuota ORDER BY cc.numero_cuota) FILTER (WHERE cc.numero_cuota IS NOT NULL), '{}') AS cuotas
FROM filas_boleta f
LEFT JOIN cartera.nexa_payment_events e ON e.id = f.nexa_payment_event_id
LEFT JOIN cartera.cuotas_credito cc ON cc.cuota_id = f.cuota_id
GROUP BY f.boleta
ORDER BY MIN(f.fecha_pago) DESC, MIN(f.pago_id) DESC
LIMIT 50`);
  const eventos = await db.execute(sql`
SELECT external_reference AS referencia, amount AS monto, status AS estado, error,
       to_char(created_at AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD"T"HH24:MI:SS') AS creado,
       vivas.existe AS tiene_filas_vivas
FROM cartera.nexa_payment_events
CROSS JOIN LATERAL (SELECT EXISTS (
  SELECT 1 FROM cartera.pagos_credito pc
  WHERE pc.nexa_payment_event_id = nexa_payment_events.id AND pc."paymentFalse" IS NOT TRUE AND pc.monto_boleta > 0
) AS existe, (
  SELECT MIN(pc.fecha_pago) FROM cartera.pagos_credito pc WHERE pc.nexa_payment_event_id = nexa_payment_events.id
) AS fecha) vivas
WHERE credito_id = ${creditoId} AND pago_id IS NULL
  -- failed siempre (sus filas vivas, si quedaron, hay que anularlas). manual_review con filas vivas
  -- es incierto: el pago pudo aplicarse y mostrarlo invita a registrarlo dos veces.
  AND (status = 'failed' OR (status = 'manual_review' AND NOT vivas.existe))
  -- Misma fecha que la tabla: un failed con filas pending en el rango aparece aunque haya llegado después.
  AND ${eventoEnRango(sql.raw("vivas.fecha"), sql.raw("nexa_payment_events.created_at"), rango)}
ORDER BY id DESC
LIMIT 20`);
  return mapNexaCreditPayments(creditoId, pagos.rows, eventos.rows);
};
