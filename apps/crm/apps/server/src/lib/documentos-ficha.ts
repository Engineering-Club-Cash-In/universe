/**
 * F6 (#1864) · Pestaña Documentos de la Ficha 360.
 *
 * - Enviar al cliente por WhatsApp: tarjeta de circulación e información del
 *   seguro. Mismo envío que el estado de cuenta (template `mensaje_adjunto`,
 *   header de documento, modo de prueba y traza en `cobros_send_logs`).
 * - Solicitar al supervisor: contrato, carta poder, cambio de placas y
 *   expertaje (`solicitudes_documentos_cobros`, migración 0078). El supervisor
 *   la aprueba o la rechaza con una nota.
 *
 * Plan: docs/features/cobros-02/21-plan-backend-ficha-360.md
 */

import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	casosCobros,
	contratosFinanciamiento,
	solicitudesDocumentosCobros,
} from "../db/schema/cobros";
import { clients, leads, opportunities } from "../db/schema/crm";
import { opportunityDocuments } from "../db/schema/documents";
import { vehicleDocuments, vehicles } from "../db/schema/vehicles";
import type { DocumentoFicha } from "../routers/ficha-cobros";
import {
	type ContactoAsesor,
	construirCierreAsesor,
	resolverContactoAsesor,
} from "../services/asesor-whatsapp";
import type { ContextoCaso } from "../services/referencias-cobros-datos";
import { persistCobrosSendLog } from "./cobros-send-log";
import { getTestPhone, isTestModeEnabled } from "./messaging-test-mode";
import { primerTelefono } from "./phone-utils";
import { sendWhatsappTemplate } from "./simpletech";
import { getFileUrl } from "./storage";

/* ── Catálogo ───────────────────────────────────────────────────────────────── */

export const DOCUMENTOS_ENVIAR = ["tarjeta-circulacion", "seguro"] as const;
export type DocumentoEnviar = (typeof DOCUMENTOS_ENVIAR)[number];

export const DOCUMENTOS_SOLICITAR = [
	"contrato",
	"carta-poder",
	"cambio-placas",
	"expertaje",
] as const;
export type DocumentoSolicitar = (typeof DOCUMENTOS_SOLICITAR)[number];

/** Mismos textos que ya pinta el front (`contexto-caso.tsx`). */
const CATALOGO: Array<Omit<DocumentoFicha, "disponible">> = [
	{
		clave: "tarjeta-circulacion",
		nombre: "Tarjeta de circulación",
		descripcion: "Documento vehicular",
		modo: "enviar",
	},
	{
		clave: "seguro",
		nombre: "Información de seguro",
		descripcion: "Póliza vigente",
		modo: "enviar",
	},
	{
		clave: "contrato",
		nombre: "Contrato de crédito",
		descripcion: "PDF · Documento legal",
		modo: "solicitar",
	},
	{
		clave: "carta-poder",
		nombre: "Carta poder",
		descripcion: "Requiere firma del titular",
		modo: "solicitar",
	},
	{
		clave: "cambio-placas",
		nombre: "Cambio de placas",
		descripcion: "Trámite vehicular",
		modo: "solicitar",
	},
	{
		clave: "expertaje",
		nombre: "Expertaje",
		descripcion: "Avalúo del vehículo",
		modo: "solicitar",
	},
];

export function nombreDocumento(clave: string): string {
	return CATALOGO.find((d) => d.clave === clave)?.nombre ?? clave;
}

/**
 * El catálogo con su disponibilidad: un envío está disponible si hay archivo;
 * una solicitud, si no hay otra pendiente del mismo documento. Pura.
 */
export function armarDocumentos(estado: {
	archivos: Partial<Record<DocumentoEnviar, boolean>>;
	pendientes: string[];
}): DocumentoFicha[] {
	return CATALOGO.map((d) => ({
		...d,
		disponible:
			d.modo === "enviar"
				? !!estado.archivos[d.clave as DocumentoEnviar]
				: !estado.pendientes.includes(d.clave),
	}));
}

/* ── Archivos ───────────────────────────────────────────────────────────────── */

