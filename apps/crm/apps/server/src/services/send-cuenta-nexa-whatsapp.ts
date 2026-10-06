/**
 * Mensaje aparte con la cuenta Nexa del cliente.
 *
 * Normalmente la cuenta Nexa llega en la bienvenida (`bienvenida-credito.ts`).
 * Si cartera no la pudo crear a tiempo (nexa-server caído, Nexa rechazó), la
 * reintenta en su barrido y, cuando la tiene, llama al CRM
 * (`POST /api/notifications/cuenta-nexa-whatsapp`) para que se la mande al
 * cliente en un solo mensaje. Cartera marca el aviso como hecho con la
 * respuesta, así que no se repite.
 *
 * Nunca lanza: cualquier fallo vuelve como resultado tipado.
 */

import { and, desc, eq, inArray, like } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { cobrosSendLogs } from "../db/schema/cobros-send-logs";
import { leads, opportunities } from "../db/schema/crm";
import { persistCobrosSendLog } from "../lib/cobros-send-log";
import { getTestPhone, isTestModeEnabled } from "../lib/messaging-test-mode";
import { primerTelefono } from "../lib/phone-utils";
import { ROLES } from "../lib/roles";
import { sendWhatsappTemplate } from "../lib/simpletech";
import {
	construirCierreAsesor,
	type ObtenerAsesor,
	obtenerAsesorCartera,
	resolverContactoAsesor,
} from "./asesor-whatsapp";

const LOG_PREFIX = "[CuentaNexaWhatsapp]";
const PLANTILLA_ID = "cuenta_nexa";

export interface SendCuentaNexaWhatsappParams {
	numeroSifco: string;
	token: string;
	clienteNombre?: string | null;
	asesorNombre?: string | null;
	asesorTelefono?: string | null;
}

export type SendCuentaNexaWhatsappResult =
	| {
			sent: true;
			templateMessageId?: string;
			telefono?: string;
			/** true si el código ya se le había mandado y no se repitió. */
			yaEnviado?: boolean;
	  }
	| {
			sent: false;
			codigo:
				| "CLIENTE_NO_ENCONTRADO"
				| "SIN_TELEFONO"
				| "SIN_USUARIO_SISTEMA"
				| "ERROR_ENVIO"
				| "ERROR_INTERNO";
			mensaje: string;
	  };

/** Teléfono y nombre del cliente por SIFCO (oportunidad ganada o migrada). */
async function clientePorSifco(
	numeroSifco: string,
): Promise<{ telefono: string | null; nombre: string } | null> {
	const [row] = await db
		.select({
			phone: leads.phone,
			firstName: leads.firstName,
			lastName: leads.lastName,
		})
		.from(opportunities)
		.innerJoin(leads, eq(leads.id, opportunities.leadId))
		.where(
			and(
				eq(opportunities.numeroSifco, numeroSifco),
				inArray(opportunities.status, ["won", "migrate"]),
			),
		)
		.orderBy(desc(opportunities.updatedAt))
		.limit(1);
	if (!row) return null;
	return {
		telefono: row.phone,
		nombre: [row.firstName, row.lastName].filter(Boolean).join(" "),
	};
}

/**
 * ¿El cliente ya recibió este código? Lo que salió por WhatsApp queda en
 * `cobros_send_logs`: la bienvenida con la línea de Nexa o un aviso aparte
 * anterior. Si la bienvenida salió pero no se alcanzó a avisar a cartera,
 * esto evita mandarle el código dos veces.
 */
async function codigoYaEnviadoEnCrm(
	numeroSifco: string,
	token: string,
): Promise<boolean> {
	const [fila] = await db
		.select({ id: cobrosSendLogs.id })
		.from(cobrosSendLogs)
		.where(
			and(
				eq(cobrosSendLogs.numeroCreditoSifco, numeroSifco),
				eq(cobrosSendLogs.status, "sent"),
				inArray(cobrosSendLogs.plantillaId, ["bienvenida", PLANTILLA_ID]),
				like(cobrosSendLogs.mensaje, `%${token}%`),
			),
		)
		.limit(1);
	return Boolean(fila);
}

async function usuarioSistema(): Promise<string | null> {
	const [supervisor] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.role, ROLES.COBROS_SUPERVISOR))
		.limit(1);
	return supervisor?.id ?? null;
}

/** 3 bloques → template `mensaje3parametro`. Registro formal. */
export function construirMensajeCuentaNexa(
	clienteNombre: string,
	token: string,
	cierreAsesor: string,
): string {
	const saludo = clienteNombre
		? `Estimado(a) ${clienteNombre}:`
		: "Estimado(a) cliente:";
	return `${saludo}

Le compartimos su código de pago Nexa: *${token}*. Con este código puede pagar su cuota mensual desde su banco.

${cierreAsesor} Atentamente, Club Cash-In.`;
}

