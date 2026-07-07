import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, gte, lt, lte, ne, sql, sum } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { auctionVehicles } from "../db/schema/auctionVehicles";
import { carteraBackReferences } from "../db/schema/cartera-back";
import {
	casosCobros,
	contratosFinanciamiento,
	cuotasPago,
} from "../db/schema/cobros";
import {
	clients,
	leads,
	opportunities,
	opportunityStageHistory,
	salesStages,
} from "../db/schema/crm";
import { metasMensuales } from "../db/schema/metas";
import { quotations } from "../db/schema/quotations";
import { vehicleInspections, vehicles } from "../db/schema/vehicles";
import { getGuatemalaMonthWindow } from "../lib/guatemala-month-window";
import {
	getLeadSourceChannelType,
	type LeadSourceChannelType,
} from "../lib/lead-sources";
import {
	closedCreditsReportProcedure,
	metaColocacionReportProcedure,
	porcentajeEfectividadReportProcedure,
	protectedProcedure,
	tiempoCierreReportProcedure,
} from "../lib/orpc";
import type { StatusCreditEnum } from "../types/cartera-back";

const SECONDS_PER_DAY = 60 * 60 * 24;
const CHANNEL_TYPE_ORDER: LeadSourceChannelType[] = [
	"Físico",
	"Pauta Digital",
	"Orgánico Digital",
	"Otros",
];

// Schema para filtros de fecha
const dateRangeSchema = z.object({
	startDate: z.string().optional(),
	endDate: z.string().optional(),
});

