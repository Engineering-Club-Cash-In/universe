/**
 * Send Recibo Pago Whatsapp Service
 *
 * Envía por WhatsApp el recibo de comprobante de un pago (CB-113), usando el
 * template `mensaje_adjunto` de WittyBots (header de documento + body de 1
 * variable).
 * El documento ya viene generado: lo dispara cartera-back cuando un pago queda
 * aplicado (conta lo valida o entra por Nexa) y manda la URL del PDF (1 recibo
 * por `pago_id`, no por factura ni por boleta).
 *
 * Sin sesión de usuario: lo llama cartera-back servidor-a-servidor (API key),
 * no un asesor desde el frontend, así que el caso se busca por número SIFCO
 * y no pasa por el gate de acceso de la ficha.
 *
 * Autocontenido y nunca lanza al caller: cualquier fallo (caso sin teléfono,
 * caso no encontrado, SimpleTech caído) se resuelve como un resultado
 * tipado, nunca como una excepción.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { casosCobros, contratosFinanciamiento } from "../db/schema/cobros";
import { recibosPagoWhatsapp } from "../db/schema/cobros-send-logs";
import { clients, leads, opportunities } from "../db/schema/crm";
import { vehicles } from "../db/schema/vehicles";
import { persistCobrosSendLog } from "../lib/cobros-send-log";
import { getTestPhone, isTestModeEnabled } from "../lib/messaging-test-mode";
import { primerTelefono } from "../lib/phone-utils";
import { ROLES } from "../lib/roles";
import { sendWhatsappTemplate } from "../lib/simpletech";
import {
	type ContactoAsesor,
	construirCierreAsesor,
	type ObtenerAsesor,
	obtenerAsesorCartera,
	resolverContactoAsesor,
} from "./asesor-whatsapp";

const TEMPLATE_NAME = "mensaje_adjunto";
const LOG_PREFIX = "[ReciboPagoWhatsapp]";

export type ReciboPagoErrorCodigo =
	| "CASO_NO_ENCONTRADO"
	| "SIN_TELEFONO"
	| "SIN_USUARIO_SISTEMA"
	| "ERROR_ENVIO"
	| "EN_CURSO"
	| "ERROR_INTERNO";

const MENSAJES_ERROR: Record<ReciboPagoErrorCodigo, string> = {
	CASO_NO_ENCONTRADO: "No se encontró un caso de cobros para ese número SIFCO.",
	SIN_TELEFONO: "El cliente no tiene un número de teléfono válido registrado.",
	SIN_USUARIO_SISTEMA:
		"No se encontró un usuario cobros_supervisor para registrar el envío.",
	ERROR_ENVIO: "No se pudo enviar el mensaje de WhatsApp.",
	EN_CURSO: "El recibo de este pago ya se está enviando.",
	ERROR_INTERNO: "No se pudo preparar el envío. Intente de nuevo.",
};

export interface SendReciboPagoWhatsappParams {
	pagoId: number;
	numeroSifco: string;
	reciboUrl: string;
	clienteNombre: string;
	numeroCuota?: number | null;
	asesorNombre?: string | null;
	asesorTelefono?: string | null;
}

export type SendReciboPagoWhatsappResult =
	| {
			sent: true;
			templateMessageId?: string;
			telefono: string;
			/** true si el recibo ya se había mandado y no se volvió a enviar. */
			yaEnviado?: boolean;
	  }
	| { sent: false; codigo: ReciboPagoErrorCodigo; mensaje: string };

interface DatosCaso {
	telefonoPrincipal: string | null;
	telefonoAlternativo: string | null;
	vehiculoMarca: string | null;
	vehiculoModelo: string | null;
	vehiculoYear: number | null;
	vehiculoPlaca: string | null;
}

/**
 * `casos_cobros` solo existe para créditos en mora (`diasMora > 0`, ver
 * `sync-casos-cobros.ts`), así que un cliente al día nunca tiene fila ahí.
 * Fallback: `opportunities` (ganada/migrada) → `leads.phone`, la misma
 * fuente que ya usa el bot de cobros para cualquier crédito activo
 * (`bot-cobros/buscar-cliente.ts`). El vehículo se resuelve vía
 * `clients.opportunityId` → `contratosFinanciamiento`, cuando existe.
 */
const ESTADOS_CON_CREDITO = ["won", "migrate"] as const;