/** Deps inyectables solo para tests — en producción no se pasa nada. */
export interface CuentaNexaWhatsappDeps {
	codigoYaEnviado?: (numeroSifco: string, token: string) => Promise<boolean>;
	buscarCliente?: typeof clientePorSifco;
	obtenerUsuarioSistema?: () => Promise<string | null>;
	obtenerAsesor?: ObtenerAsesor;
	enviar?: typeof sendWhatsappTemplate;
	guardarLog?: typeof persistCobrosSendLog;
}

export async function sendCuentaNexaWhatsapp(
	params: SendCuentaNexaWhatsappParams,
	deps: CuentaNexaWhatsappDeps = {},
): Promise<SendCuentaNexaWhatsappResult> {
	const buscarCliente = deps.buscarCliente ?? clientePorSifco;
	const obtenerUsuario = deps.obtenerUsuarioSistema ?? usuarioSistema;
	const enviar = deps.enviar ?? sendWhatsappTemplate;
	const guardarLog = deps.guardarLog ?? persistCobrosSendLog;
	const obtenerAsesor = deps.obtenerAsesor ?? obtenerAsesorCartera;
	const codigoYaEnviado = deps.codigoYaEnviado ?? codigoYaEnviadoEnCrm;

	try {
		if (await codigoYaEnviado(params.numeroSifco, params.token)) {
			console.log(
				`${LOG_PREFIX} El código Nexa de ${params.numeroSifco} ya se había enviado; no se repite`,
			);
			return { sent: true, yaEnviado: true };
		}

		const cliente = await buscarCliente(params.numeroSifco);
		if (!cliente) {
			return {
				sent: false,
				codigo: "CLIENTE_NO_ENCONTRADO",
				mensaje: "No se encontró una oportunidad ganada con ese número SIFCO.",
			};
		}

		const testMode = isTestModeEnabled();
		const realPhone = primerTelefono(cliente.telefono);
		if (!testMode && !realPhone) {
			return {
				sent: false,
				codigo: "SIN_TELEFONO",
				mensaje: "El cliente no tiene un número de teléfono válido registrado.",
			};
		}
		const telefonoDestino = testMode ? getTestPhone(2) : (realPhone as string);

		const createdBy = await obtenerUsuario();
		if (!createdBy) {
			return {
				sent: false,
				codigo: "SIN_USUARIO_SISTEMA",
				mensaje:
					"No se encontró un usuario cobros_supervisor para registrar el envío.",
			};
		}

		const asesor = await resolverContactoAsesor(
			params.numeroSifco,
			{ nombre: params.asesorNombre, telefono: params.asesorTelefono },
			obtenerAsesor,
		);
		const mensaje = construirMensajeCuentaNexa(
			params.clienteNombre?.trim() || cliente.nombre,
			params.token,
			construirCierreAsesor(asesor),
		);

		const result = await enviar({
			phone: telefonoDestino,
			message: mensaje,
			logPrefix: testMode ? `${LOG_PREFIX}[TEST]` : LOG_PREFIX,
		});

		await guardarLog({
			numeroCreditoSifco: params.numeroSifco,
			plantillaId: PLANTILLA_ID,
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
							testMode,
							realTarget: testMode ? (realPhone ?? undefined) : undefined,
						},
					}
				: {
						success: false,
						errorMessage: result.error,
						providerResponse: {
							...(result.providerResponse ?? {}),
							testMode,
							realTarget: testMode ? (realPhone ?? undefined) : undefined,
						},
					},
		});

		if (!result.success) {
			console.error(
				`${LOG_PREFIX} Falló envío para ${params.numeroSifco}: ${result.error}`,
			);
			return {
				sent: false,
				codigo: "ERROR_ENVIO",
				mensaje: "No se pudo enviar el mensaje de WhatsApp.",
			};
		}

		console.log(
			`${LOG_PREFIX} ✓ Cuenta Nexa enviada para ${params.numeroSifco}`,
		);
		return {
			sent: true,
			templateMessageId: result.templateMessageId,
			telefono: telefonoDestino,
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(
			`${LOG_PREFIX} Error no controlado para ${params.numeroSifco}: ${msg}`,
		);
		return {
			sent: false,
			codigo: "ERROR_INTERNO",
			mensaje: "No se pudo preparar el envío. Intente de nuevo.",
		};
	}
}
