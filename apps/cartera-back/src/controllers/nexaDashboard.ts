import { sql } from "drizzle-orm";
import { db } from "../database";
import { filaQueCubreCuotaSql, hasPaidPaymentSql } from "../utils/cuotaYaPagadaSql";

import type { SQL } from "drizzle-orm";

// Rango de fecha de pago, inclusivo, en días de Guatemala. "" = sin límite.
export type RangoFechas = { desde: string; hasta: string };
// cuotaMes: pagados = cuota del mes pagada (criterio del cron); parciales = no pagada con plata aplicada;
// sinpago = no pagada y sin plata aplicada; pendientes = no pagada (parcial o sin pago, compatibilidad).
// medio: con qué se pagó la cuota del mes (pagada o parcial); con sinpago se ignora.
export type NexaDashboardParams = RangoFechas & {
  q: string; page: number; pageSize: number;
  cuotaMes: "" | FiltroCuotaMes; medio: "" | "nexa" | "manual";
};

const MEDIOS = ["nexa", "manual"] as const;
export type FiltroCuotaMes = "pagados" | "parciales" | "sinpago" | "pendientes";
const CUOTA_MES = ["pagados", "parciales", "sinpago", "pendientes"] as const;
// pagada: criterio del cron. vencida: venció antes de hoy (GT) y no está pagada. por_vencer: vence hoy o después.
export type EstadoCuotaMes = "pagada" | "vencida" | "por_vencer";
// completa: pagada (criterio del cron). parcial: no pagada pero con plata aplicada. sin_pago: ninguna de las dos.
export type PagoCuota = "completa" | "parcial" | "sin_pago";
// Solo valores de la lista: lo demás es "sin filtro".
const deLista = <T extends string>(lista: readonly T[], valor: unknown): T | "" =>
  lista.includes(valor as T) ? (valor as T) : "";

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
  const cuotaMes = deLista(CUOTA_MES, query.cuotaMes);
  return {
    q, page, pageSize, ...parseRangoFechas(query),
    // Sin pago no tiene medio: ahí se ignora.
    cuotaMes, medio: cuotaMes === "sinpago" ? "" : deLista(MEDIOS, query.medio),
  };
};

// Qué créditos puede ver la sesión, por `creditos.asesor_id`. todos: ADMIN/CONTA sin filtro.
// asesor: solo los de ese asesor. ninguno: un ASESOR sin asesor vinculado (cierra en falso).
export type AlcanceNexa = { tipo: "todos" } | { tipo: "asesor"; asesorId: number } | { tipo: "ninguno" };

const INT4_MAX = 2_147_483_647;
const esIdAsesor = (valor: unknown): valor is number =>
  typeof valor === "number" && Number.isInteger(valor) && valor > 0 && valor <= INT4_MAX;

/** `?asesor=` del ADMIN/CONTA: entero positivo en rango de int4, sin ceros a la izquierda. Lo demás, null (sin filtro). */
export const parseAsesorFiltro = (valor: unknown): number | null => {
  if (typeof valor !== "string" || !/^[1-9]\d{0,9}$/.test(valor)) return null;
  const id = Number(valor);
  return esIdAsesor(id) ? id : null;
};

/** Fila VIGENTE de platform_users de la sesión (findSessionUser); null si no existe. */
export type SesionNexa = { role: string | null; is_active: boolean | null; asesor_id: number | null } | null;

/**
 * Alcance de la sesión. Un ASESOR (por el token o por su fila vigente) ve siempre y solo su
 * `platform_users.asesor_id` de la base: el `?asesor=` y el claim del token se ignoran. Sin fila,
 * inactivo o sin vínculo: ninguno. Los demás roles (el router ya filtró ADMIN/CONTA) ven todo,
 * o el asesor que piden.
 */
export const resolverAlcanceNexa = (rolToken: unknown, sesion: SesionNexa, asesorPedido: number | null): AlcanceNexa => {
  if (rolToken === "ASESOR" || sesion?.role === "ASESOR") {
    const propio = sesion?.is_active === true ? sesion.asesor_id : null;
    return esIdAsesor(propio) ? { tipo: "asesor", asesorId: propio } : { tipo: "ninguno" };
  }
  return esIdAsesor(asesorPedido) ? { tipo: "asesor", asesorId: asesorPedido } : { tipo: "todos" };
};