async function cargarCasoPorSifco(
	numeroSifco: string,
): Promise<DatosCaso | null> {
	const [row] = await db
		.select({
			telefonoPrincipal: casosCobros.telefonoPrincipal,
			telefonoAlternativo: casosCobros.telefonoAlternativo,
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
		.leftJoin(vehicles, eq(contratosFinanciamiento.vehicleId, vehicles.id))
		.where(eq(casosCobros.numeroCreditoSifco, numeroSifco))
		// `activo` es nullable — con DESC simple Postgres pone NULL antes que
		// true (NULLS FIRST es el default), así que un caso con activo=NULL le
		// ganaría a uno activo=true. coalesce(activo,false) trata NULL como
		// inactivo, igual que el criterio de `caso-vigente.ts`.
		.orderBy(
			desc(sql`coalesce(${casosCobros.activo}, false)`),
			desc(casosCobros.updatedAt),
		)
		.limit(1);

	// `sync-casos-cobros.ts` guarda el placeholder "Sin teléfono" cuando no
	// pudo resolver el lead al crear el caso — sin este chequeo, ese caso
	// "existe" pero nunca dispara el fallback de abajo y el envío termina en
	// SIN_TELEFONO en vez de intentar leads.phone.
	const tieneTelefonoValido =
		row &&
		(primerTelefono(row.telefonoPrincipal) ??
			primerTelefono(row.telefonoAlternativo));
	if (tieneTelefonoValido) return row;

	const [fallback] = await db
		.select({
			telefonoPrincipal: leads.phone,
			vehiculoMarca: vehicles.make,
			vehiculoModelo: vehicles.model,
			vehiculoYear: vehicles.year,
			vehiculoPlaca: vehicles.licensePlate,
		})
		.from(opportunities)
		.innerJoin(leads, eq(leads.id, opportunities.leadId))
		.leftJoin(clients, eq(clients.opportunityId, opportunities.id))
		.leftJoin(
			contratosFinanciamiento,
			eq(contratosFinanciamiento.clientId, clients.id),
		)
		.leftJoin(vehicles, eq(vehicles.id, contratosFinanciamiento.vehicleId))
		.where(
			and(
				eq(opportunities.numeroSifco, numeroSifco),
				inArray(opportunities.status, [...ESTADOS_CON_CREDITO]),
			),
		)
		.orderBy(desc(opportunities.updatedAt))
		.limit(1);

	if (!fallback) return row ?? null;

	return { ...fallback, telefonoAlternativo: null };
}

/** Envío disparado por el propio sistema: se atribuye al primer cobros_supervisor. */
async function obtenerUsuarioSistema(): Promise<string | null> {
	const [supervisor] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.role, ROLES.COBROS_SUPERVISOR))
		.limit(1);

	return supervisor?.id ?? null;
}

export function construirMensajeReciboPago(
	clienteNombre: string,
	vehiculo: {
		marca: string | null;
		modelo: string | null;
		year: number | null;
		placa: string | null;
	},
	numeroSifco: string,
	extra: { numeroCuota?: number | null; asesor?: ContactoAsesor | null } = {},
): string {
	// Registro formal (usted), como el resto de los textos de cobros.
	const saludo = clienteNombre ? `${clienteNombre}, le` : "Le";
	const descripcionVehiculo = [vehiculo.marca, vehiculo.modelo, vehiculo.year]
		.filter((valor): valor is string | number => valor !== null)
		.join(" ");
	const identificador = descripcionVehiculo
		? ` de su ${descripcionVehiculo}${vehiculo.placa ? `, placas ${vehiculo.placa}` : ""}`
		: ` de su crédito ${numeroSifco}`;
	const cuota =
		extra.numeroCuota != null ? ` (cuota ${extra.numeroCuota})` : "";

	return `${saludo} compartimos el recibo del pago${identificador}${cuota} en el documento adjunto. ${construirCierreAsesor(extra.asesor ?? null)}`;
}

type ReservaEnvio = "nueva" | "ya_enviado" | "en_curso";

/** Un "enviando" de más de 30 min no se reenvía: no se sabe si llegó. */
const MINUTOS_ENVIO_TRABADO = 30;

/**
 * Reserva el pago antes de llamar a WhatsApp. Solo un pago nuevo o con un
 * envío fallido se puede mandar; uno enviado o con un envío en curso no.
 */
