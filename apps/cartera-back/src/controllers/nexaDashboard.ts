import { sql } from "drizzle-orm";
import { db } from "../database";

export type NexaDashboardParams = { q: string; page: number; pageSize: number };

export const parseNexaDashboardParams = (query: Record<string, unknown>): NexaDashboardParams => {
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  const page = Math.max(1, Math.trunc(Number(query.page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(query.pageSize) || 20)));
  return { q, page, pageSize };
};

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
  // Los totales son columnas de ventana: iguales en todas las filas. Sin filas, cero.
  const firstRow = rows[0] ?? {};
  const totales = {
    creditos: Number(firstRow.total_creditos ?? 0),
    conToken: Number(firstRow.total_con_token ?? 0),
    pagosNexa: Number(firstRow.total_pagos_nexa ?? 0),
    montoNexa: String(firstRow.total_monto_nexa ?? "0"),
    rechazosNexa: Number(firstRow.total_rechazos_nexa ?? 0),
    ultimoPagoNexa: Number(firstRow.total_ultimo_pago_nexa ?? 0),
  };

  const creditos: NexaDashboardRow[] = rows.map((row) => ({
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
), ultimo AS (
  SELECT DISTINCT ON (p.credito_id) p.credito_id, p.fecha_pago, p.monto_boleta,
         (p.nexa_payment_event_id IS NOT NULL) AS es_nexa
  FROM cartera.pagos_credito p
  JOIN base ON base.credito_id = p.credito_id
  -- Sin fechas futuras: hay filas de SIFCO_IMPORT con fecha_pago adelantada.
  WHERE p.fecha_pago IS NOT NULL AND p.fecha_pago <= now() AND p.monto_boleta > 0 AND p."paymentFalse" IS NOT TRUE
  ORDER BY p.credito_id, p.fecha_pago DESC, p.pago_id DESC
), nexa AS (
  SELECT e.credito_id,
         COUNT(*) FILTER (WHERE e.pago_id IS NOT NULL) AS pagos_nexa,
         COALESCE(SUM(e.amount) FILTER (WHERE e.pago_id IS NOT NULL), 0) AS monto_nexa,
         COUNT(*) FILTER (WHERE e.pago_id IS NULL AND e.status IN ('failed', 'manual_review')) AS rechazos_nexa
  FROM cartera.nexa_payment_events e
  JOIN base ON base.credito_id = e.credito_id
  GROUP BY e.credito_id
), filas AS (
  SELECT base.credito_id, base.nexa_token, base.activo, base.numero_credito_sifco, base.estado, base.cliente,
         -- Como texto: fecha_pago no tiene zona horaria y el driver la correría.
         to_char(ultimo.fecha_pago, 'YYYY-MM-DD"T"HH24:MI:SS') AS ultimo_pago_fecha, ultimo.monto_boleta AS ultimo_pago_monto,
         COALESCE(ultimo.es_nexa, false) AS ultimo_pago_nexa,
         COALESCE(nexa.pagos_nexa, 0) AS pagos_nexa,
         COALESCE(nexa.monto_nexa, 0) AS monto_nexa,
         COALESCE(nexa.rechazos_nexa, 0) AS rechazos_nexa
  FROM base
  LEFT JOIN ultimo ON ultimo.credito_id = base.credito_id
  LEFT JOIN nexa ON nexa.credito_id = base.credito_id
)
SELECT filas.*,
       COUNT(*) OVER () AS total_creditos,
       COUNT(*) FILTER (WHERE filas.nexa_token IS NOT NULL) OVER () AS total_con_token,
       SUM(filas.pagos_nexa) OVER () AS total_pagos_nexa,
       SUM(filas.monto_nexa) OVER () AS total_monto_nexa,
       SUM(filas.rechazos_nexa) OVER () AS total_rechazos_nexa,
       COUNT(*) FILTER (WHERE filas.ultimo_pago_nexa) OVER () AS total_ultimo_pago_nexa
FROM filas
ORDER BY filas.ultimo_pago_fecha DESC NULLS LAST, filas.credito_id
LIMIT ${params.pageSize} OFFSET ${(params.page - 1) * params.pageSize}
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
};

export type NexaCreditRejectedEvent = {
  referencia: string;
  monto: string;
  estado: string;
  error: string | null;
  creado: string | null;
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
  })),
  eventosSinPago: eventos.map((row) => ({
    referencia: String(row.referencia ?? ""),
    monto: String(row.monto ?? "0"),
    estado: String(row.estado ?? ""),
    error: row.error == null ? null : String(row.error),
    creado: row.creado == null ? null : String(row.creado),
  })),
});

export const getNexaCreditPayments = async (creditoId: number): Promise<NexaCreditPaymentsResponse> => {
  const pagos = await db.execute(sql`
SELECT to_char(MIN(p.fecha_pago), 'YYYY-MM-DD"T"HH24:MI:SS') AS fecha_pago,
       MAX(p.monto_boleta) AS monto_boleta,
       (p.nexa_payment_event_id IS NOT NULL) AS es_nexa,
       MAX(p.registerby) AS registrado_por,
       MAX(p.numeroautorizacion) AS autorizacion,
       BOOL_AND(p.validation_status IN ('validated', 'capital_validated', 'no_required')) AS validado,
       COUNT(*) AS filas,
       MAX(e.status) AS evento_estado
FROM cartera.pagos_credito p
LEFT JOIN cartera.nexa_payment_events e ON e.id = p.nexa_payment_event_id
WHERE p.credito_id = ${creditoId}
  AND p.fecha_pago IS NOT NULL AND p.monto_boleta > 0 AND p."paymentFalse" IS NOT TRUE
-- Las filas de una boleta manual se graban con segundos de diferencia: se agrupan por minuto.
GROUP BY COALESCE('n' || p.nexa_payment_event_id::text, 'm' || date_trunc('minute', p.fecha_pago)::text || '|' || p.monto_boleta::text),
         (p.nexa_payment_event_id IS NOT NULL)
ORDER BY MIN(p.fecha_pago) DESC
LIMIT 50`);
  const eventos = await db.execute(sql`
SELECT external_reference AS referencia, amount AS monto, status AS estado, error,
       to_char(created_at AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD"T"HH24:MI:SS') AS creado
FROM cartera.nexa_payment_events
WHERE credito_id = ${creditoId} AND pago_id IS NULL
ORDER BY id DESC
LIMIT 20`);
  return mapNexaCreditPayments(creditoId, pagos.rows, eventos.rows);
};
