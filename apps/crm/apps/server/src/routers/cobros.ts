import { and, asc, count, desc, eq, gte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
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
	isCarteraBackPaymentsEnabled,
} from "../services/cartera-back-integration";
import {
	getUltimasSincronizaciones,
	sincronizarCasosCobros,
} from "../services/sync-casos-cobros";

export const cobrosRouter = {
	// Dashboard de cobros - Vista general del embudo
	getDashboardStats: cobrosProcedure.handler(async ({ context }) => {
		// Estadísticas completas incluyendo todos los contratos
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
		.handler(async ({ input }) => {
			// Obtener todos los contratos con información de casos de cobros (si existen)
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

				// Obtener cuotas
				console.log("📊 Obteniendo cuotas de pago...");
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
				const credito = await carteraBackClient.getCredito(input.numeroSifco);

				return {
					creditoId: credito.credito_id,
					numeroSifco: credito.numero_credito_sifco,
					fechaCreacion: credito.fecha_creacion,
					capital: credito.capital,
					porcentajeInteres: credito.porcentaje_interes,
					deudaTotal: credito.deudatotal,
					cuota: credito.cuota,
					plazo: credito.plazo,
					statusCredit: credito.statusCredit,
					observaciones: credito.observaciones,
					// Cliente
					usuario: {
						usuarioId: credito.usuario.usuario_id,
						nombre: credito.usuario.nombre,
						nit: credito.usuario.nit,
						categoria: credito.usuario.categoria,
						saldoAFavor: credito.usuario.saldo_a_favor,
					},
					// Asesor
					asesor: credito.asesor
						? {
								asesorId: credito.asesor.asesor_id,
								nombre: credito.asesor.nombre,
								activo: credito.asesor.activo,
							}
						: null,
					// Cuotas
					cuotas: credito.cuotas.map((cuota) => ({
						cuotaId: cuota.cuota_id,
						numeroCuota: cuota.numero_cuota,
						fechaVencimiento: cuota.fecha_vencimiento,
						pagado: cuota.pagado,
					})),
					// Moras
					moras: credito.moras?.map((mora) => ({
						moraId: mora.mora_id,
						activa: mora.activa,
						porcentajeMora: mora.porcentaje_mora,
						montoMora: mora.monto_mora,
						cuotasAtrasadas: mora.cuotas_atrasadas,
					})),
					// Inversionistas
					inversionistas: credito.creditos_inversionistas?.map((ci) => ({
						inversionistaId: ci.inversionista_id,
						inversionistaNombre: ci.inversionista?.nombre,
						porcentajeParticipacion: ci.porcentaje_participacion_inversionista,
						montoAportado: ci.monto_aportado,
						cuotaInversionista: ci.cuota_inversionista,
					})),
					// Calculated fields
					cuotasPagadas: credito.cuotas_pagadas,
					cuotasPendientes: credito.cuotas_pendientes,
					capitalRestante: credito.capital_restante,
					interesRestante: credito.interes_restante,
					totalRestante: credito.total_restante,
					diasMora: credito.dias_mora,
					montoMora: credito.monto_mora,
					cuotasAtrasadas: credito.cuotas_atrasadas,
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
				mes: z.number().min(1).max(12).optional(),
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
				const credito = await carteraBackClient.getCredito(input.numeroSifco);

				return {
					numeroSifco: credito.numero_credito_sifco,
					capital: credito.capital,
					statusCredit: credito.statusCredit,
					inversionistas:
						credito.creditos_inversionistas?.map((ci) => ({
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
			} catch (error) {
				throw new Error(
					`Error obteniendo inversionistas del crédito: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}),
};
