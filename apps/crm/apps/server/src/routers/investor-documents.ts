import { ORPCError } from "@orpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { investorActivityLog } from "../db/schema";
import {
	crmCobrosOrInvestmentsProcedure,
	investmentManagerProcedure,
	investmentProcedure,
} from "../lib/orpc";
import { PERMISSIONS } from "../lib/roles";
import {
	exigeConstancia,
	exigeConstanciaPorFalla,
	tieneCuentaSana,
} from "../lib/salud-cuenta-portal";
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

// Los motivos que se guardan en `details` salen de un `Error` cualquiera, así
// que se acotan: un cuerpo de error largo de cartera no tiene por qué entrar
// entero a una columna que se lee a ojo.
const LARGO_MAXIMO_MOTIVO = 300;

function motivoDeLaFalla(error: unknown): string {
	const texto = error instanceof Error ? error.message : String(error);
	return texto.slice(0, LARGO_MAXIMO_MOTIVO);
}

/**
 * Escribe la constancia del acceso al portal SIN PODER TUMBAR la respuesta.
 *
 * Cuando esto se llama, lo irreversible ya pasó: cartera contestó, la cuenta
 * puede estar creada y la contraseña puede haber salido por correo. Si el
 * insert tirara —el enum `acceso_portal` sin aplicar en ese ambiente, el pool,
 * la FK de `performed_by`, una conexión cortada— el throw subiría, el navegador
 * vería un rojo de "falló" sobre algo que SÍ ocurrió, y quien lo apretó volvería
 * a apretar. Es exactamente el invariante al revés: por callar la constancia se
 * perdía además la verdad de lo que pasó.
 *
 * Es la misma forma que ya usan `editarInversionista` y
 * `cambiarStatusInversionista` en este archivo, y el mismo criterio que
 * `portalProvisioning.ts` de cartera-back deja escrito como REGLA DE ORO: la
 * función que corre DESPUÉS del efecto nunca tira.
 *
 * El `console.error` no es decoración: es la constancia de última instancia.
 * Lleva la fila entera para que se pueda reconstruir a mano desde el log.
 */
