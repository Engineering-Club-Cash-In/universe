import { sql } from "drizzle-orm";
import { creditosVigentesSql } from "./moraCapitalCartera";
import { snapCte } from "./moraSnapshotSql";

export type MoraRecoverySourceRow = {
	asesorId: number | null;
	nombre: string;
	esperado: string;
	cobradoEnSnapshot: string;
	cobradoFueraSnapshot: string;
};

export type MoraRecoveryMetric = {
	esperado: string;
	cobradoEnSnapshot: string;
	cobradoFueraSnapshot: string;
	excedenteEnSnapshot: string;
	pendiente: string;
};

export type MoraRecoveryRow = MoraRecoveryMetric & {
	asesorId: number | null;
	nombre: string;
};

type MoraRecoveryReport = {
	periodo: { inicio: string; fin: string };
	metadata: {
		alcance: "live" | "historico";
		atribucionAsesor: "actual";
	};
	totales: MoraRecoveryMetric;
	porAsesor: MoraRecoveryRow[];
};

export type MoraRecoveryPeriod = {
	inicio: string;
	fin: string;
	fechaSnapshot: string;
	alcance: "live" | "historico";
};

export class MoraRecoveryFuturePeriodError extends Error {
	constructor() {
		super("No se puede consultar un ciclo futuro");
		this.name = "MoraRecoveryFuturePeriodError";
	}
}

export function getMoraRecoveryPeriod({
	mes,
	anio,
	hoy,
}: {
	mes: number;
	anio: number;
	hoy: string;
}): MoraRecoveryPeriod {
	const [anioActual, mesActual] = hoy.split("-").map(Number);
	if (anio > anioActual || (anio === anioActual && mes > mesActual)) {
		throw new MoraRecoveryFuturePeriodError();
	}
	const inicio = `${anio}-${String(mes).padStart(2, "0")}-06`;
	const finMes = mes === 12 ? 1 : mes + 1;
	const finAnio = mes === 12 ? anio + 1 : anio;
	const fin = `${finAnio}-${String(finMes).padStart(2, "0")}-06`;
	const fechaSnapshot = inicio > hoy ? hoy : inicio;
	return {
		inicio,
		fin,
		fechaSnapshot,
		alcance: inicio <= hoy ? "historico" : "live",
	};
}

export function buildMoraRecoveryQuery({
	inicio,
	fin,
	fechaSnapshot,
	alcance,
	asesores,
	emailCobrador,
}: MoraRecoveryPeriod & {
	asesores?: number[];
	emailCobrador?: string;
}) {
	const emailFilter = emailCobrador
		? sql`AND LOWER(a.email_cash_in) = LOWER(TRIM(${emailCobrador}))`
		: sql``;
	const asesoresFilter = asesores?.length
		? sql`AND a.asesor_id IN (${sql.join(
				asesores.map((id) => sql`${id}`),
				sql`, `,
			)})`
		: sql``;
	const snapshotCte =
		alcance === "historico"
			? sql`${snapCte(fechaSnapshot, false)}, snapshot_por_credito AS (
      SELECT s.credito_id, s.monto::numeric AS esperado
      FROM snap s
      WHERE s.tipo_evento <> 'DESACTIVACION' AND s.monto > 0 AND s.cuotas > 0
    )`
			: sql`mora_activa AS (
      SELECT DISTINCT ON (credito_id) credito_id, monto_mora::numeric AS esperado
      FROM cartera.moras_credito
      WHERE activa = true AND cuotas_atrasadas > 0
      ORDER BY credito_id, mora_id DESC
    ), snapshot_por_credito AS (
      SELECT m.credito_id, m.esperado
      FROM mora_activa m
    )`;

	return sql`
    WITH ${snapshotCte},
    creditos_con_asesor AS (
      SELECT c.credito_id, c.asesor_id, a.nombre
      FROM cartera.creditos c
      LEFT JOIN cartera.asesores a ON a.asesor_id = c.asesor_id
      WHERE c."statusCredit" IN (${creditosVigentesSql})
        ${emailFilter}
        ${asesoresFilter}
    ),
    pagos_por_credito AS (
      SELECT pc.credito_id, COALESCE(SUM(pc.mora::numeric), 0) AS cobrado
      FROM cartera.pagos_credito pc
      JOIN creditos_con_asesor ca ON ca.credito_id = pc.credito_id
      WHERE pc.fecha_pago >= ${inicio}::timestamp
        AND pc.fecha_pago < ${fin}::timestamp
        AND COALESCE(pc."paymentFalse", false) = false
      GROUP BY pc.credito_id
    )
    SELECT
      ca.asesor_id,
      COALESCE(ca.nombre, 'Sin asignar') AS nombre,
      COALESCE(s.esperado, 0)::text AS esperado,
      CASE WHEN s.credito_id IS NOT NULL THEN COALESCE(p.cobrado, 0) ELSE 0 END::text AS cobrado_en_snapshot,
      CASE WHEN s.credito_id IS NULL THEN COALESCE(p.cobrado, 0) ELSE 0 END::text AS cobrado_fuera_snapshot
    FROM snapshot_por_credito s
    FULL JOIN pagos_por_credito p ON p.credito_id = s.credito_id
    JOIN creditos_con_asesor ca ON ca.credito_id = COALESCE(s.credito_id, p.credito_id)
  `;
}

