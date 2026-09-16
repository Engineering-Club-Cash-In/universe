/**
 * Servicio 10 · ¿De quién son los créditos del cliente que pidió un agente?
 *
 * El bot manda `referencia` **o** `telefono` (al menos uno) y `numeroSifco`
 * opcional:
 *
 *   1. Si la referencia es válida (OTP canjeado, dentro de la ventana), manda
 *      ella: es identidad verificada.
 *   2. Si no vino, o no sirve, y hay teléfono, se busca por el número desde el
 *      que escribe. Es el caso del cliente que dice "hola" y pide un humano sin
 *      haberse identificado nunca — el que el primer diseño dejaba sin aviso.
 *   3. Con `numeroSifco` se avisa solo por ese crédito, y tiene que ser de esa
 *      persona; sin él, por todos los suyos.
 *
 * Lo del teléfono no es un control de acceso, y no hace falta que lo sea: este
 * servicio no le devuelve al bot ningún dato del crédito, solo decide a qué
 * asesores avisar. El número lo pone WhatsApp, no el cliente.
 */

import type { OrigenModoAgente } from "../../services/aviso-bot-modo-agente";
import type { IdentidadBot } from "./historial";
import { normalizarTelefono } from "./identificadores";
import type { ResultadoSesion } from "./menu-credito";

/**
 * Cuánto vale la referencia para ESTE servicio: 24 horas, no los 30 minutos
 * del menú. El modo agente llega justo cuando el bot ya no pudo resolver,
 * muchas veces al final de una conversación larga; con 30 minutos, el aviso
 * que más importa sería el que más se pierde.
 */
export const VIGENCIA_MODO_AGENTE_MINUTOS = 24 * 60;

export type ResolucionModoAgente =
	| {
			estado: "identificado";
			origen: OrigenModoAgente;
			creditos: string[];
			/** Para colgar la interacción de su ficha; null si no hay una sola persona. */
			identidad: IdentidadBot | null;
	  }
	/** Nadie con crédito tiene ese número (o esa persona no tiene créditos). */
	| { estado: "no_identificado" }
	| {
			estado: "error";
			codigo:
				| "PARAMETROS_INVALIDOS"
				| "REFERENCIA_INVALIDA"
				| "SESION_VENCIDA"
				| "CREDITO_NO_ES_DEL_CLIENTE";
	  };

export type DependenciasResolucion = {
	verificarSesion: (
		referencia: string,
		vigenciaMinutos: number,
	) => Promise<ResultadoSesion>;
	buscarPorTelefono: (
		telefono8: string,
	) => Promise<{ creditos: string[]; identidad: IdentidadBot | null }>;
};

export async function resolverClienteModoAgente(
	entrada: { referencia: string; telefono: string; numeroSifco: string },
	deps: DependenciasResolucion,
): Promise<ResolucionModoAgente> {
	const { referencia, telefono, numeroSifco } = entrada;
	const telefono8 = telefono ? normalizarTelefono(telefono) : null;

	if (!referencia && !telefono8) {
		return { estado: "error", codigo: "PARAMETROS_INVALIDOS" };
	}

	let origen: OrigenModoAgente;
	let creditos: string[];
	let identidad: IdentidadBot | null;

	const sesion = referencia
		? await deps.verificarSesion(referencia, VIGENCIA_MODO_AGENTE_MINUTOS)
		: null;

	if (sesion?.ok) {
		origen = { tipo: "referencia", sesionId: sesion.otp.id };
		creditos = sesion.creditos.map((c) => c.numeroSifco);
		identidad = {
			leadId: sesion.otp.leadId,
			coDebtorId: sesion.otp.coDebtorId,
			dpi: sesion.otp.dpi,
		};
	} else if (telefono8) {
		// Referencia ausente, inválida o vencida: el teléfono todavía dice quién
		// es. Un cliente que tardó más de un día en pedir agente sigue esperando.
		const porTelefono = await deps.buscarPorTelefono(telefono8);
		origen = { tipo: "telefono", telefono8 };
		creditos = porTelefono.creditos;
		identidad = porTelefono.identidad;
	} else {
		// Solo referencia, y no sirve: el error de siempre (401).
		return {
			estado: "error",
			codigo: sesion && !sesion.ok ? sesion.codigo : "REFERENCIA_INVALIDA",
		};
	}

	if (creditos.length === 0) return { estado: "no_identificado" };

	if (numeroSifco) {
		// El crédito que nombra el bot tiene que ser de esta persona: sin esto, la
		// API key sola alcanzaría para alertar al asesor de cualquier crédito.
		if (!creditos.includes(numeroSifco)) {
			return { estado: "error", codigo: "CREDITO_NO_ES_DEL_CLIENTE" };
		}
		creditos = [numeroSifco];
	}

	return { estado: "identificado", origen, creditos, identidad };
}
