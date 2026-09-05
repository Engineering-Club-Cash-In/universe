import { ORPCError } from "@orpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { investorActivityLog } from "../db/schema";
import {
	crmCobrosOrInvestmentsProcedure,
	investmentManagerProcedure,
} from "../lib/orpc";
import { PERMISSIONS } from "../lib/roles";
import {
	CarteraBackHttpError,
	carteraBackClient,
	type SimulacionInversionistaResult,
} from "../services/cartera-back-client";

// Errores de cartera que apuntan a un campo del formulario. Los duplicados
// (controllers/investor.ts revisa email → DPI → nombre y corta con 409 en el
// primero que choca) y el representante legal inexistente (400 de la validación
// de dpi_rep_legal). El código de máquina es lo estable; el texto y el campo los
// ponemos acá para que el modal marque exactamente qué dato hay que corregir.
const ERRORES_POR_CAMPO = {
	duplicate_dpi: {
		campo: "dpi",
		mensaje: "Ya existe un inversionista registrado con ese DPI",
	},
	duplicate_email: {
		campo: "email",
		mensaje: "Ya existe un inversionista registrado con ese email",
	},
	duplicate_nombre: {
		campo: "nombre",
		mensaje: "Ya existe un inversionista registrado con ese nombre",
	},
	rep_legal_inexistente: {
		campo: "dpi_rep_legal",
		mensaje:
			"El DPI del representante legal no existe como inversionista. Primero hay que darlo de alta.",
	},
} as const;

type CodigoConCampo = keyof typeof ERRORES_POR_CAMPO;

function esCodigoConCampo(codigo?: string): codigo is CodigoConCampo {
	return !!codigo && codigo in ERRORES_POR_CAMPO;
}

// Traduce una falla de cartera-back a un error de oRPC con mensaje legible.
// Sin esto, cualquier throw del cliente HTTP llega al navegador como
// "Internal server error" (oRPC solo conserva el mensaje de los ORPCError),
// y el usuario abre ticket en vez de corregir el DPI/email duplicado.
export function toCarteraOrpcError(
	error: unknown,
	contexto: string,
): ORPCError<any, any> {
	if (error instanceof CarteraBackHttpError) {
		// cartera manda el texto para el usuario en `message` y el código de
		// máquina en `error` ("duplicate_dpi", "duplicate_email", ...).
		const codigo = error.payload.error;
		const detalle = [
			error.payload.message?.trim(),
			...(error.payload.errores ?? []),
		]
			.filter(Boolean)
			.join(". ");

		// Error conocido y atribuible a un campo: mandamos el campo culpable para
		// que el modal lo marque, en vez de dejarle al usuario adivinar si fue el
		// DPI, el email o el representante legal. El status importa: los
		// duplicados son 409, el representante inexistente es un 400.
		if (esCodigoConCampo(codigo)) {
			const { campo, mensaje } = ERRORES_POR_CAMPO[codigo];
			return new ORPCError(
				codigo.startsWith("duplicate_") ? "CONFLICT" : "BAD_REQUEST",
				{
					message: mensaje,
					data: { codigo, campo },
				},
			);
		}

		if (error.status === 409) {
			return new ORPCError("CONFLICT", {
				message: detalle || "Ya existe un inversionista con esos datos",
				data: { codigo },
			});
		}

		if (error.status >= 400 && error.status < 500) {
			return new ORPCError("BAD_REQUEST", {
				message: detalle || `${contexto}: cartera rechazó la solicitud`,
				data: { codigo },
			});
		}
	}

	console.error(`[${contexto}] error en cartera-back:`, error);
	return new ORPCError("INTERNAL_SERVER_ERROR", {
		message: `${contexto}: cartera no está respondiendo. Intenta de nuevo en unos minutos.`,
	});
}

