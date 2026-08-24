/**
 * Send Estado de Cuenta Whatsapp Service
 *
 * Envía por WhatsApp el estado de cuenta (PDF) de un crédito, usando el mismo
 * template `mensaje_adjunto` de WittyBots que `send-coverage-document.ts`
 * (header de documento + body de 1 variable). A diferencia de la cobertura de
 * seguro, el documento NO es fijo: se genera en cada llamada en cartera-back
 * (Puppeteer + subida a R2) vía `carteraBackClient.getEstadoCuentaUrl`.
 *
 * Autocontenido y nunca lanza al caller: cualquier fallo (caso sin teléfono,
 * crédito sin movimientos, cartera caída, SimpleTech caído) se resuelve como
 * un resultado tipado, nunca como una excepción.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { casosCobros, contratosFinanciamiento } from "../db/schema/cobros";
import { clients } from "../db/schema/crm";
import { vehicles } from "../db/schema/vehicles";
import { persistCobrosSendLog } from "../lib/cobros-send-log";
import { getTestPhone, isTestModeEnabled } from "../lib/messaging-test-mode";
import { primerTelefono } from "../lib/phone-utils";
import { sendWhatsappTemplate } from "../lib/simpletech";
import {
	type ContactoAsesor,
	construirCierreAsesor,
	type ObtenerAsesor,
	obtenerAsesorCartera,
	resolverContactoAsesor,
} from "./asesor-whatsapp";
import { carteraBackClient } from "./cartera-back-client";

/** Template de WittyBots: header documento + 1 variable de body. */
const TEMPLATE_NAME = "mensaje_adjunto";

const LOG_PREFIX = "[EstadoCuentaWhatsapp]";

export type EstadoCuentaErrorCodigo =
	| "CASO_NO_ENCONTRADO"
	| "SIN_SIFCO"
	| "SIN_TELEFONO"
	| "SIN_MOVIMIENTOS"
	| "CREDITO_NO_ESTA_EN_CARTERA"
	| "ERROR_CARTERA"
	| "ERROR_ENVIO"
	| "ERROR_INTERNO";

const MENSAJES_ERROR: Record<EstadoCuentaErrorCodigo, string> = {
	CASO_NO_ENCONTRADO: "No se encontró el caso de cobros.",
	SIN_SIFCO: "Este caso no tiene un crédito de cartera asociado.",
	SIN_TELEFONO: "El cliente no tiene un número de teléfono válido registrado.",
	SIN_MOVIMIENTOS:
		"Este crédito todavía no tiene movimientos, no hay estado de cuenta que enviar.",
	CREDITO_NO_ESTA_EN_CARTERA: "No encontramos este crédito en cartera.",
	ERROR_CARTERA: "No se pudo generar el estado de cuenta. Intenta de nuevo.",
	ERROR_ENVIO: "No se pudo enviar el mensaje de WhatsApp.",
	ERROR_INTERNO: "No se pudo preparar el envío. Intenta de nuevo.",
};

export interface SendEstadoCuentaWhatsappParams {
	casoCobroId: string;
	userId: string;
	/** Solo supervisor/admin pueden enviar estados de cuenta de cualquier caso. */
	puedeVerTodos?: boolean;
	/**
	 * Si es true, el mensaje se manda SIEMPRE al primer teléfono de prueba
	 * (`TEST_PHONES[0]`), nunca al del cliente real. En producción se llama
	 * SIN esto (el gate real es `TEST_MESSAGE`).
	 */
	toTestPhone?: boolean;
}

export type SendEstadoCuentaWhatsappResult =
	| { sent: true; templateMessageId?: string; telefono: string }
	| { sent: false; codigo: EstadoCuentaErrorCodigo; mensaje: string };

