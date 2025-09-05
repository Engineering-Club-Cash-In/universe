import { and, eq, gte, lte, count, desc, asc, sql, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { clients } from "../db/schema/crm";
import { vehicles } from "../db/schema/vehicles";
import {
	contratosFinanciamiento,
	cuotasPago,
	casosCobros,
	contactosCobros,
	conveniosPago,
	recuperacionesVehiculo,
	notificacionesCobros,
	estadoMoraEnum,
	metodoContactoEnum,
	estadoContactoEnum,
	tipoRecuperacionEnum,
} from "../db/schema/cobros";
import { cobrosProcedure, adminProcedure } from "../lib/orpc";

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
			.leftJoin(casosCobros, eq(contratosFinanciamiento.id, casosCobros.contratoId))
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

		estatusStats.forEach(stat => {
			if (stat.estadoContrato === "completado") {
				embudoStats.completado.totalCases += stat.totalCases;
			} else if (stat.estadoContrato === "incobrable" || stat.estadoContrato === "recuperado") {
				// Contratos incobrables y recuperados van al bucket "incobrable"
				embudoStats.incobrable.totalCases += stat.totalCases;
				const currentMonto = Number(embudoStats.incobrable.montoTotal);
				embudoStats.incobrable.montoTotal = (currentMonto + Number(stat.montoTotal)).toString();
			} else if (stat.estadoContrato === "activo" && !stat.estadoMora) {
				// Contratos activos sin caso de cobros = al día
				embudoStats.al_dia.totalCases += stat.totalCases;
			} else if (stat.estadoMora) {
				// Casos con estado de mora específico
				if (stat.estadoMora in embudoStats) {
					embudoStats[stat.estadoMora as keyof typeof embudoStats].totalCases += stat.totalCases;
					const currentMonto = Number(embudoStats[stat.estadoMora as keyof typeof embudoStats].montoTotal);
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
						eq(casosCobros.responsableCobros, context.userId)
					)
			);

		// Contactos realizados hoy
		const contactosHoy = await db
			.select({ count: count() })
			.from(contactosCobros)
			.where(
				gte(contactosCobros.fechaContacto, new Date(new Date().setHours(0, 0, 0, 0)))
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
			})
		)
		.handler(async ({ input, context }) => {
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
				.leftJoin(casosCobros, eq(contratosFinanciamiento.id, casosCobros.contratoId))
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
			})
		)
		.handler(async ({ input, context }) => {
			// Construir condiciones WHERE
			const conditions = [eq(casosCobros.activo, true)];

			// Filtros
			if (input.estadoMora) {
				conditions.push(eq(casosCobros.estadoMora, input.estadoMora));
			}

			if (input.responsableCobros) {
				conditions.push(eq(casosCobros.responsableCobros, input.responsableCobros));
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
				.leftJoin(contratosFinanciamiento, eq(casosCobros.contratoId, contratosFinanciamiento.id))
				.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
				.leftJoin(vehicles, eq(contratosFinanciamiento.vehicleId, vehicles.id))
				.leftJoin(user, eq(casosCobros.responsableCobros, user.id))
				.where(and(...conditions))

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
			const whereClause = context.userRole === "admin"
				? eq(casosCobros.id, input.id)
				: and(
					eq(casosCobros.id, input.id),
					eq(casosCobros.responsableCobros, context.userId)
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
				.leftJoin(contratosFinanciamiento, eq(casosCobros.contratoId, contratosFinanciamiento.id))
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
			})
		)
		.handler(async ({ input, context }) => {
			// Verificar que el usuario tenga acceso al caso
			if (context.userRole !== "admin") {
				const caso = await db
					.select()
					.from(casosCobros)
					.where(and(
						eq(casosCobros.id, input.casoCobroId),
						eq(casosCobros.responsableCobros, context.userId)
					))
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
			})
		)
		.handler(async ({ input, context }) => {
			// Verificar acceso al caso
			if (context.userRole !== "admin") {
				const caso = await db
					.select()
					.from(casosCobros)
					.where(and(
						eq(casosCobros.id, input.casoCobroId),
						eq(casosCobros.responsableCobros, context.userId)
					))
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
				montoAcordado: z.string().regex(/^\d+(\.\d{1,2})?$/, "Formato de monto inválido"),
				numeroCuotasConvenio: z.number().min(1).max(60),
				montoCuotaConvenio: z.string().regex(/^\d+(\.\d{1,2})?$/, "Formato de cuota inválido"),
				fechaInicioConvenio: z.date(),
				condicionesEspeciales: z.string().optional(),
			})
		)
		.handler(async ({ input, context }) => {
			// Solo admin o usuario asignado pueden crear convenios
			if (context.userRole !== "admin") {
				const caso = await db
					.select()
					.from(casosCobros)
					.where(and(
						eq(casosCobros.id, input.casoCobroId),
						eq(casosCobros.responsableCobros, context.userId)
					))
					.limit(1);

				if (!caso.length) {
					throw new Error("No tienes permiso para crear convenios en este caso");
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
					.where(and(
						eq(casosCobros.id, input.casoCobroId),
						eq(casosCobros.responsableCobros, context.userId)
					))
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
			})
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
			// Verificar acceso al caso
			const caso = await db
				.select()
				.from(casosCobros)
				.where(eq(casosCobros.contratoId, input.contratoId))
				.limit(1);

			if (!caso.length) {
				throw new Error("Contrato no encontrado");
			}

			// Verificar permisos
			if (context.userRole !== "admin" && caso[0].responsableCobros !== context.userId) {
				throw new Error("No tienes permiso para ver este historial");
			}

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

			return cuotas;
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
					.where(and(
						eq(casosCobros.id, input.casoCobroId),
						eq(casosCobros.responsableCobros, context.userId)
					))
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
				.leftJoin(user, eq(recuperacionesVehiculo.responsableRecuperacion, user.id))
				.where(eq(recuperacionesVehiculo.casoCobroId, input.casoCobroId))
				.limit(1);

			return recuperacion[0] || null;
		}),

	// Obtener detalles de contrato (puede ser caso de cobros o contrato directo)
	getDetallesContrato: cobrosProcedure
		.input(z.object({ 
			id: z.string().uuid(),
			tipo: z.enum(["caso", "contrato"]).default("caso")
		}))
		.handler(async ({ input, context }) => {
			if (input.tipo === "caso") {
				// Es un caso de cobros
				const whereClause = context.userRole === "admin"
					? eq(casosCobros.id, input.id)
					: and(
						eq(casosCobros.id, input.id),
						eq(casosCobros.responsableCobros, context.userId)
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
					.leftJoin(contratosFinanciamiento, eq(casosCobros.contratoId, contratosFinanciamiento.id))
					.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
					.leftJoin(vehicles, eq(contratosFinanciamiento.vehicleId, vehicles.id))
					.where(whereClause)
					.limit(1);

				return caso[0] || null;
			} else {
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
						telefonoPrincipal: sql<string>`''`,
						telefonoAlternativo: sql<string>`''`,
						emailContacto: sql<string>`'cliente@email.com'`,
						direccionContacto: sql<string>`''`,
						proximoContacto: sql<Date | null>`null`,
						metodoContactoProximo: sql<string | null>`null`,
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
					.where(eq(contratosFinanciamiento.id, input.id))
					.limit(1);

				return contrato[0] || null;
			}
		}),
};