const TIPOS_ARCHIVO: Record<DocumentoEnviar, string[]> = {
	"tarjeta-circulacion": ["tarjeta_circulacion", "vehicle_title"],
	seguro: ["seguro_vehiculo"],
};

/**
 * PDF que no depende del crédito: la cobertura e instrucciones del seguro,
 * el mismo que manda `send-coverage-document.ts`. Respaldo de la póliza.
 */
const COBERTURA_SEGURO_PDF_URL = process.env.COBERTURA_SEGURO_PDF_URL;

export type ArchivoDocumento = { key: string } | { url: string };

/**
 * El PDF más reciente del documento: primero los del vehículo, después los
 * de la oportunidad. Solo PDF: el template de WhatsApp lleva header de
 * documento. Para el seguro, si no hay póliza, la cobertura general.
 */
export async function archivoDocumento(
	ctx: ContextoCaso,
	clave: DocumentoEnviar,
): Promise<ArchivoDocumento | null> {
	const tipos = TIPOS_ARCHIVO[clave];
	if (ctx.opportunityId) {
		const [opp] = await db
			.select({ vehicleId: opportunities.vehicleId })
			.from(opportunities)
			.where(eq(opportunities.id, ctx.opportunityId))
			.limit(1);
		if (opp?.vehicleId) {
			const [delVehiculo] = await db
				.select({ key: vehicleDocuments.filePath })
				.from(vehicleDocuments)
				.where(
					and(
						eq(vehicleDocuments.vehicleId, opp.vehicleId),
						inArray(vehicleDocuments.documentType, tipos),
						eq(vehicleDocuments.mimeType, "application/pdf"),
					),
				)
				.orderBy(desc(vehicleDocuments.uploadedAt))
				.limit(1);
			if (delVehiculo) return delVehiculo;
		}
		const [deOportunidad] = await db
			.select({ key: opportunityDocuments.filePath })
			.from(opportunityDocuments)
			.where(
				and(
					eq(opportunityDocuments.opportunityId, ctx.opportunityId),
					inArray(
						opportunityDocuments.documentType,
						tipos as (typeof opportunityDocuments.documentType.enumValues)[number][],
					),
					eq(opportunityDocuments.mimeType, "application/pdf"),
				),
			)
			.orderBy(desc(opportunityDocuments.uploadedAt))
			.limit(1);
		if (deOportunidad) return deOportunidad;
	}
	if (clave === "seguro" && COBERTURA_SEGURO_PDF_URL) {
		return { url: COBERTURA_SEGURO_PDF_URL };
	}
	return null;
}

async function solicitudesPendientes(casoCobroId: string): Promise<string[]> {
	const filas = await db
		.select({ clave: solicitudesDocumentosCobros.clave })
		.from(solicitudesDocumentosCobros)
		.where(
			and(
				eq(solicitudesDocumentosCobros.casoCobroId, casoCobroId),
				eq(solicitudesDocumentosCobros.estado, "pendiente"),
			),
		);
	return filas.map((f) => f.clave);
}

export async function cargarDocumentos(
	ctx: ContextoCaso,
): Promise<DocumentoFicha[]> {
	const [tarjeta, seguro, pendientes] = await Promise.all([
		archivoDocumento(ctx, "tarjeta-circulacion"),
		archivoDocumento(ctx, "seguro"),
		solicitudesPendientes(ctx.casoCobroId),
	]);
	return armarDocumentos({
		archivos: { "tarjeta-circulacion": !!tarjeta, seguro: !!seguro },
		pendientes,
	});
}

/* ── Enviar al cliente ──────────────────────────────────────────────────────── */

const TEMPLATE_NAME = "mensaje_adjunto";
const LOG_PREFIX = "[DocumentoClienteWhatsapp]";

export type EnvioDocumentoErrorCodigo =
	| "SIN_SIFCO"
	| "SIN_TELEFONO"
	| "SIN_DOCUMENTO"
	| "ERROR_ENVIO";

