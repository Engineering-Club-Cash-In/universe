import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, gte, lte, sql, sum } from "drizzle-orm";
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
import { vehicleInspections, vehicles } from "../db/schema/vehicles";
import {
	getGuatemalaMonthWindow,
	toDateStrGT,
} from "../lib/guatemala-month-window";
import {
	closedCreditsReportProcedure,
	metaColocacionReportProcedure,
	porcentajeEfectividadReportProcedure,
	protectedProcedure,
	tiempoCierreReportProcedure,
} from "../lib/orpc";
import { carteraBackClient } from "../services/cartera-back-client";
import type { StatusCreditEnum } from "../types/cartera-back";

const SECONDS_PER_DAY = 60 * 60 * 24;

// Schema para filtros de fecha
const dateRangeSchema = z.object({
	startDate: z.string().optional(),
	endDate: z.string().optional(),
});

const closedCreditsReportInputSchema = z.object({
	startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const CLOSED_CREDIT_REPORT_CARTERA_STATUSES: StatusCreditEnum[] = [
	"ACTIVO",
	"MOROSO",
	"EN_CONVENIO",
];
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

async function getClosedCreditReportCarteraStatuses(sifcos: string[]) {
	const uniqueSifcos = [...new Set(sifcos.filter(Boolean))];
	const statuses = new Map<string, StatusCreditEnum>();
	const [anio, mes] = toDateStrGT(new Date()).split("-").map(Number);

	for (
		let index = 0;
		index < uniqueSifcos.length;
		index += CLOSED_CREDIT_REPORT_CARTERA_STATUS_CHUNK_SIZE
	) {
		const chunk = uniqueSifcos.slice(
			index,
			index + CLOSED_CREDIT_REPORT_CARTERA_STATUS_CHUNK_SIZE,
		);
		const response = await carteraBackClient.getAllCreditos({
			mes,
			anio,
			page: 1,
			perPage: chunk.length,
			numeros_credito_sifco: chunk,
		});

		for (const row of response.data) {
			statuses.set(
				row.creditos.numero_credito_sifco,
				row.creditos.statusCredit,
			);
		}
	}

	return statuses;
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
 * Créditos que llegaron por primera vez a una etapa 90%+.
 */
export const getReporteCreditosCerrados = closedCreditsReportProcedure
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
			.where(gte(salesStages.closurePercentage, 90))
			.groupBy(opportunityStageHistory.opportunityId)
			.as("first_closed_stage_dates");

		const latestCarteraReference = db
			.select({
				opportunityId: carteraBackReferences.opportunityId,
				contratoFinanciamientoId:
					carteraBackReferences.contratoFinanciamientoId,
				numeroCreditoSifco: carteraBackReferences.numeroCreditoSifco,
				rn: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${carteraBackReferences.opportunityId} ORDER BY ${carteraBackReferences.createdAt} DESC, ${carteraBackReferences.id} DESC)`.as(
					"rn",
				),
			})
			.from(carteraBackReferences)
			.as("latest_cartera_reference");

		const rows = await db
			.select({
				placa: vehicles.licensePlate,
				chasis: vehicles.vinNumber,
				cuotaSeguro: opportunities.seguro,
				insuranceProvider: opportunities.insuranceProvider,
				clienteNombre: sql<string>`COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ${leads.firstName}, ${leads.middleName}, ${leads.lastName}, ${leads.secondLastName})), ''), ${clients.contactPerson}, '')`,
				numeroCredito: sql<string>`COALESCE(${latestCarteraReference.numeroCreditoSifco}, ${opportunities.numeroSifco}, '')`,
				fecha90: firstClosedStageDates.firstClosedStageAt,
			})
			.from(firstClosedStageDates)
			.innerJoin(
				opportunities,
				eq(firstClosedStageDates.opportunityId, opportunities.id),
			)
			.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
			.leftJoin(leads, eq(opportunities.leadId, leads.id))
			.leftJoin(clients, eq(clients.opportunityId, opportunities.id))
			.leftJoin(
				latestCarteraReference,
				and(
					eq(latestCarteraReference.opportunityId, opportunities.id),
					eq(latestCarteraReference.rn, 1),
				),
			)
			.innerJoin(
				contratosFinanciamiento,
				eq(
					latestCarteraReference.contratoFinanciamientoId,
					contratosFinanciamiento.id,
				),
			)
			.where(
				and(
					gte(firstClosedStageDates.firstClosedStageAt, start),
					lte(firstClosedStageDates.firstClosedStageAt, end),
				),
			)
			.orderBy(desc(firstClosedStageDates.firstClosedStageAt));

		const carteraStatuses = await getClosedCreditReportCarteraStatuses(
			rows.map((row) => row.numeroCredito),
		);

		const activeRows = rows.filter((row) =>
			isClosedCreditReportCarteraStatusIncluded(
				carteraStatuses.get(row.numeroCredito) ?? null,
			),
		);
		enforceClosedCreditReportLimit(activeRows);

		return activeRows;
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

			const baseWhere = and(
				gte(opportunities.createdAt, start),
				lte(opportunities.createdAt, end),
			);

			const totalCerradas = sql<number>`COUNT(${everClosed.opportunityId})`;
			const porcentaje = sql<number>`ROUND(COUNT(${everClosed.opportunityId}) * 100.0 / NULLIF(COUNT(${opportunities.id}), 0), 1)`;

			const [totalRows, porFuente, registrosRaw] = await Promise.all([
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

			return {
				total: {
					totalOportunidades: totalRows[0]?.totalOportunidades ?? 0,
					totalCerradas: totalRows[0]?.totalCerradas ?? 0,
					porcentaje: totalRows[0]?.porcentaje ?? 0,
				},
				porFuente: porFuente.map((row) => ({
					source: row.source,
					totalOportunidades: row.totalOportunidades,
					totalCerradas: row.totalCerradas ?? 0,
					porcentaje: row.porcentaje ?? 0,
				})),
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
		const diasDesdeCreacion = (fn: "AVG" | "MIN" | "MAX") =>
			sql<number>`ROUND(${sql.raw(fn)}(EXTRACT(EPOCH FROM (${firstClosedStageDates.firstClosedStageAt} - COALESCE(${leads.createdAt}, ${opportunities.createdAt}))) / ${SECONDS_PER_DAY}), 1)`;

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

		return {
			total: {
				totalCreditos: totalRows[0]?.totalCreditos ?? 0,
				avgDias: totalRows[0]?.avgDias ?? 0,
				minDias: totalRows[0]?.minDias ?? 0,
				maxDias: totalRows[0]?.maxDias ?? 0,
			},
			porFuente: porFuente.map((row) => ({
				source: row.source,
				totalCreditos: row.totalCreditos,
				avgDias: row.avgDias ?? 0,
				minDias: row.minDias ?? 0,
				maxDias: row.maxDias ?? 0,
			})),
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