async function reservarEnvioRecibo(
	pagoId: number,
	numeroSifco: string,
): Promise<ReservaEnvio> {
	const [tomada] = await db
		.insert(recibosPagoWhatsapp)
		.values({ pagoId, numeroCreditoSifco: numeroSifco, estado: "enviando" })
		.onConflictDoUpdate({
			target: recibosPagoWhatsapp.pagoId,
			set: {
				estado: "enviando",
				intentos: sql`${recibosPagoWhatsapp.intentos} + 1`,
				actualizadoAt: new Date(),
			},
			setWhere: eq(recibosPagoWhatsapp.estado, "fallido"),
		})
		.returning({ pagoId: recibosPagoWhatsapp.pagoId });
	if (tomada) return "nueva";

	const [actual] = await db
		.select({
			estado: recibosPagoWhatsapp.estado,
			trabado: sql<boolean>`${recibosPagoWhatsapp.actualizadoAt} < now() - make_interval(mins => ${MINUTOS_ENVIO_TRABADO}::int)`,
		})
		.from(recibosPagoWhatsapp)
		.where(eq(recibosPagoWhatsapp.pagoId, pagoId))
		.limit(1);
	if (actual?.estado === "enviando" && !actual.trabado) return "en_curso";
	if (actual?.estado === "enviando") {
		console.warn(
			`${LOG_PREFIX} Pago ${pagoId}: envío anterior sin cerrar (más de ${MINUTOS_ENVIO_TRABADO} min); no se reenvía para no duplicar`,
		);
	}
	return "ya_enviado";
}

async function cerrarEnvioRecibo(
	pagoId: number,
	estado: "enviado" | "fallido",
): Promise<void> {
	await db
		.update(recibosPagoWhatsapp)
		.set({ estado, actualizadoAt: new Date() })
		.where(eq(recibosPagoWhatsapp.pagoId, pagoId));
}

/** Deps inyectables solo para tests — en producción no se pasa nada. */
export interface ReciboPagoDeps {
	reservarEnvio?: (
		pagoId: number,
		numeroSifco: string,
	) => Promise<ReservaEnvio>;
	cerrarEnvio?: (
		pagoId: number,
		estado: "enviado" | "fallido",
	) => Promise<void>;
	cargarCaso?: (numeroSifco: string) => Promise<DatosCaso | null>;
	obtenerUsuarioSistema?: () => Promise<string | null>;
	obtenerAsesor?: ObtenerAsesor;
	enviar?: typeof sendWhatsappTemplate;
	guardarLog?: typeof persistCobrosSendLog;
}

