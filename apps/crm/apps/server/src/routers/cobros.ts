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
	cuotasPago,
	estadoContactoEnum,
	estadoMoraEnum,
	metodoContactoEnum,
	recuperacionesVehiculo,
} from "../db/schema/cobros";
import { clients } from "../db/schema/crm";
import { vehicles } from "../db/schema/vehicles";
import { adminProcedure, cobrosProcedure } from "../lib/orpc";
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
}) {
	const estados: Array<
		"ACTIVO" | "CANCELADO" | "INCOBRABLE" | "PENDIENTE_CANCELACION" | "MOROSO"
	> = ["ACTIVO", "CANCELADO", "INCOBRABLE", "PENDIENTE_CANCELACION", "MOROSO"];

	console.log(
		`[Cobros] Obteniendo créditos de todos los estados: ${estados.join(", ")}`,
	);

	// Hacer llamadas en paralelo para todos los estados
	const responses = await Promise.all(
		estados.map((estado) =>
			carteraBackClient
				.getAllCreditos({
					...params,
					estado,
				})
				.catch((error) => {
					console.error(`[Cobros] Error obteniendo créditos ${estado}:`, error);
					// Retornar respuesta vacía si falla
					return {
						data: [],
						page: params.page || 1,
						perPage: params.perPage || 1000,
						totalCount: 0,
						totalPages: 0,
					};
				}),
		),
	);

	// Combinar todos los resultados
	const todosLosCreditos = responses.flatMap((response) => response.data);

	console.log(
		`[Cobros] Total de créditos obtenidos: ${todosLosCreditos.length}`,
	);

	return {
		data: todosLosCreditos,
		page: params.page || 1,
		perPage: params.perPage || 1000,
		totalCount: todosLosCreditos.length,
		totalPages: Math.ceil(
			todosLosCreditos.length / (params.perPage || 1000),
		),
	};
}