// Condición SQL del alcance sobre `columna` (creditos.asesor_id). Sin alcance válido lanza:
// un llamador que lo olvide no ve todo por defecto.
const condicionAlcance = (alcance: AlcanceNexa, columna: SQL): SQL => {
  switch (alcance?.tipo) {
    case "todos": return sql`true`;
    case "ninguno": return sql`false`;
    case "asesor":
      if (!esIdAsesor(alcance.asesorId)) break;
      return sql`${columna} = ${alcance.asesorId}::int`;
  }
  throw new Error("Alcance del dashboard Nexa no válido");
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
         p.registerby, p.numeroautorizacion, p.validation_status, p.banco_id,
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
  /** Banco de la boleta manual (`pagos_credito.banco_id` → `bancos.nombre`). Nexa: null, cartera no recibe el banco de origen. */
  ultimoPagoBanco: string | null;
  pagosNexa: number;
  montoNexa: string;
  rechazosNexa: number;
  /** Los 5 rechazos o revisiones manuales más recientes de los que cuenta `rechazosNexa`. */
  rechazosDetalle: NexaRechazo[];
  /** Últimas 12 cuotas hasta fin del mes en curso, de la más vieja a la más nueva. */
  ultimasCuotas: NexaCuotaFranja[];
  cuotaMes: NexaCuotaMes | null;
};

// aplicado: monto_aplicado de las filas no anuladas y no 'reset' de la cuota. monto: creditos.cuota
// (cuotas_credito no guarda el monto de cada cuota). medio: el mismo de la franja.
export type NexaCuotaMes = {
  numero: number; vencimiento: string; estado: EstadoCuotaMes; pago: PagoCuota;
  aplicado: string; monto: string; medio: "NEXA" | "MANUAL" | null;
  /** Alguna fila que le aplica plata a la cuota sigue en validation_status 'pending' (ver medio_cuota). */
  porValidar: boolean;
};

export type NexaRechazo = { fecha: string | null; monto: string; codigo: string | null; estado: string };
// medio: quién puso más plata en la cuota (empate: el pago más reciente). null = sin pagos.
export type NexaCuotaFranja = {
  numero: number; vencimiento: string; pagada: boolean; medio: "NEXA" | "MANUAL" | null; banco: string | null;
  aplicado: string; monto: string; porValidar: boolean;
};

// La cuota del mes sobre los créditos del alcance, con búsqueda, asesor y fechas, pero sin el filtro
// de cuota ni de medio. pagadaNexa + pagadaManual + parcialNexa + parcialManual + sinPago = conCuotaMes.
export type NexaDesglose = {
  creditos: number; conCuotaMes: number;
  pagadaNexa: number; pagadaManual: number; parcialNexa: number; parcialManual: number; sinPago: number;
  vencidaSinPago: number; porValidar: number;
  conToken: number; pagosNexa: number; montoNexa: string; rechazosNexa: number;
};