const closedCreditsReportInputSchema = z.object({
	startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// Reporte "Créditos cerrados": filtro por mes + paginación del lado del servidor.
// Sin `pageSize` se devuelven todas las filas del mes (usado por la exportación).
const creditosCerradosInputSchema = z.object({
	anio: z.number().int().min(2000).max(2100),
	mes: z.number().int().min(1).max(12),
	page: z.number().int().min(1).optional(),
	pageSize: z.number().int().min(1).max(500).optional(),
});

const CLOSED_CREDIT_REPORT_CARTERA_STATUSES: StatusCreditEnum[] = [
	"ACTIVO",
	"MOROSO",
	"EN_CONVENIO",
];
const MIGRATED_OPPORTUNITY_STATUS = "migrate";
export const CLOSED_CREDIT_REPORT_CARTERA_STATUS_CHUNK_SIZE = 50;

export function isClosedCreditReportCarteraStatusIncluded(
	status: StatusCreditEnum | null,
) {
	return status
		? CLOSED_CREDIT_REPORT_CARTERA_STATUSES.includes(status)
		: false;
}

export function enforceClosedCreditReportLimit<T>(rows: T[]) {
	if (rows.length > 10_000) {
		throw new ORPCError("BAD_REQUEST", {
			message:
				"El rango seleccionado devuelve demasiados registros. Reduce el rango de fechas.",
		});
	}
}

export function isPorcentajeEfectividadOpportunityStatusIncluded(
	status: string | null,
) {
	return status !== MIGRATED_OPPORTUNITY_STATUS;
}

export function isPorcentajeEfectividadPeriodCloseIncluded(
	status: string | null,
	firstClosedAt: Date,
	start: Date,
	end: Date,
) {
	return (
		isPorcentajeEfectividadOpportunityStatusIncluded(status) &&
		firstClosedAt >= start &&
		firstClosedAt <= end
	);
}

type EfectividadFuenteRow = {
	source: string | null;
	totalOportunidades: number;
	totalCerradas: number | `${number}`;
	porcentaje: number;
};

export function aggregateEfectividadPorTipoCanal(rows: EfectividadFuenteRow[]) {
	const totals = new Map<
		LeadSourceChannelType,
		{ totalOportunidades: number; totalCerradas: number }
	>();

	for (const row of rows) {
		const tipoCanal = getLeadSourceChannelType(row.source);
		const total = totals.get(tipoCanal) ?? {
			totalOportunidades: 0,
			totalCerradas: 0,
		};
		total.totalOportunidades += row.totalOportunidades;
		total.totalCerradas += Number(row.totalCerradas);
		totals.set(tipoCanal, total);
	}

	return CHANNEL_TYPE_ORDER.flatMap((tipoCanal) => {
		const total = totals.get(tipoCanal);
		if (!total) return [];
		return [
			{
				tipoCanal,
				totalOportunidades: total.totalOportunidades,
				totalCerradas: total.totalCerradas,
				porcentaje:
					total.totalOportunidades > 0
						? Math.round(
								(total.totalCerradas * 1000) / total.totalOportunidades,
							) / 10
						: 0,
			},
		];
	});
}

type TiempoCierreFuenteRow = {
	source: string | null;
	totalCreditos: number;
	avgDias: number;
	totalDias?: number | `${number}`;
	minDias: number;
	maxDias: number;
};

export function aggregateTiempoCierrePorTipoCanal(
	rows: TiempoCierreFuenteRow[],
) {
	const totals = new Map<
		LeadSourceChannelType,
		{
			totalCreditos: number;
			totalDias: number;
			minDias: number | null;
			maxDias: number | null;
		}
	>();

	for (const row of rows) {
		const tipoCanal = getLeadSourceChannelType(row.source);
		const total = totals.get(tipoCanal) ?? {
			totalCreditos: 0,
			totalDias: 0,
			minDias: null,
			maxDias: null,
		};
		total.totalCreditos += row.totalCreditos;
		total.totalDias += Number(row.totalDias ?? row.avgDias * row.totalCreditos);
		total.minDias =
			total.minDias === null
				? row.minDias
				: Math.min(total.minDias, row.minDias);
		total.maxDias =
			total.maxDias === null
				? row.maxDias
				: Math.max(total.maxDias, row.maxDias);
		totals.set(tipoCanal, total);
	}

	return CHANNEL_TYPE_ORDER.flatMap((tipoCanal) => {
		const total = totals.get(tipoCanal);
		if (!total) return [];
		return [
			{
				tipoCanal,
				totalCreditos: total.totalCreditos,
				avgDias:
					total.totalCreditos > 0
						? Math.round((total.totalDias * 10) / total.totalCreditos) / 10
						: 0,
				minDias: total.minDias ?? 0,
				maxDias: total.maxDias ?? 0,
			},
		];
	});
}

function parseGuatemalaDateRange(startDate: string, endDate: string) {
	const start = new Date(`${startDate}T00:00:00.000-06:00`);
	const end = new Date(`${endDate}T23:59:59.999-06:00`);

	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
		throw new ORPCError("BAD_REQUEST", { message: "Rango de fechas inválido" });
	}

	if (start > end) {
		throw new ORPCError("BAD_REQUEST", {
			message: "La fecha inicial no puede ser mayor que la fecha final",
		});
	}

	const startDay = new Date(`${startDate}T00:00:00.000-06:00`);
	const endDay = new Date(`${endDate}T00:00:00.000-06:00`);
	const inclusiveDays =
		Math.floor((endDay.getTime() - startDay.getTime()) / 86_400_000) + 1;

	if (inclusiveDays > 366) {
		throw new ORPCError("BAD_REQUEST", {
			message: "El rango máximo permitido es de 366 días",
		});
	}

	return { start, end };
}

/**
 * Dashboard Ejecutivo
 * KPIs principales del negocio
 */
export const getDashboardExecutivo = protectedProcedure
	.input(dateRangeSchema)
	.handler(async () => {
		// KPI 1: Cartera total activa
		const carteraActiva = await db
			.select({
				totalContratos: count(contratosFinanciamiento.id),
				montoTotal: sum(contratosFinanciamiento.montoFinanciado),
			})
			.from(contratosFinanciamiento)
			.where(eq(contratosFinanciamiento.estado, "activo"));

		// KPI 2: Morosidad
		const morosidad = await db
			.select({
				estadoMora: cuotasPago.estadoMora,
				totalCuotas: count(cuotasPago.id),
				montoTotal: sum(cuotasPago.montoCuota),
			})
			.from(cuotasPago)
			.groupBy(cuotasPago.estadoMora);

		// KPI 3: Casos de cobros activos
		const casosActivos = await db
			.select({
				estadoMora: casosCobros.estadoMora,
				totalCasos: count(casosCobros.id),
				montoEnMora: sum(casosCobros.montoEnMora),
			})
			.from(casosCobros)
			.where(eq(casosCobros.activo, true))
			.groupBy(casosCobros.estadoMora);

		// KPI 4: Contratos por estado
		const contratosPorEstado = await db
			.select({
				estado: contratosFinanciamiento.estado,
				total: count(contratosFinanciamiento.id),
				monto: sum(contratosFinanciamiento.montoFinanciado),
			})
			.from(contratosFinanciamiento)
			.groupBy(contratosFinanciamiento.estado);

		// KPI 5: Pipeline de ventas
		const pipeline = await db
			.select({
				etapa: salesStages.name,
				order: salesStages.order,
				totalOportunidades: count(opportunities.id),
				valorTotal: sum(opportunities.value),
			})
			.from(opportunities)
			.leftJoin(salesStages, eq(opportunities.stageId, salesStages.id))
			.where(eq(opportunities.status, "open"))
			.groupBy(salesStages.name, salesStages.order)
			.orderBy(salesStages.order);

		// KPI 6: Conversión de leads
		const leadsStats = await db
			.select({
				status: leads.status,
				total: count(leads.id),
			})
			.from(leads)
			.groupBy(leads.status);

		// KPI 7: Nuevos contratos (últimos 6 meses)
		const seisMonthsAgo = new Date();
		seisMonthsAgo.setMonth(seisMonthsAgo.getMonth() - 6);

		const nuevosContratos = await db
			.select({
				mes: sql<string>`TO_CHAR(${contratosFinanciamiento.fechaInicio}, 'YYYY-MM')`,
				total: count(contratosFinanciamiento.id),
				monto: sum(contratosFinanciamiento.montoFinanciado),
			})
			.from(contratosFinanciamiento)
			.where(gte(contratosFinanciamiento.fechaInicio, seisMonthsAgo))
			.groupBy(sql`TO_CHAR(${contratosFinanciamiento.fechaInicio}, 'YYYY-MM')`)
			.orderBy(sql`TO_CHAR(${contratosFinanciamiento.fechaInicio}, 'YYYY-MM')`);

		return {
			carteraActiva: {
				totalContratos: carteraActiva[0]?.totalContratos || 0,
				montoTotal: carteraActiva[0]?.montoTotal || "0",
			},
			morosidad,
			casosActivos,
			contratosPorEstado,
			pipeline,
			leadsStats,
			nuevosContratos,
		};
	});

/**
 * Reporte de créditos cerrados
 * Oportunidades ganadas (status = 'won'), filtradas por la fecha en que se
 * cerraron (actualCloseDate) dentro del mes seleccionado. Paginado del lado del
 * servidor; sin `pageSize` se devuelven todas las filas del mes (exportación).
 */
export const getReporteCreditosCerrados = closedCreditsReportProcedure
	.input(creditosCerradosInputSchema)
	.handler(async ({ input }) => {
		const { startOfMonth, endOfMonth } = getGuatemalaMonthWindow(
			input.anio,
			input.mes,
		);

		// Cuota del crédito = monthlyPayment de la cotización enlazada a la
		// oportunidad. Si hay varias, se prefiere la aceptada y luego la más reciente.
		const latestQuotation = db
			.select({
				opportunityId: quotations.opportunityId,
				monthlyPayment: quotations.monthlyPayment,
				rn: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${quotations.opportunityId} ORDER BY (${quotations.status} = 'accepted') DESC, ${quotations.createdAt} DESC)`.as(
					"rn_quot",
				),
			})
			.from(quotations)
			.as("latest_quotation");

		// Número SIFCO: referencia de cartera más reciente; fallback al de la opp.
		const latestCarteraReference = db
			.select({
				opportunityId: carteraBackReferences.opportunityId,
				numeroCreditoSifco: carteraBackReferences.numeroCreditoSifco,
				rn: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${carteraBackReferences.opportunityId} ORDER BY ${carteraBackReferences.createdAt} DESC, ${carteraBackReferences.id} DESC)`.as(
					"rn_cart",
				),
			})
			.from(carteraBackReferences)
			.as("latest_cartera_reference");

		// Cliente por oportunidad (deduplicado) — solo para el nombre de respaldo.
		// Garantiza una fila por oportunidad (evita multiplicar el conteo/paginado).
		const latestClient = db
			.select({
				opportunityId: clients.opportunityId,
				contactPerson: clients.contactPerson,
				rn: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${clients.opportunityId} ORDER BY ${clients.createdAt} DESC, ${clients.id} DESC)`.as(
					"rn_cli",
				),
			})
			.from(clients)
			.as("latest_client");

		const whereClause = and(
			eq(opportunities.status, "won"),
			gte(opportunities.actualCloseDate, startOfMonth),
			lt(opportunities.actualCloseDate, endOfMonth),
		);

		const baseQuery = db
			.select({
				id: opportunities.id,
				clienteNombre: sql<string>`COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ${leads.firstName}, ${leads.middleName}, ${leads.lastName}, ${leads.secondLastName})), ''), ${latestClient.contactPerson}, '')`,
				numeroSifco: sql<string>`COALESCE(${latestCarteraReference.numeroCreditoSifco}, ${opportunities.numeroSifco}, '')`,
				cuotaSeguro: opportunities.seguro,
				insuranceProvider: opportunities.insuranceProvider,
				montoCredito: opportunities.value,
				// Cuota de la cotización; si no hay cotización enlazada, se usa la
				// cuota mensual guardada en la oportunidad (el flujo de cierre usa
				// esa cuando no encuentra cotización).
				cuotaCredito: sql<
					string | null
				>`COALESCE(${latestQuotation.monthlyPayment}, ${opportunities.cuotaMensual})`,
				fechaCierre: opportunities.actualCloseDate,
				// Día del mes en que paga (1-31), tomado de la oportunidad.
				diaPago: opportunities.diaPagoMensual,
			})
			.from(opportunities)
			.leftJoin(leads, eq(opportunities.leadId, leads.id))
			.leftJoin(
				latestClient,
				and(
					eq(latestClient.opportunityId, opportunities.id),
					eq(latestClient.rn, 1),
				),
			)
			.leftJoin(
				latestCarteraReference,
				and(
					eq(latestCarteraReference.opportunityId, opportunities.id),
					eq(latestCarteraReference.rn, 1),
				),
			)
			.leftJoin(
				latestQuotation,
				and(
					eq(latestQuotation.opportunityId, opportunities.id),
					eq(latestQuotation.rn, 1),
				),
			)
			.where(whereClause)
			.orderBy(desc(opportunities.actualCloseDate));

		const rows = input.pageSize
			? await baseQuery
					.limit(input.pageSize)
					.offset(((input.page ?? 1) - 1) * input.pageSize)
			: await baseQuery;

		// Conteo total independiente de la página. Cada oportunidad produce
		// exactamente una fila (los joins están deduplicados a rn=1), así que
		// contar oportunidades que cumplen el filtro = total real. Con esto, una
		// página fuera de rango (datos borrados o page stale) deja de reportar 0.
		const totalResult = await db
			.select({ total: count() })
			.from(opportunities)
			.where(whereClause);
		const total = totalResult[0]?.total ?? 0;

		// Solo la exportación (sin paginar) puede traer todo; ahí aplicamos el tope.
		if (!input.pageSize) {
			enforceClosedCreditReportLimit(rows);
		}

		return {
			rows,
			total,
			page: input.page ?? 1,
			pageSize: input.pageSize ?? total,
		};
	});

/**
 * Reporte de Cobranza
 * Análisis detallado de la gestión de cobros
 */
export const getReporteCobranza = protectedProcedure
	.input(dateRangeSchema)
	.handler(async () => {
		// Casos activos por responsable
		const casosPorResponsable = await db
			.select({
				responsable: casosCobros.responsableCobros,
				totalCasos: count(casosCobros.id),
				montoTotal: sum(casosCobros.montoEnMora),
			})
			.from(casosCobros)
			.where(eq(casosCobros.activo, true))
			.groupBy(casosCobros.responsableCobros);

		// Top 10 casos con mayor mora
		const top10Mora = await db
			.select({
				casoId: casosCobros.id,
				contratoId: casosCobros.contratoId,
				estadoMora: casosCobros.estadoMora,
				montoEnMora: casosCobros.montoEnMora,
				diasMora: casosCobros.diasMoraMaximo,
				cuotasVencidas: casosCobros.cuotasVencidas,
				responsable: casosCobros.responsableCobros,
				clienteNombre: clients.contactPerson,
			})
			.from(casosCobros)
			.leftJoin(
				contratosFinanciamiento,
				eq(casosCobros.contratoId, contratosFinanciamiento.id),
			)
			.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
			.where(eq(casosCobros.activo, true))
			.orderBy(sql`${casosCobros.montoEnMora} DESC`)
			.limit(10);

		// Distribución por estado de mora
		const distribucionMora = await db
			.select({
				estadoMora: casosCobros.estadoMora,
				totalCasos: count(casosCobros.id),
				montoTotal: sum(casosCobros.montoEnMora),
			})
			.from(casosCobros)
			.where(eq(casosCobros.activo, true))
			.groupBy(casosCobros.estadoMora);

		// Estadísticas de cuotas
		const estadisticasCuotas = await db
			.select({
				estadoMora: cuotasPago.estadoMora,
				totalCuotas: count(cuotasPago.id),
				montoCuotas: sum(cuotasPago.montoCuota),
				montoMoraAcumulado: sum(cuotasPago.montoMora),
			})
			.from(cuotasPago)
			.groupBy(cuotasPago.estadoMora);

		return {
			casosPorResponsable,
			top10Mora,
			distribucionMora,
			estadisticasCuotas,
		};
	});

/**
 * Reporte de Cartera de Créditos
 * Análisis financiero de la cartera
 */
export const getReporteCartera = protectedProcedure
	.input(dateRangeSchema)
	.handler(async () => {
		// Resumen general de cartera
		const resumenCartera = await db
			.select({
				estado: contratosFinanciamiento.estado,
				totalContratos: count(contratosFinanciamiento.id),
				montoFinanciado: sum(contratosFinanciamiento.montoFinanciado),
				tasaInteresPromedio: sql<string>`AVG(${contratosFinanciamiento.tasaInteres})`,
			})
			.from(contratosFinanciamiento)
			.groupBy(contratosFinanciamiento.estado);

		// Distribución por plazo
		const distribucionPlazo = await db
			.select({
				plazo: contratosFinanciamiento.numeroCuotas,
				total: count(contratosFinanciamiento.id),
				montoTotal: sum(contratosFinanciamiento.montoFinanciado),
			})
			.from(contratosFinanciamiento)
			.where(eq(contratosFinanciamiento.estado, "activo"))
			.groupBy(contratosFinanciamiento.numeroCuotas)
			.orderBy(contratosFinanciamiento.numeroCuotas);

		// Cuotas pagadas vs pendientes
		const estadoCuotas = await db
			.select({
				contratoId: cuotasPago.contratoId,
				totalCuotas: count(cuotasPago.id),
				cuotasPagadas: sql<number>`COUNT(CASE WHEN ${cuotasPago.estadoMora} = 'pagado' THEN 1 END)`,
				cuotasPendientes: sql<number>`COUNT(CASE WHEN ${cuotasPago.estadoMora} != 'pagado' THEN 1 END)`,
				montoPagado: sql<string>`SUM(COALESCE(${cuotasPago.montoPagado}, 0))`,
				montoPendiente: sql<string>`SUM(CASE WHEN ${cuotasPago.estadoMora} != 'pagado' THEN ${cuotasPago.montoCuota} ELSE 0 END)`,
			})
			.from(cuotasPago)
			.groupBy(cuotasPago.contratoId);

		// Contratos por tipo de crédito
		const contratosPorTipo = await db
			.select({
				tipoCredito: opportunities.creditType,
				total: count(contratosFinanciamiento.id),
				montoTotal: sum(contratosFinanciamiento.montoFinanciado),
			})
			.from(contratosFinanciamiento)
			.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
			.leftJoin(opportunities, eq(clients.opportunityId, opportunities.id))
			.groupBy(opportunities.creditType);

		return {
			resumenCartera,
			distribucionPlazo,
			estadoCuotas,
			contratosPorTipo,
		};
	});

/**
 * Reporte de Inventario de Vehículos
 */
export const getReporteInventario = protectedProcedure.handler(async () => {
	// Vehículos por estado
	const vehiculosPorEstado = await db
		.select({
			estado: vehicles.status,
			total: count(vehicles.id),
		})
		.from(vehicles)
		.groupBy(vehicles.status);

	// Vehículos con GPS activo/inactivo
	const estadoGPS = await db
		.select({
			gpsActivo: vehicles.gpsActivo,
			total: count(vehicles.id),
		})
		.from(vehicles)
		.groupBy(vehicles.gpsActivo);

	// Vehículos con seguro vigente
	const estadoSeguro = await db
		.select({
			seguroVigente: vehicles.seguroVigente,
			total: count(vehicles.id),
		})
		.from(vehicles)
		.groupBy(vehicles.seguroVigente);

	// Inspecciones por resultado
	const inspeccionesPorResultado = await db
		.select({
			status: vehicleInspections.status,
			vehicleRating: vehicleInspections.vehicleRating,
			total: count(vehicleInspections.id),
		})
		.from(vehicleInspections)
		.groupBy(vehicleInspections.status, vehicleInspections.vehicleRating);

	return {
		vehiculosPorEstado,
		estadoGPS,
		estadoSeguro,
		inspeccionesPorResultado,
	};
});

const CLOSED_STAGE_THRESHOLD = 90;
const MAX_REPORT_ROWS = 10_000;

type PorcentajeEfectividadFuenteBaseRow = {
	source: string;
	totalOportunidades: number;
	totalCerradas: number;
	porcentaje: number;
};

type PorcentajeEfectividadCierrePeriodoFuenteRow = {
	source: string;
	totalCierresPeriodo: number;
};

export function buildPorcentajeEfectividadFuenteRows(
	cohortRows: PorcentajeEfectividadFuenteBaseRow[],
	periodCloseRows: PorcentajeEfectividadCierrePeriodoFuenteRow[],
) {
	const bySource = new Map<
		string,
		PorcentajeEfectividadFuenteBaseRow & { totalCierresPeriodo: number }
	>();

	for (const row of cohortRows) {
		bySource.set(row.source, {
			source: row.source,
			totalOportunidades: row.totalOportunidades,
			totalCerradas: row.totalCerradas ?? 0,
			totalCierresPeriodo: 0,
			porcentaje: row.porcentaje ?? 0,
		});
	}

	for (const row of periodCloseRows) {
		const current = bySource.get(row.source) ?? {
			source: row.source,
			totalOportunidades: 0,
			totalCerradas: 0,
			totalCierresPeriodo: 0,
			porcentaje: 0,
		};
		current.totalCierresPeriodo = row.totalCierresPeriodo ?? 0;
		bySource.set(row.source, current);
	}

	return [...bySource.values()].sort((a, b) => {
		if (b.totalOportunidades !== a.totalOportunidades) {
			return b.totalOportunidades - a.totalOportunidades;
		}
		if (b.totalCierresPeriodo !== a.totalCierresPeriodo) {
			return b.totalCierresPeriodo - a.totalCierresPeriodo;
		}
		return a.source.localeCompare(b.source);
	});
}
/**
 * Reporte Porcentaje Efectividad
 * Tasa de conversión de oportunidades a créditos cerrados, por fuente.
 */
export const getReportePorcentajeEfectividad =
	porcentajeEfectividadReportProcedure
		.input(closedCreditsReportInputSchema)
		.handler(async ({ input }) => {
			const { start, end } = parseGuatemalaDateRange(
				input.startDate,
				input.endDate,
			);

			// Sin filtro de fechas intencional: la cohorte es "creadas en el período,
			// ¿alguna vez cerraron?", no "creadas y cerradas dentro del mismo período".
			const everClosed = db
				.select({ opportunityId: opportunityStageHistory.opportunityId })
				.from(opportunityStageHistory)
				.innerJoin(
					salesStages,
					eq(opportunityStageHistory.toStageId, salesStages.id),
				)
				.where(gte(salesStages.closurePercentage, CLOSED_STAGE_THRESHOLD))
				.groupBy(opportunityStageHistory.opportunityId)
				.as("ever_closed");

			const firstClosedStageDates = db
				.select({
					opportunityId: opportunityStageHistory.opportunityId,
					firstClosedStageAt:
						sql<Date>`MIN(${opportunityStageHistory.changedAt})`.as(
							"first_closed_stage_at",
						),
				})
				.from(opportunityStageHistory)
				.innerJoin(
					salesStages,
					eq(opportunityStageHistory.toStageId, salesStages.id),
				)
				.where(gte(salesStages.closurePercentage, CLOSED_STAGE_THRESHOLD))
				.groupBy(opportunityStageHistory.opportunityId)
				.as("first_closed_stage_dates");

			const baseWhere = and(
				gte(opportunities.createdAt, start),
				lte(opportunities.createdAt, end),
				ne(opportunities.status, MIGRATED_OPPORTUNITY_STATUS),
			);

			const totalCerradas = sql<number>`COUNT(${everClosed.opportunityId})`;
			const porcentaje = sql<number>`ROUND(COUNT(${everClosed.opportunityId}) * 100.0 / NULLIF(COUNT(${opportunities.id}), 0), 1)`;

			const [
				totalRows,
				periodCloseRows,
				porFuente,
				cierresPeriodoPorFuente,
				registrosRaw,
			] = await Promise.all([
				db
					.select({
						totalOportunidades: count(opportunities.id),
						totalCerradas,
						porcentaje,
					})
					.from(opportunities)
					.leftJoin(everClosed, eq(opportunities.id, everClosed.opportunityId))
					.where(baseWhere),

				db
					.select({ totalCierresPeriodo: count(opportunities.id) })
					.from(firstClosedStageDates)
					.innerJoin(
						opportunities,
						eq(firstClosedStageDates.opportunityId, opportunities.id),
					)
					.where(
						and(
							gte(firstClosedStageDates.firstClosedStageAt, start),
							lte(firstClosedStageDates.firstClosedStageAt, end),
							ne(opportunities.status, MIGRATED_OPPORTUNITY_STATUS),
						),
					),

				db
					.select({
						source: sql<string>`COALESCE(${opportunities.source}, 'other')`,
						totalOportunidades: count(opportunities.id),
						totalCerradas,
						porcentaje,
					})
					.from(opportunities)
					.leftJoin(everClosed, eq(opportunities.id, everClosed.opportunityId))
					.where(baseWhere)
					.groupBy(sql`COALESCE(${opportunities.source}, 'other')`)
					.orderBy(desc(count(opportunities.id))),

				db
					.select({
						source: sql<string>`COALESCE(${opportunities.source}, 'other')`,
						totalCierresPeriodo: count(opportunities.id),
					})
					.from(firstClosedStageDates)
					.innerJoin(
						opportunities,
						eq(firstClosedStageDates.opportunityId, opportunities.id),
					)
					.where(
						and(
							gte(firstClosedStageDates.firstClosedStageAt, start),
							lte(firstClosedStageDates.firstClosedStageAt, end),
							ne(opportunities.status, MIGRATED_OPPORTUNITY_STATUS),
						),
					)
					.groupBy(sql`COALESCE(${opportunities.source}, 'other')`),

				db
					.select({
						id: opportunities.id,
						createdAt: opportunities.createdAt,
						source: sql<string>`COALESCE(${opportunities.source}, 'other')`,
						nombre: sql<
							string | null
						>`NULLIF(TRIM(CONCAT_WS(' ', ${leads.firstName}, ${leads.lastName})), '')`,
						etapaNombre: salesStages.name,
						etapaPorcentaje: salesStages.closurePercentage,
						cerro: sql<boolean>`(${everClosed.opportunityId} IS NOT NULL)`,
					})
					.from(opportunities)
					.leftJoin(leads, eq(opportunities.leadId, leads.id))
					.leftJoin(salesStages, eq(opportunities.stageId, salesStages.id))
					.leftJoin(everClosed, eq(opportunities.id, everClosed.opportunityId))
					.where(baseWhere)
					.orderBy(desc(opportunities.createdAt))
					.limit(MAX_REPORT_ROWS + 1),
			]);

			if (registrosRaw.length > MAX_REPORT_ROWS) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"El rango seleccionado devuelve demasiados registros. Reduce el rango de fechas.",
				});
			}

			const porFuenteRows = buildPorcentajeEfectividadFuenteRows(
				porFuente.map((row) => ({
					source: row.source,
					totalOportunidades: row.totalOportunidades,
					totalCerradas: row.totalCerradas ?? 0,
					porcentaje: row.porcentaje ?? 0,
				})),
				cierresPeriodoPorFuente.map((row) => ({
					source: row.source,
					totalCierresPeriodo: row.totalCierresPeriodo,
				})),
			);

			return {
				total: {
					totalOportunidades: totalRows[0]?.totalOportunidades ?? 0,
					totalCerradas: totalRows[0]?.totalCerradas ?? 0,
					totalCierresPeriodo: periodCloseRows[0]?.totalCierresPeriodo ?? 0,
					porcentaje: totalRows[0]?.porcentaje ?? 0,
				},
				porFuente: porFuenteRows,
				porTipoCanal: aggregateEfectividadPorTipoCanal(porFuenteRows),
				registros: registrosRaw.map((row) => ({
					id: row.id,
					createdAt: row.createdAt,
					source: row.source,
					nombre: row.nombre,
					etapaNombre: row.etapaNombre,
					etapaPorcentaje: row.etapaPorcentaje,
					cerro: row.cerro,
				})),
			};
		});

/**
 * Reporte de Tiempo de Cierre de Crédito
 * Días desde la creación del prospecto hasta que la oportunidad alcanza etapa 90%+
 * Desglosado por fuente (total y por fuente)
 */
export const getReporteTiempoCierre = tiempoCierreReportProcedure
	.input(closedCreditsReportInputSchema)
	.handler(async ({ input }) => {
		const { start, end } = parseGuatemalaDateRange(
			input.startDate,
			input.endDate,
		);

		const firstClosedStageDates = db
			.select({
				opportunityId: opportunityStageHistory.opportunityId,
				firstClosedStageAt:
					sql<Date>`MIN(${opportunityStageHistory.changedAt})`.as(
						"first_closed_stage_at",
					),
			})
			.from(opportunityStageHistory)
			.innerJoin(
				salesStages,
				eq(opportunityStageHistory.toStageId, salesStages.id),
			)
			.where(gte(salesStages.closurePercentage, CLOSED_STAGE_THRESHOLD))
			.groupBy(opportunityStageHistory.opportunityId)
			.as("first_closed_stage_dates");

		// Fallback a opportunities.createdAt cuando leadId es null (oportunidades
		// vinculadas directamente a empresa sin prospecto previo).
		const diasDesdeCreacionBase = sql<number>`EXTRACT(EPOCH FROM (${firstClosedStageDates.firstClosedStageAt} - COALESCE(${leads.createdAt}, ${opportunities.createdAt}))) / ${SECONDS_PER_DAY}`;
		const diasDesdeCreacion = (fn: "AVG" | "MIN" | "MAX") =>
			sql<number>`ROUND(${sql.raw(fn)}(${diasDesdeCreacionBase}), 1)`;

		const baseWhere = and(
			gte(firstClosedStageDates.firstClosedStageAt, start),
			lte(firstClosedStageDates.firstClosedStageAt, end),
		);

		const [totalRows, porFuente] = await Promise.all([
			db
				.select({
					totalCreditos: count(),
					avgDias: diasDesdeCreacion("AVG"),
					minDias: diasDesdeCreacion("MIN"),
					maxDias: diasDesdeCreacion("MAX"),
				})
				.from(firstClosedStageDates)
				.innerJoin(
					opportunities,
					eq(firstClosedStageDates.opportunityId, opportunities.id),
				)
				.leftJoin(leads, eq(opportunities.leadId, leads.id))
				.where(baseWhere),
			db
				.select({
					source: sql<string>`COALESCE(${opportunities.source}, 'other')`,
					totalCreditos: count(),
					avgDias: diasDesdeCreacion("AVG"),
					minDias: diasDesdeCreacion("MIN"),
					maxDias: diasDesdeCreacion("MAX"),
					totalDias: sql<number>`SUM(${diasDesdeCreacionBase})`,
				})
				.from(firstClosedStageDates)
				.innerJoin(
					opportunities,
					eq(firstClosedStageDates.opportunityId, opportunities.id),
				)
				.leftJoin(leads, eq(opportunities.leadId, leads.id))
				.where(baseWhere)
				.groupBy(sql`COALESCE(${opportunities.source}, 'other')`)
				.orderBy(desc(count())),
		]);

		const porFuenteRows = porFuente.map((row) => ({
			source: row.source,
			totalCreditos: row.totalCreditos,
			avgDias: row.avgDias ?? 0,
			totalDias: row.totalDias ?? 0,
			minDias: row.minDias ?? 0,
			maxDias: row.maxDias ?? 0,
		}));

		return {
			total: {
				totalCreditos: totalRows[0]?.totalCreditos ?? 0,
				avgDias: totalRows[0]?.avgDias ?? 0,
				minDias: totalRows[0]?.minDias ?? 0,
				maxDias: totalRows[0]?.maxDias ?? 0,
			},
			porFuente: porFuenteRows,
			porTipoCanal: aggregateTiempoCierrePorTipoCanal(porFuenteRows),
		};
	});

/**
 * Reporte de Subastas
 */
export const getReporteSubastas = protectedProcedure.handler(async () => {
	// Resumen de subastas
	const resumenSubastas = await db
		.select({
			status: auctionVehicles.status,
			total: count(auctionVehicles.id),
			valorMercado: sum(auctionVehicles.marketValue),
			precioSubasta: sum(auctionVehicles.auctionPrice),
			perdidaTotal: sum(auctionVehicles.lossValue),
		})
		.from(auctionVehicles)
		.groupBy(auctionVehicles.status);

	return {
		resumenSubastas,
	};
});

/**
 * Reporte de Meta de Colocación vs Real
 * Compara la meta mensual de colocación con lo efectivamente colocado,
 * desglosado por colaborador (assigned_to del opportunity).
 */
export const getReporteMetaColocacion = metaColocacionReportProcedure
	.input(
		z.object({
			anio: z.number().min(2024).max(2100),
			mes: z.number().min(1).max(12),
		}),
	)
	.handler(async ({ input }) => {
		const { anio, mes } = input;
		const { startOfMonth, endOfMonth } = getGuatemalaMonthWindow(anio, mes);

		const [metaRow, porColaboradorRows] = await Promise.all([
			db
				.select({ monto: metasMensuales.monto })
				.from(metasMensuales)
				.where(
					and(
						eq(metasMensuales.tipo, "colocacion"),
						eq(metasMensuales.anio, anio),
						eq(metasMensuales.mes, mes),
					),
				)
				.limit(1),

			db.execute(sql`
				WITH placed_stage_ids AS (
					SELECT id
					FROM sales_stages
					WHERE closure_percentage >= 90
				), moved_to_placed_this_month AS (
					SELECT
						DISTINCT osh.opportunity_id
					FROM opportunity_stage_history osh
					WHERE osh.to_stage_id IN (SELECT id FROM placed_stage_ids)
						AND osh.changed_at >= ${startOfMonth}
						AND osh.changed_at < ${endOfMonth}
				), already_placed_before AS (
					SELECT DISTINCT osh.opportunity_id
					FROM opportunity_stage_history osh
					WHERE osh.opportunity_id IN (
						SELECT opportunity_id FROM moved_to_placed_this_month
					)
						AND osh.to_stage_id IN (SELECT id FROM placed_stage_ids)
						AND osh.changed_at < ${startOfMonth}
				), placed_this_month AS (
					SELECT opportunity_id FROM moved_to_placed_this_month
					EXCEPT
					SELECT opportunity_id FROM already_placed_before
				)
				SELECT
					o.assigned_to AS user_id,
					u.name AS nombre,
					COUNT(o.id)::int AS creditos,
					COALESCE(SUM(o.value::numeric), 0) AS monto
				FROM placed_this_month ptm
				JOIN opportunities o ON o.id = ptm.opportunity_id
				LEFT JOIN "user" u ON u.id = o.assigned_to
				WHERE o.status != 'migrate'
					AND o.stage_id IN (SELECT id FROM placed_stage_ids)
				GROUP BY o.assigned_to, u.name
				ORDER BY monto DESC
			`),
		]);

		const meta = Number(metaRow[0]?.monto ?? 0);
		const rawRows = porColaboradorRows.rows as {
			user_id: string | null;
			nombre: string | null;
			creditos: number;
			monto: string;
		}[];
		const realMonto = rawRows.reduce((acc, r) => acc + Number(r.monto), 0);
		const realCreditos = rawRows.reduce((acc, r) => acc + r.creditos, 0);
		const cobertura = meta > 0 ? (realMonto / meta) * 100 : null;

		const porColaborador = rawRows.map((r) => ({
			userId: r.user_id,
			nombre: r.nombre ?? "Sin asignar",
			creditos: r.creditos,
			monto: Number(r.monto).toFixed(2),
			pctDelTotal: realMonto > 0 ? (Number(r.monto) / realMonto) * 100 : 0,
		}));

		return {
			meta: meta.toFixed(2),
			realMonto: realMonto.toFixed(2),
			realCreditos,
			cobertura: cobertura !== null ? Number(cobertura.toFixed(1)) : null,
			porColaborador,
		};
	});
