/**
 * Estado de cuenta de un caso de cobros: vista previa y envío por correo.
 *
 * El documento es EL MISMO que se manda por WhatsApp
 * (`send-estado-cuenta-whatsapp.ts`): cartera-back lo genera en cada llamada
 * (Puppeteer + subida a R2) vía `carteraBackClient.getEstadoCuentaUrl` y
 * devuelve la URL pública del PDF. Aquí no se arma ningún PDF propio.
 *
 *  - `obtenerEstadoCuentaPdf`: para que el asesor lo vea antes de enviarlo.
 *  - `sendEstadoCuentaEmail`: lo adjunta a un correo (Resend, vía `@cci/email`,
 *    el mismo servicio que ya usa `enviarEmailCobros`) y deja la traza en
 *    `cobros_send_logs` con canal `email`, igual que el WhatsApp deja la suya
 *    con canal `whatsapp`.
 *
 * Mismo contrato que el WhatsApp: nunca lanza al caller, todo fallo vuelve
 * como un resultado tipado.
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { casosCobros, contratosFinanciamiento } from "../db/schema/cobros";
import { cobrosSendLogs } from "../db/schema/cobros-send-logs";
import { clients, leads } from "../db/schema/crm";
import { vehicles } from "../db/schema/vehicles";
import { usuarioTrabajaSifco } from "../lib/acceso-caso-cobro";
import { isTestModeEnabled, TEST_EMAIL } from "../lib/messaging-test-mode";
import {
	type ObtenerAsesor,
	obtenerAsesorCartera,
	resolverContactoAsesor,
} from "./asesor-whatsapp";
import { carteraBackClient } from "./cartera-back-client";
import { construirMensajeEstadoCuenta } from "./send-estado-cuenta-whatsapp";

const LOG_PREFIX = "[EstadoCuentaCaso]";

/** Mismo `plantilla_id` que el WhatsApp: el log distingue por `canal`. */
const PLANTILLA_ID = "estado_cuenta";

export type EstadoCuentaCasoErrorCodigo =
	| "CASO_NO_ENCONTRADO"
	| "SIN_SIFCO"
	| "SIN_EMAIL"
	| "SIN_MOVIMIENTOS"
	| "CREDITO_NO_ESTA_EN_CARTERA"
	| "ERROR_CARTERA"
	| "ERROR_ENVIO"
	| "ERROR_INTERNO";

const MENSAJES_ERROR: Record<EstadoCuentaCasoErrorCodigo, string> = {
	CASO_NO_ENCONTRADO: "No se encontró el caso de cobros.",
	SIN_SIFCO: "Este caso no tiene un crédito de cartera asociado.",
	SIN_EMAIL:
		"El cliente no tiene un correo válido registrado. Ingrese el correo al que se enviará.",
	SIN_MOVIMIENTOS:
		"Este crédito todavía no tiene movimientos, no hay estado de cuenta que mostrar.",
	CREDITO_NO_ESTA_EN_CARTERA: "No se encontró este crédito en cartera.",
	ERROR_CARTERA: "No se pudo generar el estado de cuenta. Intente de nuevo.",
	ERROR_ENVIO: "No se pudo enviar el correo. Intente de nuevo.",
	ERROR_INTERNO: "No se pudo preparar el estado de cuenta. Intente de nuevo.",
};

type Fallo = {
	codigo: EstadoCuentaCasoErrorCodigo;
	mensaje: string;
};

function fallo(codigo: EstadoCuentaCasoErrorCodigo): Fallo {
	return { codigo, mensaje: MENSAJES_ERROR[codigo] };
}

/**
 * Correo que no sirve como destino: mal formado o de relleno
 * («sin-email@example.com», que la sincronización pone cuando el lead no
 * tiene). Mismo criterio que `correoDeRelleno` del Workspace
 * (`web/.../gestion/contacto-valido.ts`).
 */
export function esCorreoDeRelleno(correo: string | null | undefined): boolean {
	const c = (correo ?? "").trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return true;
	const [usuario, dominio] = c.split("@");
	if (/^(example|ejemplo|test|prueba)\.[a-z.]+$/.test(dominio)) return true;
	return /^(sin|no)[-_.]?(e-?mail|correo|tiene)/.test(usuario);
}

