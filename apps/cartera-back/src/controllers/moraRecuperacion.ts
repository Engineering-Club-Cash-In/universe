import { sql } from "drizzle-orm";
import { inicioDiaGTComoTimestampUTC } from "../utils/functions/diaGuatemala";
import { creditosElegiblesMoraSql } from "./moraCapitalCartera";
import { snapCte } from "./moraSnapshotSql";

export type MoraRecoverySourceRow = {
	asesorId: number | null;
	nombre: string;
	/** Foto de la mora al INICIO del ciclo (día 6). */
	esperado: string;
	/**
	 * Mora GENERADA dentro del ciclo. Con la mora proporcional el monto crece
	 * todos los días, así que la foto inicial ya no es todo lo que el asesor
	 * tuvo oportunidad de cobrar; el `esperado` del reporte es la suma de las
	 * dos (ver `metricFrom`).
	 */
	generadoEnPeriodo: string;
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

	// `moras_historial.fecha` es `timestamp` SIN zona con el instante en UTC. Para
	// filtrar por día de Guatemala se convierten los LÍMITES a instantes UTC y se
	// compara contra la columna CRUDA: envolverla en `AT TIME ZONE` (como hace
	// `snapCte`, que corta por día y no por rango) mataría `moras_historial_fecha_idx`.
	const inicioUtc = inicioDiaGTComoTimestampUTC(inicio);
	const finUtc = inicioDiaGTComoTimestampUTC(fin);
	if (!inicioUtc || !finUtc) {
		throw new RangeError(
			`Período de recuperación de mora inválido: ${inicio} → ${fin}`,
		);
	}

	return sql`
    WITH ${snapshotCte},
    creditos_con_asesor AS (
      SELECT c.credito_id, c.asesor_id, a.nombre
      FROM cartera.creditos c
      LEFT JOIN cartera.asesores a ON a.asesor_id = c.asesor_id
      WHERE c."statusCredit" IN (${creditosElegiblesMoraSql})
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
    ),
    -- Mora generada DENTRO del ciclo. No se recalcula nada: cada evento de
    -- \`moras_historial\` ya trae monto_anterior/monto_nuevo, así que lo generado
    -- es la suma de los incrementos.
    --   * Solo incrementos: una CONDONACION o un DECREMENTO bajan el monto, pero
    --     eso NO reduce lo que hubo para cobrar — reduce lo cobrable por decisión
    --     de la empresa, no por el cliente.
    --   * CREACION cuenta: un crédito que entró al ciclo sin mora y la generó
    --     adentro sí tuvo mora que cobrar.
    --   * GREATEST(0, …) por si un evento de esos tipos viniera con delta negativo.
    -- LIMITACIÓN: el RECALCULO diario solo existe desde el despliegue de la mora
    -- proporcional. Antes el monto casi no cambiaba y el cron escribía \`sinCambios\`,
    -- así que para ciclos viejos el historial es escaso y el esperado queda
    -- APROXIMADO POR LO BAJO. No es un defecto del cálculo: el dato no existe hacia atrás.
    generado_por_credito AS (
      SELECT h.credito_id,
             SUM(GREATEST(0, h.monto_nuevo::numeric - h.monto_anterior::numeric)) AS generado
      FROM cartera.moras_historial h
      JOIN creditos_con_asesor ca ON ca.credito_id = h.credito_id
      WHERE h.tipo_evento IN ('CREACION', 'RECALCULO', 'INCREMENTO')
        AND h.fecha >= ${inicioUtc}::timestamp
        AND h.fecha < ${finUtc}::timestamp
      GROUP BY h.credito_id
    )
    SELECT
      ca.asesor_id,
      COALESCE(ca.nombre, 'Sin asignar') AS nombre,
      COALESCE(s.esperado, 0)::text AS esperado,
      COALESCE(g.generado, 0)::text AS generado_en_periodo,
      -- "En snapshot" = el crédito aporta esperado (foto inicial O mora generada
      -- adentro). Un crédito que entró al ciclo sin mora, la generó y la pagó
      -- tiene esperado > 0: contar su pago como "fuera" dejaría el pendiente
      -- inflado por el monto completo.
      CASE WHEN s.credito_id IS NOT NULL OR g.credito_id IS NOT NULL THEN COALESCE(p.cobrado, 0) ELSE 0 END::text AS cobrado_en_snapshot,
      CASE WHEN s.credito_id IS NULL AND g.credito_id IS NULL THEN COALESCE(p.cobrado, 0) ELSE 0 END::text AS cobrado_fuera_snapshot
    FROM snapshot_por_credito s
    FULL JOIN pagos_por_credito p ON p.credito_id = s.credito_id
    FULL JOIN generado_por_credito g ON g.credito_id = COALESCE(s.credito_id, p.credito_id)
    JOIN creditos_con_asesor ca ON ca.credito_id = COALESCE(s.credito_id, p.credito_id, g.credito_id)
  `;
}

function metricFrom(
	row: Omit<MoraRecoverySourceRow, "asesorId" | "nombre">,
): MoraRecoveryMetric {
	// El esperado del reporte = foto inicial + lo generado dentro del ciclo, que es
	// exactamente lo que el asesor tuvo oportunidad de cobrar.
	const esperado = Number(row.esperado) + Number(row.generadoEnPeriodo);
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
				generadoEnPeriodo: "0",
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