export const investorDocumentsRouter = {
	getInvestorRendimiento: crmCobrosOrInvestmentsProcedure
		.input(
			z.object({
				email: z.string().email(),
			}),
		)
		.handler(async ({ input }) => {
			const result = await carteraBackClient.getInvestorRendimiento(
				input.email,
			);
			return result;
		}),

	getInvestorDocumentsAdmin: crmCobrosOrInvestmentsProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
			}),
		)
		.handler(async ({ input }) => {
			const result = await carteraBackClient.getInvestorDocumentsAdmin(
				input.inversionistaId,
			);
			return result;
		}),

	createInvestorDocument: crmCobrosOrInvestmentsProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
				nombre: z.string().min(1),
				descripcion: z.string().optional(),
				visible: z.boolean().optional(),
				fileBase64: z.string().min(1),
				fileMimeType: z.string().min(1),
			}),
		)
		.handler(async ({ input, context }) => {
			const buffer = Buffer.from(input.fileBase64, "base64");
			const blob = new Blob([buffer], { type: input.fileMimeType });

			// Solo manager/admin pueden hacer visible el documento al crearlo
			const canSetVisible = PERMISSIONS.canValidateInvestmentFunds(
				context.userRole,
			);
			const visible = canSetVisible ? input.visible : false;

			const result = await carteraBackClient.createInvestorDocument({
				file: blob,
				inversionista_id: input.inversionistaId,
				nombre: input.nombre,
				descripcion: input.descripcion,
				visible,
				created_by: context.session.user.name ?? context.session.user.email,
			});

			await db.insert(investorActivityLog).values({
				inversionistaId: input.inversionistaId,
				action: "document_created",
				details: {
					nombre: input.nombre,
					descripcion: input.descripcion,
					visible,
					mimeType: input.fileMimeType,
				},
				performedBy: context.session.user.id,
				performedByName:
					context.session.user.name ?? context.session.user.email,
			});

			return result;
		}),

	// Solo manager/admin pueden cambiar visibilidad
	toggleInvestorDocumentVisibility: investmentManagerProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
				documentoId: z.number().int().positive(),
				visible: z.boolean(),
				documentoNombre: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const result = await carteraBackClient.toggleInvestorDocumentVisibility(
				input.documentoId,
				input.visible,
			);

			await db.insert(investorActivityLog).values({
				inversionistaId: input.inversionistaId,
				action: "document_visibility_toggled",
				details: {
					documentoId: input.documentoId,
					documentoNombre: input.documentoNombre,
					visible: input.visible,
				},
				performedBy: context.session.user.id,
				performedByName:
					context.session.user.name ?? context.session.user.email,
			});

			return result;
		}),

	deleteInvestorDocument: crmCobrosOrInvestmentsProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
				documentoId: z.number().int().positive(),
				documentoNombre: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const result = await carteraBackClient.deleteInvestorDocument(
				input.documentoId,
			);

			await db.insert(investorActivityLog).values({
				inversionistaId: input.inversionistaId,
				action: "document_deleted",
				details: {
					documentoId: input.documentoId,
					documentoNombre: input.documentoNombre,
				},
				performedBy: context.session.user.id,
				performedByName:
					context.session.user.name ?? context.session.user.email,
			});

			return result;
		}),

	// Bancos — catálogo desde cartera-back (solo con transferencia: alimenta
	// los comboboxes de crear/editar inversionista)
	getBancosCartera: crmCobrosOrInvestmentsProcedure.handler(async () => {
		return carteraBackClient.getBancosTransferencia();
	}),

	// Editar inversionista — upsert en cartera-back + log
	editarInversionista: crmCobrosOrInvestmentsProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
				nombre: z.string().min(1),
				dpi: z.string().optional(),
				email: z.string().email().optional(),
				banco: z.number().nullable().optional(),
				tipoCuenta: z.string().optional(),
				numeroCuenta: z.string().optional(),
				tipoReinversion: z.string().optional(),
				montoReinversion: z.number().optional(),
				moneda: z.enum(["quetzales", "dolares"]).optional(),
				emiteFactura: z.boolean().optional(),
				// Solo dígitos, hasta 20 (varchar(20) en cartera). Cadena vacía = borrar.
				// Se valida acá para atajar el formato antes de salir a la red; la
				// existencia del representante la revisa cartera y su 400 vuelve
				// traducido por `toCarteraOrpcError`.
				dpiRepLegal: z
					.string()
					.regex(/^\d*$/, "El DPI del representante legal solo admite dígitos")
					.max(20, "El DPI del representante legal admite máximo 20 dígitos")
					.optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Sin el try/catch cualquier 400 de cartera (representante legal
			// inexistente, duplicados) llegaba al navegador como "Internal server
			// error", porque oRPC solo conserva el mensaje de los ORPCError.
			let result: Awaited<ReturnType<typeof carteraBackClient.createInvestor>>;
			try {
				result = await carteraBackClient.createInvestor({
					inversionista_id: input.inversionistaId,
					nombre: input.nombre,
					dpi: input.dpi ? Number(input.dpi) : null,
					email: input.email ?? null,
					banco: input.banco ?? null,
					tipo_cuenta: input.tipoCuenta ?? null,
					numero_cuenta: input.numeroCuenta ?? null,
					tipo_reinversion: input.tipoReinversion ?? "sin_reinversion",
					monto_reinversion: input.montoReinversion ?? null,
					moneda: input.moneda ?? "quetzales",
					emite_factura: input.emiteFactura ?? false,
					// Sin `?? null`: si la llave no viene, cartera deja el valor como
					// está; si viene vacía, lo borra.
					dpi_rep_legal: input.dpiRepLegal,
				});
			} catch (error) {
				throw toCarteraOrpcError(error, "Editar inversionista");
			}

			try {
				await db.insert(investorActivityLog).values({
					inversionistaId: input.inversionistaId,
					action: "investor_updated",
					details: {
						nombre: input.nombre,
						dpi: input.dpi,
						email: input.email,
						moneda: input.moneda,
					},
					performedBy: context.session.user.id,
					performedByName:
						context.session.user.name ?? context.session.user.email,
				});
			} catch (logError) {
				console.error("Error al registrar log de edición:", logError);
			}

			return { success: true, data: result.data };
		}),

	// Cambiar status del inversionista — pendiente_devolucion / activo / inactivo
	cambiarStatusInversionista: crmCobrosOrInvestmentsProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
				status: z.enum(["activo", "inactivo", "pendiente_devolucion"]),
			}),
		)
		.handler(async ({ input, context }) => {
			const result = await carteraBackClient.setInvestorStatus({
				inversionista_id: input.inversionistaId,
				status: input.status,
			});

			try {
				await db.insert(investorActivityLog).values({
					inversionistaId: input.inversionistaId,
					action: "investor_updated",
					details: {
						statusChange: input.status,
					},
					performedBy: context.session.user.id,
					performedByName:
						context.session.user.name ?? context.session.user.email,
				});
			} catch (logError) {
				console.error("Error al registrar log de cambio de status:", logError);
			}

			return { success: true, data: result };
		}),

	// Crear inversionista — opcionalmente con compra de cartera
	crearInversionista: crmCobrosOrInvestmentsProcedure
		.input(
			z
				.object({
					nombre: z.string().min(1),
					dpi: z.string().optional(),
					email: z.string().email().optional(),
					banco: z.number().nullable().optional(),
					tipoCuenta: z.string().optional(),
					numeroCuenta: z.string().optional(),
					tipoReinversion: z.string().optional(),
					montoReinversion: z.number().optional(),
					moneda: z.enum(["quetzales", "dolares"]).optional(),
					emiteFactura: z.boolean().optional(),
					// Compra de cartera opcional
					hacerCompraCartera: z.boolean().optional(),
					montoCompraCartera: z.number().positive().optional(),
					// Obligatoria cuando hacerCompraCartera = true (cartera-back la
					// exige). Por default calcula el % Inversionista/Cash In por
					// monto; si viene modalidadFacturacionSpreadId, el operador
					// anuló manualmente el bracket (ver ese campo abajo).
					modalidadFacturacion: z
						.enum(["p2p_directa", "factura_cube", "factura_cube_pequeno"])
						.optional(),
					// Anulación manual: id del bracket elegido (de los 8 de la
					// modalidad), sin importar si corresponde al monto.
					modalidadFacturacionSpreadId: z.number().int().positive().optional(),
					fechaInicioParticipacion: z.string().optional(),
					// Solo dígitos, hasta 20 (varchar(20) en cartera). Cadena vacía =
					// borrar. Se valida acá para rechazarlo antes de salir a cartera.
					dpiRepLegal: z
						.string()
						.regex(/^\d*$/, "El DPI del representante legal solo admite dígitos")
						.max(20, "El DPI del representante legal admite máximo 20 dígitos")
						.optional(),
				})
				.refine(
					(data) => !data.hacerCompraCartera || !!data.modalidadFacturacion,
					{
						message:
							"La modalidad de facturación es obligatoria para hacer una compra de cartera",
						path: ["modalidadFacturacion"],
					},
				),
		)
		.handler(async ({ input, context }) => {
			// 1. Crear inversionista en cartera-back.
			// Cartera valida duplicados (DPI / email / nombre) y responde 409; sin
			// este try/catch el error viajaba como Error suelto y oRPC se lo
			// entregaba al usuario como "Internal server error", que terminaba en
			// ticket de soporte en vez de en una corrección del formulario.
			let createResult: Awaited<
				ReturnType<typeof carteraBackClient.createInvestor>
			>;
			try {
				createResult = await carteraBackClient.createInvestor({
					operation: "CREATE",
					nombre: input.nombre,
					dpi: input.dpi ? Number(input.dpi) : null,
					email: input.email ?? null,
					banco: input.banco ?? null,
					tipo_cuenta: input.tipoCuenta ?? null,
					numero_cuenta: input.numeroCuenta ?? null,
					tipo_reinversion: input.tipoReinversion ?? "sin_reinversion",
					monto_reinversion: input.montoReinversion ?? null,
					moneda: input.moneda ?? "quetzales",
					emite_factura: input.emiteFactura ?? false,
					// Sin `?? null`: si la llave no viene, cartera deja el valor como
					// está; si viene vacía, lo borra.
					dpi_rep_legal: input.dpiRepLegal,
				});
			} catch (error) {
				throw toCarteraOrpcError(error, "Crear inversionista");
			}

			const created = createResult.data?.[0];
			if (!created?.inversionista_id) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						createResult.message ||
						"No se pudo crear el inversionista en cartera",
				});
			}

			// Qué pasó con su acceso al portal. Cartera nunca falla el alta por
			// esto, así que el dato viaja aparte: el inversionista puede haber
			// quedado perfecto y el acceso no, y son dos cosas distintas.
			const accesoPortal =
				createResult.provisioning?.find(
					(p) => p.inversionistaId === created.inversionista_id,
				) ?? null;

			// 2. Log de creación
			await db.insert(investorActivityLog).values({
				inversionistaId: created.inversionista_id,
				action: "investor_created",
				details: {
					nombre: input.nombre,
					dpi: input.dpi,
					email: input.email,
					moneda: input.moneda,
					// Queda registrado acá también: si el correo con la contraseña
					// se desvió por SERVER != PROD, la cuenta existe y su dueño no
					// puede entrar, y sin este rastro nadie se enteraría.
					accesoPortal,
				},
				performedBy: context.session.user.id,
				performedByName:
					context.session.user.name ?? context.session.user.email,
			});

			// 3. Si pidió compra de cartera, ejecutarla con el ID del nuevo inversionista
			// (modalidadFacturacion ya viene garantizada por el .refine() del schema)
			let compraResult = null;
			if (input.hacerCompraCartera && input.montoCompraCartera) {
				const tipoReinversionCompra:
					| "sin_reinversion"
					| "reinversion_capital"
					| "reinversion_total" =
					input.tipoReinversion === "reinversion_capital" ||
					input.tipoReinversion === "reinversion_total"
						? input.tipoReinversion
						: "sin_reinversion";
				try {
					compraResult = await carteraBackClient.compraCartera({
						inversionista_id: created.inversionista_id,
						monto_aportado: input.montoCompraCartera,
						tipo_operacion: "compra_cartera",
						tipo_reinversion: tipoReinversionCompra,
						modalidad_facturacion: input.modalidadFacturacion,
						modalidad_facturacion_spread_id: input.modalidadFacturacionSpreadId,
						fecha_inicio_participacion:
							input.fechaInicioParticipacion || undefined,
					});
				} catch (error) {
					// El inversionista YA quedó creado: hay que decirlo explícito para
					// que no lo vuelvan a crear (cartera respondería 409 duplicado).
					const causa = toCarteraOrpcError(error, "Compra de cartera");
					throw new ORPCError(causa.code, {
						message: `El inversionista se creó (ID ${created.inversionista_id}), pero falló la compra de cartera: ${causa.message}. Regístrala desde su perfil, no vuelvas a crearlo.`,
						data: {
							...(typeof causa.data === "object" ? causa.data : {}),
							inversionistaId: created.inversionista_id,
							inversionistaCreado: true,
						},
					});
				}

				// Log de compra de cartera
				await db.insert(investorActivityLog).values({
					inversionistaId: created.inversionista_id,
					action: "compra_cartera",
					details: {
						monto_aportado: input.montoCompraCartera,
						tipo_reinversion: tipoReinversionCompra,
						modalidad_facturacion: input.modalidadFacturacion,
						fecha_inicio_participacion: input.fechaInicioParticipacion,
					},
					performedBy: context.session.user.id,
					performedByName:
						context.session.user.name ?? context.session.user.email,
				});
			}

			return {
				success: true,
				inversionista: created,
				compraCartera: compraResult,
				accesoPortal,
			};
		}),

	// Compra de cartera — registra log y llama a cartera-back
	compraCartera: crmCobrosOrInvestmentsProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
				montoAportado: z.number().positive(),
				tipoReinversion: z.enum([
					"sin_reinversion",
					"reinversion_capital",
					"reinversion_total",
				]),
				// Obligatoria: define el % Inversionista / % Cash In desde el
				// catálogo de spreads. Por default por monto; si viene
				// modalidadFacturacionSpreadId, el operador anuló manualmente
				// el bracket (ver ese campo abajo).
				modalidadFacturacion: z.enum([
					"p2p_directa",
					"factura_cube",
					"factura_cube_pequeno",
				]),
				// Anulación manual: id del bracket elegido (de los 8 de la
				// modalidad), sin importar si corresponde al monto.
				modalidadFacturacionSpreadId: z.number().int().positive().optional(),
				fechaInicioParticipacion: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// 1. Llamar a cartera-back para registrar la compra
			const result = await carteraBackClient.compraCartera({
				inversionista_id: input.inversionistaId,
				monto_aportado: input.montoAportado,
				tipo_operacion: "compra_cartera",
				tipo_reinversion: input.tipoReinversion,
				modalidad_facturacion: input.modalidadFacturacion,
				modalidad_facturacion_spread_id: input.modalidadFacturacionSpreadId,
				fecha_inicio_participacion: input.fechaInicioParticipacion || undefined,
			});

			// 2. Registrar en investor_activity_log
			await db.insert(investorActivityLog).values({
				inversionistaId: input.inversionistaId,
				action: "compra_cartera",
				details: {
					monto_aportado: input.montoAportado,
					tipo_reinversion: input.tipoReinversion,
					modalidad_facturacion: input.modalidadFacturacion,
					modalidad_facturacion_spread_id: input.modalidadFacturacionSpreadId,
					fecha_inicio_participacion: input.fechaInicioParticipacion,
				},
				performedBy: context.session.user.id,
				performedByName:
					context.session.user.name ?? context.session.user.email,
			});

			return result;
		}),

	getInvestorsCartera: investmentManagerProcedure.handler(async () => {
		const result = await carteraBackClient.getInvestors();
		return result.data ?? [];
	}),

	// Resuelve, por monto, las 3 filas de Modalidad de Facturación (una por
	// modalidad) del bracket correspondiente. Lo usa el modal de compra de
	// cartera para autocalcular % Inversionista/CCI — única fuente de verdad
	// (SQL), el front ya no reimplementa la resolución de bracket.
	resolverModalidadFacturacionSpread: crmCobrosOrInvestmentsProcedure
		.input(z.object({ monto: z.number().positive() }))
		.handler(async ({ input }) => {
			return await carteraBackClient.resolverModalidadFacturacionSpread(
				input.monto,
			);
		}),

	// Las 8 filas (una por bracket) de una modalidad, sin filtrar por monto.
	// Alimenta el combobox de anulación manual del spread — el operador
	// puede elegir cualquiera de los 8, sin importar el monto de la compra.
	listModalidadFacturacionSpreadByModalidad: crmCobrosOrInvestmentsProcedure
		.input(
			z.object({
				modalidad: z.enum([
					"p2p_directa",
					"factura_cube",
					"factura_cube_pequeno",
				]),
			}),
		)
		.handler(async ({ input }) => {
			return await carteraBackClient.listModalidadFacturacionSpreadByModalidad(
				input.modalidad,
			);
		}),

	getSimulacionInversionista: investmentManagerProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
				mes: z.number().int().min(1).max(12).optional(),
				anio: z.number().int().min(1900).max(2100).optional(),
			}),
		)
		.handler(async ({ input }): Promise<SimulacionInversionistaResult> => {
			return carteraBackClient.getSimulacionInversionista(
				input.inversionistaId,
				{ mes: input.mes, anio: input.anio },
			);
		}),

	// Solo manager/admin pueden ver el historial de actividad
	getInvestorActivityLog: investmentManagerProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
			}),
		)
		.handler(async ({ input }) => {
			const logs = await db
				.select()
				.from(investorActivityLog)
				.where(eq(investorActivityLog.inversionistaId, input.inversionistaId))
				.orderBy(desc(investorActivityLog.createdAt))
				.limit(100);

			return logs;
		}),
};