async function dejarConstanciaDeAccesoPortal(
	valores: typeof investorActivityLog.$inferInsert,
): Promise<void> {
	try {
		await db.insert(investorActivityLog).values(valores);
	} catch (errorDeBitacora) {
		console.error(
			"🔴 [darAccesoPortal] NO se pudo escribir la constancia en investor_activity_log. Es la ÚNICA constancia veraz de quién autorizó mandar la contraseña (cartera la firma con el token de servicio): reconstruir esta fila a mano.",
			JSON.stringify(valores),
			errorDeBitacora,
		);
	}
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

	/**
	 * ¿De quién es este DPI o este correo? Alimenta la detección del alta: si el
	 * dato ya es de alguien, conta no está duplicando — está por dar de alta su
	 * empresa.
	 *
	 * Devuelve `null` cuando no hay nadie, que es el caso normal de un alta
	 * corriente. No es un error y no debe tratarse como tal.
	 *
	 * Un fallo de cartera SÍ es un error y se propaga. Antes se tragaba y se
	 * devolvía el mismo `null` que "no hay nadie", cuando eso ya no es inocuo:
	 * al desaparecer el interruptor "¿Es empresa?", la única forma de mover el
	 * DPI a representante legal es que la detección haya corrido. Con el fallo
	 * disfrazado de "no existe", conta enviaba el alta con el DPI en su sitio y
	 * cartera la rechazaba por duplicada, sin ninguna salida.
	 */
	identidadInversionista: crmCobrosOrInvestmentsProcedure
		.input(
			z.object({
				dpi: z.string().optional(),
				email: z.string().optional(),
			}),
		)
		.handler(async ({ input }) => {
			const dpi = input.dpi?.trim();
			const email = input.email?.trim();
			if (!dpi && !email) return null;

			try {
				const result = await carteraBackClient.buscarIdentidadInversionista({
					...(dpi ? { dpi } : {}),
					...(email ? { email } : {}),
				});
				return result.data ?? null;
			} catch (error) {
				console.error("[identidadInversionista] error en cartera-back:", error);

				// Se distingue de "no hay nadie" a propósito: el formulario tiene que
				// poder decir "no pudimos verificar" y ofrecer reintentar, en vez de
				// dejar creer que el DPI está libre.
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					message:
						"No pudimos verificar el DPI contra cartera. Reintenta en un momento.",
				});
			}
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
			let result: Awaited<
				ReturnType<typeof carteraBackClient.setInvestorStatus>
			>;
			try {
				result = await carteraBackClient.setInvestorStatus({
					inversionista_id: input.inversionistaId,
					status: input.status,
				});
			} catch (error) {
				throw toCarteraOrpcError(error, "Cambiar status de inversionista");
			}

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

	// Abrir el acceso al Portal del Inversionista: cartera crea la cuenta y le
	// manda la contraseña por correo. El acto lo dispara una persona desde acá
	// (cartera-back no lo automatiza a propósito: controllers/otorgarAccesoPortal.ts).
	//
	// GUARD: `investmentProcedure` (`PERMISSIONS.canAccessInvestments`), o sea
	// ADMIN, INVESTMENT_ADVISOR_JR, INVESTMENT_ADVISOR_SR e INVESTMENT_MANAGER.
	// NO el `crmCobrosOrInvestmentsProcedure` del resto del archivo, que es la
	// unión de `canAccessCRM`, `canAccessCobros`, `canAccessInvestments` y
	// `canAccessAccounting`. Son once familias de rol: las cuatro de arriba más
	// ventas, supervisor de ventas, analista, jurídico, cobros, supervisor de
	// cobros y contabilidad.
	//
	// La razón no es el conteo: es que ese guard ancho cubre TAMBIÉN
	// `editarInversionista` (más arriba en este mismo archivo), que cambia el
	// `email` del inversionista. Con los dos bajo el mismo permiso, cualquiera de
	// las once familias podía poner su propia dirección y apretar este botón: la
	// contraseña del portal salía hacia el buzón que acabara de escribir. Cerrar
	// solo este procedure no arregla `editarInversionista`, pero sí corta el
	// segundo paso, que es el que convierte una edición en una credencial.
	//
	// `correoAprobado` es el correo que el diálogo ENSEÑÓ antes de apretar, y
	// viaja hasta cartera para que lo revalide contra la fila. El id solo no
	// alcanzaba: cartera volvía a LEER la fila para saber a dónde mandar la
	// contraseña, así que lo aprobado y lo usado eran dos lecturas distintas de
	// algo que se puede reescribir en el medio. La ventana dura lo que la
	// persona tarde en leer el diálogo, y quien la mueve —`editarInversionista`,
	// once familias— no es quien aprueba —este botón, cuatro—.
	darAccesoPortal: investmentProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),

				// AUSENTE o un correo de verdad. NO se acepta `""`, ni espacios, ni
				// `null`, aunque cartera trate `null` como ausente:
				//
				//  - Ausente es el camino legítimo de la EMPRESA, cuyo diálogo no
				//    enseña correo porque la cuenta es del representante.
				//  - Vacío es un diálogo que SÍ tenía que enseñar uno y llegó sin él.
				//    Dejarlo pasar como "no se aprobó nada" saltaría el control justo
				//    cuando el front se equivoca, que es cuando más falta hace; y
				//    aceptar `null` le daría a un front con un `?? null` de más la
				//    misma salida silenciosa. Acá rebota con 400 sin salir a la red,
				//    un escalón antes del `correo_aprobado_invalido` de cartera.
				//
				// `.trim()` va ANTES de `.min`/`.max` a propósito (zod aplica los
				// checks en orden): así `"   "` se rechaza y el `.max(255)` mide el
				// mismo string RECORTADO que Elysia va a medir del otro lado con su
				// `maxLength: 255`. Al revés, un correo de 255 con espacios alrededor
				// pasaría acá y se iría en 422 contra cartera.
				correoAprobado: z.string().trim().min(1).max(255).optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const firmante = {
				performedBy: context.session.user.id,
				performedByName:
					context.session.user.name ?? context.session.user.email,
			};

			// 1. Llamar a cartera-back (el contrato pide un arreglo de ids)
			//
			// El try/catch es el mismo de `crearInversionista`/`editarInversionista`
			// y por la misma razón: oRPC solo conserva el mensaje de los
			// ORPCError, así que sin él el 403 "Solo un ADMIN puede abrir accesos
			// al portal" —un estado real y documentado, `cartera-back/DEPLOYMENT.md`—
			// llegaba al navegador como "Internal server error".
			let result: Awaited<
				ReturnType<typeof carteraBackClient.otorgarAccesoPortal>
			>;
			try {
				result = await carteraBackClient.otorgarAccesoPortal(
					[input.inversionistaId],
					input.correoAprobado,
				);
			} catch (error) {
				// Una llamada que FALLÓ también deja constancia, salvo cuando el
				// propio status prueba que cartera no llegó a provisionar.
				//
				// El caso que lo obliga es el timeout: el salto CRM→cartera aborta
				// mientras cartera sigue dentro de su `fetch` a auth-google, así que
				// la contraseña puede estar en el buzón del inversionista mientras
				// acá solo se ve "cartera no está respondiendo". Sin esta fila no
				// quedaba NADA: ni quién apretó, ni cuándo, ni sobre quién. Y el
				// reintento lo entierra —la cuenta ya existe, cartera contesta
				// `ya_tenia` y el segundo apretón sale en verde—.
				//
				// Qué status descarta el efecto y cuál no vive en
				// `lib/salud-cuenta-portal.ts`; es una lista blanca, igual que las
				// otras dos decisiones de este flujo.
				const statusDeCartera =
					error instanceof CarteraBackHttpError ? error.status : null;

				if (exigeConstanciaPorFalla(statusDeCartera)) {
					await dejarConstanciaDeAccesoPortal({
						inversionistaId: input.inversionistaId,
						action: "acceso_portal",
						details: {
							// `estado` NO es de la enumeración de cartera a propósito:
							// cartera nunca contestó, y escribir uno de los suyos sería
							// inventar un desenlace que nadie observó.
							estado: "sin_respuesta_de_cartera",
							usuarioEmail: null,
							advertencias: ["no_se_sabe_si_la_contrasena_salio"],
							motivo: motivoDeLaFalla(error),
							correo: null,
							httpStatus: statusDeCartera,
							// Acá es donde MÁS vale: este es el caso en que no se sabe si
							// la contraseña salió. `usuarioEmail` viene en null porque
							// cartera nunca contestó, así que el correo aprobado es el
							// ÚNICO dato de a dónde habría ido a parar.
							correoAprobado: input.correoAprobado ?? null,
						},
						...firmante,
					});
				}

				throw toCarteraOrpcError(error, "Dar acceso al portal");
			}

			const detalle = result.resultados?.[0] ?? null;

			// 2. Registrar QUIÉN lo autorizó, cuando hubo algo que autorizar.
			// `cartera.audit_logs` graba el "quién" decodificándolo del JWT, y el
			// CRM llama con un token de servicio que pertenece a una persona
			// real: allá este acto aparece firmado por ESA persona, lo apriete
			// quien lo apriete. Este insert es la única constancia veraz de quién
			// mandó la contraseña, así que no es opcional ni decorativo.
			//
			// Por eso mismo NO se escribe en los apretones que cartera resuelve
			// sin tocar nada: una fila por apretón diluye esa constancia hasta
			// taparla. El caso que lo obliga es la empresa —el camino de lectura
			// contesta `omitida/es_empresa` para siempre, así que el botón nunca
			// se apaga y cada apretón vuelve sin crear nada y sin mandar ningún
			// correo—. Qué cuenta como acto, y por qué la duda SIEMPRE cuenta,
			// vive en `lib/salud-cuenta-portal.ts`.
			//
			// EL VETO DEJA FILA, y es el caso que más la necesita. Cuando cartera
			// contesta `fallo/correo_aprobado_no_coincide` no provisionó nada, así
			// que por forma se parece a los no-ops que este guard calla. No lo es:
			// un veto significa que la fila SE MOVIÓ entre que el diálogo se pintó
			// y el clic llegó, que es exactamente el evento contra el que existe
			// todo este mecanismo. Puede ser alguien corrigiendo un typo o puede
			// ser el correo envenenado a tiempo, y desde acá no se distingue —
			// justamente por eso se anota—. Tampoco es ruido repetitivo como la
			// empresa: la empresa contesta igual en cada apretón para siempre, y un
			// veto solo ocurre si de verdad cambió el destinatario.
			//
			// Cae del lado correcto SOLO porque `MOTIVOS_SIN_EFECTO` es una lista
			// blanca y el motivo del veto no está en ella. Es deliberado y está
			// anotado allá: agregarlo apagaría la única alarma de la carrera.
			if (exigeConstancia(detalle)) {
				await dejarConstanciaDeAccesoPortal({
					inversionistaId: input.inversionistaId,
					action: "acceso_portal",
					details: {
						estado: detalle?.estado ?? null,
						usuarioEmail: detalle?.usuarioEmail ?? null,
						advertencias: detalle?.advertencias ?? [],
						motivo: detalle?.motivo ?? null,
						// Si el correo se desvió por SERVER != PROD, la cuenta existe y
						// su dueño no puede entrar; sin este rastro nadie se entera.
						correo: detalle?.correo ?? null,
						// QUÉ se aprobó, no solo a quién. Sin esto la fila dice que
						// alguien autorizó, pero no qué tenía delante al autorizar, y
						// esa es la mitad que importa cuando el correo de la fila
						// resulta no ser de su dueño.
						//
						// En un veto es la ÚNICA evidencia que queda de lo que el
						// diálogo enseñaba: cartera NO devuelve el correo de la fila a
						// propósito. Con el `investor_updated` de `editarInversionista`
						// —que sí guarda el `email` nuevo— el par reconstruye la
						// carrera entera: quién movió el correo, cuándo, y qué se había
						// aprobado.
						//
						// No agrega una clase de dato nueva a la tabla: `usuarioEmail`
						// y `correo.destinatarioReal` ya viven en esta misma columna.
						correoAprobado: input.correoAprobado ?? null,
					},
					...firmante,
				});
			}

			// El front necesita el resultado crudo para mostrar el estado.
			return result;
		}),

	// ¿Ya tiene cuenta en el portal? SOLO LECTURA: sirve para poner en gris el
	// botón de arriba sin tener que apretarlo para averiguarlo.
	//
	// NO registra en `investorActivityLog` a propósito. Esto corre en cada carga
	// de la pantalla del inversionista: anotarlo inundaría la bitácora y taparía
	// los actos REALES —quién autorizó mandar una contraseña—, que es lo único
	// que esa tabla existe para conservar.
	//
	// GUARD: el MISMO que `darAccesoPortal` (`investmentProcedure`), y no uno más
	// flojo por ser de lectura. Una consulta más abierta que el acto es
	// reconocimiento previo: contesta, por cada id que le pasen, si esa persona ya
	// tiene cuenta en el portal. Quien no puede abrir el acceso tampoco necesita
	// saber quién lo tiene.
	estadoAccesoPortal: investmentProcedure
		.input(
			z.object({
				inversionistaId: z.number().int().positive(),
			}),
		)
		.handler(async ({ input }) => {
			// Mismo try/catch que los demás procedures que salen a cartera: sin
			// él, el 403 "Solo un ADMIN puede consultar accesos al portal" y el
			// 404 "No existe ese inversionista" llegaban al navegador como
			// "Internal server error", y los dos son estados accionables.
			let acceso: Awaited<
				ReturnType<typeof carteraBackClient.consultarAccesoPortal>
			>;
			try {
				acceso = await carteraBackClient.consultarAccesoPortal(
					input.inversionistaId,
				);
			} catch (error) {
				throw toCarteraOrpcError(error, "Consultar acceso al portal");
			}

			// El booleano se calcula AQUÍ y no en el front: es el valor que
			// deshabilita el botón, y marcar sana una cuenta rota dejaría a esa
			// persona con el botón en gris y sin forma de arreglarlo desde la
			// pantalla. La regla —una lista blanca de advertencias inocuas, para
			// que lo que todavía no existe caiga del lado barato— vive en
			// `lib/salud-cuenta-portal.ts`.
			//
			// `usuarioEmail` NO viaja por acá, a propósito, aunque cartera lo
			// devuelva. Esto corre en CADA carga de la pantalla del inversionista,
			// con un id que elige quien llama y sin ninguna cota: devolver el correo
			// de la cuenta del portal convierte un barrido de ids en una cosecha de
			// "quién tiene cuenta y en qué buzón". El booleano y el motivo también
			// se cosechan, pero son lo que la pantalla necesita para no encerrar a
			// nadie detrás de un botón gris; el correo no lo es.
			//
			// El camino de ESCRITURA sí lo devuelve y debe seguir haciéndolo:
			// `darAccesoPortal` entrega el crudo de cartera porque el front traduce
			// con él el desenlace (`correo_de_cartera_distinto_al_de_la_cuenta`
			// nombra la dirección), y el insert en `investor_activity_log` lo guarda
			// porque es la constancia de a dónde salió la contraseña. Ahí hay un
			// acto detrás; acá no hay más que abrir una pantalla.
			//
			// Y el correo que el diálogo enseña antes de apretar tampoco sale de
			// acá: sale de `identidadInversionista`, que lo trae fresco.
			return {
				tieneCuentaSana: tieneCuentaSana(acceso),
				estado: acceso.estado,
				// Las advertencias VIAJAN aunque el booleano ya esté resuelto: sin
				// ellas la pantalla no tiene con qué explicar por qué el botón
				// sigue activo sobre alguien que "ya tenía" cuenta.
				advertencias: acceso.advertencias,
				motivo: acceso.motivo,
			};
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
