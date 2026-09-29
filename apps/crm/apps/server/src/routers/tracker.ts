import { ORPCError } from "@orpc/server";
import { APIError } from "better-auth/api";
import { and, desc, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../db";
import { session } from "../db/schema/auth";
import {
	companies,
	leads,
	opportunities,
	opportunityStageHistory,
	salesStages,
} from "../db/schema/crm";
import { opportunityDocuments } from "../db/schema/documents";
import {
	type EstadoEnvioFactura,
	insuranceInvoiceSubmissions,
	opportunityAgencySellers,
	partnerAccounts,
} from "../db/schema/partners";
import { quotations } from "../db/schema/quotations";
import { vehicles, vehicleVendors } from "../db/schema/vehicles";
import {
	armarCorreoFacturaSeguro,
	type DatosCorreoFacturaSeguro,
	enviarCorreoFacturaSeguro,
} from "../lib/correo-factura-seguro";
import {
	type Aseguradora,
	destinatariosDe,
	MENSAJE_MOTIVO,
	MENSAJE_SIN_REENVIO,
	MIME_FACTURA_SEGURO,
	puedeReenviarFacturaSeguro,
	puedeSubirFacturaSeguro,
	resolverAseguradora,
} from "../lib/factura-seguro";
import { partnerIdentityProcedure, partnerProcedure } from "../lib/orpc";
import { PARTNER_CHANGE_PASSWORD_PATH, partnerAuth } from "../lib/partner-auth";
import {
	casoDentroDeAlcance,
	condicionDeAlcance,
	type MembresiaSocio,
} from "../lib/partner-scope";
import {
	buildUploadPrefix,
	deleteFileFromR2,
	generateUniqueFilename,
	MAX_FILE_SIZE,
	uploadBufferToR2,
	validateResolvedMimeType,
} from "../lib/storage";
import { extraerIp, partnerAuthLimiter } from "../lib/rate-limit";
import {
	construirHistorial,
	type EntradaHistorial,
} from "../lib/tracker-historial";
import { type PasoTracker, pasoDesdeCierre } from "../lib/tracker-pasos";

// Los cerrados se acotan para que el payload no crezca sin límite; los activos
// van siempre porque el socio necesita verlos aunque lleven meses parados.
const MESES_HISTORICO = 24;

export type EstadoCaso =
	| "en_proceso"
	| "en_pausa"
	| "rechazado"
	| "aprobado"
	| "desembolsado";

export type { EntradaHistorial };

export type CasoTracker = {
	id: string;
	referencia: string;
	cliente: string;
	agencia: string;
	vendedor: string | null;
	vehiculo: string | null;
	valorVehiculo: number | null;
	pasoActual: PasoTracker;
	porcentaje: number;
	estado: EstadoCaso;
	cerrado: boolean;
	actualizadoAt: string;
	historial: EntradaHistorial[];
	facturaSeguro: {
		habilitada: boolean;
		motivo: string | null;
		subidaAt: string | null;
		envio: EstadoEnvioFactura | null;
		reenviable: boolean;
	};
};

// Fecha de cierre efectiva: los perdidos nunca traen actual_close_date.
const fechaCierre = sql<Date>`COALESCE(${opportunities.actualCloseDate}, ${opportunities.updatedAt})`;

// open/on_hold siempre entran (el socio los necesita aunque lleven meses
// parados). won ya está cerrado en el pipeline de ventas — aunque "aprobado"
// no signifique desembolsado, comparte la misma ventana de retención para
// que el payload no crezca sin límite. Los perdidos ("lost") no se traen
// nunca: el socio no debe ver créditos rechazados.
function dentroDeVentanaDeRetencion(desde: Date) {
	return or(
		inArray(opportunities.status, ["open", "on_hold"]),
		and(eq(opportunities.status, "won"), gte(fechaCierre, desde)),
	);
}

// Una oportunidad puede tener varias cotizaciones. El tracker solo expone el
// valor del vehículo de la última cotización actualizada, nunca el valor del
// crédito de la oportunidad.
const ultimaCotizacion = db
	.selectDistinctOn([quotations.opportunityId], {
		opportunityId: quotations.opportunityId,
		vehicleBrand: quotations.vehicleBrand,
		vehicleLine: quotations.vehicleLine,
		vehicleModel: quotations.vehicleModel,
		vehicleValue: quotations.vehicleValue,
	})
	.from(quotations)
	.orderBy(
		quotations.opportunityId,
		desc(quotations.updatedAt),
		desc(quotations.createdAt),
	)
	.as("ultima_cotizacion");

const filaSelect = {
	id: opportunities.id,
	status: opportunities.status,
	createdAt: opportunities.createdAt,
	updatedAt: opportunities.updatedAt,
	closurePercentage: salesStages.closurePercentage,
	companyId: opportunities.companyId,
	agenciaNombre: companies.name,
	sellerId: opportunityAgencySellers.sellerId,
	vendedorNombre: vehicleVendors.name,
	leadFirstName: leads.firstName,
	leadMiddleName: leads.middleName,
	leadLastName: leads.lastName,
	leadSecondLastName: leads.secondLastName,
	vehicleMake: vehicles.make,
	vehicleModel: vehicles.model,
	vehicleYear: vehicles.year,
	quotationBrand: ultimaCotizacion.vehicleBrand,
	quotationLine: ultimaCotizacion.vehicleLine,
	quotationModel: ultimaCotizacion.vehicleModel,
	vehicleValue: ultimaCotizacion.vehicleValue,
	facturaEnvio: insuranceInvoiceSubmissions.status,
	facturaSubidaAt: insuranceInvoiceSubmissions.createdAt,
	facturaActualizadaAt: insuranceInvoiceSubmissions.updatedAt,
};

type Fila = {
	id: string;
	status: string;
	createdAt: Date;
	updatedAt: Date;
	closurePercentage: number;
	companyId: string | null;
	agenciaNombre: string;
	sellerId: string | null;
	vendedorNombre: string | null;
	leadFirstName: string | null;
	leadMiddleName: string | null;
	leadLastName: string | null;
	leadSecondLastName: string | null;
	vehicleMake: string | null;
	vehicleModel: string | null;
	vehicleYear: number | null;
	quotationBrand: string | null;
	quotationLine: string | null;
	quotationModel: string | null;
	vehicleValue: string | null;
	facturaEnvio: EstadoEnvioFactura | null;
	facturaSubidaAt: Date | null;
	facturaActualizadaAt: Date | null;
};

export function nombreCliente(
	firstName: string | null,
	middleName: string | null,
	lastName: string | null,
	secondLastName: string | null,
) {
	const partes = [firstName, middleName, lastName, secondLastName]
		.map((parte) => (parte ?? "").trim())
		.filter(Boolean);
	return partes.length > 0 ? partes.join(" ") : "Cliente sin nombre";
}

function descripcionVehiculo(fila: Fila) {
	const vinculado = [fila.vehicleMake, fila.vehicleModel, fila.vehicleYear]
		.filter(Boolean)
		.join(" ");
	if (vinculado) return vinculado;

	const deCotizacion = [
		fila.quotationBrand,
		fila.quotationLine,
		fila.quotationModel,
	]
		.filter(Boolean)
		.join(" ");
	return deCotizacion || null;
}

// No hay señal confiable de cuándo contabilidad desembolsa un `won`, así que
// no se reclama "desembolsado" — se queda en "aprobado".
function estadoDeCaso(status: string): EstadoCaso {
	if (status === "lost") return "rechazado";
	if (status === "on_hold") return "en_pausa";
	if (status === "won") return "aprobado";
	return "en_proceso";
}

// Carga el historial de todos los casos en una sola query, sin N+1.
async function cargarHistoriales(filas: Fila[]) {
	const porCaso = new Map<string, EntradaHistorial[]>();
	if (filas.length === 0) return porCaso;

	const etapaOrigen = alias(salesStages, "etapa_origen");
	const eventos = await db
		.select({
			opportunityId: opportunityStageHistory.opportunityId,
			changedAt: opportunityStageHistory.changedAt,
			pctDestino: salesStages.closurePercentage,
			pctOrigen: etapaOrigen.closurePercentage,
		})
		.from(opportunityStageHistory)
		.innerJoin(
			salesStages,
			eq(salesStages.id, opportunityStageHistory.toStageId),
		)
		.leftJoin(
			etapaOrigen,
			eq(etapaOrigen.id, opportunityStageHistory.fromStageId),
		)
		.where(
			inArray(
				opportunityStageHistory.opportunityId,
				filas.map((f) => f.id),
			),
		)
		.orderBy(opportunityStageHistory.changedAt);

	const eventosPorCaso = new Map<string, typeof eventos>();
	for (const evento of eventos) {
		const lista = eventosPorCaso.get(evento.opportunityId);
		if (lista) lista.push(evento);
		else eventosPorCaso.set(evento.opportunityId, [evento]);
	}

	for (const fila of filas) {
		porCaso.set(
			fila.id,
			construirHistorial(eventosPorCaso.get(fila.id) ?? [], fila),
		);
	}

	return porCaso;
}

// Arma el DTO campo por campo: la fila de opportunity trae DPI, ingresos,
// buró, inversionistas y tasas que el socio no debe ver nunca.
function reglaFactura(fila: Fila, membresias: MembresiaSocio[]) {
	return puedeSubirFacturaSeguro({
		closurePercentage: fila.closurePercentage,
		status: fila.status,
		companyId: fila.companyId,
		sellerId: fila.sellerId,
		membresias,
		yaSubida: fila.facturaEnvio != null,
	});
}

function aCaso(
	fila: Fila,
	historial: EntradaHistorial[],
	membresias: MembresiaSocio[],
): CasoTracker {
	const pasoActual = pasoDesdeCierre(fila.closurePercentage);
	const factura = reglaFactura(fila, membresias);
	return {
		id: fila.id,
		referencia: fila.id.slice(0, 8).toUpperCase(),
		cliente: nombreCliente(
			fila.leadFirstName,
			fila.leadMiddleName,
			fila.leadLastName,
			fila.leadSecondLastName,
		),
		agencia: fila.agenciaNombre.trim(),
		vendedor: fila.vendedorNombre?.trim() || null,
		vehiculo: descripcionVehiculo(fila),
		valorVehiculo:
			fila.vehicleValue === null ? null : Number(fila.vehicleValue),
		pasoActual,
		porcentaje: fila.closurePercentage,
		estado: estadoDeCaso(fila.status),
		cerrado: fila.status === "lost" || fila.status === "won",
		actualizadoAt: fila.updatedAt.toISOString(),
		historial,
		facturaSeguro: {
			habilitada: factura.ok,
			motivo: factura.ok ? null : MENSAJE_MOTIVO[factura.motivo],
			subidaAt: fila.facturaSubidaAt?.toISOString() ?? null,
			envio: fila.facturaEnvio ?? null,
			reenviable: puedeReenviarFacturaSeguro({
				envio: fila.facturaEnvio ?? null,
				envioActualizadoAt: fila.facturaActualizadaAt ?? null,
				companyId: fila.companyId,
				sellerId: fila.sellerId,
				membresias,
			}).ok,
		},
	};
}

const consultaBase = () =>
	db
		.select(filaSelect)
		.from(opportunities)
		.innerJoin(salesStages, eq(salesStages.id, opportunities.stageId))
		.innerJoin(companies, eq(companies.id, opportunities.companyId))
		.leftJoin(leads, eq(leads.id, opportunities.leadId))
		.leftJoin(vehicles, eq(vehicles.id, opportunities.vehicleId))
		.leftJoin(
			ultimaCotizacion,
			eq(ultimaCotizacion.opportunityId, opportunities.id),
		)
		// El UNIQUE(opportunity_id) evita que este join duplique casos.
		.leftJoin(
			opportunityAgencySellers,
			eq(opportunityAgencySellers.opportunityId, opportunities.id),
		)
		.leftJoin(
			vehicleVendors,
			eq(vehicleVendors.id, opportunityAgencySellers.sellerId),
		)
		.leftJoin(
			insuranceInvoiceSubmissions,
			eq(insuranceInvoiceSubmissions.opportunityId, opportunities.id),
		);

// Caso por id, dentro de la ventana de retención y del alcance del socio.
async function casoDelSocio(id: string, membresias: MembresiaSocio[]) {
	const desde = new Date();
	desde.setUTCMonth(desde.getUTCMonth() - MESES_HISTORICO);

	const [fila] = await consultaBase()
		.where(and(eq(opportunities.id, id), dentroDeVentanaDeRetencion(desde)))
		.limit(1);

	if (!fila) {
		throw new ORPCError("NOT_FOUND", { message: "Caso no encontrado" });
	}
	// El alcance se revalida contra la membresía, nunca contra el id que manda el cliente.
	if (!casoDentroDeAlcance(fila, membresias)) {
		// Si la agencia es suya, el caso es de otro vendedor (o de ninguno).
		const esDeSuAgencia = membresias.some(
			(m) => m.companyId === fila.companyId,
		);
		throw new ORPCError("FORBIDDEN", {
			message: esDeSuAgencia
				? "Este caso no está asignado a ti"
				: "Este caso no pertenece a tu agencia",
		});
	}
	return fila;
}

function exigirReglaFactura(fila: Fila, membresias: MembresiaSocio[]) {
	const regla = reglaFactura(fila, membresias);
	if (regla.ok) return;
	const codigo =
		regla.motivo === "no_es_el_vendedor"
			? "FORBIDDEN"
			: regla.motivo === "ya_subida"
				? "CONFLICT"
				: "BAD_REQUEST";
	throw new ORPCError(codigo, { message: MENSAJE_MOTIVO[regla.motivo] });
}

// En un reenvío la aseguradora de estos datos no se usa: se conserva la que se
// resolvió al subir la factura.
async function datosDelCorreo(
	fila: Fila,
): Promise<{ aseguradora: Aseguradora; datos: DatosCorreoFacturaSeguro }> {
	// Regla confirmada con negocio: la aseguradora es la de la última
	// cotización de la oportunidad (el cotizador la calcula y no se edita).
	const [cotizacion] = await db
		.select({
			insuranceProvider: quotations.insuranceProvider,
			insuredAmount: quotations.insuredAmount,
			monthlyPayment: quotations.monthlyPayment,
			vehicleType: quotations.vehicleType,
		})
		.from(quotations)
		.where(eq(quotations.opportunityId, fila.id))
		.orderBy(desc(quotations.createdAt))
		.limit(1);
	const [oportunidad] = await db
		.select({
			insuranceProvider: opportunities.insuranceProvider,
			cuotaMensual: opportunities.cuotaMensual,
			vin: vehicles.vinNumber,
			tipoVehiculo: vehicles.vehicleType,
		})
		.from(opportunities)
		.leftJoin(vehicles, eq(vehicles.id, opportunities.vehicleId))
		.where(eq(opportunities.id, fila.id))
		.limit(1);

	const aseguradora = resolverAseguradora(
		cotizacion?.insuranceProvider,
		oportunidad?.insuranceProvider,
	);
	return {
		aseguradora,
		datos: {
			referencia: fila.id.slice(0, 8).toUpperCase(),
			cliente: nombreCliente(
				fila.leadFirstName,
				fila.leadMiddleName,
				fila.leadLastName,
				fila.leadSecondLastName,
			),
			vehiculo: descripcionVehiculo(fila),
			vin: oportunidad?.vin ?? null,
			tipoVehiculo:
				oportunidad?.tipoVehiculo?.trim() || cotizacion?.vehicleType || null,
			montoAsegurado: aNumero(cotizacion?.insuredAmount),
			cuotaMensual: aNumero(
				cotizacion?.monthlyPayment ?? oportunidad?.cuotaMensual,
			),
			aseguradora,
		},
	};
}

// La llave de idempotencia es por registro e intento: reintentar el mismo
// intento (resultado desconocido) no duplica el correo en Resend mientras la
// llave siga vigente allá (24 h); después Resend lo trata como un correo nuevo.
export function llaveDeEnvio(registroId: string, intento: number): string {
	return `factura-seguro/${registroId}/${intento}`;
}

// `correo` es el guardado en el registro para este intento.
async function enviarYRegistrar(params: {
	registro: { id: string; intento: number };
	destinatarios: string[];
	archivo: { key: string; nombre: string };
	correo: { asunto: string; html: string };
}): Promise<EstadoEnvioFactura> {
	if (params.destinatarios.length === 0) return "sin_destinatario";

	const resultado = await enviarCorreoFacturaSeguro({
		destinatarios: params.destinatarios,
		archivo: params.archivo,
		correo: params.correo,
		idempotencyKey: llaveDeEnvio(params.registro.id, params.registro.intento),
	});
	const ahora = new Date();

	if (resultado.ok) {
		await db
			.update(insuranceInvoiceSubmissions)
			.set({ status: "enviado", error: null, sentAt: ahora, updatedAt: ahora })
			.where(eq(insuranceInvoiceSubmissions.id, params.registro.id));
		return "enviado";
	}
	// Otro proceso tiene la misma llave en Resend: no se toca el registro.
	if (resultado.resultado === "en_curso") return "pendiente";
	// Pudo haber salido: el intento se conserva en `pendiente` (y su llave),
	// así el reenvío lo repite sin duplicar en vez de abrir otro intento.
	if (resultado.resultado === "incierto") {
		await db
			.update(insuranceInvoiceSubmissions)
			.set({ error: resultado.error.slice(0, 2000), updatedAt: ahora })
			.where(eq(insuranceInvoiceSubmissions.id, params.registro.id));
		return "pendiente";
	}
	await db
		.update(insuranceInvoiceSubmissions)
		.set({
			status: "fallido",
			error: resultado.error.slice(0, 2000),
			sentAt: null,
			updatedAt: ahora,
		})
		.where(eq(insuranceInvoiceSubmissions.id, params.registro.id));
	return "fallido";
}

function aNumero(valor: string | null | undefined): number | null {
	if (valor == null || valor === "") return null;
	const numero = Number(valor);
	return Number.isFinite(numero) ? numero : null;
}

function mimeDeFactura(file: { name: string; type?: string }) {
	const resuelto = validateResolvedMimeType(file);
	const mime = resuelto.mimeType;
	if (
		!resuelto.valid ||
		!mime ||
		!(MIME_FACTURA_SEGURO as readonly string[]).includes(mime)
	) {
		throw new ORPCError("BAD_REQUEST", {
			message: "La factura debe subirse en PDF o como imagen (JPG, PNG o WebP)",
		});
	}
	return mime;
}

export const changePartnerPasswordInputSchema = z
	.object({
		email: z.string().email(),
		currentPassword: z.string().min(1),
		newPassword: z.string().min(8),
		confirmPassword: z.string().min(8),
	})
	.refine((data) => data.newPassword === data.confirmPassword, {
		message: "Las contraseñas nuevas no coinciden",
		path: ["confirmPassword"],
	})
	// Better Auth acepta un cambio a la misma contraseña: sin esto, repetir la
	// temporal marca passwordChangedAt sin rotar nada de verdad.
	.refine((data) => data.newPassword !== data.currentPassword, {
		message: "La contraseña nueva debe ser distinta de la actual",
		path: ["newPassword"],
	});

export const trackerRouter = {
	getPartnerAgencies: partnerIdentityProcedure.handler(async ({ context }) => {
		return db
			.select({ id: companies.id, name: companies.name })
			.from(companies)
			.where(inArray(companies.id, context.companyIds))
			.orderBy(companies.name);
	}),

	getPartnerPasswordStatus: partnerIdentityProcedure.handler(({ context }) => ({
		mustChangePassword: !context.partnerAccount?.passwordChangedAt,
	})),

	changePartnerPassword: partnerIdentityProcedure
		.input(changePartnerPasswordInputSchema)
		.handler(async ({ input, context }) => {
			// Esta es la vía real que usa la pantalla de cambio de contraseña — la
			// ruta cruda /api/partner-auth/change-password casi nadie la llama
			// directo. Comparte cupo con ella (misma clave) porque ambas validan
			// la misma contraseña actual.
			const ip = extraerIp((nombre) => context.headers.get(nombre));
			if (
				!partnerAuthLimiter.permitir(`${ip}:${PARTNER_CHANGE_PASSWORD_PATH}`)
			) {
				throw new ORPCError("TOO_MANY_REQUESTS", {
					message: partnerAuthLimiter.mensaje,
				});
			}

			if (
				input.email.trim().toLowerCase() !==
				context.user.email.trim().toLowerCase()
			) {
				throw new ORPCError("BAD_REQUEST", {
					message: "El correo no coincide con la sesión actual",
				});
			}

			// Sin revokeOtherSessions: con true, better-auth rota la sesión actual
			// y su Set-Cookie se perdía (llamada server-side sin asResponse),
			// botando al socio justo después del cambio exitoso. En su lugar,
			// borramos directo las demás sesiones del usuario (ej. una contraseña
			// temporal que alguien más también tenga) sin tocar la actual.
			try {
				await partnerAuth.api.changePassword({
					headers: context.headers,
					body: {
						currentPassword: input.currentPassword,
						newPassword: input.newPassword,
					},
				});
			} catch (error) {
				// Sin este catch, una contraseña actual incorrecta llegaba al socio
				// como un 500 genérico en vez de un mensaje que pudiera entender.
				if (error instanceof APIError) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							error.body?.message === "Invalid password"
								? "La contraseña actual no es correcta"
								: "No se pudo cambiar la contraseña",
					});
				}
				throw error;
			}

			await db
				.delete(session)
				.where(
					and(
						eq(session.userId, context.userId),
						ne(session.id, context.partnerSession.session.id),
					),
				);

			const ahora = new Date();
			await db
				.insert(partnerAccounts)
				.values({
					userId: context.userId,
					passwordChangedAt: ahora,
					createdAt: ahora,
					updatedAt: ahora,
				})
				.onConflictDoUpdate({
					target: partnerAccounts.userId,
					set: {
						passwordChangedAt: ahora,
						updatedAt: ahora,
					},
				});

			return { success: true };
		}),

	// Devuelve el universo completo del socio; el filtrado por período lo hace
	// el front, que necesita el historial para saber cuándo llegó a cada etapa.
	getCasos: partnerProcedure.handler(async ({ context }) => {
		const desde = new Date();
		desde.setUTCMonth(desde.getUTCMonth() - MESES_HISTORICO);

		const filas = await consultaBase()
			.where(
				and(
					condicionDeAlcance(context.membresias),
					dentroDeVentanaDeRetencion(desde),
				),
			)
			.orderBy(desc(opportunities.updatedAt));

		const historiales = await cargarHistoriales(filas);
		return filas.map((fila) =>
			aCaso(fila, historiales.get(fila.id) ?? [], context.membresias),
		);
	}),

	// Misma ventana de retención que getCasos: un caso que ya salió de la lista
	// por antiguo no debe seguir siendo alcanzable por id directo.
	getCasoById: partnerProcedure
		.input(z.object({ id: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const fila = await casoDelSocio(input.id, context.membresias);
			const historiales = await cargarHistoriales([fila]);
			return aCaso(fila, historiales.get(fila.id) ?? [], context.membresias);
		}),

	// El archivo pasa por el server y no por una URL firmada: el CORS del bucket
	// de R2 no admite subidas desde el origen del tracker.
	subirFacturaSeguro: partnerProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				archivo: z.instanceof(File),
			}),
		)
		.handler(async ({ input, context }) => {
			const fila = await casoDelSocio(input.opportunityId, context.membresias);
			// Antes de escribir en R2: si el caso no califica, no se sube nada.
			exigirReglaFactura(fila, context.membresias);

			const nombre = input.archivo.name;
			const mimeType = mimeDeFactura({
				name: nombre,
				type: input.archivo.type || undefined,
			});
			if (input.archivo.size === 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: "El archivo está vacío",
				});
			}
			if (input.archivo.size > MAX_FILE_SIZE) {
				throw new ORPCError("BAD_REQUEST", {
					message: `La factura no puede pesar más de ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
				});
			}

			// Todo lo que puede fallar va antes de subir a R2: así la subida queda
			// pegada a la transacción y a su limpieza, sin archivos huérfanos.
			const { aseguradora, datos } = await datosDelCorreo(fila);
			const destinatarios = destinatariosDe(aseguradora);
			// El correo se arma una vez y se guarda: el saludo usa esta misma
			// fecha (createdAt del registro), no la hora de cada reintento.
			const creadoAt = new Date();
			const correo = armarCorreoFacturaSeguro(datos, creadoAt);
			const contenido = Buffer.from(await input.archivo.arrayBuffer());

			const subido = {
				key: `${buildUploadPrefix("opportunity_document", fila.id)}/${generateUniqueFilename(nombre)}`,
				mimeType,
				size: input.archivo.size,
			};
			await uploadBufferToR2(subido.key, contenido, mimeType);

			const registrar = () =>
				db.transaction(async (tx) => {
					// Oportunidad FOR UPDATE: dos subidas simultáneas se turnan y la
					// segunda ya ve la factura de la primera.
					const [vigente] = await tx
						.select({
							status: opportunities.status,
							closurePercentage: salesStages.closurePercentage,
							companyId: opportunities.companyId,
						})
						.from(opportunities)
						.innerJoin(salesStages, eq(salesStages.id, opportunities.stageId))
						.where(eq(opportunities.id, fila.id))
						.for("update", { of: opportunities });
					const [asignado] = await tx
						.select({ sellerId: opportunityAgencySellers.sellerId })
						.from(opportunityAgencySellers)
						.where(eq(opportunityAgencySellers.opportunityId, fila.id));
					const [previa] = await tx
						.select({ id: insuranceInvoiceSubmissions.id })
						.from(insuranceInvoiceSubmissions)
						.where(eq(insuranceInvoiceSubmissions.opportunityId, fila.id));
					exigirReglaFactura(
						{
							...fila,
							status: vigente?.status ?? fila.status,
							closurePercentage:
								vigente?.closurePercentage ?? fila.closurePercentage,
							companyId: vigente?.companyId ?? null,
							sellerId: asignado?.sellerId ?? null,
							facturaEnvio: previa ? "pendiente" : null,
						},
						context.membresias,
					);

					const [documento] = await tx
						.insert(opportunityDocuments)
						.values({
							opportunityId: fila.id,
							filename: subido.key.split("/").pop() ?? subido.key,
							originalName: nombre,
							mimeType: subido.mimeType,
							size: subido.size,
							documentType: "seguro_vehiculo",
							description: "Factura del seguro subida desde el tracker",
							uploadedBy: context.userId,
							filePath: subido.key,
						})
						.returning({ id: opportunityDocuments.id });

					const [envio] = await tx
						.insert(insuranceInvoiceSubmissions)
						.values({
							opportunityId: fila.id,
							documentId: documento.id,
							insuranceProvider: aseguradora,
							recipients: destinatarios,
							status:
								destinatarios.length > 0 ? "pendiente" : "sin_destinatario",
							correoAsunto: correo.asunto,
							correoHtml: correo.html,
							submittedBy: context.userId,
							createdAt: creadoAt,
							updatedAt: creadoAt,
						})
						.returning({
							id: insuranceInvoiceSubmissions.id,
							intento: insuranceInvoiceSubmissions.intento,
						});
					return envio;
				});

			let registro: Awaited<ReturnType<typeof registrar>>;
			try {
				registro = await registrar();
			} catch (error) {
				// Solo se borra el archivo que esta misma llamada acaba de subir.
				await deleteFileFromR2(subido.key).catch(() => {});
				throw error;
			}

			// Después del commit: un fallo del correo no revierte la factura subida.
			const envio = await enviarYRegistrar({
				registro,
				destinatarios,
				archivo: { key: subido.key, nombre },
				correo,
			});
			return { envio, aseguradora };
		}),

	// Solo si el primer envío no salió (fallido o sin destinatarios): usa la
	// factura ya guardada, no se vuelve a subir.
	reenviarFacturaSeguro: partnerProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const fila = await casoDelSocio(input.opportunityId, context.membresias);
			// Solo se usan si hay que abrir un intento nuevo (ver abajo).
			const { datos } = await datosDelCorreo(fila);

			// Se reserva el registro (pasa a `pendiente` bajo bloqueo) antes de
			// mandar: dos clics seguidos no envían dos correos.
			const reservado = await db.transaction(async (tx) => {
				// Oportunidad FOR UPDATE y vendedor releído bajo el bloqueo: si lo
				// reasignaron, el vendedor anterior ya no puede reenviar.
				const [vigente] = await tx
					.select({ companyId: opportunities.companyId })
					.from(opportunities)
					.where(eq(opportunities.id, fila.id))
					.for("update");
				const [asignado] = await tx
					.select({ sellerId: opportunityAgencySellers.sellerId })
					.from(opportunityAgencySellers)
					.where(eq(opportunityAgencySellers.opportunityId, fila.id));
				const [registro] = await tx
					.select({
						id: insuranceInvoiceSubmissions.id,
						status: insuranceInvoiceSubmissions.status,
						intento: insuranceInvoiceSubmissions.intento,
						recipients: insuranceInvoiceSubmissions.recipients,
						correoAsunto: insuranceInvoiceSubmissions.correoAsunto,
						correoHtml: insuranceInvoiceSubmissions.correoHtml,
						createdAt: insuranceInvoiceSubmissions.createdAt,
						insuranceProvider: insuranceInvoiceSubmissions.insuranceProvider,
						actualizadoAt: insuranceInvoiceSubmissions.updatedAt,
						key: opportunityDocuments.filePath,
						nombre: opportunityDocuments.originalName,
					})
					.from(insuranceInvoiceSubmissions)
					.innerJoin(
						opportunityDocuments,
						eq(opportunityDocuments.id, insuranceInvoiceSubmissions.documentId),
					)
					.where(eq(insuranceInvoiceSubmissions.opportunityId, fila.id))
					.for("update", { of: insuranceInvoiceSubmissions });

				const regla = puedeReenviarFacturaSeguro({
					envio: registro?.status ?? null,
					envioActualizadoAt: registro?.actualizadoAt ?? null,
					companyId: vigente?.companyId ?? null,
					sellerId: asignado?.sellerId ?? null,
					membresias: context.membresias,
				});
				if (!regla.ok) {
					const codigo =
						regla.motivo === "no_es_el_vendedor"
							? "FORBIDDEN"
							: regla.motivo === "sin_factura"
								? "NOT_FOUND"
								: "CONFLICT";
					throw new ORPCError(codigo, {
						message: MENSAJE_SIN_REENVIO[regla.motivo],
					});
				}

				const aseguradora = resolverAseguradora(
					registro.insuranceProvider,
					null,
				);
				// Un `pendiente` abandonado tiene resultado desconocido: se repite el
				// mismo intento (misma llave y mismos destinatarios) y Resend no lo
				// duplica si ya salió, dentro de las 24 h de la llave. Pasado ese
				// plazo puede llegar dos veces; se permite igual para que el caso no
				// quede trabado. Solo un envío que falló pasa a otro intento.
				// Repetir el intento es reenviar exactamente el correo guardado; los
				// registros previos a guardarlo (sin correo) se arman de nuevo.
				const correoGuardado =
					registro.correoAsunto && registro.correoHtml
						? { asunto: registro.correoAsunto, html: registro.correoHtml }
						: null;
				const repetirIntento = registro.status === "pendiente";
				const intento =
					registro.status === "fallido"
						? registro.intento + 1
						: registro.intento;
				const destinatarios = repetirIntento
					? registro.recipients
					: destinatariosDe(aseguradora);
				const correo =
					repetirIntento && correoGuardado
						? correoGuardado
						: armarCorreoFacturaSeguro(
								{ ...datos, aseguradora },
								registro.createdAt,
							);
				await tx
					.update(insuranceInvoiceSubmissions)
					.set({
						status: destinatarios.length > 0 ? "pendiente" : "sin_destinatario",
						recipients: destinatarios,
						intento,
						correoAsunto: correo.asunto,
						correoHtml: correo.html,
						error: null,
						updatedAt: new Date(),
					})
					.where(eq(insuranceInvoiceSubmissions.id, registro.id));
				return {
					registro: { ...registro, intento },
					aseguradora,
					destinatarios,
					correo,
				};
			});

			const envio = await enviarYRegistrar({
				registro: reservado.registro,
				destinatarios: reservado.destinatarios,
				archivo: {
					key: reservado.registro.key,
					nombre: reservado.registro.nombre,
				},
				correo: reservado.correo,
			});
			return { envio, aseguradora: reservado.aseguradora };
		}),
};
