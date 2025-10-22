import { and, between, count, eq, gte, lte, sql, sum } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { auctionVehicles } from "../db/schema/auctionVehicles";
import {
	casosCobros,
	contratosFinanciamiento,
	cuotasPago,
} from "../db/schema/cobros";
import {
	clients,
	companies,
	creditAnalysis,
	leads,
	opportunities,
	salesStages,
} from "../db/schema/crm";
import { vehicleInspections, vehicles } from "../db/schema/vehicles";
import { protectedProcedure } from "../lib/orpc";

// Schema para filtros de fecha
const dateRangeSchema = z.object({
	startDate: z.string().optional(),
	endDate: z.string().optional(),
});

/**
 * Dashboard Ejecutivo
 * KPIs principales del negocio
 */
export const getDashboardExecutivo = protectedProcedure
	.input(dateRangeSchema)
	.handler(async ({ input }) => {
		const startDate = input.startDate ? new Date(input.startDate) : undefined;
		const endDate = input.endDate ? new Date(input.endDate) : undefined;

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
 * Reporte de Cobranza
 * Análisis detallado de la gestión de cobros
 */
export const getReporteCobranza = protectedProcedure
	.input(dateRangeSchema)
	.handler(async ({ input }) => {
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
	.handler(async ({ input }) => {
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