export async function sendReciboPagoWhatsapp(
	params: SendReciboPagoWhatsappParams,
	deps: ReciboPagoDeps = {},
): Promise<SendReciboPagoWhatsappResult> {
	const {
		numeroSifco,
		reciboUrl,
		clienteNombre,
		pagoId,
		numeroCuota,
		asesorNombre,
		asesorTelefono,
	} = params;
	const cargarCaso = deps.cargarCaso ?? cargarCasoPorSifco;
	const obtenerUsuario = deps.obtenerUsuarioSistema ?? obtenerUsuarioSistema;
	const enviar = deps.enviar ?? sendWhatsappTemplate;
	const guardarLog = deps.guardarLog ?? persistCobrosSendLog;
	const obtenerAsesor = deps.obtenerAsesor ?? obtenerAsesorCartera;
	const reservarEnvio = deps.reservarEnvio ?? reservarEnvioRecibo;
	const cerrarEnvio = deps.cerrarEnvio ?? cerrarEnvioRecibo;

	const fallo = (
		codigo: ReciboPagoErrorCodigo,
	): SendReciboPagoWhatsappResult => ({
		sent: false,
		codigo,
		mensaje: MENSAJES_ERROR[codigo],
	});

	// 1. Cargar el caso por SIFCO.
	let caso: DatosCaso | null;
	try {
		caso = await cargarCaso(numeroSifco);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(
			`${LOG_PREFIX} Error cargando caso para SIFCO ${numeroSifco}: ${msg}`,
		);
		return fallo("ERROR_INTERNO");
	}
	if (!caso) {
		console.error(`${LOG_PREFIX} Caso no encontrado para SIFCO ${numeroSifco}`);
		return fallo("CASO_NO_ENCONTRADO");
	}

	// 2. Resolver teléfono.
	const testMode = isTestModeEnabled();
	const realPhone =
		primerTelefono(caso.telefonoPrincipal) ??
		primerTelefono(caso.telefonoAlternativo);

	let telefonoDestino: string;
	if (testMode) {
		telefonoDestino = getTestPhone(2);
	} else {
		if (!realPhone) {
			console.log(
				`${LOG_PREFIX} SIFCO ${numeroSifco} sin teléfono válido; se omite`,
			);
			return fallo("SIN_TELEFONO");
		}
		telefonoDestino = realPhone;
	}

	// 3. Usuario de sistema para el log (createdBy es FK NOT NULL a user.id).
	let createdBy: string | null;
	try {
		createdBy = await obtenerUsuario();
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`${LOG_PREFIX} Error buscando usuario de sistema: ${msg}`);
		return fallo("ERROR_INTERNO");
	}
	if (!createdBy) {
		console.error(
			`${LOG_PREFIX} No hay usuario cobros_supervisor para atribuir el envío`,
		);
		return fallo("SIN_USUARIO_SISTEMA");
	}
	const asesor = await resolverContactoAsesor(
		numeroSifco,
		{ nombre: asesorNombre, telefono: asesorTelefono },
		obtenerAsesor,
	);

	const mensaje = construirMensajeReciboPago(
		clienteNombre,
		{
			marca: caso.vehiculoMarca,
			modelo: caso.vehiculoModelo,
			year: caso.vehiculoYear,
			placa: caso.vehiculoPlaca,
		},
		numeroSifco,
		{ numeroCuota, asesor },
	);

	// 4. Reservar el pago (idempotencia): si cartera reintenta porque la
	//    respuesta anterior se cortó, el recibo ya enviado no sale dos veces.
	let reserva: ReservaEnvio;
	try {
		reserva = await reservarEnvio(pagoId, numeroSifco);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(
			`${LOG_PREFIX} Error reservando el envío del pago ${pagoId}: ${msg}`,
		);
		return fallo("ERROR_INTERNO");
	}
	if (reserva === "ya_enviado") {
		console.log(
			`${LOG_PREFIX} Recibo del pago ${pagoId} ya enviado; no se repite`,
		);
		return { sent: true, telefono: telefonoDestino, yaEnviado: true };
	}
	if (reserva === "en_curso") return fallo("EN_CURSO");

	// 5. Enviar por WhatsApp.
	const result = await enviar({
		phone: telefonoDestino,
		message: mensaje,
		templateName: TEMPLATE_NAME,
		bodyParams: [mensaje],
		header: {
			type: "document",
			url: reciboUrl,
			filename: `Recibo-Pago-${pagoId}.pdf`,
		},
		logPrefix: testMode ? `${LOG_PREFIX}[TEST]` : LOG_PREFIX,
	});

	try {
		await cerrarEnvio(pagoId, result.success ? "enviado" : "fallido");
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(
			`${LOG_PREFIX} No se pudo cerrar el envío del pago ${pagoId}: ${msg}`,
		);
	}

	// 6. Log de traza en cobros_send_logs.
	await guardarLog({
		numeroCreditoSifco: numeroSifco,
		plantillaId: "recibo_pago",
		telefono: telefonoDestino,
		mensaje,
		providerRequest: result.providerRequest ?? null,
		createdBy,
		result: result.success
			? {
					success: true,
					providerResponse: {
						...(result.providerResponse ?? {}),
						templateMessageId: result.templateMessageId,
						reciboUrl,
						pagoId,
						testMode,
						realTarget: testMode ? (realPhone ?? undefined) : undefined,
					},
				}
			: {
					success: false,
					errorMessage: result.error,
					providerResponse: {
						...(result.providerResponse ?? {}),
						reciboUrl,
						pagoId,
						testMode,
						realTarget: testMode ? (realPhone ?? undefined) : undefined,
					},
				},
	});

	if (!result.success) {
		console.error(
			`${LOG_PREFIX} Falló envío para pago ${pagoId}: ${result.error}`,
		);
		return fallo("ERROR_ENVIO");
	}

	console.log(`${LOG_PREFIX} ✓ Recibo de pago enviado para pago ${pagoId}`);
	return {
		sent: true,
		templateMessageId: result.templateMessageId,
		telefono: telefonoDestino,
	};
}