/** Nombre del adjunto: el mismo que usa el WhatsApp. */
export function nombreArchivoEstadoCuenta(numeroSifco: string): string {
	return `Estado-de-Cuenta-${numeroSifco}.pdf`;
}

function escaparHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

/** Cuerpo del correo: el mismo texto del WhatsApp, en un párrafo. */
export function construirHtmlEstadoCuenta(mensaje: string): string {
	return `<div style="font-family:Arial,sans-serif;color:#111827;font-size:14px;line-height:1.5;"><p>${escaparHtml(
		mensaje,
	)}</p></div>`;
}

export function asuntoEstadoCuenta(numeroSifco: string): string {
	return `Estado de cuenta de su crédito ${numeroSifco}`;
}

interface DatosCaso {
	numeroCreditoSifco: string | null;
	/** Correo del caso del CRM (editable desde la ficha). */
	emailContacto: string | null;
	/** Correo del lead, el respaldo que usa la ficha cuando el caso no tiene. */
	emailLead: string | null;
	clienteNombre: string | null;
	vehiculoMarca: string | null;
	vehiculoModelo: string | null;
	vehiculoYear: number | null;
	vehiculoPlaca: string | null;
}

interface EstadoCuentaScope {
	userId: string;
	puedeVerTodos: boolean;
}

