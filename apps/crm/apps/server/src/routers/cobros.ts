import { ORPCError } from "@orpc/server";
import { and, asc, count, desc, eq, gte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { carteraBackReferences } from "../db/schema/cartera-back";
import {
	casosCobros,
	contactosCobros,
	contratosFinanciamiento,
	conveniosPago,
	estadoContactoEnum,
	estadoMoraEnum,
	metodoContactoEnum,
	recuperacionesVehiculo,
} from "../db/schema/cobros";
import { clients, leads, opportunities, PARENTESCO_VALUES, referenciasLead, salesStages } from "../db/schema/crm";
import { vehicles } from "../db/schema/vehicles";
import {
	cobrosProcedure,
	cobrosSupervisorProcedure,
	crmOrCobrosProcedure,
} from "../lib/orpc";
import { PERMISSIONS } from "../lib/roles";
import { carteraBackClient } from "../services/cartera-back-client";
import {
	createPagoInCarteraBack,
	getCreditoReferenceByNumeroSifco,
	isCarteraBackEnabled,
	isCarteraBackPaymentsEnabled,
} from "../services/cartera-back-integration";
import {
	getUltimasSincronizaciones,
	sincronizarCasosCobros,
} from "../services/sync-casos-cobros";
import type {
	CarteraCuotaCredito,
	CreditoDirectoResponse,
} from "../types/cartera-back";

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Calcula los días de mora exactos basándose en la fecha de vencimiento
 * de la cuota más antigua que está atrasada
 */
function calcularDiasMoraExactos(
	cuotasAtrasadas: CarteraCuotaCredito[],
): number {
	if (!cuotasAtrasadas || cuotasAtrasadas.length === 0) {
		return 0;
	}

	// Encontrar la cuota con fecha de vencimiento más antigua
	const cuotaMasAntigua = cuotasAtrasadas.reduce((antigua, actual) => {
		const fechaAntigua = new Date(antigua.fecha_vencimiento);
		const fechaActual = new Date(actual.fecha_vencimiento);
		return fechaActual < fechaAntigua ? actual : antigua;
	});

	// Calcular días transcurridos desde la fecha de vencimiento
	const fechaVencimiento = new Date(cuotaMasAntigua.fecha_vencimiento);
	const hoy = new Date();
	const diffMs = hoy.getTime() - fechaVencimiento.getTime();
	const diasMora = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	// Retornar 0 si el resultado es negativo (cuota aún no vence)
	return Math.max(0, diasMora);
}

// Helper: Obtener todos los créditos de todos los estados
async function obtenerTodosLosCreditosCarteraBack(params: {
	mes: number;
	anio: number;
	page?: number;
	perPage?: number;
	cuotasAtrasadas?: number;
	estado?:
		| "ACTIVO"
		| "CANCELADO"
		| "INCOBRABLE"
		| "PENDIENTE_CANCELACION"
		| "MOROSO";
	nombre_usuario?: string;
	numero_credito_sifco?: string;
	time?: "WEEK" | "MONTH" | "DUEMONTH" | "TODAY";
	email_cobrador?: string;
}) {
	const estado = params.estado || "ACTIVO";

	const response = await carteraBackClient
		.getAllCreditos({
			mes: params.mes,
			anio: params.anio,
			page: params.page,
			perPage: params.perPage,
			estado: estado,
			...(params.cuotasAtrasadas !== undefined && {
				cuotas_atrasadas: params.cuotasAtrasadas,
			}),
			...(params.nombre_usuario !== undefined &&
				params.nombre_usuario !== "" && {
					nombre_usuario: params.nombre_usuario,
				}),
			...(params.numero_credito_sifco !== undefined &&
				params.numero_credito_sifco !== "" && {
					numero_credito_sifco: params.numero_credito_sifco,
				}),
			...(params.time !== undefined && { time: params.time }),
			...(params.email_cobrador !== undefined &&
				params.email_cobrador !== "" && {
					email_cobrador: params.email_cobrador,
				}),
		})
		.catch((error) => {
			console.error("[Cobros] Error obteniendo créditos:", error);
			// Retornar respuesta vacía si falla
			return {
				data: [],
				page: params.page || 1,
				perPage: params.perPage || 1000,
				totalCount: 0,
				totalPages: 0,
			};
		});

	return {
		data: response.data,
		page: response.page,
		perPage: response.perPage,
		totalCount: response.totalCount,
		totalPages: response.totalPages,
	};
}

/**
 * Verifica si la auto-creación de datos migrate está habilitada
 */
function isAutoMigrateEnabled(): boolean {
	return process.env.ENABLE_AUTO_MIGRATE_OPPORTUNITIES === "true";
}

/**
 * Parsea nombre completo en componentes (firstName, middleName, lastName, secondLastName)
 */
function parseNombreCompleto(nombreCompleto: string | null | undefined): {
	firstName: string;
	middleName: string | null;
	lastName: string;
	secondLastName: string | null;
} {
	if (!nombreCompleto) {
		return {
			firstName: "N/A",
			middleName: null,
			lastName: "N/A",
			secondLastName: null,
		};
	}
	const partes = nombreCompleto.trim().split(/\s+/);
	if (partes.length === 1)
		return {
			firstName: partes[0],
			middleName: null,
			lastName: "N/A",
			secondLastName: null,
		};
	if (partes.length === 2)
		return {
			firstName: partes[0],
			middleName: null,
			lastName: partes[1],
			secondLastName: null,
		};
	if (partes.length === 3)
		return {
			firstName: partes[0],
			middleName: null,
			lastName: partes[1],
			secondLastName: partes[2],
		};
	return {
		firstName: partes[0],
		middleName: partes[1],
		lastName: partes[2],
		secondLastName: partes.slice(3).join(" "),
	};
}

/**
 * Auto-crea lead, vehículo y oportunidad cuando no se encuentra la oportunidad por número SIFCO.
 * Solo se ejecuta si ENABLE_AUTO_MIGRATE_OPPORTUNITIES=true.
 * Retorna los datos creados para que el endpoint los use, o null si no aplica.
 */
async function autoCrearDatosMigrate({
	numeroSifco,
	nombreCliente,
	deudaTotal,
	cuotaMensual,
	diaPagoMensual,
	tipoCredito,
	userId,
}: {
	numeroSifco: string;
	nombreCliente: string;
	deudaTotal: string;
	cuotaMensual: string;
	diaPagoMensual: number | null;
	tipoCredito: string | null;
	userId: string;
}) {
	if (!isAutoMigrateEnabled()) return null;

	console.log(
		`[AutoMigrate] Creando datos migrate para crédito ${numeroSifco}`,
	);

	const nombre = parseNombreCompleto(nombreCliente);

	// Obtener stage antes de la transacción (solo lectura)
	const [defaultStage] = await db
		.select({ id: salesStages.id })
		.from(salesStages)
		.orderBy(desc(salesStages.order))
		.limit(1);

	if (!defaultStage) {
		console.error("[AutoMigrate] No hay etapas de venta configuradas");
		return null;
	}

	const creditType = tipoCredito?.toLowerCase().includes("autocompra")
		? ("autocompra" as const)
		: ("sobre_vehiculo" as const);

	// Transacción atómica: si algo falla, se revierte todo
	const result = await db.transaction(async (tx) => {
		// 1. Crear Lead con solo el nombre, status "migrate"
		const [nuevoLead] = await tx
			.insert(leads)
			.values({
				firstName: nombre.firstName,
				middleName: nombre.middleName,
				lastName: nombre.lastName,
				secondLastName: nombre.secondLastName,
				email: `migrado_${Date.now()}@placeholder.com`,
				source: "other",
				status: "migrate",
				assignedTo: userId,
				createdBy: userId,
				notes: `Creado automáticamente desde Cartera-Back. Crédito SIFCO: ${numeroSifco}`,
			})
			.returning({ id: leads.id });

		// 2. Crear Vehículo con datos nulos, status "sold"
		const [nuevoVehiculo] = await tx
			.insert(vehicles)
			.values({
				make: "N/A",
				model: "N/A",
				year: 2000,
				color: "N/A",
				vehicleType: "N/A",
				status: "sold",
			})
			.returning({ id: vehicles.id });

		// 3. Crear Oportunidad enlazando lead y vehículo
		await tx.insert(opportunities).values({
			title: `Crédito ${numeroSifco}`,
			leadId: nuevoLead.id,
			vehicleId: nuevoVehiculo.id,
			creditType,
			stageId: defaultStage.id,
			assignedTo: userId,
			createdBy: userId,
			status: "migrate",
			numeroSifco,
			diaPagoMensual: diaPagoMensual,
			cuotaMensual: cuotaMensual,
			value: deudaTotal,
			notes: "Crédito migrado automáticamente desde Cartera-Back.",
		});

		return { leadId: nuevoLead.id, vehiculoId: nuevoVehiculo.id };
	});

	console.log(
		`[AutoMigrate] Datos creados exitosamente para crédito ${numeroSifco} (lead: ${result.leadId}, vehiculo: ${result.vehiculoId})`,
	);

	return {
		leadId: result.leadId,
		vehiculoId: result.vehiculoId,
		leadInfo: {
			nombre: `${nombre.firstName} ${nombre.lastName}`.trim(),
			email: null as string | null,
			telefono: null as string | null,
		},
		vehiculo: {
			make: "N/A" as string | null,
			model: "N/A" as string | null,
			year: 2000 as number | null,
			licensePlate: null as string | null,
			tipo: null as string | null,
			motor: null as string | null,
			chasis: null as string | null,
			asientos: null as number | null,
			uso: null as string | null,
			numeroPoliza: null as string | null,
			fechaInicioSeguro: null as Date | null,
			fechaVencimientoSeguro: null as Date | null,
			montoAsegurado: null as string | null,
		},
		oportunidadData: {
			notes: null as string | null,
			cuotaMensual: cuotaMensual,
			diaPago: diaPagoMensual,
			creditType: creditType as string | null,
		},
	};
}

export const cobrosRouter = {
	// Dashboard de cobros - Vista general del embudo
	getDashboardStats: cobrosProcedure
		.input(
			z
				.object({
					emailCobrador: z.string().optional(),
				})
				.optional(),
		)
		.handler(async ({ input, context }) => {
			// Si la integración con Cartera-Back está habilitada, usar el endpoint de stats
			if (isCarteraBackEnabled()) {
				try {
					console.log(
						`[Cobros] Obteniendo stats desde Cartera-Back endpoint /stats${input?.emailCobrador ? `?email=${input.emailCobrador}` : ""}`,
					);

					// Usar el nuevo endpoint de stats de cartera-back
					const statsResponse = await carteraBackClient.getStats({
						email: input?.emailCobrador,
					});

					// Mapear cuotas atrasadas a estados de mora - usar datos exactos de cartera
					const estatusStats = [
						{
							estadoMora: "al_dia",
							totalCases: statsResponse.porCuotasAtrasadas["0"]?.cantidad || 0,
							montoTotal:
								statsResponse.porCuotasAtrasadas["0"]?.sumaMora || "0",
							sumaCapital:
								statsResponse.porCuotasAtrasadas["0"]?.sumaCapital || "0",
							porcentaje:
								statsResponse.porCuotasAtrasadas["0"]?.porcentaje || "0",
						},
						{
							estadoMora: "mora_30",
							totalCases: statsResponse.porCuotasAtrasadas["1"]?.cantidad || 0,
							montoTotal:
								statsResponse.porCuotasAtrasadas["1"]?.sumaMora || "0",
							sumaCapital:
								statsResponse.porCuotasAtrasadas["1"]?.sumaCapital || "0",
							porcentaje:
								statsResponse.porCuotasAtrasadas["1"]?.porcentaje || "0",
						},
						{
							estadoMora: "mora_60",
							totalCases: statsResponse.porCuotasAtrasadas["2"]?.cantidad || 0,
							montoTotal:
								statsResponse.porCuotasAtrasadas["2"]?.sumaMora || "0",
							sumaCapital:
								statsResponse.porCuotasAtrasadas["2"]?.sumaCapital || "0",
							porcentaje:
								statsResponse.porCuotasAtrasadas["2"]?.porcentaje || "0",
						},
						{
							estadoMora: "mora_90",
							totalCases: statsResponse.porCuotasAtrasadas["3"]?.cantidad || 0,
							montoTotal:
								statsResponse.porCuotasAtrasadas["3"]?.sumaMora || "0",
							sumaCapital:
								statsResponse.porCuotasAtrasadas["3"]?.sumaCapital || "0",
							porcentaje:
								statsResponse.porCuotasAtrasadas["3"]?.porcentaje || "0",
						},
						{
							estadoMora: "mora_120",
							totalCases: statsResponse.porCuotasAtrasadas["4"]?.cantidad || 0,
							montoTotal:
								statsResponse.porCuotasAtrasadas["4"]?.sumaMora || "0",
							sumaCapital:
								statsResponse.porCuotasAtrasadas["4"]?.sumaCapital || "0",
							porcentaje:
								statsResponse.porCuotasAtrasadas["4"]?.porcentaje || "0",
						},
						{
							estadoMora: "completado",
							totalCases: statsResponse.porEstado.cancelado?.cantidad || 0,
							montoTotal: statsResponse.porEstado.cancelado?.sumaMora || "0",
							sumaCapital:
								statsResponse.porEstado.cancelado?.sumaCapital || "0",
							porcentaje: statsResponse.porEstado.cancelado?.porcentaje || "0",
						},
						{
							estadoMora: "incobrable",
							totalCases: statsResponse.porEstado.incobrable?.cantidad || 0,
							montoTotal: statsResponse.porEstado.incobrable?.sumaMora || "0",
							sumaCapital:
								statsResponse.porEstado.incobrable?.sumaCapital || "0",
							porcentaje: statsResponse.porEstado.incobrable?.porcentaje || "0",
						},
					];

					console.log(
						"[Cobros] Stats obtenidas desde endpoint /stats:",
						estatusStats,
					);

					// Contactos realizados hoy
					const contactosHoy = await db
						.select({ count: count() })
						.from(contactosCobros)
						.where(
							gte(
								contactosCobros.fechaContacto,
								new Date(new Date().setHours(0, 0, 0, 0)),
							),
						);

					return {
						estatusStats,
						totalCasosAsignados: statsResponse.totalCreditos,
						efectividad: statsResponse.efectividad,
						contactosHoy: contactosHoy[0]?.count || 0,
					};
				} catch (error) {
					console.error(
						"[Cobros] Error obteniendo stats desde Cartera-Back:",
						error,
					);
					// Fallback a datos locales
				}
			}

			// Fallback: Calcular stats desde la base de datos local
			const estatusStats = await db
				.select({
					estadoContrato: contratosFinanciamiento.estado,
					estadoMora: casosCobros.estadoMora,
					totalCases: count(),
					montoTotal: sql<string>`COALESCE(SUM(CASE WHEN ${casosCobros.montoEnMora} IS NOT NULL THEN ${casosCobros.montoEnMora} ELSE 0 END), 0)`,
				})
				.from(contratosFinanciamiento)
				.leftJoin(
					casosCobros,
					eq(contratosFinanciamiento.id, casosCobros.contratoId),
				)
				.groupBy(contratosFinanciamiento.estado, casosCobros.estadoMora);

			// Procesar estadísticas para el embudo
			const embudoStats = {
				al_dia: {
					totalCases: 0,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
				mora_30: {
					totalCases: 0,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
				mora_60: {
					totalCases: 0,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
				mora_90: {
					totalCases: 0,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
				mora_120: {
					totalCases: 0,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
				pagado: {
					totalCases: 0,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
				incobrable: {
					totalCases: 0,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
				completado: {
					totalCases: 0,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
			};

			estatusStats.forEach((stat) => {
				if (stat.estadoContrato === "completado") {
					embudoStats.completado.totalCases += stat.totalCases;
				} else if (
					stat.estadoContrato === "incobrable" ||
					stat.estadoContrato === "recuperado"
				) {
					// Contratos incobrables y recuperados van al bucket "incobrable"
					embudoStats.incobrable.totalCases += stat.totalCases;
					const currentMonto = Number(embudoStats.incobrable.montoTotal);
					embudoStats.incobrable.montoTotal = (
						currentMonto + Number(stat.montoTotal)
					).toString();
				} else if (stat.estadoContrato === "activo" && !stat.estadoMora) {
					// Contratos activos sin caso de cobros = al día
					embudoStats.al_dia.totalCases += stat.totalCases;
				} else if (stat.estadoMora) {
					// Casos con estado de mora específico
					if (stat.estadoMora in embudoStats) {
						embudoStats[
							stat.estadoMora as keyof typeof embudoStats
						].totalCases += stat.totalCases;
						const currentMonto = Number(
							embudoStats[stat.estadoMora as keyof typeof embudoStats]
								.montoTotal,
						);
						embudoStats[
							stat.estadoMora as keyof typeof embudoStats
						].montoTotal = (currentMonto + Number(stat.montoTotal)).toString();
					}
				}
			});

			// Casos asignados al usuario actual
			const casosAsignados = await db
				.select({ count: count() })
				.from(casosCobros)
				.where(
					context.userRole === "admin"
						? eq(casosCobros.activo, true)
						: and(
								eq(casosCobros.activo, true),
								eq(casosCobros.responsableCobros, context.userId),
							),
				);

			// Contactos realizados hoy
			const contactosHoy = await db
				.select({ count: count() })
				.from(contactosCobros)
				.where(
					gte(
						contactosCobros.fechaContacto,
						new Date(new Date().setHours(0, 0, 0, 0)),
					),
				);

			return {
				estatusStats: Object.entries(embudoStats).map(([estado, data]) => ({
					estadoMora: estado,
					...data,
				})),
				totalCasosAsignados: casosAsignados[0]?.count || 0,
				efectividad: "0",
				contactosHoy: contactosHoy[0]?.count || 0,
			};
		}),

	// Obtener todos los contratos con sus estados (incluyendo al día e incobrables)
	getTodosLosCreditos: cobrosProcedure
		.input(
			z.object({
				limit: z.number().optional(),
				offset: z.number().optional(),
				estadoMora: z.string().optional(),
				nombreUsuario: z.string().optional(),
				time: z.enum(["WEEK", "MONTH", "DUEMONTH", "TODAY"]).optional(),
				emailCobrador: z.string().optional(),
			}),
		)
		.handler(async ({ input }) => {
			// Si la integración con Cartera-Back está habilitada, obtener datos directamente
			if (isCarteraBackEnabled()) {
				try {
					// Usar mes=0 para obtener TODOS los créditos sin filtrar por mes
					const mes = 0;
					const anio = new Date().getFullYear();

					// Mapear filtro de estadoMora a parámetros de cartera-back
					let cuotasAtrasadas: number | undefined;
					let estadoCartera: "ACTIVO" | "CANCELADO" | "INCOBRABLE" | undefined;
					const nombre_usuario: string | undefined =
						input.nombreUsuario ?? undefined;

					if (input.estadoMora) {
						switch (input.estadoMora) {
							case "al_dia":
								cuotasAtrasadas = 0;
								estadoCartera = "ACTIVO";
								break;
							case "mora_30":
								cuotasAtrasadas = 1;
								estadoCartera = "ACTIVO";
								break;
							case "mora_60":
								cuotasAtrasadas = 2;
								estadoCartera = "ACTIVO";
								break;
							case "mora_90":
								cuotasAtrasadas = 3;
								estadoCartera = "ACTIVO";
								break;
							case "mora_120":
								// Más de 3 cuotas atrasadas (120+ días)
								cuotasAtrasadas = 4;
								estadoCartera = "ACTIVO";
								break;
							case "incobrable":
								// Solo cambiar el estado, sin filtrar por cuotas
								estadoCartera = "INCOBRABLE";
								break;
							case "completado":
								// Solo cambiar el estado, sin filtrar por cuotas
								estadoCartera = "CANCELADO";
								break;
							default:
								// Sin filtro, mantener ACTIVO como predeterminado
								estadoCartera = "ACTIVO";
						}
					} else {
						// Si no hay filtro, usar ACTIVO por defecto
						estadoCartera = "ACTIVO";
					}

					console.log(
						`[Cobros] Obteniendo créditos de Cartera-Back: mes=${mes} (todos), anio=${anio}, page=${Math.floor((input.offset || 0) / (input.limit || 50)) + 1}, perPage=${input.limit || 50}, cuotasAtrasadas=${cuotasAtrasadas}, estado=${estadoCartera}, time=${input.time}, emailCobrador=${input.emailCobrador}`,
					);

					// Obtener todos los créditos de Cartera-Back con los filtros
					const creditosResponse = await obtenerTodosLosCreditosCarteraBack({
						mes,
						anio,
						page: Math.floor((input.offset || 0) / (input.limit || 50)) + 1,
						perPage: input.limit || 50,
						cuotasAtrasadas,
						estado: estadoCartera,
						nombre_usuario,
						time: input.time,
						email_cobrador: input.emailCobrador,
					}); // Validar que la respuesta tenga la estructura esperada
					if (!creditosResponse || !creditosResponse.data) {
						console.error(
							"[Cobros] Respuesta inválida de Cartera-Back:",
							creditosResponse,
						);
						throw new ORPCError("BAD_REQUEST", {
							message: "Estructura de respuesta inválida",
						});
					}

					console.log(
						`[Cobros] Obtenidos ${creditosResponse.data.length} créditos de Cartera-Back`,
					);

					// Mapear los datos de Cartera-Back al formato esperado por el frontend
					const contratos = await Promise.all(
						creditosResponse.data.map(async (credito) => {
							// Acceder a los datos anidados correctamente
							const statusCredit = credito.creditos.statusCredit;
							const cuotasAtrasadas = credito.mora?.cuotas_atrasadas ?? 0;
							const cuotaMensual = Number(credito.creditos.cuota ?? 0);

							// NOTA: Usamos aproximación (30 días por cuota) porque /getAllCredits
							// NO retorna las fechas de vencimiento de las cuotas individuales.
							// Solo /credito retorna el array completo con fechas para cálculo exacto.
							const diasMora = cuotasAtrasadas * 30;

							// Calcular monto en mora como: cuota mensual * cuotas atrasadas
							const montoEnMora = cuotaMensual * cuotasAtrasadas;

							// Determinar estado de mora según días de mora
							let estadoMora: string | null = null;
							if (diasMora === 0) estadoMora = "al_dia";
							else if (diasMora <= 30) estadoMora = "mora_30";
							else if (diasMora <= 60) estadoMora = "mora_60";
							else if (diasMora <= 90) estadoMora = "mora_90";
							else if (diasMora <= 120) estadoMora = "mora_120";
							else estadoMora = "mora_120_plus";

							// Determinar estado del contrato según statusCredit
							let estadoContrato = "activo";
							if (statusCredit === "CANCELADO") estadoContrato = "completado";
							else if (statusCredit === "INCOBRABLE")
								estadoContrato = "incobrable";

							// Buscar la oportunidad por número SIFCO para obtener datos del vehículo
							const numeroSifco = credito.creditos.numero_credito_sifco;
							let vehiculoMarca = "-";
							let vehiculoModelo = "-";
							let vehiculoYear: number | null = null;
							let vehiculoPlaca = "-";

							if (numeroSifco) {
								const [oportunidad] = await db
									.select({
										vehicleId: opportunities.vehicleId,
										marca: vehicles.make,
										modelo: vehicles.model,
										year: vehicles.year,
										placa: vehicles.licensePlate,
									})
									.from(opportunities)
									.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
									.where(eq(opportunities.numeroSifco, numeroSifco))
									.limit(1);

								if (oportunidad?.vehicleId) {
									vehiculoMarca = oportunidad.marca || "-";
									vehiculoModelo = oportunidad.modelo || "-";
									vehiculoYear = oportunidad.year;
									vehiculoPlaca = oportunidad.placa || "";
								}
							}

							return {
								contratoId: credito.creditos.credito_id.toString(),
								clienteNombre: credito.usuarios.nombre,
								vehiculoMarca,
								vehiculoModelo,
								vehiculoYear,
								vehiculoPlaca,
								estadoContrato,
								montoFinanciado: credito.creditos.capital.toString(),
								cuotaMensual: credito.creditos.cuota.toString(),
								fechaProximoPago:
									credito.proxima_cuota?.fecha_vencimiento || null,
								responsableCobros: credito.asesores?.nombre || null,
								casoCobroId: null,
								estadoMora,
								montoEnMora: montoEnMora.toFixed(2),
								diasMoraMaximo: diasMora,
								cuotasVencidas: cuotasAtrasadas,
								telefonoPrincipal: null,
								proximoContacto: null,
								responsableNombre: null,
								numeroCredito: numeroSifco || null,
							};
						}),
					);

					console.log(
						`[Cobros] Mapeados ${contratos.length} contratos para el frontend`,
					);

					return {
						data: contratos,
						total: creditosResponse.totalCount,
						page: creditosResponse.page,
						perPage: creditosResponse.perPage,
						totalPages: creditosResponse.totalPages,
					};
				} catch (error) {
					console.error(
						"[Cobros] Error obteniendo datos de Cartera-Back:",
						error,
					);
					// Fallback a datos locales en caso de error
				}
			}

			return {
				data: [],
				total: 0,
				page: 0,
				perPage: 0,
				totalPages: 0,
			};
		}),

	// Obtener casos de cobros con filtros (solo casos activos con mora)
	getCasosCobros: cobrosProcedure
		.input(
			z.object({
				estadoMora: z.enum(estadoMoraEnum.enumValues).optional(),
				responsableCobros: z.string().optional(),
				limit: z.number().default(50),
				offset: z.number().default(0),
			}),
		)
		.handler(async ({ input, context }) => {
			// Construir condiciones WHERE
			const conditions = [eq(casosCobros.activo, true)];

			// Filtros
			if (input.estadoMora) {
				conditions.push(eq(casosCobros.estadoMora, input.estadoMora));
			}

			if (input.responsableCobros) {
				conditions.push(
					eq(casosCobros.responsableCobros, input.responsableCobros),
				);
			}

			// Si no es admin o supervisor de cobros, solo ver casos asignados
			if (!PERMISSIONS.canViewAllCasosCobros(context.userRole)) {
				conditions.push(eq(casosCobros.responsableCobros, context.userId));
			}

			const query = db
				.select({
					id: casosCobros.id,
					contratoId: casosCobros.contratoId,
					estadoMora: casosCobros.estadoMora,
					montoEnMora: casosCobros.montoEnMora,
					diasMoraMaximo: casosCobros.diasMoraMaximo,
					cuotasVencidas: casosCobros.cuotasVencidas,
					responsableCobros: casosCobros.responsableCobros,
					telefonoPrincipal: casosCobros.telefonoPrincipal,
					emailContacto: casosCobros.emailContacto,
					proximoContacto: casosCobros.proximoContacto,
					metodoContactoProximo: casosCobros.metodoContactoProximo,
					createdAt: casosCobros.createdAt,
					updatedAt: casosCobros.updatedAt,
					// Datos del cliente
					clienteNombre: clients.contactPerson,
					// Datos del vehículo
					vehiculoMarca: vehicles.make,
					vehiculoModelo: vehicles.model,
					vehiculoYear: vehicles.year,
					vehiculoPlaca: vehicles.licensePlate,
					// Datos del responsable
					responsableNombre: user.name,
				})
				.from(casosCobros)
				.leftJoin(
					contratosFinanciamiento,
					eq(casosCobros.contratoId, contratosFinanciamiento.id),
				)
				.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
				.leftJoin(vehicles, eq(contratosFinanciamiento.vehicleId, vehicles.id))
				.leftJoin(user, eq(casosCobros.responsableCobros, user.id))
				.where(and(...conditions));

			const casos = await query
				.orderBy(desc(casosCobros.diasMoraMaximo), desc(casosCobros.updatedAt))
				.limit(input.limit)
				.offset(input.offset);

			return casos;
		}),

	// Obtener detalles de un caso específico
	getCasoCobroById: cobrosProcedure
		.input(z.object({ id: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const whereClause = PERMISSIONS.canViewAllCasosCobros(context.userRole)
				? eq(casosCobros.id, input.id)
				: and(
						eq(casosCobros.id, input.id),
						eq(casosCobros.responsableCobros, context.userId),
					);

			const caso = await db
				.select({
					// Datos del caso
					id: casosCobros.id,
					contratoId: casosCobros.contratoId,
					estadoMora: casosCobros.estadoMora,
					montoEnMora: casosCobros.montoEnMora,
					diasMoraMaximo: casosCobros.diasMoraMaximo,
					cuotasVencidas: casosCobros.cuotasVencidas,
					telefonoPrincipal: casosCobros.telefonoPrincipal,
					telefonoAlternativo: casosCobros.telefonoAlternativo,
					emailContacto: casosCobros.emailContacto,
					direccionContacto: casosCobros.direccionContacto,
					proximoContacto: casosCobros.proximoContacto,
					metodoContactoProximo: casosCobros.metodoContactoProximo,
					// Datos del contrato
					montoFinanciado: contratosFinanciamiento.montoFinanciado,
					cuotaMensual: contratosFinanciamiento.cuotaMensual,
					numeroCuotas: contratosFinanciamiento.numeroCuotas,
					fechaInicio: contratosFinanciamiento.fechaInicio,
					diaPagoMensual: contratosFinanciamiento.diaPagoMensual,
					// Datos del cliente
					clienteNombre: clients.contactPerson,
					// Datos del vehículo
					vehiculoMarca: vehicles.make,
					vehiculoModelo: vehicles.model,
					vehiculoYear: vehicles.year,
					vehiculoPlaca: vehicles.licensePlate,
				})
				.from(casosCobros)
				.leftJoin(
					contratosFinanciamiento,
					eq(casosCobros.contratoId, contratosFinanciamiento.id),
				)
				.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
				.leftJoin(vehicles, eq(contratosFinanciamiento.vehicleId, vehicles.id))
				.where(whereClause)
				.limit(1);

			return caso[0] || null;
		}),

	// Registrar contacto de cobros
	createContactoCobros: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				metodoContacto: z.enum(metodoContactoEnum.enumValues),
				estadoContacto: z.enum(estadoContactoEnum.enumValues),
				duracionLlamada: z.number().optional(),
				comentarios: z.string().min(1, "Los comentarios son requeridos"),
				acuerdosAlcanzados: z.string().optional(),
				compromisosPago: z.string().optional(),
				requiereSeguimiento: z.boolean().default(false),
				fechaProximoContacto: z.date().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Verificar que el usuario tenga acceso al caso
			if (!PERMISSIONS.canViewAllCasosCobros(context.userRole)) {
				const caso = await db
					.select()
					.from(casosCobros)
					.where(
						and(
							eq(casosCobros.id, input.casoCobroId),
							eq(casosCobros.responsableCobros, context.userId),
						),
					)
					.limit(1);

				if (!caso.length) {
					throw new ORPCError("FORBIDDEN", {
						message: "No tienes permiso para acceder a este caso",
					});
				}
			}

			const nuevoContacto = await db
				.insert(contactosCobros)
				.values({
					...input,
					realizadoPor: context.userId,
				})
				.returning();

			// Actualizar próximo contacto en el caso si se especifica
			if (input.fechaProximoContacto) {
				await db
					.update(casosCobros)
					.set({
						proximoContacto: input.fechaProximoContacto,
						metodoContactoProximo: input.metodoContacto,
						updatedAt: new Date(),
					})
					.where(eq(casosCobros.id, input.casoCobroId));
			}

			return nuevoContacto[0];
		}),

	// Obtener historial de contactos de un caso
	getHistorialContactos: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				limit: z.number().default(20),
			}),
		)
		.handler(async ({ input, context }) => {
			// Verificar acceso al caso
			if (!PERMISSIONS.canViewAllCasosCobros(context.userRole)) {
				const caso = await db
					.select()
					.from(casosCobros)
					.where(
						and(
							eq(casosCobros.id, input.casoCobroId),
							eq(casosCobros.responsableCobros, context.userId),
						),
					)
					.limit(1);

				if (!caso.length) {
					throw new ORPCError("FORBIDDEN", {
						message: "No tienes permiso para acceder a este caso",
					});
				}
			}
			console.log(
				"Obteniendo historial de contactos para el caso:",
				input.casoCobroId,
			);
			console.log("userRole:", context.userRole, "userId:", context.userId);

			const contactos = await db
				.select({
					id: contactosCobros.id,
					fechaContacto: contactosCobros.fechaContacto,
					metodoContacto: contactosCobros.metodoContacto,
					estadoContacto: contactosCobros.estadoContacto,
					duracionLlamada: contactosCobros.duracionLlamada,
					comentarios: contactosCobros.comentarios,
					acuerdosAlcanzados: contactosCobros.acuerdosAlcanzados,
					compromisosPago: contactosCobros.compromisosPago,
					requiereSeguimiento: contactosCobros.requiereSeguimiento,
					fechaProximoContacto: contactosCobros.fechaProximoContacto,
					realizadoPor: user.name,
				})
				.from(contactosCobros)
				.leftJoin(user, eq(contactosCobros.realizadoPor, user.id))
				.where(eq(contactosCobros.casoCobroId, input.casoCobroId))
				.orderBy(desc(contactosCobros.fechaContacto))
				.limit(input.limit);

			return contactos;
		}),

	// Crear convenio de pago
	createConvenioPago: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				montoAcordado: z
					.string()
					.regex(/^\d+(\.\d{1,2})?$/, "Formato de monto inválido"),
				numeroCuotasConvenio: z.number().min(1).max(60),
				montoCuotaConvenio: z
					.string()
					.regex(/^\d+(\.\d{1,2})?$/, "Formato de cuota inválido"),
				fechaInicioConvenio: z.date(),
				condicionesEspeciales: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Solo admin, supervisor de cobros o usuario asignado pueden crear convenios
			if (!PERMISSIONS.canViewAllCasosCobros(context.userRole)) {
				const caso = await db
					.select()
					.from(casosCobros)
					.where(
						and(
							eq(casosCobros.id, input.casoCobroId),
							eq(casosCobros.responsableCobros, context.userId),
						),
					)
					.limit(1);

				if (!caso.length) {
					throw new ORPCError("FORBIDDEN", {
						message: "No tienes permiso para crear convenios en este caso",
					});
				}
			}

			const convenio = await db
				.insert(conveniosPago)
				.values({
					...input,
					aprobadoPor: context.userId,
				})
				.returning();

			return convenio[0];
		}),

	// Obtener convenios de pago de un caso
	getConveniosPago: cobrosProcedure
		.input(z.object({ casoCobroId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			// Verificar acceso
			if (!PERMISSIONS.canViewAllCasosCobros(context.userRole)) {
				const caso = await db
					.select()
					.from(casosCobros)
					.where(
						and(
							eq(casosCobros.id, input.casoCobroId),
							eq(casosCobros.responsableCobros, context.userId),
						),
					)
					.limit(1);

				if (!caso.length) {
					throw new ORPCError("FORBIDDEN", {
						message: "No tienes permiso para ver convenios de este caso",
					});
				}
			}

			const convenios = await db
				.select({
					id: conveniosPago.id,
					montoAcordado: conveniosPago.montoAcordado,
					numeroCuotasConvenio: conveniosPago.numeroCuotasConvenio,
					montoCuotaConvenio: conveniosPago.montoCuotaConvenio,
					fechaInicioConvenio: conveniosPago.fechaInicioConvenio,
					activo: conveniosPago.activo,
					cumplido: conveniosPago.cumplido,
					cuotasCumplidas: conveniosPago.cuotasCumplidas,
					condicionesEspeciales: conveniosPago.condicionesEspeciales,
					fechaAprobacion: conveniosPago.fechaAprobacion,
					aprobadoPor: user.name,
				})
				.from(conveniosPago)
				.leftJoin(user, eq(conveniosPago.aprobadoPor, user.id))
				.where(eq(conveniosPago.casoCobroId, input.casoCobroId))
				.orderBy(desc(conveniosPago.createdAt));

			return convenios;
		}),

	// Asignar responsable de cobros
	asignarResponsableCobros: cobrosSupervisorProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				responsableCobros: z.string(),
			}),
		)
		.handler(async ({ input }) => {
			// Verificar que el responsable tenga rol de cobros
			const responsable = await db
				.select()
				.from(user)
				.where(eq(user.id, input.responsableCobros))
				.limit(1);

			if (!responsable.length) {
				throw new ORPCError("NOT_FOUND", { message: "Usuario no encontrado" });
			}

			if (
				responsable[0].role !== "cobros" &&
				responsable[0].role !== "cobros_supervisor" &&
				responsable[0].role !== "admin"
			) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"El usuario debe tener rol de cobros, supervisor de cobros o admin",
				});
			}

			const casoActualizado = await db
				.update(casosCobros)
				.set({
					responsableCobros: input.responsableCobros,
					updatedAt: new Date(),
				})
				.where(eq(casosCobros.id, input.casoCobroId))
				.returning();

			return casoActualizado[0];
		}),

	// Obtener usuarios con rol de cobros para asignación
	getUsuariosCobros: cobrosSupervisorProcedure.handler(async () => {
		const usuarios = await db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				role: user.role,
			})
			.from(user)
			.where(
				or(
					eq(user.role, "cobros"),
					eq(user.role, "cobros_supervisor"),
					eq(user.role, "admin"),
				),
			)
			.orderBy(asc(user.name));

		return usuarios;
	}),

	// Obtener historial de cuotas de pago de un contrato
	getHistorialPagos: cobrosProcedure
		.input(z.object({ numeroSifco: z.string() }))
		.handler(async ({ input, context }) => {
			try {
				if (!input.numeroSifco) {
					throw new ORPCError("BAD_REQUEST", {
						message: "El número SIFCO es requerido",
					});
				}

				// TODO: Cambiar a verificación por caso de cobros cuando ya no haya datos importados sin responsable
				// Actualmente permitimos a usuarios de cobros ver todos los historiales porque los contratos
				// importados de cartera-back no tienen responsable asignado.
				// Futura implementación (cuando todos los casos tengan responsables):
				// - Buscar caso de cobros asociado al contrato
				// - Verificar que el usuario sea el responsable del caso
				// - Solo permitir acceso si es admin o responsable del caso
				console.log("🔐 Verificando permisos:", {
					esAdmin: context.userRole === "admin",
					esCobros: context.userRole === "cobros",
					esCobrosSupervisor: context.userRole === "cobros_supervisor",
					usuarioActual: context.userId,
					tienePermiso: PERMISSIONS.canAccessCobros(context.userRole),
				});

				if (!PERMISSIONS.canAccessCobros(context.userRole)) {
					console.error("❌ Sin permisos para ver historial");
					throw new ORPCError("FORBIDDEN", {
						message: "No tienes permiso para ver este historial",
					});
				}

				// Verificar si el contrato tiene referencia a cartera-back
				if (isCarteraBackEnabled()) {
					console.log(
						"🔗 Contrato vinculado a cartera-back, obteniendo cuotas de allá",
					);

					try {
						// Obtener crédito completo de cartera-back
						const creditoCompleto = await carteraBackClient.getCredito(
							input.numeroSifco,
						);

						const cuotasCombinadas = [
							...(creditoCompleto.cuotasPagadas || []),
							...(creditoCompleto.cuotasPendientes || []),
							...(creditoCompleto.cuotasAtrasadas || []),
						];

						// Eliminar duplicados basándose en numero_cuota
						// Prioridad: pagadas > atrasadas > pendientes
						const cuotasUnicas = new Map<number, any>();

						for (const cuota of cuotasCombinadas) {
							const numeroCuota = cuota.numero_cuota;
							const existente = cuotasUnicas.get(numeroCuota);

							if (!existente) {
								cuotasUnicas.set(numeroCuota, cuota);
							} else {
								// Si la nueva cuota está pagada, reemplaza la existente
								// Si ambas están pagadas o ninguna, mantiene la primera
								if (cuota.pagado && !existente.pagado) {
									cuotasUnicas.set(numeroCuota, cuota);
								}
							}
						}

						// Mapear a estructura esperada por frontend
						return Array.from(cuotasUnicas.values())
							.sort((a, b) => a.numero_cuota - b.numero_cuota)
							.map((cuota) => {
								const montoMora = cuota.pago_mora ? Number(cuota.pago_mora) : 0;
								const montoPagadoReal =
									cuota.pagado && cuota.monto_boleta
										? Number(cuota.monto_boleta)
										: cuota.pagado
											? Number(creditoCompleto.credito.cuota)
											: null;

								return {
									...cuota,
									id: cuota.cuota_id.toString(),
									numeroCuota: cuota.numero_cuota,
									fechaVencimiento: cuota.fecha_vencimiento,
									montoCuota: creditoCompleto.credito.cuota,
									fechaPago: cuota.pagado ? cuota.fecha_vencimiento : null,
									montoPagado: montoPagadoReal,
									montoMora: montoMora.toString(),
									estadoMora: cuota.pagado ? "pagado" : "pendiente",
									diasMora: 0,
									detallesPago: cuota.pagado
										? {
												abonoCapital: cuota.abono_capital || "0",
												abonoInteres: cuota.abono_interes || "0",
												abonoIva: cuota.abono_iva_12 || "0",
												abonoSeguro: cuota.abono_seguro || "0",
												abonoGps: cuota.abono_gps || "0",
												abonoMembresias: cuota.abono_membresias || "0",
												pagoMora: cuota.pago_mora || "0",
												pagoOtros: cuota.pago_otros || "0",
												capitalRestante: cuota.capital_restante || "0",
												interesRestante: cuota.interes_restante || "0",
											}
										: undefined,
								};
							});
					} catch (error) {
						console.warn(
							`⚠️ No se pudieron obtener cuotas de cartera-back para el contrato ${input.numeroSifco}:`,
							error instanceof Error ? error.message : error,
						);
						console.log(
							"📊 Fallback: intentando obtener cuotas desde DB local...",
						);
						// Continuar con DB local más abajo
					}
				}

				return [];
			} catch (error) {
				console.error("💥 Error en getHistorialPagos:", {
					error: error instanceof Error ? error.message : error,
					stack: error instanceof Error ? error.stack : undefined,
				});
				throw error;
			}
		}),

	// Obtener información de recuperación de vehículo
	getRecuperacionVehiculo: cobrosProcedure
		.input(z.object({ casoCobroId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			// Verificar acceso
			if (!PERMISSIONS.canViewAllCasosCobros(context.userRole)) {
				const caso = await db
					.select()
					.from(casosCobros)
					.where(
						and(
							eq(casosCobros.id, input.casoCobroId),
							eq(casosCobros.responsableCobros, context.userId),
						),
					)
					.limit(1);

				if (!caso.length) {
					throw new ORPCError("FORBIDDEN", {
						message: "No tienes permiso para ver esta información",
					});
				}
			}

			const recuperacion = await db
				.select({
					id: recuperacionesVehiculo.id,
					tipoRecuperacion: recuperacionesVehiculo.tipoRecuperacion,
					fechaRecuperacion: recuperacionesVehiculo.fechaRecuperacion,
					ordenSecuestro: recuperacionesVehiculo.ordenSecuestro,
					numeroExpediente: recuperacionesVehiculo.numeroExpediente,
					juzgadoCompetente: recuperacionesVehiculo.juzgadoCompetente,
					completada: recuperacionesVehiculo.completada,
					observaciones: recuperacionesVehiculo.observaciones,
					responsableRecuperacion: user.name,
				})
				.from(recuperacionesVehiculo)
				.leftJoin(
					user,
					eq(recuperacionesVehiculo.responsableRecuperacion, user.id),
				)
				.where(eq(recuperacionesVehiculo.casoCobroId, input.casoCobroId))
				.limit(1);

			return recuperacion[0] || null;
		}),

	// Obtener detalles de contrato (puede ser caso de cobros o contrato directo)
	getDetallesContrato: cobrosProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				tipo: z.enum(["caso", "contrato"]).default("caso"),
			}),
		)
		.handler(async ({ input, context }) => {
			if (input.tipo === "caso") {
				// Es un caso de cobros
				const whereClause = PERMISSIONS.canViewAllCasosCobros(context.userRole)
					? eq(casosCobros.id, input.id)
					: and(
							eq(casosCobros.id, input.id),
							eq(casosCobros.responsableCobros, context.userId),
						);

				const caso = await db
					.select({
						// Datos del caso
						id: casosCobros.id,
						contratoId: casosCobros.contratoId,
						estadoMora: casosCobros.estadoMora,
						montoEnMora: casosCobros.montoEnMora,
						diasMoraMaximo: casosCobros.diasMoraMaximo,
						cuotasVencidas: casosCobros.cuotasVencidas,
						telefonoPrincipal: casosCobros.telefonoPrincipal,
						telefonoAlternativo: casosCobros.telefonoAlternativo,
						emailContacto: casosCobros.emailContacto,
						direccionContacto: casosCobros.direccionContacto,
						proximoContacto: casosCobros.proximoContacto,
						metodoContactoProximo: casosCobros.metodoContactoProximo,
						// Datos del contrato
						montoFinanciado: contratosFinanciamiento.montoFinanciado,
						cuotaMensual: contratosFinanciamiento.cuotaMensual,
						numeroCuotas: contratosFinanciamiento.numeroCuotas,
						fechaInicio: contratosFinanciamiento.fechaInicio,
						diaPagoMensual: contratosFinanciamiento.diaPagoMensual,
						estadoContrato: contratosFinanciamiento.estado,
						// Datos del cliente
						clienteNombre: clients.contactPerson,
						// Datos del vehículo
						vehiculoMarca: vehicles.make,
						vehiculoModelo: vehicles.model,
						vehiculoYear: vehicles.year,
						vehiculoPlaca: vehicles.licensePlate,
					})
					.from(casosCobros)
					.leftJoin(
						contratosFinanciamiento,
						eq(casosCobros.contratoId, contratosFinanciamiento.id),
					)
					.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
					.leftJoin(
						vehicles,
						eq(contratosFinanciamiento.vehicleId, vehicles.id),
					)
					.where(whereClause)
					.limit(1);

				return caso[0] || null;
			}
			// Es un contrato directo (al día o completado)
			const contrato = await db
				.select({
					// Simular estructura de caso
					id: contratosFinanciamiento.id,
					contratoId: contratosFinanciamiento.id,
					estadoMora: sql<string>`'al_dia'`, // Simular estado al día
					montoEnMora: sql<string>`'0'`,
					diasMoraMaximo: sql<number>`0`,
					cuotasVencidas: sql<number>`0`,
					telefonoPrincipal: sql<string>`COALESCE(${casosCobros.telefonoPrincipal}, '')`,
					telefonoAlternativo: sql<string>`COALESCE(${casosCobros.telefonoAlternativo}, '')`,
					emailContacto: sql<string>`COALESCE(${casosCobros.emailContacto}, '')`,
					direccionContacto: sql<string>`COALESCE(${casosCobros.direccionContacto}, '')`,
					proximoContacto: casosCobros.proximoContacto,
					metodoContactoProximo: casosCobros.metodoContactoProximo,
					// Datos del contrato
					montoFinanciado: contratosFinanciamiento.montoFinanciado,
					cuotaMensual: contratosFinanciamiento.cuotaMensual,
					numeroCuotas: contratosFinanciamiento.numeroCuotas,
					fechaInicio: contratosFinanciamiento.fechaInicio,
					diaPagoMensual: contratosFinanciamiento.diaPagoMensual,
					estadoContrato: contratosFinanciamiento.estado,
					// Datos del cliente
					clienteNombre: clients.contactPerson,
					// Datos del vehículo
					vehiculoMarca: vehicles.make,
					vehiculoModelo: vehicles.model,
					vehiculoYear: vehicles.year,
					vehiculoPlaca: vehicles.licensePlate,
				})
				.from(contratosFinanciamiento)
				.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
				.leftJoin(vehicles, eq(contratosFinanciamiento.vehicleId, vehicles.id))
				.leftJoin(
					casosCobros,
					eq(contratosFinanciamiento.id, casosCobros.contratoId),
				)
				.where(eq(contratosFinanciamiento.id, input.id))
				.limit(1);

			return contrato[0] || null;
		}),

	// Obtener detalles de un crédito desde Cartera-Back
	// Usa el endpoint directo /credito y combina con datos del CRM (vehículo, caso de cobros)
	getDetallesCreditoCarteraBack: cobrosProcedure
		.input(
			z.object({
				creditoId: z.string(), // credito_id como string numérico
			}),
		)
		.handler(async ({ input, context }) => {
			if (!isCarteraBackEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con Cartera-Back no está habilitada",
				});
			}

			try {
				let numeroSifco: string = input.creditoId ?? "";

				// 1. Buscar referencia por sifco número de crédito
				let reference = await db
					.select()
					.from(carteraBackReferences)
					.where(eq(carteraBackReferences.numeroCreditoSifco, numeroSifco))
					.limit(1);

				let creditoCompleto: CreditoDirectoResponse | null = null;

				if (reference.length === 0) {
					// Si no hay referencia, buscar el crédito en cartera-back
					// usando getAllCredits para encontrar el número SIFCO
					creditoCompleto = await carteraBackClient.getCredito(numeroSifco);

					await db.insert(carteraBackReferences).values({
						carteraCreditoId: creditoCompleto.credito.credito_id,
						numeroCreditoSifco: numeroSifco,
						syncedAt: new Date(),
						lastSyncStatus: "success",
						createdBy: context.user.id,
					});

					// Reload reference
					reference = await db
						.select()
						.from(carteraBackReferences)
						.where(
							eq(
								carteraBackReferences.carteraCreditoId,
								creditoCompleto.credito.credito_id,
							),
						)
						.limit(1);
				} else {
					numeroSifco = reference[0].numeroCreditoSifco;
				}

				// 2. Obtener detalles completos del crédito de cartera-back
				if (creditoCompleto === null) {
					try {
						creditoCompleto = await carteraBackClient.getCredito(numeroSifco);
					} catch (error) {
						console.error(
							`[Cobros] Error obteniendo detalles de crédito ${numeroSifco}:`,
							error,
						);

						// Si el crédito tiene datos corruptos o circuit breaker está abierto,
						// intentar usar datos del listado como fallback
						if (
							error instanceof Error &&
							(error.message.includes("destructure") ||
								error.message.includes("HTTP 500") ||
								error.message.includes("Circuit breaker is OPEN") ||
								error.message.includes("HTTP 404"))
						) {
							console.warn(
								`[Cobros] Intentando fallback con datos del listado para ${numeroSifco}...`,
							);

							try {
								// Obtener datos del listado como fallback
								// Intentar con todos los estados posibles ya que no sabemos cuál es
								const now = new Date();
								const estadosPosibles: (
									| "ACTIVO"
									| "MOROSO"
									| "CANCELADO"
									| "INCOBRABLE"
								)[] = ["ACTIVO", "MOROSO", "CANCELADO", "INCOBRABLE"];

								let creditoListado = null;
								for (const estado of estadosPosibles) {
									const listado = await carteraBackClient.getAllCreditos({
										mes: 0,
										anio: now.getFullYear(),
										estado,
										numero_credito_sifco: numeroSifco,
										page: 1,
										perPage: 1,
									});

									if (listado.data.length > 0) {
										creditoListado = listado.data[0];
										break;
									}
								}

								if (creditoListado) {
									// Convertir estructura del listado a estructura de detalle
									creditoCompleto = {
										credito: creditoListado.creditos,
										usuario: creditoListado.usuarios,
										cuotasPagadas: [],
										cuotasPendientes: [],
										cuotasAtrasadas: [],
										moraActual: creditoListado.mora?.monto_mora || "0.00",
									};
									console.log(
										`[Cobros] ✓ Usando datos del listado (fallback) para ${numeroSifco}`,
									);
								} else {
									console.warn(
										`[Cobros] No se encontró el crédito ${numeroSifco} en ningún estado`,
									);
									return null;
								}
							} catch (fallbackError) {
								console.error(
									`[Cobros] Error en fallback para ${numeroSifco}:`,
									fallbackError,
								);
								return null;
							}
						} else {
							// Re-throw otros errores que no sean de datos corruptos
							throw error;
						}
					}
				}

				if (!creditoCompleto) {
					return null;
				}

				// 3. Buscar oportunidad por número SIFCO para obtener vehículo, lead y dirección
				let vehiculo = null;
				let leadInfo = null;
				let direccion = null;
				const contratoId = reference[0]?.contratoFinanciamientoId || null;

				const oportunidadResult = await db
					.select({
						oportunidadId: opportunities.id,
						vehicleId: opportunities.vehicleId,
						leadId: opportunities.leadId,
						direccion: leads.direccion,
						// Datos de la oportunidad (para fallback)
						oportunidadNotes: opportunities.notes,
						oportunidadCuotaMensual: opportunities.cuotaMensual,
						oportunidadDiaPago: opportunities.diaPagoMensual,
						oportunidadCreditType: opportunities.creditType,
						// Datos del vehículo
						vehiculoMarca: vehicles.make,
						vehiculoModelo: vehicles.model,
						vehiculoYear: vehicles.year,
						vehiculoPlaca: vehicles.licensePlate,
						vehiculoTipo: vehicles.vehicleType,
						vehiculoMotor: vehicles.motorNumber,
						vehiculoChasis: vehicles.series,
						vehiculoAsientos: vehicles.seats,
						vehiculoUso: vehicles.vehicleUse,
						// Datos del seguro del vehículo
						vehiculoNumeroPoliza: vehicles.numeroPoliza,
						vehiculoFechaInicioSeguro: vehicles.fechaInicioSeguro,
						vehiculoFechaVencimientoSeguro: vehicles.fechaVencimientoSeguro,
						vehiculoMontoAsegurado: vehicles.montoAsegurado,
						// Datos del lead
						leadFirstName: leads.firstName,
						leadLastName: leads.lastName,
						leadEmail: leads.email,
						leadTelefono: leads.phone,
					})
					.from(opportunities)
					.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
					.leftJoin(leads, eq(opportunities.leadId, leads.id))
					.where(eq(opportunities.numeroSifco, numeroSifco))
					.limit(1);

				// Datos extras de nuestra BD (para fallback si cartera no tiene)
				let oportunidadData: {
					notes: string | null;
					cuotaMensual: string | null;
					diaPago: number | null;
					creditType: string | null;
				} | null = null;

				let vehicleId: string | null = null;

				if (oportunidadResult.length > 0) {
					const opp = oportunidadResult[0];
					vehicleId = opp.vehicleId;
					vehiculo = {
						make: opp.vehiculoMarca,
						model: opp.vehiculoModelo,
						year: opp.vehiculoYear,
						licensePlate: opp.vehiculoPlaca,
						tipo: opp.vehiculoTipo,
						motor: opp.vehiculoMotor,
						chasis: opp.vehiculoChasis,
						asientos: opp.vehiculoAsientos,
						uso: opp.vehiculoUso,
						// Seguro
						numeroPoliza: opp.vehiculoNumeroPoliza,
						fechaInicioSeguro: opp.vehiculoFechaInicioSeguro,
						fechaVencimientoSeguro: opp.vehiculoFechaVencimientoSeguro,
						montoAsegurado: opp.vehiculoMontoAsegurado,
					};
					leadInfo = {
						nombre:
							`${opp.leadFirstName || ""} ${opp.leadLastName || ""}`.trim(),
						email: opp.leadEmail,
						telefono: opp.leadTelefono,
					};
					direccion = opp.direccion;
					oportunidadData = {
						notes: opp.oportunidadNotes,
						cuotaMensual: opp.oportunidadCuotaMensual,
						diaPago: opp.oportunidadDiaPago,
						creditType: opp.oportunidadCreditType,
					};
				} else {
					// No se encontró oportunidad: auto-crear datos migrate si está habilitado
					const datosMigrate = await autoCrearDatosMigrate({
						numeroSifco,
						nombreCliente: creditoCompleto.usuario.nombre,
						deudaTotal: creditoCompleto.credito.deudatotal,
						cuotaMensual: creditoCompleto.credito.cuota,
						diaPagoMensual: null,
						tipoCredito: creditoCompleto.credito.tipoCredito,
						userId: context.user.id,
					});

					if (datosMigrate) {
						vehicleId = datosMigrate.vehiculoId;
						vehiculo = datosMigrate.vehiculo;
						leadInfo = datosMigrate.leadInfo;
						oportunidadData = datosMigrate.oportunidadData;
					}
				}

				// 4. Buscar o crear caso de cobros automáticamente
				let casoCobro = null;

				// Buscar caso activo
				const casosResult = await db
					.select()
					.from(casosCobros)
					.where(
						and(
							contratoId
								? eq(casosCobros.contratoId, contratoId)
								: eq(casosCobros.numeroCreditoSifco, numeroSifco),
							eq(casosCobros.activo, true),
						),
					)
					.limit(1);
				if (
					casosResult.length === 0 &&
					creditoCompleto.credito.statusCredit !== "CANCELADO"
				) {
					// Crear caso de cobros automáticamente
					if (!context.user?.id) {
						throw new ORPCError("UNAUTHORIZED", {
							message: "Usuario no autenticado",
						});
					}

					const cuotasAtrasadas = creditoCompleto?.mora?.cuotas_atrasadas ?? 0;
					const diasMora = calcularDiasMoraExactos(
						creditoCompleto.cuotasAtrasadas || [],
					);
					const montoEnMora = creditoCompleto.moraActual
						? Number(creditoCompleto.moraActual)
						: 0;

					let estadoMora: (typeof estadoMoraEnum.enumValues)[number] = "al_dia";
					if (diasMora > 0 && diasMora <= 30) estadoMora = "mora_30";
					else if (diasMora > 30 && diasMora <= 60) estadoMora = "mora_60";
					else if (diasMora > 60 && diasMora <= 90) estadoMora = "mora_90";
					else if (diasMora > 90) estadoMora = "mora_120";

					const nuevosCasos = await db
						.insert(casosCobros)
						.values({
							contratoId: contratoId,
							activo: true,
							montoEnMora: montoEnMora.toFixed(2),
							diasMoraMaximo: diasMora,
							cuotasVencidas: cuotasAtrasadas,
							estadoMora,
							responsableCobros: context.user.id,
							telefonoPrincipal: leadInfo?.telefono || "00000000",
							emailContacto: leadInfo?.email || "sin-email@example.com",
							direccionContacto: direccion || "Sin dirección",
							numeroCreditoSifco: numeroSifco,
						})
						.returning();
					casoCobro = nuevosCasos[0];
				} else {
					casoCobro = casosResult[0] || null;
				}

				console.log(`COBROSCREDITOSDETALLES ${JSON.stringify(casoCobro)}`);

				// 5. Calcular fecha de inicio (cuota 0) y cuotas restantes
				const todasLasCuotas = [
					...(creditoCompleto.cuotasPagadas || []),
					...(creditoCompleto.cuotasPendientes || []),
					...(creditoCompleto.cuotasAtrasadas || []),
				];
				const cuota0 = todasLasCuotas.find((c) => c.numero_cuota === 0);
				const fechaInicioCuota0 = cuota0?.fecha_vencimiento || null;
				const cuotasPagadasCount = creditoCompleto.cuotasPagadas?.length || 0;
				const totalCuotas = creditoCompleto.credito.plazo || 0;
				let cuotasRestantes = totalCuotas;
				if (cuota0?.pagado) {
					cuotasRestantes = totalCuotas - cuotasPagadasCount + 1;
				} else {
					cuotasRestantes = totalCuotas - cuotasPagadasCount;
				}

				// 6. Mapear datos correctamente
				const cuotasAtrasadas = creditoCompleto.cuotasAtrasadas?.length || 0;
				const cuotaMensual = Number(creditoCompleto.credito.cuota ?? 0);
				// Calcular días de mora exactos usando la fecha de vencimiento
				const diasMora = calcularDiasMoraExactos(
					creditoCompleto.cuotasAtrasadas || [],
				);
				const montoEnMora =
					Number(creditoCompleto.moraActual) || cuotaMensual * cuotasAtrasadas;

				let estadoMora: string | null = null;
				if (diasMora === 0) estadoMora = "al_dia";
				else if (diasMora <= 30) estadoMora = "mora_30";
				else if (diasMora <= 60) estadoMora = "mora_60";
				else if (diasMora <= 90) estadoMora = "mora_90";
				else estadoMora = "mora_120";

				const statusCredit = creditoCompleto.credito.statusCredit;
				let estadoContrato = "activo";
				if (statusCredit === "CANCELADO") estadoContrato = "completado";
				else if (statusCredit === "INCOBRABLE") estadoContrato = "incobrable";

				return {
					// ID del caso de cobros (si existe)
					id: casoCobro?.id || null,
					contratoId: contratoId,

					// Datos de mora
					estadoMora,
					montoEnMora: montoEnMora.toFixed(2),
					diasMoraMaximo: diasMora,
					cuotasVencidas: cuotasAtrasadas,

					// Datos de contacto (del caso de cobros primero, fallback al lead)
					telefonoPrincipal: casoCobro?.telefonoPrincipal || leadInfo?.telefono || null,
					telefonoAlternativo: casoCobro?.telefonoAlternativo || null,
					emailContacto: casoCobro?.emailContacto || leadInfo?.email || null,
					direccionContacto: direccion || null,
					proximoContacto: casoCobro?.proximoContacto || null,
					metodoContactoProximo: null,

					// Datos del contrato (cartera primero, fallback a nuestra BD)
					montoFinanciado: creditoCompleto.credito.deudatotal,
					cuotaMensual:
						creditoCompleto.credito.cuota || oportunidadData?.cuotaMensual,
					numeroCuotas: creditoCompleto.credito.plazo,
					fechaInicio: creditoCompleto.credito.fecha_creacion,
					diaPagoMensual: oportunidadData?.diaPago || null,
					estadoContrato,

					// Datos del cliente (de cartera-back o lead)
					clienteNombre: leadInfo?.nombre || creditoCompleto.usuario.nombre,
					clienteNit: creditoCompleto.usuario.nit,

					// Datos del vehículo (de la oportunidad)
					vehicleId,
					vehiculoMarca: vehiculo?.make || "-",
					vehiculoModelo: vehiculo?.model || "-",
					vehiculoYear: vehiculo?.year || null,
					vehiculoPlaca: vehiculo?.licensePlate || null,
					vehiculoTipo: vehiculo?.tipo || null,
					vehiculoMotor: vehiculo?.motor || null,
					vehiculoChasis: vehiculo?.chasis || null,
					vehiculoAsientos: vehiculo?.asientos || null,
					vehiculoUso: vehiculo?.uso || null,
					// Seguro del vehículo
					vehiculoNumeroPoliza: vehiculo?.numeroPoliza || null,
					vehiculoFechaInicioSeguro: vehiculo?.fechaInicioSeguro || null,
					vehiculoFechaVencimientoSeguro:
						vehiculo?.fechaVencimientoSeguro || null,
					vehiculoMontoAsegurado: vehiculo?.montoAsegurado || null,

					// Datos adicionales de Cartera-Back
					numeroCreditoSifco: creditoCompleto.credito.numero_credito_sifco,
					deudaTotal: creditoCompleto.credito.deudatotal,
					asesor: null, // Cartera-back no devuelve asesor completo en endpoint /credito

					// Notas de la oportunidad
					oportunidadNotes: oportunidadData?.notes || null,
					creditType: oportunidadData?.creditType || null,

					// Campos calculados
					fechaInicioCuota0,
					cuotasRestantes,
				};
			} catch (error) {
				console.error("[Cobros] Error obteniendo detalles de crédito:", error);
				throw error;
			}
		}),

	// ========================================================================
	// INTEGRACIÓN CON CARTERA-BACK - PAGOS
	// ========================================================================

	// Registrar pago en cartera-back
	registrarPago: cobrosProcedure
		.input(
			z.object({
				numeroSifco: z.string(),
				cuotaId: z.number().optional(),
				fechaPago: z.string(), // ISO date string
				montoBoleta: z.number(),
				numeroAutorizacion: z.string().optional(),
				observaciones: z.string().optional(),
				casoCobroId: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Verify the credit exists and user has access
			const reference = await getCreditoReferenceByNumeroSifco(
				input.numeroSifco,
			);

			if (!reference) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Crédito ${input.numeroSifco} no encontrado en el sistema`,
				});
			}

			// Register payment in cartera-back
			const result = await createPagoInCarteraBack({
				credito_numero_sifco: input.numeroSifco,
				cuota_id: input.cuotaId,
				fecha_pago: input.fechaPago,
				monto_boleta: input.montoBoleta,
				numeroAutorizacion: input.numeroAutorizacion,
				observaciones: input.observaciones,
				casoCobroId: input.casoCobroId,
				userId: context.userId,
			});

			if (!result.success) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Error registrando pago: ${result.error}`,
				});
			}

			return {
				success: true,
				pago_id: result.pago_id,
				message: "Pago registrado exitosamente",
			};
		}),

	// Obtener historial de pagos de un crédito desde cartera-back
	getHistorialPagosCarteraBack: cobrosProcedure
		.input(
			z.object({
				numeroSifco: z.string(),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			if (!isCarteraBackPaymentsEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración de pagos con cartera-back no está habilitada",
				});
			}

			try {
				const pagos = await carteraBackClient.getPagosByCredito(
					input.numeroSifco,
				);

				return {
					numeroSifco: input.numeroSifco,
					totalPagos: pagos.length,
					pagos: pagos.map((pago) => ({
						pagoId: pago.pago_id,
						fechaPago: pago.fecha_pago,
						cuotaId: pago.cuota_id,
						montoBoleta: pago.monto_boleta,
						abonoCapital: pago.abono_capital,
						abonoInteres: pago.abono_interes,
						abonoIva: pago.abono_iva_12,
						abonoSeguro: pago.abono_seguro,
						abonoGps: pago.abono_gps,
						mora: pago.mora,
						capitalRestante: pago.capital_restante,
						totalRestante: pago.total_restante,
						numeroAutorizacion: pago.numeroAutorizacion,
						observaciones: pago.observaciones,
						pagado: pago.pagado,
						validationStatus: pago.validationStatus,
						// Investor distribution
						distribucionInversionistas: pago.pagos_inversionistas?.map(
							(pi) => ({
								inversionistaId: pi.inversionista_id,
								inversionistaNombre: pi.inversionista?.nombre,
								abonoCapital: pi.abono_capital,
								abonoInteres: pi.abono_interes,
								abonoIva: pi.abono_iva_12,
								porcentajeParticipacion: pi.porcentaje_participacion,
								estadoLiquidacion: pi.estado_liquidacion,
							}),
						),
					})),
				};
			} catch (error) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Error obteniendo historial de pagos: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		}),

	// Obtener detalles completos de un crédito desde cartera-back
	getCreditoCarteraBack: cobrosProcedure
		.input(
			z.object({
				numeroSifco: z.string(),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			if (!isCarteraBackPaymentsEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}

			try {
				const creditoData = await carteraBackClient.getCredito(
					input.numeroSifco,
				);

				// Combinar todas las cuotas
				const todasCuotas = [
					...(creditoData.cuotasPagadas || []),
					...(creditoData.cuotasPendientes || []),
					...(creditoData.cuotasAtrasadas || []),
				];

				return {
					creditoId: creditoData.credito.credito_id,
					numeroSifco: creditoData.credito.numero_credito_sifco,
					fechaCreacion: creditoData.credito.fecha_creacion,
					capital: creditoData.credito.capital,
					porcentajeInteres: creditoData.credito.porcentaje_interes,
					deudaTotal: creditoData.credito.deudatotal,
					cuota: creditoData.credito.cuota,
					plazo: creditoData.credito.plazo,
					statusCredit: creditoData.credito.statusCredit,
					observaciones: creditoData.credito.observaciones,
					// Cliente
					usuario: {
						usuarioId: creditoData.usuario.usuario_id,
						nombre: creditoData.usuario.nombre,
						nit: creditoData.usuario.nit,
						categoria: creditoData.usuario.categoria,
						saldoAFavor: creditoData.usuario.saldo_a_favor,
					},
					// Asesor (no disponible en endpoint /credito)
					asesor: null,
					// Cuotas
					cuotas: todasCuotas.map((cuota) => ({
						cuotaId: cuota.cuota_id,
						numeroCuota: cuota.numero_cuota,
						fechaVencimiento: cuota.fecha_vencimiento,
						pagado: cuota.pagado,
					})),
					// Moras (no disponible en endpoint /credito)
					moras: [],
					// Inversionistas (no disponible en endpoint /credito)
					inversionistas: [],
					// Calculated fields
					cuotasPagadas: creditoData.cuotasPagadas?.length || 0,
					cuotasPendientes: creditoData.cuotasPendientes?.length || 0,
					capitalRestante: null, // No disponible en endpoint /credito
					interesRestante: null, // No disponible en endpoint /credito
					totalRestante: null, // No disponible en endpoint /credito
					diasMora: creditoData.cuotasAtrasadas?.length
						? creditoData.cuotasAtrasadas.length * 30
						: 0,
					montoMora: creditoData.moraActual, // ya es string
					cuotasAtrasadas: creditoData.cuotasAtrasadas?.length || 0,
				};
			} catch (error) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Error obteniendo crédito de cartera-back: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		}),

	// ========================================================================
	// SINCRONIZACIÓN DE CASOS DE COBROS
	// ========================================================================

	// Ejecutar sincronización de casos de cobros (admin y supervisor de cobros)
	sincronizarCasosCobros: cobrosSupervisorProcedure
		.input(
			z.object({
				mes: z.number().min(0).max(12).optional(), // 0 = todos los meses
				anio: z.number().min(2000).max(2100).optional(),
				forceSyncAll: z.boolean().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const result = await sincronizarCasosCobros({
				mes: input.mes,
				anio: input.anio,
				forceSyncAll: input.forceSyncAll,
				userId: context.user.id,
			});

			return {
				success: result.success,
				casosCreados: result.casosCreados,
				casosActualizados: result.casosActualizados,
				casosCerrados: result.casosCerrados,
				errors: result.errors,
				duracionMs: result.duration,
				mensaje:
					result.errors.length > 0
						? `Sincronización completada con ${result.errors.length} errores`
						: "Sincronización completada exitosamente",
			};
		}),

	// Obtener historial de sincronizaciones recientes
	getHistorialSincronizaciones: cobrosSupervisorProcedure
		.input(
			z.object({
				limit: z.number().min(1).max(100).optional().default(10),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			const sincronizaciones = await getUltimasSincronizaciones(input.limit);

			return {
				total: sincronizaciones.length,
				sincronizaciones,
			};
		}),

	// ========================================================================
	// INVERSIONISTAS
	// ========================================================================

	// Listar todos los inversionistas
	getInversionistas: crmOrCobrosProcedure
		.input(
			z.object({
				page: z.number().min(1).optional().default(1),
				perPage: z.number().min(1).max(100).optional().default(20),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			if (!isCarteraBackPaymentsEnabled()) {
				console.log(
					"[getInversionistas] Cartera-back integration is NOT enabled",
				);
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}

			try {
				const result = await carteraBackClient.getInvestors({
					page: input.page,
					perPage: input.perPage,
				});

				return {
					inversionistas: result.data.map((inv) => ({
						inversionistaId: inv.inversionista_id,
						nombre: inv.nombre,
						emiteFactura: inv.emite_factura,
						reinversion: inv.reinversion,
						banco: inv.banco,
						tipoCuenta: inv.tipo_cuenta,
						numeroCuenta: inv.numero_cuenta,
					})),
					pagination: {
						page: result.page,
						perPage: result.perPage,
						total: result.total,
						totalPages: result.totalPages,
					},
				};
			} catch (error) {
				console.error("[getInversionistas] Error occurred:", error);
				console.error(
					"[getInversionistas] Error stack:",
					error instanceof Error ? error.stack : "No stack",
				);
				throw new ORPCError("BAD_REQUEST", {
					message: `Error obteniendo inversionistas: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		}),

	// Obtener detalle de un inversionista con sus créditos
	getDetalleInversionista: cobrosProcedure
		.input(
			z.object({
				inversionistaId: z.number(),
				page: z.number().min(1).optional().default(1),
				perPage: z.number().min(1).max(100).optional().default(10),
				numeroCreditoSifco: z.string().optional(),
				nombreUsuario: z.string().optional(),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			if (!isCarteraBackPaymentsEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}

			try {
				const reporte = await carteraBackClient.getInvestorReport({
					id: input.inversionistaId,
					page: input.page,
					perPage: input.perPage,
					numeroCreditoSifco: input.numeroCreditoSifco,
					nombreUsuario: input.nombreUsuario,
				});

				return {
					inversionista: {
						inversionistaId: reporte.inversionista.inversionista_id,
						nombre: reporte.inversionista.nombre,
						emiteFactura: reporte.inversionista.emite_factura,
						reinversion: reporte.inversionista.reinversion,
						banco: reporte.inversionista.banco,
						tipoCuenta: reporte.inversionista.tipo_cuenta,
						numeroCuenta: reporte.inversionista.numero_cuenta,
					},
					creditos: reporte.creditos.map((creditoData) => ({
						// Datos del crédito
						creditoId: creditoData.credito.credito_id,
						numeroSifco: creditoData.credito.numero_credito_sifco,
						capital: creditoData.credito.capital,
						statusCredit: creditoData.credito.statusCredit,
						fechaCreacion: creditoData.credito.fecha_creacion,
						// Datos del cliente
						clienteNombre: creditoData.usuario.nombre,
						clienteNit: creditoData.usuario.nit,
						// Participación del inversionista
						porcentajeParticipacion:
							creditoData.participacion.porcentaje_participacion_inversionista,
						montoAportado: creditoData.participacion.monto_aportado,
						cuotaInversionista: creditoData.participacion.cuota_inversionista,
						// Montos recuperados
						montoRecuperado: creditoData.montoRecuperado,
						montoPendiente: creditoData.montoPendiente,
						// Pagos
						totalPagos: creditoData.pagos.length,
						pagos: creditoData.pagos.map((pagoDetalle) => ({
							pagoId: pagoDetalle.pago.pago_id,
							fechaPago: pagoDetalle.pago.fecha_pago,
							montoBoleta: pagoDetalle.pago.monto_boleta,
							abonoCapital: pagoDetalle.distribucion.abono_capital,
							abonoInteres: pagoDetalle.distribucion.abono_interes,
							abonoIva: pagoDetalle.distribucion.abono_iva_12,
							estadoLiquidacion: pagoDetalle.distribucion.estado_liquidacion,
						})),
					})),
					totales: {
						montoTotalAportado: reporte.totales.montoTotalAportado,
						montoTotalRecuperado: reporte.totales.montoTotalRecuperado,
						montoTotalPendiente: reporte.totales.montoTotalPendiente,
						creditosActivos: reporte.totales.creditosActivos,
						creditosCancelados: reporte.totales.creditosCancelados,
						porcentajeRecuperacion: reporte.totales.porcentajeRecuperacion,
					},
				};
			} catch (error) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Error obteniendo detalle de inversionista: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		}),

	// Obtener inversionistas de un crédito específico
	getInversionistasDelCredito: cobrosProcedure
		.input(
			z.object({
				numeroSifco: z.string(),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			if (!isCarteraBackPaymentsEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}

			try {
				const creditoData = await carteraBackClient.getCredito(
					input.numeroSifco,
				);

				return {
					numeroSifco: creditoData.credito.numero_credito_sifco,
					capital: creditoData.credito.capital,
					statusCredit: creditoData.credito.statusCredit,
					// El endpoint /credito no incluye inversionistas
					inversionistas: [],
				};

				/* Código original comentado - el endpoint /credito no retorna inversionistas
				return {
					numeroSifco: creditoData.credito.numero_credito_sifco,
					capital: creditoData.credito.capital,
					statusCredit: creditoData.credito.statusCredit,
					inversionistas:
						creditoData.creditos_inversionistas?.map((ci) => ({
							inversionistaId: ci.inversionista_id,
							inversionistaNombre: ci.inversionista?.nombre,
							porcentajeParticipacion:
								ci.porcentaje_participacion_inversionista,
							montoAportado: ci.monto_aportado,
							cuotaInversionista: ci.cuota_inversionista,
							porcentajeCashIn: ci.porcentaje_cash_in,
							ivaInversionista: ci.iva_inversionista,
							montoInversionista: ci.monto_inversionista,
							montoCashIn: ci.monto_cash_in,
						})) || [],
				};
				*/
			} catch (error) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Error obteniendo inversionistas del crédito: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		}),

	// ========================================================================
	// ASESORES
	// ========================================================================

	// Listar todos los asesores
	getAsesores: crmOrCobrosProcedure
		.input(
			z.object({
				page: z.number().min(1).optional().default(1),
				perPage: z.number().min(1).max(100).optional().default(20),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			console.log("[getAsesores] Handler called with input:", input);

			if (!isCarteraBackPaymentsEnabled()) {
				console.log("[getAsesores] Cartera-back integration is NOT enabled");
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}

			console.log("[getAsesores] Cartera-back integration is enabled");

			try {
				console.log(
					"[getAsesores] Calling carteraBackClient.getAdvisors with params:",
					{
						page: input.page,
						perPage: input.perPage,
					},
				);

				const result = await carteraBackClient.getAdvisors({
					page: input.page,
					perPage: input.perPage,
				});

				console.log(
					"[getAsesores] Result received:",
					JSON.stringify(result, null, 2),
				);

				return {
					asesores: result.data.map((asesor) => ({
						asesorId: asesor.asesor_id,
						nombre: asesor.nombre,
						activo: asesor.activo,
						email: asesor.email,
						isActive: asesor.is_active,
					})),
					pagination: {
						page: result.page,
						perPage: result.perPage,
						total: result.total,
						totalPages: result.totalPages,
					},
				};
			} catch (error) {
				console.error("[getAsesores] Error occurred:", error);
				console.error(
					"[getAsesores] Error stack:",
					error instanceof Error ? error.stack : "No stack",
				);
				throw new ORPCError("BAD_REQUEST", {
					message: `Error obteniendo asesores: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		}),

	// ============================================================================
	// ACTUALIZAR INFO DE CONTACTO
	// ============================================================================

	updateContactInfoCobros: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				telefonoPrincipal: z.string().min(1),
				telefonoAlternativo: z.string().optional(),
				emailContacto: z.string().email().optional().or(z.literal("")),
			}),
		)
		.handler(async ({ input }) => {
			const [updated] = await db
				.update(casosCobros)
				.set({
					telefonoPrincipal: input.telefonoPrincipal,
					telefonoAlternativo: input.telefonoAlternativo || null,
					emailContacto: input.emailContacto || "",
					updatedAt: new Date(),
				})
				.where(eq(casosCobros.id, input.casoCobroId))
				.returning();

			if (!updated) {
				throw new ORPCError("NOT_FOUND", {
					message: "Caso de cobros no encontrado",
				});
			}

			return updated;
		}),

	// ============================================================================
	// CRUD DE REFERENCIAS
	// ============================================================================

	getReferencias: cobrosProcedure
		.input(
			z.object({
				leadId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			const result = await db
				.select()
				.from(referenciasLead)
				.where(eq(referenciasLead.leadId, input.leadId))
				.orderBy(desc(referenciasLead.createdAt));

			return result;
		}),

	createReferencia: cobrosProcedure
		.input(
			z.object({
				leadId: z.string().uuid(),
				nombre: z.string().min(1),
				telefono: z.string().min(1),
				parentesco: z.enum(PARENTESCO_VALUES),
				notas: z.string().optional(),
			}),
		)
		.handler(async ({ input }) => {
			const [created] = await db
				.insert(referenciasLead)
				.values({
					leadId: input.leadId,
					nombre: input.nombre,
					telefono: input.telefono,
					parentesco: input.parentesco,
					notas: input.notas || null,
				})
				.returning();

			return created;
		}),

	updateReferencia: cobrosProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				leadId: z.string().uuid(),
				nombre: z.string().min(1),
				telefono: z.string().min(1),
				parentesco: z.enum(PARENTESCO_VALUES),
				notas: z.string().optional(),
			}),
		)
		.handler(async ({ input }) => {
			const [updated] = await db
				.update(referenciasLead)
				.set({
					nombre: input.nombre,
					telefono: input.telefono,
					parentesco: input.parentesco,
					notas: input.notas || null,
					updatedAt: new Date(),
				})
				.where(and(eq(referenciasLead.id, input.id), eq(referenciasLead.leadId, input.leadId)))
				.returning();

			if (!updated) {
				throw new ORPCError("NOT_FOUND", {
					message: "Referencia no encontrada",
				});
			}

			return updated;
		}),

	deleteReferencia: cobrosProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				leadId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			const [deleted] = await db
				.delete(referenciasLead)
				.where(and(eq(referenciasLead.id, input.id), eq(referenciasLead.leadId, input.leadId)))
				.returning();

			if (!deleted) {
				throw new ORPCError("NOT_FOUND", {
					message: "Referencia no encontrada",
				});
			}

			return { success: true };
		}),
};