function metricFrom(
	row: Omit<MoraRecoverySourceRow, "asesorId" | "nombre">,
): MoraRecoveryMetric {
	const esperado = Number(row.esperado);
	const cobradoEnSnapshot = Number(row.cobradoEnSnapshot);
	const cobradoFueraSnapshot = Number(row.cobradoFueraSnapshot);
	return {
		esperado: esperado.toFixed(2),
		cobradoEnSnapshot: cobradoEnSnapshot.toFixed(2),
		cobradoFueraSnapshot: cobradoFueraSnapshot.toFixed(2),
		excedenteEnSnapshot: Math.max(0, cobradoEnSnapshot - esperado).toFixed(2),
		pendiente: Math.max(0, esperado - cobradoEnSnapshot).toFixed(2),
	};
}

export function buildMoraRecoveryReport(
	rows: MoraRecoverySourceRow[],
	periodo: { inicio: string; fin: string; alcance: "live" | "historico" },
): MoraRecoveryReport {
	const byAsesor = new Map<string, MoraRecoveryRow>();
	for (const source of rows) {
		const key = String(source.asesorId);
		const current = byAsesor.get(key) ?? {
			asesorId: source.asesorId,
			nombre: source.nombre,
			...metricFrom({
				esperado: "0",
				cobradoEnSnapshot: "0",
				cobradoFueraSnapshot: "0",
			}),
		};
		const metric = metricFrom(source);
		byAsesor.set(key, {
			asesorId: current.asesorId,
			nombre: current.nombre,
			esperado: (Number(current.esperado) + Number(metric.esperado)).toFixed(2),
			cobradoEnSnapshot: (
				Number(current.cobradoEnSnapshot) + Number(metric.cobradoEnSnapshot)
			).toFixed(2),
			cobradoFueraSnapshot: (
				Number(current.cobradoFueraSnapshot) +
				Number(metric.cobradoFueraSnapshot)
			).toFixed(2),
			excedenteEnSnapshot: (
				Number(current.excedenteEnSnapshot) + Number(metric.excedenteEnSnapshot)
			).toFixed(2),
			pendiente: (Number(current.pendiente) + Number(metric.pendiente)).toFixed(
				2,
			),
		});
	}
	const porAsesor = [...byAsesor.values()];
	const sum = (field: keyof MoraRecoveryMetric) =>
		porAsesor.reduce((total, row) => total + Number(row[field]), 0).toFixed(2);

	return {
		periodo: { inicio: periodo.inicio, fin: periodo.fin },
		metadata: { alcance: periodo.alcance, atribucionAsesor: "actual" },
		totales: {
			esperado: sum("esperado"),
			cobradoEnSnapshot: sum("cobradoEnSnapshot"),
			cobradoFueraSnapshot: sum("cobradoFueraSnapshot"),
			excedenteEnSnapshot: sum("excedenteEnSnapshot"),
			pendiente: sum("pendiente"),
		},
		porAsesor,
	};
}