async function cargarCasoDefault(
	casoCobroId: string,
	scope: EstadoCuentaScope,
): Promise<DatosCaso | null> {
	const [row] = await db
		.select({
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			emailContacto: casosCobros.emailContacto,
			emailLead: leads.email,
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
		.leftJoin(leads, eq(clients.leadId, leads.id))
		.leftJoin(vehicles, eq(contratosFinanciamiento.vehicleId, vehicles.id))
		.where(eq(casosCobros.id, casoCobroId))
		.limit(1);
	if (!row) return null;

	// Mismo permiso que el WhatsApp: lo da cartera (el asesor que lleva el
	// crédito o quien lo cubre). Sin acceso se responde igual que sin caso.
	if (
		!scope.puedeVerTodos &&
		!(await usuarioTrabajaSifco(scope.userId, row.numeroCreditoSifco))
	) {
		return null;
	}
	return row;
}

type EnviarCorreo = (params: {
	to: string[];
	asunto: string;
	html: string;
	adjuntos?: Array<{ filename: string; path: string }>;
}) => Promise<
	{ success: true; id: string } | { success: false; error: unknown }
>;

/**
 * El paquete de correo se carga al usarlo: valida RESEND_API_KEY al importarse
 * y así las pruebas (que inyectan `enviar`) no dependen del entorno.
 */
const enviarCorreoDefault: EnviarCorreo = async (params) => {
	const { enviarCorreoEnHilo } = await import("@cci/email");
	return enviarCorreoEnHilo(params);
};

type GuardarLogEmail = (params: {
	numeroCreditoSifco: string | null;
	email: string;
	asunto: string;
	mensaje: string;
	createdBy: string;
	result:
		| { success: true; providerResponse?: Record<string, unknown> }
		| {
				success: false;
				errorMessage?: string;
				providerResponse?: Record<string, unknown>;
		  };
}) => Promise<void>;

/** Traza en `cobros_send_logs` (best-effort: nunca rompe el envío). */
const guardarLogEmailDefault: GuardarLogEmail = async (params) => {
	try {
		await db.insert(cobrosSendLogs).values({
			numeroCreditoSifco: params.numeroCreditoSifco,
			canal: "email",
			email: params.email,
			asunto: params.asunto,
			mensaje: params.mensaje,
			plantillaId: PLANTILLA_ID,
			providerRequest: null,
			status: params.result.success ? "sent" : "failed",
			errorMessage: params.result.success ? null : params.result.errorMessage,
			providerResponse: params.result.providerResponse,
			createdBy: params.createdBy,
			sentAt: params.result.success ? new Date() : null,
		});
	} catch (err) {
		console.error("[cobros_send_logs] Error guardando log:", err);
	}
};

/** Deps inyectables solo para pruebas — en producción no se pasa nada. */
export interface EstadoCuentaCasoDeps {
	cargarCaso?: (
		casoCobroId: string,
		scope: EstadoCuentaScope,
	) => Promise<DatosCaso | null>;
	obtenerUrl?: typeof carteraBackClient.getEstadoCuentaUrl;
	obtenerAsesor?: ObtenerAsesor;
	enviar?: EnviarCorreo;
	guardarLog?: GuardarLogEmail;
}

export interface EstadoCuentaCasoParams {
	casoCobroId: string;
	userId: string;
	/** Supervisor/admin: cualquier caso. */
	puedeVerTodos?: boolean;
}

type CasoListo = { caso: DatosCaso; numeroSifco: string };

async function cargarCasoConSifco(
	params: EstadoCuentaCasoParams,
	deps: EstadoCuentaCasoDeps,
): Promise<CasoListo | Fallo> {
	const cargarCaso = deps.cargarCaso ?? cargarCasoDefault;
	let caso: DatosCaso | null;
	try {
		caso = await cargarCaso(params.casoCobroId, {
			userId: params.userId,
			puedeVerTodos: params.puedeVerTodos ?? false,
		});
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(
			`${LOG_PREFIX} Error cargando caso ${params.casoCobroId}: ${msg}`,
		);
		return fallo("ERROR_INTERNO");
	}
	if (!caso) return fallo("CASO_NO_ENCONTRADO");
	const numeroSifco = caso.numeroCreditoSifco?.trim();
	if (!numeroSifco) return fallo("SIN_SIFCO");
	return { caso, numeroSifco };
}

/** Genera el PDF en cartera. Sin reintentos (ver `getEstadoCuentaUrl`). */
async function generarUrl(
	numeroSifco: string,
	deps: EstadoCuentaCasoDeps,
): Promise<{ url: string } | Fallo> {
	const obtenerUrl =
		deps.obtenerUrl ??
		carteraBackClient.getEstadoCuentaUrl.bind(carteraBackClient);
	try {
		const resultado = await obtenerUrl(numeroSifco);
		if (!resultado.ok) {
			console.log(
				`${LOG_PREFIX} Sin estado de cuenta para ${numeroSifco}: ${resultado.motivo}`,
			);
			return fallo(
				resultado.motivo === "SIN_MOVIMIENTOS"
					? "SIN_MOVIMIENTOS"
					: "CREDITO_NO_ESTA_EN_CARTERA",
			);
		}
		return { url: resultado.url };
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(
			`${LOG_PREFIX} Error consultando cartera para ${numeroSifco}: ${msg}`,
		);
		return fallo("ERROR_CARTERA");
	}
}

export type ObtenerEstadoCuentaPdfResult =
	| { ok: true; url: string; nombreArchivo: string }
	| ({ ok: false } & Fallo);

/** Vista previa: el mismo PDF que se envía, sin enviarlo a nadie. */
export async function obtenerEstadoCuentaPdf(
	params: EstadoCuentaCasoParams,
	deps: EstadoCuentaCasoDeps = {},
): Promise<ObtenerEstadoCuentaPdfResult> {
	const listo = await cargarCasoConSifco(params, deps);
	if ("codigo" in listo) return { ok: false, ...listo };
	const generado = await generarUrl(listo.numeroSifco, deps);
	if ("codigo" in generado) return { ok: false, ...generado };
	return {
		ok: true,
		url: generado.url,
		nombreArchivo: nombreArchivoEstadoCuenta(listo.numeroSifco),
	};
}

export interface SendEstadoCuentaEmailParams extends EstadoCuentaCasoParams {
	/**
	 * Destinatario elegido en el modal. Sin él, el correo del cliente en el CRM
	 * (el del caso y, si no tiene, el del lead). No se guarda en la ficha.
	 */
	email?: string;
}

export type SendEstadoCuentaEmailResult =
	| { sent: true; email: string; emailId?: string }
	| ({ sent: false } & Fallo);

export async function sendEstadoCuentaEmail(
	params: SendEstadoCuentaEmailParams,
	deps: EstadoCuentaCasoDeps = {},
): Promise<SendEstadoCuentaEmailResult> {
	const enviar = deps.enviar ?? enviarCorreoDefault;
	const guardarLog = deps.guardarLog ?? guardarLogEmailDefault;
	const obtenerAsesor = deps.obtenerAsesor ?? obtenerAsesorCartera;

	// 1. Caso y acceso.
	const listo = await cargarCasoConSifco(params, deps);
	if ("codigo" in listo) return { sent: false, ...listo };
	const { caso, numeroSifco } = listo;

	// 2. Destinatario ANTES de generar el PDF: no quemar un Puppeteer en
	//    cartera para después no poder enviar.
	const elegido = params.email?.trim();
	const delCrm = [caso.emailContacto, caso.emailLead]
		.map((c) => c?.trim() ?? "")
		.find((c) => c && !esCorreoDeRelleno(c));
	const realEmail = elegido || delCrm;
	if (!realEmail || esCorreoDeRelleno(realEmail)) {
		console.log(
			`${LOG_PREFIX} Caso ${params.casoCobroId} sin correo válido; se omite`,
		);
		return { sent: false, ...fallo("SIN_EMAIL") };
	}
	const testMode = isTestModeEnabled();
	const emailDestino = testMode ? TEST_EMAIL : realEmail;

	const asesor = await resolverContactoAsesor(numeroSifco, null, obtenerAsesor);
	const mensaje = construirMensajeEstadoCuenta(
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
	const asunto = asuntoEstadoCuenta(numeroSifco);
	const realTarget = testMode ? { testMode, realTarget: realEmail } : {};

	// 3. El mismo PDF que el WhatsApp.
	const generado = await generarUrl(numeroSifco, deps);
	if ("codigo" in generado) {
		await guardarLog({
			numeroCreditoSifco: numeroSifco,
			email: emailDestino,
			asunto,
			mensaje,
			createdBy: params.userId,
			result: {
				success: false,
				errorMessage: generado.mensaje,
				providerResponse: testMode ? realTarget : undefined,
			},
		});
		return { sent: false, ...generado };
	}

	// 4. Enviar con el PDF adjunto (Resend lo baja de la URL de R2).
	let resultado: Awaited<ReturnType<EnviarCorreo>>;
	try {
		resultado = await enviar({
			to: [emailDestino],
			asunto,
			html: construirHtmlEstadoCuenta(mensaje),
			adjuntos: [
				{
					filename: nombreArchivoEstadoCuenta(numeroSifco),
					path: generado.url,
				},
			],
		});
	} catch (error) {
		resultado = { success: false, error };
	}

	// 5. Traza en cobros_send_logs.
	const errorTexto = resultado.success
		? null
		: resultado.error instanceof Error
			? resultado.error.message
			: resultado.error && typeof resultado.error === "object"
				? JSON.stringify(resultado.error)
				: String(resultado.error ?? "desconocido");
	await guardarLog({
		numeroCreditoSifco: numeroSifco,
		email: emailDestino,
		asunto,
		mensaje,
		createdBy: params.userId,
		result: resultado.success
			? {
					success: true,
					providerResponse: {
						emailId: resultado.id,
						estadoCuentaUrl: generado.url,
						...realTarget,
					},
				}
			: {
					success: false,
					errorMessage: errorTexto ?? undefined,
					providerResponse: { estadoCuentaUrl: generado.url, ...realTarget },
				},
	});

	if (!resultado.success) {
		console.error(
			`${LOG_PREFIX} Falló el correo del caso ${params.casoCobroId}: ${errorTexto}`,
		);
		return { sent: false, ...fallo("ERROR_ENVIO") };
	}

	console.log(
		`${LOG_PREFIX} ✓ Estado de cuenta enviado por correo para caso ${params.casoCobroId}`,
	);
	return { sent: true, email: emailDestino, emailId: resultado.id };
}

/** Código de negocio → código HTTP del `ORPCError` (tabla pura, testeable). */
export function codigoEstadoCuentaCasoAHttp(
	codigo: EstadoCuentaCasoErrorCodigo,
): "NOT_FOUND" | "BAD_REQUEST" | "INTERNAL_SERVER_ERROR" {
	switch (codigo) {
		case "CASO_NO_ENCONTRADO":
			return "NOT_FOUND";
		case "SIN_SIFCO":
		case "SIN_EMAIL":
		case "SIN_MOVIMIENTOS":
		case "CREDITO_NO_ESTA_EN_CARTERA":
			return "BAD_REQUEST";
		case "ERROR_CARTERA":
		case "ERROR_ENVIO":
		case "ERROR_INTERNO":
			return "INTERNAL_SERVER_ERROR";
	}
}