export type NexaDashboardResponse = {
  totales: {
    creditos: number;
    conToken: number;
    pagosNexa: number;
    montoNexa: string;
    rechazosNexa: number;
    ultimoPagoNexa: number;
    /** Cabecera: sin el filtro de cuota ni de medio (ver la CTE desglose). */
    desglose: NexaDesglose;
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
    desglose: {
      creditos: Number(firstRow.d_creditos ?? 0),
      conCuotaMes: Number(firstRow.d_con_cuota_mes ?? 0),
      pagadaNexa: Number(firstRow.d_pagada_nexa ?? 0),
      pagadaManual: Number(firstRow.d_pagada_manual ?? 0),
      parcialNexa: Number(firstRow.d_parcial_nexa ?? 0),
      parcialManual: Number(firstRow.d_parcial_manual ?? 0),
      sinPago: Number(firstRow.d_sin_pago ?? 0),
      vencidaSinPago: Number(firstRow.d_vencida_sin_pago ?? 0),
      porValidar: Number(firstRow.d_por_validar ?? 0),
      conToken: Number(firstRow.d_con_token ?? 0),
      pagosNexa: Number(firstRow.d_pagos_nexa ?? 0),
      montoNexa: String(firstRow.d_monto_nexa ?? "0"),
      rechazosNexa: Number(firstRow.d_rechazos_nexa ?? 0),
    },
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
    ultimoPagoBanco: row.ultimo_pago_banco == null ? null : String(row.ultimo_pago_banco),
    pagosNexa: Number(row.pagos_nexa ?? 0),
    montoNexa: String(row.monto_nexa ?? "0"),
    rechazosNexa: Number(row.rechazos_nexa ?? 0),
    rechazosDetalle: Array.isArray(row.rechazos_detalle) ? (row.rechazos_detalle as NexaRechazo[]) : [],
    ultimasCuotas: Array.isArray(row.ultimas_cuotas) ? (row.ultimas_cuotas as NexaCuotaFranja[]) : [],
    cuotaMes: row.cuota_mes_numero == null ? null : {
      numero: Number(row.cuota_mes_numero),
      vencimiento: String(row.cuota_mes_vencimiento),
      estado: String(row.cuota_mes_estado) as EstadoCuotaMes,
      pago: String(row.cuota_mes_pago) as PagoCuota,
      aplicado: String(row.cuota_mes_aplicado ?? "0.00"),
      monto: String(row.cuota_mes_monto ?? "0.00"),
      medio: row.cuota_mes_medio == null ? null : (String(row.cuota_mes_medio) as "NEXA" | "MANUAL"),
      porValidar: row.cuota_mes_por_validar === true,
    },
  }));

  return {
    totales,
    creditos,
    total: totales.creditos,
    page: params.page,
    pageSize: params.pageSize,
  };
};

// failed es rechazo siempre: el pago no se aplicó aunque hayan quedado filas pending colgando.
// manual_review con filas vigentes es incierto (pudo aplicarse): no cuenta como rechazo.
const esRechazo = sql`e.pago_id IS NULL AND (e.status = 'failed' OR (e.status = 'manual_review' AND pe.vigente IS NOT TRUE))`;