export const cobrosRouter = {
	// Dashboard de cobros - Vista general del embudo
	getDashboardStats: cobrosProcedure.handler(async ({ context }) => {
		// Si la integración con Cartera-Back está habilitada, calcular stats desde Cartera-Back
		if (isCarteraBackEnabled()) {
			try {
				// Usar mes=0 para obtener TODOS los créditos sin filtrar por mes
				// (el backend de cartera-back trata mes=0 como "sin filtro de fecha")
				const mes = 0;
				const anio = new Date().getFullYear();

				console.log(
					`[Cobros] Calculando stats desde Cartera-Back: mes=${mes} (todos), anio=${anio}`,
				);

				// Obtener todos los créditos de Cartera-Back de todos los estados
				const creditosResponse = await obtenerTodosLosCreditosCarteraBack({
					mes,
					anio,
					page: 1,
					perPage: 10000, // Obtener todos para calcular stats
				});

				if (!creditosResponse || !creditosResponse.data) {
					throw new Error("Estructura de respuesta inválida");
				}

				// Procesar estadísticas para el embudo
				const embudoStats = {
					al_dia: { totalCases: 0, montoTotal: "0" },
					mora_30: { totalCases: 0, montoTotal: "0" },
					mora_60: { totalCases: 0, montoTotal: "0" },
					mora_90: { totalCases: 0, montoTotal: "0" },
					mora_120: { totalCases: 0, montoTotal: "0" },
					pagado: { totalCases: 0, montoTotal: "0" },
					incobrable: { totalCases: 0, montoTotal: "0" },
					completado: { totalCases: 0, montoTotal: "0" },
				};

				// Contar créditos por estado de mora
				for (const credito of creditosResponse.data) {
					// Acceder a los datos anidados correctamente
					const statusCredit = credito.creditos.statusCredit;
					const cuotasAtrasadas = credito.mora?.cuotas_atrasadas ?? 0;
					const montoMora = Number(credito.mora?.monto_mora ?? 0);

					// NOTA: Usamos aproximación (30 días por cuota) porque /getAllCredits
					// NO retorna las fechas de vencimiento de las cuotas individuales.
					// Solo /credito retorna el array completo con fechas para cálculo exacto.
					const diasMora = cuotasAtrasadas * 30;

					// Determinar estado de mora
					let estadoMora: keyof typeof embudoStats;
					if (statusCredit === "CANCELADO") {
						estadoMora = "completado";
					} else if (statusCredit === "INCOBRABLE") {
						estadoMora = "incobrable";
					} else if (diasMora === 0) {
						estadoMora = "al_dia";
					} else if (diasMora <= 30) {
						estadoMora = "mora_30";
					} else if (diasMora <= 60) {
						estadoMora = "mora_60";
					} else if (diasMora <= 90) {
						estadoMora = "mora_90";
					} else {
						estadoMora = "mora_120";
					}

					embudoStats[estadoMora].totalCases += 1;
					const currentMonto = Number(embudoStats[estadoMora].montoTotal);
					embudoStats[estadoMora].montoTotal = (
						currentMonto + montoMora
					).toString();
				}

				console.log(
					`[Cobros] Stats calculadas desde Cartera-Back:`,
					embudoStats,
				);

				return {
					estatusStats: Object.entries(embudoStats).map(([estado, data]) => ({
						estadoMora: estado,
						...data,
					})),
					totalCasosAsignados: creditosResponse.data.filter((c) => {
						const cuotasAtrasadas = c.mora?.cuotas_atrasadas ?? 0;
						return cuotasAtrasadas > 0;
					}).length,
					contactosHoy: 0, // No disponible en Cartera-Back
				};
			} catch (error) {
				console.error(
					"[Cobros] Error calculando stats desde Cartera-Back:",
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
			al_dia: { totalCases: 0, montoTotal: "0" },
			mora_30: { totalCases: 0, montoTotal: "0" },
			mora_60: { totalCases: 0, montoTotal: "0" },
			mora_90: { totalCases: 0, montoTotal: "0" },
			mora_120: { totalCases: 0, montoTotal: "0" },
			pagado: { totalCases: 0, montoTotal: "0" },
			incobrable: { totalCases: 0, montoTotal: "0" },
			completado: { totalCases: 0, montoTotal: "0" },
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
					embudoStats[stat.estadoMora as keyof typeof embudoStats].totalCases +=
						stat.totalCases;
					const currentMonto = Number(
						embudoStats[stat.estadoMora as keyof typeof embudoStats].montoTotal,
					);
					embudoStats[stat.estadoMora as keyof typeof embudoStats].montoTotal =
						(currentMonto + Number(stat.montoTotal)).toString();
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
			contactosHoy: contactosHoy[0]?.count || 0,
		};
	}),

	// Obtener todos los contratos con sus estados (incluyendo al día e incobrables)
	getTodosLosContratos: cobrosProcedure
		.input(
			z.object({
				limit: z.number().default(50),
				offset: z.number().default(0),
			}),
		)
		.handler(async ({ input, context }) => {
			// Si la integración con Cartera-Back está habilitada, obtener datos directamente
			if (isCarteraBackEnabled()) {
				try {
					// Usar mes=0 para obtener TODOS los créditos sin filtrar por mes
					const mes = 0;
					const anio = new Date().getFullYear();

					console.log(
						`[Cobros] Obteniendo créditos de Cartera-Back: mes=${mes} (todos), anio=${anio}`,
					);

					// Obtener todos los créditos de Cartera-Back de todos los estados
					const creditosResponse = await obtenerTodosLosCreditosCarteraBack({
						mes,
						anio,
						page: Math.floor(input.offset / input.limit) + 1,
						perPage: input.limit,
					});

					// Validar que la respuesta tenga la estructura esperada
					if (!creditosResponse || !creditosResponse.data) {
						console.error(
							"[Cobros] Respuesta inválida de Cartera-Back:",
							creditosResponse,
						);
						throw new Error("Estructura de respuesta inválida");
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

							return {
								contratoId: credito.creditos.credito_id.toString(),
								clienteNombre: credito.usuarios.nombre,
								vehiculoMarca: "-",
								vehiculoModelo: "-",
								vehiculoYear: null,
								vehiculoPlaca: credito.creditos.numero_credito_sifco,
								estadoContrato,
								montoFinanciado: credito.creditos.capital.toString(),
								cuotaMensual: credito.creditos.cuota.toString(),
								diaPagoMensual: null,
								responsableCobros: null,
								casoCobroId: null,
								estadoMora,
								montoEnMora: montoEnMora.toFixed(2),
								diasMoraMaximo: diasMora,
								cuotasVencidas: cuotasAtrasadas,
								telefonoPrincipal: null,
								proximoContacto: null,
								responsableNombre: null,
							};
						}),
					);

					return contratos;
				} catch (error) {
					console.error(
						"[Cobros] Error obteniendo datos de Cartera-Back:",
						error,
					);
					// Fallback a datos locales en caso de error
				}
			}

			// Fallback: Obtener datos de la base de datos local
			const contratos = await db
				.select({
					contratoId: contratosFinanciamiento.id,
					clienteNombre: clients.contactPerson,
					vehiculoMarca: vehicles.make,
					vehiculoModelo: vehicles.model,
					vehiculoYear: vehicles.year,
					vehiculoPlaca: vehicles.licensePlate,
					estadoContrato: contratosFinanciamiento.estado,
					montoFinanciado: contratosFinanciamiento.montoFinanciado,
					cuotaMensual: contratosFinanciamiento.cuotaMensual,
					diaPagoMensual: contratosFinanciamiento.diaPagoMensual,
					responsableCobros: contratosFinanciamiento.responsableCobros,
					// Datos del caso de cobros (si existe)
					casoCobroId: casosCobros.id,
					estadoMora: casosCobros.estadoMora,
					montoEnMora: casosCobros.montoEnMora,
					diasMoraMaximo: casosCobros.diasMoraMaximo,
					cuotasVencidas: casosCobros.cuotasVencidas,
					telefonoPrincipal: casosCobros.telefonoPrincipal,
					proximoContacto: casosCobros.proximoContacto,
					responsableNombre: user.name,
				})
				.from(contratosFinanciamiento)
				.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
				.leftJoin(vehicles, eq(contratosFinanciamiento.vehicleId, vehicles.id))
				.leftJoin(
					casosCobros,
					eq(contratosFinanciamiento.id, casosCobros.contratoId),
				)
				.leftJoin(user, eq(contratosFinanciamiento.responsableCobros, user.id))
				.limit(input.limit)
				.offset(input.offset);

			return contratos;
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

			// Si no es admin, solo ver casos asignados
			if (context.userRole !== "admin") {
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
			const whereClause =
				context.userRole === "admin"
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
			if (context.userRole !== "admin") {
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
					throw new Error("No tienes permiso para acceder a este caso");
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
			if (context.userRole !== "admin") {
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
					throw new Error("No tienes permiso para acceder a este caso");
				}
			}

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
			// Solo admin o usuario asignado pueden crear convenios
			if (context.userRole !== "admin") {
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
					throw new Error(
						"No tienes permiso para crear convenios en este caso",
					);
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
			if (context.userRole !== "admin") {
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
					throw new Error("No tienes permiso para ver convenios de este caso");
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
	asignarResponsableCobros: adminProcedure
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
				throw new Error("Usuario no encontrado");
			}

			if (responsable[0].role !== "cobros" && responsable[0].role !== "admin") {
				throw new Error("El usuario debe tener rol de cobros o admin");
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
	getUsuariosCobros: adminProcedure.handler(async () => {
		const usuarios = await db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				role: user.role,
			})
			.from(user)
			.where(or(eq(user.role, "cobros"), eq(user.role, "admin")))
			.orderBy(asc(user.name));

		return usuarios;
	}),

	// Obtener historial de cuotas de pago de un contrato
	getHistorialPagos: cobrosProcedure
		.input(z.object({ contratoId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			try {
				console.log("📋 getHistorialPagos - Inicio", {
					contratoId: input.contratoId,
					userId: context.userId,
					userRole: context.userRole,
				});

				// Verificar que el contrato existe
				console.log(
					"🔍 Verificando existencia del contrato:",
					input.contratoId,
				);
				const contrato = await db
					.select({
						id: contratosFinanciamiento.id,
						responsableCobros: contratosFinanciamiento.responsableCobros,
						estado: contratosFinanciamiento.estado,
					})
					.from(contratosFinanciamiento)
					.where(eq(contratosFinanciamiento.id, input.contratoId))
					.limit(1);

				console.log("✅ Resultado búsqueda contrato:", {
					encontrado: contrato.length > 0,
					estado: contrato[0]?.estado,
					responsable: contrato[0]?.responsableCobros,
				});

				if (!contrato.length) {
					console.error("❌ Contrato no encontrado");
					throw new Error("Contrato no encontrado");
				}

				// Verificar permisos (admin o responsable del contrato)
				console.log("🔐 Verificando permisos:", {
					esAdmin: context.userRole === "admin",
					responsableContrato: contrato[0].responsableCobros,
					usuarioActual: context.userId,
					tienePermiso:
						context.userRole === "admin" ||
						contrato[0].responsableCobros === context.userId,
				});

				if (
					context.userRole !== "admin" &&
					contrato[0].responsableCobros !== context.userId
				) {
					console.error("❌ Sin permisos para ver historial");
					throw new Error("No tienes permiso para ver este historial");
				}

				// Verificar si el contrato tiene referencia a cartera-back
				if (isCarteraBackEnabled()) {
					const reference = await db
						.select()
						.from(carteraBackReferences)
						.where(
							eq(carteraBackReferences.contratoFinanciamientoId, input.contratoId),
						)
						.limit(1);

					if (reference.length > 0) {
						console.log(
							"🔗 Contrato vinculado a cartera-back, obteniendo cuotas de allá",
						);

						try {
							// Obtener crédito completo de cartera-back
							const creditoCompleto = await carteraBackClient.getCredito(
								reference[0].numeroCreditoSifco,
							);

							// Combinar todas las cuotas (pagadas, pendientes, atrasadas)
							const todasLasCuotas = [
								...(creditoCompleto.cuotasPagadas || []),
								...(creditoCompleto.cuotasPendientes || []),
								...(creditoCompleto.cuotasAtrasadas || []),
							].sort((a, b) => a.numero_cuota - b.numero_cuota);

							// Mapear a estructura esperada por frontend
							return todasLasCuotas.map((cuota) => ({
								id: cuota.cuota_id.toString(),
								numeroCuota: cuota.numero_cuota,
								fechaVencimiento: cuota.fecha_vencimiento,
								montoCuota: creditoCompleto.credito.cuota,
								fechaPago: cuota.pagado ? cuota.fecha_vencimiento : null,
								montoPagado: cuota.pagado ? creditoCompleto.credito.cuota : null,
								montoMora: "0", // TODO: calcular mora real
								estadoMora: cuota.pagado ? "pagado" : "mora_30",
								diasMora: 0,
							}));
						} catch (error) {
							console.warn(
								`⚠️ No se pudieron obtener cuotas de cartera-back para ${reference[0].numeroCreditoSifco}:`,
								error instanceof Error ? error.message : error,
							);
							console.log(
								"📊 Fallback: intentando obtener cuotas desde DB local...",
							);
							// Continuar con DB local más abajo
						}
					}
				}

				// Si no hay referencia o cartera-back no está habilitado, usar DB local
				console.log("📊 Obteniendo cuotas de pago desde DB local...");
				const cuotas = await db
					.select({
						id: cuotasPago.id,
						numeroCuota: cuotasPago.numeroCuota,
						fechaVencimiento: cuotasPago.fechaVencimiento,
						montoCuota: cuotasPago.montoCuota,
						fechaPago: cuotasPago.fechaPago,
						montoPagado: cuotasPago.montoPagado,
						montoMora: cuotasPago.montoMora,
						estadoMora: cuotasPago.estadoMora,
						diasMora: cuotasPago.diasMora,
					})
					.from(cuotasPago)
					.where(eq(cuotasPago.contratoId, input.contratoId))
					.orderBy(asc(cuotasPago.numeroCuota));

				console.log("✅ Cuotas obtenidas:", {
					cantidad: cuotas.length,
				});

				return cuotas;
			} catch (error) {
				console.error("💥 Error en getHistorialPagos:", {
					error: error instanceof Error ? error.message : error,
					stack: error instanceof Error ? error.stack : undefined,
					contratoId: input.contratoId,
				});
				throw error;
			}
		}),

	// Obtener información de recuperación de vehículo
	getRecuperacionVehiculo: cobrosProcedure
		.input(z.object({ casoCobroId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			// Verificar acceso
			if (context.userRole !== "admin") {
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
					throw new Error("No tienes permiso para ver esta información");
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
				const whereClause =
					context.userRole === "admin"
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
					emailContacto: sql<string>`COALESCE(${casosCobros.emailContacto}, 'cliente@email.com')`,
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
				throw new Error("Integración con Cartera-Back no está habilitada");
			}

			try {
				const creditoIdNum = Number.parseInt(input.creditoId);

				// 1. Buscar referencia por credito_id numérico
				let reference = await db
					.select()
					.from(carteraBackReferences)
					.where(eq(carteraBackReferences.carteraCreditoId, creditoIdNum))
					.limit(1);

				let numeroSifco: string;

				if (reference.length === 0) {
					// Si no hay referencia, buscar el crédito en cartera-back
					// usando getAllCredits para encontrar el número SIFCO
					const creditosResponse = await obtenerTodosLosCreditosCarteraBack({
						mes: 0,
						anio: new Date().getFullYear(),
						page: 1,
						perPage: 10000,
					});

					const creditoEncontrado = creditosResponse.data.find(
						(c) => c.creditos.credito_id === creditoIdNum,
					);

					if (!creditoEncontrado) {
						return null; // Crédito no existe
					}

					numeroSifco = creditoEncontrado.creditos.numero_credito_sifco;

					// Crear referencia nueva
					if (!context.user?.id) {
						throw new Error("Usuario no autenticado");
					}

					await db.insert(carteraBackReferences).values({
						carteraCreditoId: creditoIdNum,
						numeroCreditoSifco: numeroSifco,
						syncedAt: new Date(),
						lastSyncStatus: "success",
						createdBy: context.user.id,
					});

					// Reload reference
					reference = await db
						.select()
						.from(carteraBackReferences)
						.where(eq(carteraBackReferences.carteraCreditoId, creditoIdNum))
						.limit(1);
				} else {
					numeroSifco = reference[0].numeroCreditoSifco;
				}

				// 2. Obtener detalles completos del crédito de cartera-back
				let creditoCompleto: CreditoDirectoResponse | null = null;
				let usingFallback = false;

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
							const estadosPosibles: ("ACTIVO" | "MOROSO" | "CANCELADO" | "INCOBRABLE")[] = [
								"ACTIVO",
								"MOROSO",
								"CANCELADO",
								"INCOBRABLE",
							];

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
								usingFallback = true;
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

				if (!creditoCompleto) {
					return null;
				}

				// 3. Obtener datos del vehículo del CRM (si existe referencia a contrato)
				let vehiculo = null;
				let cliente = null;
				if (reference[0]?.contratoFinanciamientoId) {
					const contrato = await db
						.select()
						.from(contratosFinanciamiento)
						.where(
							eq(contratosFinanciamiento.id, reference[0].contratoFinanciamientoId),
						)
						.limit(1);

					if (contrato.length > 0) {
						// Obtener vehículo
						const vehiculoResult = await db
							.select()
							.from(vehicles)
							.where(eq(vehicles.id, contrato[0].vehicleId))
							.limit(1);

						vehiculo = vehiculoResult[0] || null;

						// Obtener cliente para datos de contacto
						const clienteResult = await db
							.select()
							.from(clients)
							.where(eq(clients.id, contrato[0].clientId))
							.limit(1);

						cliente = clienteResult[0] || null;
					}
				}

				// 4. Buscar o crear caso de cobros automáticamente
				let casoCobro = null;

				if (reference[0]?.contratoFinanciamientoId) {
					// Buscar caso activo
					const casosResult = await db
						.select()
						.from(casosCobros)
						.where(
							and(
								eq(casosCobros.contratoId, reference[0].contratoFinanciamientoId),
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
							throw new Error("Usuario no autenticado");
						}

						const cuotasAtrasadas =
							creditoCompleto.cuotasAtrasadas?.length || 0;
						const cuotaMensual = Number(creditoCompleto.credito.cuota ?? 0);
					// Calcular días de mora exactos usando la fecha de vencimiento
					const diasMora = calcularDiasMoraExactos(
						creditoCompleto.cuotasAtrasadas || [],
					);
						const montoEnMora = cuotaMensual * cuotasAtrasadas;

						let estadoMora: (typeof estadoMoraEnum.enumValues)[number] = "al_dia";
						if (diasMora > 0 && diasMora <= 30) estadoMora = "mora_30";
						else if (diasMora > 30 && diasMora <= 60) estadoMora = "mora_60";
						else if (diasMora > 60 && diasMora <= 90) estadoMora = "mora_90";
						else if (diasMora > 90) estadoMora = "mora_120";

						const nuevosCasos = await db
							.insert(casosCobros)
							.values({
								contratoId: reference[0].contratoFinanciamientoId,
								activo: true,
								montoEnMora: montoEnMora.toFixed(2),
								diasMoraMaximo: diasMora,
								cuotasVencidas: cuotasAtrasadas,
								estadoMora,
								responsableCobros: context.user.id,
								telefonoPrincipal: "00000000", // TODO: Obtener de datos reales
								emailContacto: "sin-email@example.com", // TODO: Obtener de datos reales
								direccionContacto: "Sin dirección", // TODO: Obtener de datos reales
							})
							.returning();

						casoCobro = nuevosCasos[0];
					} else {
						casoCobro = casosResult[0] || null;
					}
				}

				// 5. Mapear datos correctamente
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
					contratoId: reference[0]?.contratoFinanciamientoId || null,

					// Datos de mora
					estadoMora,
					montoEnMora: montoEnMora.toFixed(2),
					diasMoraMaximo: diasMora,
					cuotasVencidas: cuotasAtrasadas,

					// Datos de contacto (no disponibles en CRM ni Cartera-Back actualmente)
					telefonoPrincipal: null,
					telefonoAlternativo: null,
					emailContacto: null,
					direccionContacto: null,
					proximoContacto: casoCobro?.proximoContacto || null,
					metodoContactoProximo: null,

					// Datos del contrato (de cartera-back)
					montoFinanciado: creditoCompleto.credito.capital,
					cuotaMensual: creditoCompleto.credito.cuota,
					numeroCuotas: creditoCompleto.credito.plazo,
					fechaInicio: creditoCompleto.credito.fecha_creacion,
					diaPagoMensual: null, // Cartera-back no tiene día de pago específico
					estadoContrato,

					// Datos del cliente (de cartera-back)
					clienteNombre: creditoCompleto.usuario.nombre,
					clienteNit: creditoCompleto.usuario.nit,

					// Datos del vehículo (del CRM si existe)
					vehiculoMarca: vehiculo?.make || "-",
					vehiculoModelo: vehiculo?.model || "-",
					vehiculoYear: vehiculo?.year || null,
					vehiculoPlaca: vehiculo?.licensePlate || creditoCompleto.credito.numero_credito_sifco,

					// Datos adicionales de Cartera-Back
					numeroCreditoSifco: creditoCompleto.credito.numero_credito_sifco,
					deudaTotal: creditoCompleto.credito.deudatotal,
					asesor: null, // Cartera-back no devuelve asesor completo en endpoint /credito
				};
			} catch (error) {
				console.error(
					"[Cobros] Error obteniendo detalles de crédito:",
					error,
				);
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
				throw new Error(
					`Crédito ${input.numeroSifco} no encontrado en el sistema`,
				);
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
				throw new Error(`Error registrando pago: ${result.error}`);
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
				throw new Error(
					"Integración de pagos con cartera-back no está habilitada",
				);
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
				throw new Error(
					`Error obteniendo historial de pagos: ${error instanceof Error ? error.message : String(error)}`,
				);
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
				throw new Error("Integración con cartera-back no está habilitada");
			}

			try {
				const creditoData = await carteraBackClient.getCredito(input.numeroSifco);

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
					diasMora: creditoData.cuotasAtrasadas?.length ? creditoData.cuotasAtrasadas.length * 30 : 0,
					montoMora: creditoData.moraActual, // ya es string
					cuotasAtrasadas: creditoData.cuotasAtrasadas?.length || 0,
				};
			} catch (error) {
				throw new Error(
					`Error obteniendo crédito de cartera-back: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}),

	// ========================================================================
	// SINCRONIZACIÓN DE CASOS DE COBROS
	// ========================================================================

	// Ejecutar sincronización de casos de cobros (admin only)
	sincronizarCasosCobros: adminProcedure
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
	getHistorialSincronizaciones: adminProcedure
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
	getInversionistas: cobrosProcedure
		.input(
			z.object({
				page: z.number().min(1).optional().default(1),
				perPage: z.number().min(1).max(100).optional().default(20),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			if (!isCarteraBackPaymentsEnabled()) {
				throw new Error("Integración con cartera-back no está habilitada");
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
				throw new Error(
					`Error obteniendo inversionistas: ${error instanceof Error ? error.message : String(error)}`,
				);
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
				throw new Error("Integración con cartera-back no está habilitada");
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
				throw new Error(
					`Error obteniendo detalle de inversionista: ${error instanceof Error ? error.message : String(error)}`,
				);
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
				throw new Error("Integración con cartera-back no está habilitada");
			}

			try {
				const creditoData = await carteraBackClient.getCredito(input.numeroSifco);

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
				throw new Error(
					`Error obteniendo inversionistas del crédito: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}),
};