const MENSAJES_ERROR: Record<EnvioDocumentoErrorCodigo, string> = {
	SIN_SIFCO: "Este caso no tiene un crédito de cartera asociado.",
	SIN_TELEFONO: "El cliente no tiene un número de teléfono válido registrado.",
	SIN_DOCUMENTO: "Este crédito no tiene ese documento cargado.",
	ERROR_ENVIO: "No se pudo enviar el mensaje de WhatsApp.",
};

const CODIGO_HTTP: Record<
	EnvioDocumentoErrorCodigo,
	"BAD_REQUEST" | "NOT_FOUND" | "BAD_GATEWAY"
> = {
	SIN_SIFCO: "BAD_REQUEST",
	SIN_TELEFONO: "BAD_REQUEST",
	SIN_DOCUMENTO: "NOT_FOUND",
	ERROR_ENVIO: "BAD_GATEWAY",
};

/** Nombre y vehículo que van en el texto, con lo que se haya podido leer. */
export interface DatosMensaje {
	numeroCreditoSifco: string | null;
	clienteNombre: string | null;
	vehiculoMarca: string | null;
	vehiculoModelo: string | null;
	vehiculoYear: number | null;
	vehiculoPlaca: string | null;
}

/**
 * El contrato manda; lo que le falte sale de la oportunidad y el lead. El 56%
 * de los casos activos no tiene contrato (`contrato_id` nulo) y sin este
 * respaldo el cliente recibía un mensaje sin su nombre ni su vehículo. Pura.
 */
export function combinarDatosMensaje(
	contrato: Omit<DatosMensaje, "numeroCreditoSifco">,
	oportunidad: Omit<DatosMensaje, "numeroCreditoSifco">,
	numeroCreditoSifco: string | null,
): DatosMensaje {
	const vacio = (v: string | null) => (v?.trim() ? v.trim() : null);
	return {
		numeroCreditoSifco,
		clienteNombre:
			vacio(contrato.clienteNombre) ?? vacio(oportunidad.clienteNombre),
		vehiculoMarca:
			vacio(contrato.vehiculoMarca) ?? vacio(oportunidad.vehiculoMarca),
		vehiculoModelo:
			vacio(contrato.vehiculoModelo) ?? vacio(oportunidad.vehiculoModelo),
		vehiculoYear: contrato.vehiculoYear ?? oportunidad.vehiculoYear,
		vehiculoPlaca:
			vacio(contrato.vehiculoPlaca) ?? vacio(oportunidad.vehiculoPlaca),
	};
}