export const getNexaDashboard = async (alcance: AlcanceNexa, params: NexaDashboardParams): Promise<NexaDashboardResponse> => {
  const filtroAlcance = condicionAlcance(alcance, sql.raw("c.asesor_id"));
  // El alcance va en `base`: de ahí cuelgan las filas, los totales y la paginación.
  const result = await db.execute(sql`
WITH base AS (
  SELECT b.credito_id, b.nexa_token, b.activo, c.numero_credito_sifco,
         c."statusCredit" AS estado, u.nombre AS cliente, c.cuota AS monto_cuota
  FROM cartera.nexa_credit_bindings b
  JOIN cartera.creditos c ON c.credito_id = b.credito_id
  LEFT JOIN cartera.usuarios u ON u.usuario_id = c.usuario_id
  WHERE ${filtroAlcance}
    AND (${params.q} = ''
     OR c.numero_credito_sifco ILIKE '%' || ${params.q} || '%'
     OR u.nombre ILIKE '%' || ${params.q} || '%')
), ${filasConBoleta(sql`p.credito_id IN (SELECT credito_id FROM base)`, params)}, boletas AS (
  SELECT f.credito_id, f.boleta, BOOL_OR(f.nexa_payment_event_id IS NOT NULL) AS es_nexa,
         MIN(f.fecha_pago) AS fecha, MAX(f.monto_boleta) AS monto, MIN(f.pago_id) AS primer_pago,
         MAX(bk.nombre) FILTER (WHERE f.nexa_payment_event_id IS NULL) AS banco
  FROM filas_boleta f
  LEFT JOIN cartera.bancos bk ON bk.banco_id = f.banco_id
  GROUP BY f.credito_id, f.boleta
), ultimo AS (
  SELECT DISTINCT ON (credito_id) credito_id, fecha AS fecha_pago, monto AS monto_boleta, es_nexa, banco
  FROM boletas
  ORDER BY credito_id, fecha DESC, primer_pago DESC
), nexa AS (
  SELECT e.credito_id,
         COUNT(*) FILTER (WHERE e.pago_id IS NOT NULL AND pe.vigente) AS pagos_nexa,
         COALESCE(SUM(e.amount) FILTER (WHERE e.pago_id IS NOT NULL AND pe.vigente), 0) AS monto_nexa,
         COUNT(*) FILTER (WHERE ${esRechazo}) AS rechazos_nexa,
         to_json((array_agg(json_build_object(
           -- Cuándo llegó (hora de Guatemala), igual que el modal; el rango sigue filtrando con eventoEnRango.
           'fecha', to_char(e.created_at AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD"T"HH24:MI:SS'),
           'monto', e.amount::text, 'codigo', e.error, 'estado', e.status) ORDER BY e.created_at DESC, e.id DESC) FILTER (WHERE ${esRechazo}))[1:5]) AS rechazos_detalle
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
), hoy AS (
  SELECT (now() AT TIME ZONE 'America/Guatemala')::date AS dia,
         date_trunc('month', now() AT TIME ZONE 'America/Guatemala')::date AS inicio_mes
), cuotas AS (
  -- Una por número (dedupe de insertPayment: gana el mayor cuota_id), sin la cuota 0 y hasta fin
  -- del mes en curso. "pagada" es el criterio del cron de mora (esCuotaElegibleParaMora): impaga
  -- solo si cuotas_credito.pagado = false Y ninguna fila la cubre; un pagado NULL cuenta como pagada.
  -- Sin alias: hasPaidPaymentSql se ata a "cartera"."cuotas_credito".
  SELECT DISTINCT ON (cuotas_credito.credito_id, cuotas_credito.numero_cuota)
         cuotas_credito.credito_id, cuotas_credito.cuota_id, cuotas_credito.numero_cuota,
         cuotas_credito.fecha_vencimiento,
         (cuotas_credito.pagado IS DISTINCT FROM false OR ${hasPaidPaymentSql()}) AS pagada
  FROM cartera.cuotas_credito, hoy
  WHERE cuotas_credito.credito_id IN (SELECT credito_id FROM base) AND cuotas_credito.numero_cuota > 0
    AND cuotas_credito.fecha_vencimiento < hoy.inicio_mes + interval '1 month'
  ORDER BY cuotas_credito.credito_id, cuotas_credito.numero_cuota, cuotas_credito.cuota_id DESC
), recientes AS (
  SELECT * FROM (SELECT cuotas.*, row_number() OVER (
    PARTITION BY credito_id ORDER BY fecha_vencimiento DESC, numero_cuota DESC) AS n FROM cuotas) x
  WHERE n <= 12
), cuota_mes AS (
  -- Cuota del mes: la PRIMERA que vence en el mes en curso (hora de Guatemala); con plazos de
  -- 30 días caen dos en el mismo mes y la segunda es la del mes siguiente corrida. Si el crédito
  -- no tiene cuota este mes, la última que ya venció.
  SELECT DISTINCT ON (cuotas.credito_id) cuotas.credito_id, cuotas.cuota_id, cuotas.numero_cuota, cuotas.fecha_vencimiento,
         CASE WHEN cuotas.pagada THEN 'pagada' WHEN cuotas.fecha_vencimiento < hoy.dia THEN 'vencida' ELSE 'por_vencer' END AS estado
  FROM cuotas, hoy
  ORDER BY cuotas.credito_id, (cuotas.fecha_vencimiento >= hoy.inicio_mes) DESC,
           CASE WHEN cuotas.fecha_vencimiento >= hoy.inicio_mes THEN cuotas.fecha_vencimiento END,
           cuotas.fecha_vencimiento DESC, cuotas.numero_cuota DESC
), medio_cuota AS (
  -- Medio de la cuota: el que más plata le aplicó; empate, el del pago más reciente. Cuentan las
  -- filas que cubren la cuota para el cron (filaQueCubreCuotaSql). Si ninguna la cubre (pagada solo
  -- por el flag, o no pagada con abonos), las filas no anuladas, no 'reset' y con monto aplicado.
  -- aplicado: lo que se le aplicó a la cuota (filas no anuladas y no 'reset'), para completa/parcial.
  -- por_validar: alguna fila no anulada que le aplica plata a la cuota sigue 'pending' (contabilidad
  -- no la validó). El cron la cuenta como pagada hasta 7 días (filaQueCubreCuotaSql); se avisa igual.
  -- Mira todas esas filas, cubran o no, y también las Nexa: entran 'pending' y applyPayment las valida
  -- en la misma llamada, así que una Nexa que queda 'pending' es un pago que no terminó de aplicarse.
  SELECT cuota_id, banco, aplicado, por_validar,
         CASE WHEN nexa > otro THEN 'NEXA' WHEN otro > nexa THEN 'MANUAL' WHEN ultimo_nexa THEN 'NEXA' ELSE 'MANUAL' END AS medio
  FROM (
    SELECT pc.cuota_id, MAX(pc.aplicado) AS aplicado, BOOL_OR(pc.por_validar) AS por_validar,
           COALESCE(SUM(pc.monto_aplicado) FILTER (WHERE pc.nexa_payment_event_id IS NOT NULL), 0) AS nexa,
           COALESCE(SUM(pc.monto_aplicado) FILTER (WHERE pc.nexa_payment_event_id IS NULL), 0) AS otro,
           (array_agg(pc.nexa_payment_event_id IS NOT NULL ORDER BY pc.fecha_pago DESC NULLS LAST, pc.pago_id DESC))[1] AS ultimo_nexa,
           (array_agg(bk.nombre ORDER BY pc.fecha_pago DESC NULLS LAST, pc.pago_id DESC)
             FILTER (WHERE pc.nexa_payment_event_id IS NULL AND bk.nombre IS NOT NULL))[1] AS banco
    FROM (
      SELECT filas.*, BOOL_OR(cubre) OVER (PARTITION BY cuota_id) AS alguna_cubre,
             SUM(monto_aplicado) FILTER (WHERE validation_status <> 'reset') OVER (PARTITION BY cuota_id) AS aplicado,
             BOOL_OR(validation_status = 'pending') OVER (PARTITION BY cuota_id) AS por_validar
      FROM (
        SELECT pc.*, ${filaQueCubreCuotaSql()} AS cubre
        FROM cartera.pagos_credito pc
        WHERE pc.cuota_id IN (SELECT cuota_id FROM recientes UNION SELECT cuota_id FROM cuota_mes)
          AND pc."paymentFalse" = false AND COALESCE(pc.monto_aplicado, 0) > 0
      ) filas
      WHERE filas.cubre OR filas.validation_status <> 'reset'
    ) pc
    LEFT JOIN cartera.bancos bk ON bk.banco_id = pc.banco_id
    WHERE pc.cubre OR NOT pc.alguna_cubre
    GROUP BY pc.cuota_id
  ) sumas
), franja AS (
  SELECT r.credito_id, json_agg(json_build_object(
           'numero', r.numero_cuota, 'vencimiento', to_char(r.fecha_vencimiento, 'YYYY-MM-DD'), 'pagada', r.pagada,
           'medio', m.medio, 'banco', CASE WHEN m.medio = 'MANUAL' THEN m.banco END,
           'aplicado', COALESCE(m.aplicado, 0)::numeric(18,2)::text, 'monto', base.monto_cuota::numeric(18,2)::text,
           'porValidar', COALESCE(m.por_validar, false)
         ) ORDER BY r.fecha_vencimiento, r.numero_cuota) AS ultimas_cuotas
  FROM recientes r LEFT JOIN medio_cuota m ON m.cuota_id = r.cuota_id
  JOIN base ON base.credito_id = r.credito_id
  GROUP BY r.credito_id
), universo AS (
  -- Todos los créditos del alcance (asesor), con la búsqueda y el rango de fechas, SIN los filtros de
  -- cuota ni de medio. De acá salen las filas (filtradas abajo) y el desglose de la cabecera, que así
  -- no colapsa al filtrar. grupo_cuota y medio_filtro son LA definición de los filtros: el WHERE de
  -- filas y los conteos del desglose leen estas mismas columnas.
  SELECT base.credito_id, base.nexa_token, base.activo, base.numero_credito_sifco, base.estado, base.cliente,
         -- Como texto: fecha_pago no tiene zona horaria y el driver la correría.
         to_char(ultimo.fecha_pago, 'YYYY-MM-DD"T"HH24:MI:SS') AS ultimo_pago_fecha, ultimo.monto_boleta AS ultimo_pago_monto,
         COALESCE(ultimo.es_nexa, false) AS ultimo_pago_nexa, ultimo.banco AS ultimo_pago_banco,
         COALESCE(nexa.pagos_nexa, 0) AS pagos_nexa,
         COALESCE(nexa.monto_nexa, 0) AS monto_nexa,
         COALESCE(nexa.rechazos_nexa, 0) AS rechazos_nexa, nexa.rechazos_detalle,
         franja.ultimas_cuotas, cuota_mes.numero_cuota AS cuota_mes_numero,
         to_char(cuota_mes.fecha_vencimiento, 'YYYY-MM-DD') AS cuota_mes_vencimiento, cuota_mes.estado AS cuota_mes_estado,
         CASE WHEN cuota_mes.estado = 'pagada' THEN 'completa' WHEN COALESCE(mm.aplicado, 0) > 0 THEN 'parcial' ELSE 'sin_pago' END AS cuota_mes_pago,
         COALESCE(mm.aplicado, 0)::numeric(18,2)::text AS cuota_mes_aplicado, base.monto_cuota::numeric(18,2)::text AS cuota_mes_monto,
         mm.medio AS cuota_mes_medio, COALESCE(mm.por_validar, false) AS cuota_mes_por_validar,
         -- pagados = pagada (criterio del cron); parciales = no pagada con plata aplicada (la misma regla
         -- de cuota_mes_pago); sinpago = no pagada y sin plata. Sin cuota del mes: NULL, ningún filtro.
         CASE WHEN cuota_mes.estado = 'pagada' THEN 'pagados'
              WHEN cuota_mes.estado IN ('vencida', 'por_vencer') AND COALESCE(mm.aplicado, 0) > 0 THEN 'parciales'
              WHEN cuota_mes.estado IN ('vencida', 'por_vencer') THEN 'sinpago' END AS grupo_cuota,
         -- Medio de la cuota del mes (pagada o con pago parcial), como la franja: una pagada sin detalle del
         -- medio cuenta como manual (verde). Sin plata aplicada no tiene medio.
         CASE WHEN cuota_mes.estado = 'pagada' THEN COALESCE(mm.medio, 'MANUAL')
              WHEN COALESCE(mm.aplicado, 0) > 0 THEN mm.medio END AS medio_filtro
  FROM base
  LEFT JOIN ultimo ON ultimo.credito_id = base.credito_id
  LEFT JOIN nexa ON nexa.credito_id = base.credito_id
  LEFT JOIN franja ON franja.credito_id = base.credito_id
  LEFT JOIN cuota_mes ON cuota_mes.credito_id = base.credito_id
  LEFT JOIN medio_cuota mm ON mm.cuota_id = cuota_mes.cuota_id
  -- Con rango de fechas, solo los créditos con algún pago o algún rechazo Nexa en el período.
  WHERE (${!conRango(params)} OR ultimo.credito_id IS NOT NULL OR COALESCE(nexa.rechazos_nexa, 0) > 0)
), filas AS (
  SELECT universo.* FROM universo
  -- pendientes (compatibilidad) = parciales + sinpago.
  WHERE (${params.cuotaMes} = '' OR universo.grupo_cuota = ${params.cuotaMes}
         OR (${params.cuotaMes} = 'pendientes' AND universo.grupo_cuota IN ('parciales', 'sinpago')))
    AND (${params.medio} = '' OR universo.medio_filtro = CASE WHEN ${params.medio} = 'nexa' THEN 'NEXA' ELSE 'MANUAL' END)
), desglose AS (
  -- Cabecera: la cuota del mes sobre el universo (sin filtro de cuota ni de medio). Cada conteo es
  -- exactamente lo que devuelve el filtro correspondiente: pagada_nexa = pagados+nexa, parcial = parciales,
  -- sin_pago = sinpago. Suman d_con_cuota_mes (un parcial siempre tiene medio: tiene plata aplicada).
  SELECT COUNT(*) AS d_creditos,
         COUNT(*) FILTER (WHERE grupo_cuota IS NOT NULL) AS d_con_cuota_mes,
         COUNT(*) FILTER (WHERE grupo_cuota = 'pagados' AND medio_filtro = 'NEXA') AS d_pagada_nexa,
         COUNT(*) FILTER (WHERE grupo_cuota = 'pagados' AND medio_filtro = 'MANUAL') AS d_pagada_manual,
         COUNT(*) FILTER (WHERE grupo_cuota = 'parciales' AND medio_filtro = 'NEXA') AS d_parcial_nexa,
         COUNT(*) FILTER (WHERE grupo_cuota = 'parciales' AND medio_filtro = 'MANUAL') AS d_parcial_manual,
         COUNT(*) FILTER (WHERE grupo_cuota = 'sinpago') AS d_sin_pago,
         COUNT(*) FILTER (WHERE grupo_cuota = 'sinpago' AND cuota_mes_estado = 'vencida') AS d_vencida_sin_pago,
         COUNT(*) FILTER (WHERE grupo_cuota IN ('pagados', 'parciales') AND cuota_mes_por_validar) AS d_por_validar,
         COUNT(*) FILTER (WHERE nexa_token IS NOT NULL) AS d_con_token,
         COALESCE(SUM(pagos_nexa), 0) AS d_pagos_nexa,
         COALESCE(SUM(monto_nexa), 0) AS d_monto_nexa,
         COALESCE(SUM(rechazos_nexa), 0) AS d_rechazos_nexa
  FROM universo
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
SELECT pagina.*, totales.*, desglose.*
FROM totales
CROSS JOIN desglose
LEFT JOIN (
  SELECT filas.* FROM filas
  -- En pendientes, primero las cuotas con pago parcial.
  ORDER BY CASE WHEN ${params.cuotaMes} IN ('pendientes', 'parciales') AND filas.cuota_mes_pago = 'parcial' THEN 0 ELSE 1 END,
           filas.ultimo_pago_fecha DESC NULLS LAST, filas.credito_id
  LIMIT ${params.pageSize} OFFSET ${(params.page - 1) * params.pageSize}
) pagina ON true
ORDER BY CASE WHEN ${params.cuotaMes} IN ('pendientes', 'parciales') AND pagina.cuota_mes_pago = 'parcial' THEN 0 ELSE 1 END,
         pagina.ultimo_pago_fecha DESC NULLS LAST, pagina.credito_id
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
  /** Banco de la boleta manual; null en Nexa (cartera no recibe el banco de origen). */
  banco: string | null;
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
    banco: row.banco == null ? null : String(row.banco),
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

/** null: el crédito no entra en el alcance de la sesión (el router responde 404, sin datos). */
export const getNexaCreditPayments = async (
  alcance: AlcanceNexa,
  creditoId: number,
  rango: RangoFechas = { desde: "", hasta: "" },
): Promise<NexaCreditPaymentsResponse | null> => {
  const filtroAlcance = condicionAlcance(alcance, sql.raw("c.asesor_id"));
  if (alcance.tipo !== "todos") {
    const propio = await db.execute(sql`
SELECT 1 FROM cartera.creditos c WHERE c.credito_id = ${creditoId} AND ${filtroAlcance}`);
    if (propio.rows.length === 0) return null;
  }
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
       COALESCE(ARRAY_AGG(DISTINCT cc.numero_cuota ORDER BY cc.numero_cuota) FILTER (WHERE cc.numero_cuota IS NOT NULL), '{}') AS cuotas,
       MAX(bk.nombre) FILTER (WHERE f.nexa_payment_event_id IS NULL) AS banco
FROM filas_boleta f
LEFT JOIN cartera.bancos bk ON bk.banco_id = f.banco_id
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

export type PagosNexaCredito = { cantidad: number; montoTotal: string };

export const mapPagosNexaCredito = (row: Record<string, unknown> | undefined): PagosNexaCredito => ({
  cantidad: Number(row?.cantidad ?? 0),
  montoTotal: String(row?.monto_total ?? "0"),
});

/**
 * Pagos de un crédito que entraron por Nexa y siguen vigentes, para advertir antes de una
 * operación que borra o rehace todos los pagos del crédito. Se cuenta por evento (boleta), no
 * por fila: un evento puede tener varias filas y todas repiten el monto_boleta.
 */
export const contarPagosNexaCredito = async (creditoId: number): Promise<PagosNexaCredito> => {
  const result = await db.execute(sql`
SELECT COUNT(*) AS cantidad, COALESCE(SUM(monto), 0) AS monto_total
FROM (
  SELECT MAX(pc.monto_boleta) AS monto
  FROM cartera.pagos_credito pc
  WHERE pc.credito_id = ${creditoId} AND pc.nexa_payment_event_id IS NOT NULL
    AND pc."paymentFalse" IS NOT TRUE AND pc.monto_boleta > 0
  GROUP BY pc.nexa_payment_event_id
) por_evento`);
  return mapPagosNexaCredito(result.rows[0]);
};