interface DatosCaso {
	numeroCreditoSifco: string | null;
	telefonoPrincipal: string | null;
	telefonoAlternativo: string | null;
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
	const whereClause = scope.puedeVerTodos
		? eq(casosCobros.id, casoCobroId)
		: and(
				eq(casosCobros.id, casoCobroId),
				eq(casosCobros.responsableCobros, scope.userId),
			);
	const [row] = await db
		.select({
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			telefonoPrincipal: casosCobros.telefonoPrincipal,
			telefonoAlternativo: casosCobros.telefonoAlternativo,
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
		.where(whereClause)
		.limit(1);

	return row ?? null;
}

/**
 * Texto del mensaje (va completo en la única variable del template).
 */
export function construirMensajeEstadoCuenta(
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
	const saludo = clienteNombre ? `Hola ${clienteNombre}` : "Hola";
	const descripcionVehiculo = [vehiculo.marca, vehiculo.modelo, vehiculo.year]
		.filter((valor): valor is string | number => valor !== null)
		.join(" ");
	const identificador = descripcionVehiculo
		? ` de tu ${descripcionVehiculo}${vehiculo.placa ? `, placas ${vehiculo.placa}` : ""}`
		: ` de tu crédito ${numeroSifco}`;
	return `${saludo}, te compartimos el estado de cuenta${identificador} en el documento adjunto. ${construirCierreAsesor(asesor)}`;
}

/** Deps inyectables solo para tests — en producción no se pasa nada. */
export interface EstadoCuentaDeps {
	cargarCaso?: (
		casoCobroId: string,
		scope: EstadoCuentaScope,
	) => Promise<DatosCaso | null>;
	obtenerUrl?: typeof carteraBackClient.getEstadoCuentaUrl;
	obtenerAsesor?: ObtenerAsesor;
	enviar?: typeof sendWhatsappTemplate;
	guardarLog?: typeof persistCobrosSendLog;
}

export async function sendEstadoCuentaWhatsapp(
	params: SendEstadoCuentaWhatsappParams,
	deps: EstadoCuentaDeps = {},
): Promise<SendEstadoCuentaWhatsappResult> {
	const { casoCobroId, userId } = params;
	const scope: EstadoCuentaScope = {
		userId,
		puedeVerTodos: params.puedeVerTodos ?? false,
	};
	const cargarCaso = deps.cargarCaso ?? cargarCasoDefault;
	const obtenerUrl =
		deps.obtenerUrl ??
		carteraBackClient.getEstadoCuentaUrl.bind(carteraBackClient);
	const enviar = deps.enviar ?? sendWhatsappTemplate;
	const guardarLog = deps.guardarLog ?? persistCobrosSendLog;
	const obtenerAsesor = deps.obtenerAsesor ?? obtenerAsesorCartera;

	const fallo = (
		codigo: EstadoCuentaErrorCodigo,
	): SendEstadoCuentaWhatsappResult => ({
		sent: false,
		codigo,
		mensaje: MENSAJES_ERROR[codigo],
	});

	// 1. Cargar el caso.
	let caso: DatosCaso | null;
	try {
		caso = await cargarCaso(casoCobroId, scope);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`${LOG_PREFIX} Error cargando caso ${casoCobroId}: ${msg}`);
		return fallo("ERROR_INTERNO");
	}
	if (!caso) {
		console.error(`${LOG_PREFIX} Caso ${casoCobroId} no encontrado`);
		return fallo("CASO_NO_ENCONTRADO");
	}

	const numeroSifco = caso.numeroCreditoSifco;
	if (!numeroSifco) {
		console.log(`${LOG_PREFIX} Caso ${casoCobroId} sin número SIFCO; se omite`);
		return fallo("SIN_SIFCO");
	}

	// 2. Resolver teléfono ANTES de generar nada — evita quemar un Puppeteer en
	//    cartera para después no poder enviar.
	const testMode = params.toTestPhone || isTestModeEnabled();
	const realPhone =
		primerTelefono(caso.telefonoPrincipal) ??
		primerTelefono(caso.telefonoAlternativo);

	let telefonoDestino: string;
	if (testMode) {
		telefonoDestino = getTestPhone(2);
	} else {
		if (!realPhone) {
			console.log(
				`${LOG_PREFIX} Caso ${casoCobroId} sin teléfono válido; se omite`,
			);
			return fallo("SIN_TELEFONO");
		}
		telefonoDestino = realPhone;
	}
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
	const guardarFallo = async (
		codigo: Exclude<
			EstadoCuentaErrorCodigo,
			"CASO_NO_ENCONTRADO" | "SIN_SIFCO" | "SIN_TELEFONO"
		>,
	) => {
		await guardarLog({
			numeroCreditoSifco: numeroSifco,
			plantillaId: "estado_cuenta",
			telefono: telefonoDestino,
			mensaje,
			providerRequest: null,
			createdBy: userId,
			result: {
				success: false,
				errorMessage: MENSAJES_ERROR[codigo],
				providerResponse: testMode
					? { testMode, realTarget: realPhone ?? undefined }
					: undefined,
			},
		});
	};

	// 3. Generar el documento en cartera-back. Sin reintentos: un timeout
	//    después de que cartera empezó a trabajar dejaría PDFs huérfanos en R2.
	let estadoCuentaUrl: string;
	try {
		const resultado = await obtenerUrl(numeroSifco);
		if (!resultado.ok) {
			console.log(
				`${LOG_PREFIX} Sin estado de cuenta para ${numeroSifco}: ${resultado.motivo}`,
			);
			const codigo =
				resultado.motivo === "SIN_MOVIMIENTOS"
					? "SIN_MOVIMIENTOS"
					: "CREDITO_NO_ESTA_EN_CARTERA";
			await guardarFallo(codigo);
			return fallo(codigo);
		}
		estadoCuentaUrl = resultado.url;
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(
			`${LOG_PREFIX} Error consultando cartera para ${numeroSifco}: ${msg}`,
		);
		await guardarFallo("ERROR_CARTERA");
		return fallo("ERROR_CARTERA");
	}

	// 4. Enviar por WhatsApp.
	const result = await enviar({
		phone: telefonoDestino,
		message: mensaje,
		templateName: TEMPLATE_NAME,
		// El template tiene 1 sola variable de body: mandamos todo el texto como
		// un único parámetro (sin partir por párrafos).
		bodyParams: [mensaje],
		header: {
			type: "document",
			url: estadoCuentaUrl,
			filename: `Estado-de-Cuenta-${numeroSifco}.pdf`,
		},
		logPrefix: testMode ? `${LOG_PREFIX}[TEST]` : LOG_PREFIX,
	});

	// 5. Log de traza en cobros_send_logs.
	await guardarLog({
		numeroCreditoSifco: numeroSifco,
		plantillaId: "estado_cuenta",
		telefono: telefonoDestino,
		mensaje,
		providerRequest: result.providerRequest ?? null,
		createdBy: userId,
		result: result.success
			? {
					success: true,
					providerResponse: {
						...(result.providerResponse ?? {}),
						templateMessageId: result.templateMessageId,
						estadoCuentaUrl,
						testMode,
						realTarget: testMode ? (realPhone ?? undefined) : undefined,
					},
				}
			: {
					success: false,
					errorMessage: result.error,
					providerResponse: {
						...(result.providerResponse ?? {}),
						estadoCuentaUrl,
						...(testMode
							? { testMode, realTarget: realPhone ?? undefined }
							: {}),
					},
				},
	});

	if (!result.success) {
		console.error(
			`${LOG_PREFIX} Falló envío para caso ${casoCobroId}: ${result.error}`,
		);
		return fallo("ERROR_ENVIO");
	}

	console.log(
		`${LOG_PREFIX} ✓ Estado de cuenta enviado para caso ${casoCobroId}`,
	);
	return {
		sent: true,
		templateMessageId: result.templateMessageId,
		telefono: telefonoDestino,
	};
}