async function datosParaMensaje(ctx: ContextoCaso): Promise<DatosMensaje> {
	const [[contrato], [oportunidad]] = await Promise.all([
		db
			.select({
				numeroCreditoSifco: casosCobros.numeroCreditoSifco,
				clienteNombre: clients.contactPerson,
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
			.where(eq(casosCobros.id, ctx.casoCobroId))
			.limit(1),
		ctx.opportunityId
			? db
					.select({
						clienteNombre: sql<
							string | null
						>`NULLIF(TRIM(CONCAT_WS(' ', ${leads.firstName}, ${leads.lastName})), '')`,
						vehiculoMarca: vehicles.make,
						vehiculoModelo: vehicles.model,
						vehiculoYear: vehicles.year,
						vehiculoPlaca: vehicles.licensePlate,
					})
					.from(opportunities)
					.leftJoin(leads, eq(opportunities.leadId, leads.id))
					.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
					.where(eq(opportunities.id, ctx.opportunityId))
					.limit(1)
			: Promise.resolve([]),
	]);
	const sinDatos = {
		clienteNombre: null,
		vehiculoMarca: null,
		vehiculoModelo: null,
		vehiculoYear: null,
		vehiculoPlaca: null,
	};
	return combinarDatosMensaje(
		contrato ?? sinDatos,
		oportunidad ?? sinDatos,
		contrato?.numeroCreditoSifco ?? ctx.numeroCreditoSifco,
	);
}

/** Texto del mensaje (va completo en la única variable del template). */
export function construirMensajeDocumento(
	clave: DocumentoEnviar,
	clienteNombre: string | null,
	vehiculo: {
		marca: string | null;
		modelo: string | null;
		year: number | null;
		placa: string | null;
	},
	numeroSifco: string,
	asesor: ContactoAsesor | null = null,
): string {
	const saludo = clienteNombre ? `${clienteNombre}, te` : "Te";
	const descripcionVehiculo = [vehiculo.marca, vehiculo.modelo, vehiculo.year]
		.filter((v): v is string | number => v !== null && v !== "")
		.join(" ");
	const deQue = descripcionVehiculo
		? `de tu ${descripcionVehiculo}${vehiculo.placa ? `, placas ${vehiculo.placa}` : ""}`
		: `del vehículo de tu crédito ${numeroSifco}`;
	const documento =
		clave === "tarjeta-circulacion"
			? "la tarjeta de circulación"
			: "la información del seguro";
	return `${saludo} compartimos ${documento} ${deQue} en el documento adjunto. ${construirCierreAsesor(asesor)}`;
}

/**
 * Envía el documento por WhatsApp. El acceso al caso lo valida el router.
 * Lanza ORPCError con un mensaje para el asesor si no se puede enviar.
 */
export async function enviarDocumentoCliente(params: {
	ctx: ContextoCaso;
	clave: DocumentoEnviar;
	userId: string;
}): Promise<{ telefono: string; templateMessageId?: string }> {
	const { ctx, clave, userId } = params;
	const fallo = (codigo: EnvioDocumentoErrorCodigo) =>
		new ORPCError(CODIGO_HTTP[codigo], { message: MENSAJES_ERROR[codigo] });

	const caso = await datosParaMensaje(ctx);
	const numeroSifco = caso?.numeroCreditoSifco;
	if (!numeroSifco) throw fallo("SIN_SIFCO");

	// Teléfono antes que nada: sin él no se firma ninguna URL.
	const testMode = isTestModeEnabled();
	const realPhone =
		primerTelefono(ctx.telefonoPrincipal) ??
		primerTelefono(ctx.telefonoAlternativo);
	if (!testMode && !realPhone) throw fallo("SIN_TELEFONO");
	const telefonoDestino = testMode ? getTestPhone(2) : (realPhone as string);

	const archivo = await archivoDocumento(ctx, clave);
	if (!archivo) throw fallo("SIN_DOCUMENTO");
	const url = "url" in archivo ? archivo.url : await getFileUrl(archivo.key);

	const asesor = await resolverContactoAsesor(numeroSifco, null);
	const mensaje = construirMensajeDocumento(
		clave,
		caso.clienteNombre,
		{
			marca: caso.vehiculoMarca,
			modelo: caso.vehiculoModelo,
			year: caso.vehiculoYear,
			placa: caso.vehiculoPlaca,
		},
		numeroSifco,
		asesor,
	);
	const filename = `${clave === "tarjeta-circulacion" ? "Tarjeta-de-Circulacion" : "Seguro"}-${numeroSifco}.pdf`;
	const result = await sendWhatsappTemplate({
		phone: telefonoDestino,
		message: mensaje,
		templateName: TEMPLATE_NAME,
		bodyParams: [mensaje],
		header: { type: "document", url, filename },
		logPrefix: testMode ? `${LOG_PREFIX}[TEST]` : LOG_PREFIX,
	});

	// La URL firmada no va al log: abre el documento a quien la tenga.
	await persistCobrosSendLog({
		numeroCreditoSifco: numeroSifco,
		plantillaId: `documento_${clave.replace("-", "_")}`,
		telefono: telefonoDestino,
		mensaje,
		providerRequest: null,
		createdBy: userId,
		result: result.success
			? {
					success: true,
					providerResponse: {
						...(result.providerResponse ?? {}),
						templateMessageId: result.templateMessageId,
						testMode,
						realTarget: testMode ? (realPhone ?? undefined) : undefined,
					},
				}
			: {
					success: false,
					errorMessage: result.error,
					providerResponse: {
						...(result.providerResponse ?? {}),
						...(testMode
							? { testMode, realTarget: realPhone ?? undefined }
							: {}),
					},
				},
	});
	if (!result.success) {
		console.error(
			`${LOG_PREFIX} Falló envío de ${clave} del caso ${ctx.casoCobroId}: ${result.error}`,
		);
		throw fallo("ERROR_ENVIO");
	}
	return {
		telefono: telefonoDestino,
		templateMessageId: result.templateMessageId,
	};
}

/* ── Solicitar al supervisor ────────────────────────────────────────────────── */

export async function solicitarDocumento(params: {
	casoCobroId: string;
	numeroCreditoSifco: string | null;
	clave: DocumentoSolicitar;
	comentario: string | null;
	userId: string;
}) {
	const [fila] = await db
		.insert(solicitudesDocumentosCobros)
		.values({
			casoCobroId: params.casoCobroId,
			numeroCreditoSifco: params.numeroCreditoSifco,
			clave: params.clave,
			comentario: params.comentario,
			solicitadoPor: params.userId,
		})
		// El índice único parcial deja una sola pendiente por caso y documento.
		.onConflictDoNothing()
		.returning({ id: solicitudesDocumentosCobros.id });
	if (!fila) {
		throw new ORPCError("CONFLICT", {
			message: `Ya hay una solicitud pendiente de «${nombreDocumento(params.clave)}» para este caso.`,
		});
	}
	return fila;
}

const solicitante = alias(user, "solicitante");
const resolutor = alias(user, "resolutor");

export async function listarSolicitudesDocumentos(filtro: {
	estado?: "pendiente" | "aprobada" | "rechazada";
	casoCobroId?: string;
	limite: number;
}) {
	const condiciones = [
		filtro.estado
			? eq(solicitudesDocumentosCobros.estado, filtro.estado)
			: undefined,
		filtro.casoCobroId
			? eq(solicitudesDocumentosCobros.casoCobroId, filtro.casoCobroId)
			: undefined,
	].filter((c) => c !== undefined);
	const filas = await db
		.select({
			id: solicitudesDocumentosCobros.id,
			casoCobroId: solicitudesDocumentosCobros.casoCobroId,
			numeroCreditoSifco: solicitudesDocumentosCobros.numeroCreditoSifco,
			clave: solicitudesDocumentosCobros.clave,
			comentario: solicitudesDocumentosCobros.comentario,
			estado: solicitudesDocumentosCobros.estado,
			solicitadoEn: solicitudesDocumentosCobros.solicitadoEn,
			solicitadoPor: solicitante.name,
			resueltoEn: solicitudesDocumentosCobros.resueltoEn,
			resueltoPor: resolutor.name,
			notaResolucion: solicitudesDocumentosCobros.notaResolucion,
		})
		.from(solicitudesDocumentosCobros)
		.innerJoin(
			solicitante,
			eq(solicitante.id, solicitudesDocumentosCobros.solicitadoPor),
		)
		.leftJoin(
			resolutor,
			eq(resolutor.id, solicitudesDocumentosCobros.resueltoPor),
		)
		.where(condiciones.length > 0 ? and(...condiciones) : undefined)
		.orderBy(desc(solicitudesDocumentosCobros.solicitadoEn))
		.limit(filtro.limite);
	return filas.map((f) => ({
		...f,
		documento: nombreDocumento(f.clave),
	}));
}

export async function resolverSolicitudDocumento(params: {
	solicitudId: string;
	decision: "aprobada" | "rechazada";
	nota: string | null;
	userId: string;
}) {
	const [fila] = await db
		.update(solicitudesDocumentosCobros)
		.set({
			estado: params.decision,
			notaResolucion: params.nota,
			resueltoPor: params.userId,
			resueltoEn: new Date(),
		})
		.where(
			and(
				eq(solicitudesDocumentosCobros.id, params.solicitudId),
				// Solo las pendientes: dos supervisores no la deciden dos veces.
				eq(solicitudesDocumentosCobros.estado, "pendiente"),
			),
		)
		.returning({
			id: solicitudesDocumentosCobros.id,
			estado: solicitudesDocumentosCobros.estado,
		});
	if (!fila) {
		throw new ORPCError("CONFLICT", {
			message: "La solicitud no existe o ya fue resuelta.",
		});
	}
	return fila;
}
