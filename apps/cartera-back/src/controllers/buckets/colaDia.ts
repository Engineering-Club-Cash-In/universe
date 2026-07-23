import { sql } from "drizzle-orm";
import { db } from "../../database";
import { SQL_CARTERA_SCHEMA } from "../../database/db/schema";
import { STATUS_BUCKET_FUERA } from "../../lib/buckets-classification";

// ─────────────────────────────────────────────────────────────────────────────
// CB-020 · Buckets — Cola del Día (universo SLA).
// Créditos del POOL de buckets del asesor (`asesor_bucket`, activo=true) — NO
// del asesor_id asignado al crédito individual (eso es lo que usa la Agenda,
// getCuotasProximasVencer). Un bucket puede tener varios asesores cubriéndolo.
//
// Por cada crédito: su bucket ACTUAL viene de la última fila de
// `buckets_historial` (misma fuente que bucketActualSql, pero acá necesitamos
// también LA FECHA de esa fila, no solo el número — el índice
// buckets_historial_credito_fecha_idx (credito_id, fecha DESC, historial_id
// DESC) cubre el DISTINCT ON exacto). B0 (Cartera Sana) se excluye siempre:
// no tiene dias_sla (al día, no aplica SLA de contacto).
//
// Créditos sin ninguna fila en buckets_historial (ambiente sin backfill de
// COBROS-02) no tienen fecha de entrada confiable → se excluyen de la cola en
// vez de asumir una fecha, mismo criterio "degradar sin inventar dato" que el
// resto del motor de buckets.
// ─────────────────────────────────────────────────────────────────────────────

export type ColaDiaFila = {
	credito_id: number;
	numero_credito_sifco: string;
	cliente: string;
	asesor_id: number;
	asesor: string;
	bucket: number;
	bucket_prefijo: string;
	bucket_nombre: string;
	dias_sla: number;
	fecha_entrada_bucket: string; // ISO
	fecha_limite_sla: string; // YYYY-MM-DD, día GT
};

export type GetColaDiaSLAParams = {
	asesor_id?: number;
	/** Filtra por bucket(s) del catálogo (0-5). Omitir = todos los buckets con SLA. */
	buckets?: number[];
	page?: number;
	perPage?: number;
};

export type GetColaDiaSLAResultado = {
	success: true;
	data: ColaDiaFila[];
	page: number;
	perPage: number;
	total: number;
	totalPages: number;
};

// Última fila de buckets_historial por crédito (DISTINCT ON, aprovecha el
// índice compuesto credito_id+fecha+historial_id) + su bucket destino, filtrado
// a los buckets que el asesor (o cualquiera, si no se filtra) cubre en el pool.
export async function getColaDiaSLA(
	params: GetColaDiaSLAParams,
): Promise<GetColaDiaSLAResultado> {
	const pageFloor = Math.floor(Number(params.page ?? 1));
	const page = Number.isFinite(pageFloor) && pageFloor > 0 ? pageFloor : 1;
	const perPageFloor = Math.floor(Number(params.perPage ?? 50));
	const perPage =
		Number.isFinite(perPageFloor) && perPageFloor > 0
			? Math.min(perPageFloor, 500)
			: 50;
	const offset = (page - 1) * perPage;

	const filtroAsesor = params.asesor_id
		? sql`AND ab.asesor_id = ${params.asesor_id}`
		: sql``;
	const filtroBuckets =
		params.buckets && params.buckets.length > 0
			? sql`AND b.numero IN (${sql.join(params.buckets.map((n) => sql`${n}`), sql`, `)})`
			: sql``;
	// Un crédito que salió del funnel (CANCELADO, EN_CONVENIO, CAIDO, etc.) no
	// siempre escribe una transición de "salida" en buckets_historial — su
	// última fila puede seguir siendo un B1-B5 viejo. Sin este filtro (mismo
	// patrón que getCreditosWithUserByMesAnio en credits.ts), esos créditos
	// quedarían en la Cola del Día indefinidamente aunque ya no se cobren
	// activamente (review Codex).
	const statusFueraSql = sql.join(
		STATUS_BUCKET_FUERA.map((s) => sql`${s}`),
		sql`, `,
	);

	// ultima_entrada: 1 fila por crédito con su bucket_nuevo/fecha más reciente.
	// pool: buckets que el asesor (o cualquier asesor activo) cubre.
	const cte = sql`
    WITH ultima_entrada AS (
      SELECT DISTINCT ON (h.credito_id)
        h.credito_id, h.bucket_nuevo, h.fecha
      FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
      ORDER BY h.credito_id, h.fecha DESC, h.historial_id DESC
    )
  `;

	const joins = sql`
    FROM ultima_entrada ue
    INNER JOIN ${SQL_CARTERA_SCHEMA}.buckets b ON b.numero = ue.bucket_nuevo
    INNER JOIN ${SQL_CARTERA_SCHEMA}.asesor_bucket ab
      ON ab.bucket = ue.bucket_nuevo AND ab.activo = true
    INNER JOIN ${SQL_CARTERA_SCHEMA}.creditos c ON c.credito_id = ue.credito_id
    INNER JOIN ${SQL_CARTERA_SCHEMA}.usuarios u ON u.usuario_id = c.usuario_id
    INNER JOIN ${SQL_CARTERA_SCHEMA}.asesores a ON a.asesor_id = c.asesor_id
    WHERE b.numero > 0
      AND b.dias_sla IS NOT NULL
      AND c."statusCredit" NOT IN (${statusFueraSql})
      ${filtroAsesor}
      ${filtroBuckets}
  `;

	const [totRes, dataRes] = await Promise.all([
		db.execute<{ total: string }>(sql`
      ${cte}
      SELECT COUNT(DISTINCT ue.credito_id)::int AS total
      ${joins}
    `),
		db.execute<{
			credito_id: number;
			numero_credito_sifco: string;
			cliente: string;
			asesor_id: number;
			asesor: string;
			bucket: number;
			bucket_prefijo: string;
			bucket_nombre: string;
			dias_sla: number;
			fecha_entrada_bucket: string;
			fecha_limite_sla: string;
		}>(sql`
      ${cte},
      base AS (
        SELECT DISTINCT ON (ue.credito_id)
          ue.credito_id,
          c.numero_credito_sifco,
          u.nombre AS cliente,
          c.asesor_id,
          a.nombre AS asesor,
          b.numero AS bucket,
          b.prefijo AS bucket_prefijo,
          b.nombre AS bucket_nombre,
          b.dias_sla,
          ue.fecha::text AS fecha_entrada_bucket,
          (
            (
              (ue.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date
              + (b.dias_sla || ' days')::interval
            )::date
          )::text AS fecha_limite_sla
        ${joins}
        -- DISTINCT ON exige empezar el ORDER BY por credito_id; el orden real
        -- (priorizado por fecha_limite_sla) se aplica afuera, en el SELECT final.
        ORDER BY ue.credito_id
      )
      SELECT * FROM base
      ORDER BY fecha_limite_sla ASC, credito_id ASC
      LIMIT ${perPage} OFFSET ${offset}
    `),
	]);

	const total = Number(totRes.rows[0]?.total ?? 0);
	return {
		success: true,
		data: dataRes.rows,
		page,
		perPage,
		total,
		totalPages: Math.max(1, Math.ceil(total / perPage)),
	};
}
