import type { WialonFallaClasificacion } from "./wialon-types";
import { WialonClientError } from "./wialon-types";

/**
 * Clasifica una falla de Wialon en severidad (para alertas y para decidir
 * qué tanto detalle ve un rol no autorizado) y si tiene sentido reintentarla.
 *
 * Referencia de códigos: https://sdk.wialon.com/wiki/en/sidebar/remoteapi/apiref/errors
 * (ver WIALON_ERROR_MESSAGES en wialon-types.ts).
 */
export function clasificarFallaWialon(
	error: unknown,
	svc?: string,
): WialonFallaClasificacion {
	if (!(error instanceof WialonClientError)) {
		return { severidad: "critical", reintentable: false };
	}

	switch (error.code) {
		case "WIALON_AUTH_REQUIRED":
			// Token no configurado: no hay nada que reintentar, requiere que
			// alguien arregle la configuración del servidor.
			return { severidad: "critical", reintentable: false };

		case "WIALON_INVALID_SESSION":
			// Error 1 de Wialon: ya tiene su propio flujo de re-login + 1
			// reintento en executeWithSession. Se registra como transitorio.
			return { severidad: "warning", reintentable: false };

		case "WIALON_TIMEOUT":
		case "WIALON_NETWORK_ERROR":
			// Timeout, DNS, conexión rechazada, o un 5xx de gateway: probable
			// falla transitoria de red o del proveedor.
			if (
				error.code === "WIALON_NETWORK_ERROR" &&
				error.status !== undefined &&
				error.status < 500
			) {
				// 4xx no es un problema transitorio de red, es una solicitud mal
				// formada o rechazada: no tiene sentido reintentar igual.
				return { severidad: "critical", reintentable: false };
			}
			return { severidad: "warning", reintentable: true };

		case "WIALON_INVALID_RESPONSE":
			// Wialon respondió pero no en el formato esperado: no es un problema
			// de red que un reintento vaya a resolver, y puede indicar un
			// cambio de contrato del proveedor que alguien debe revisar.
			return { severidad: "critical", reintentable: false };

		case "WIALON_RESULTADO_INCIERTO":
			// Ya es el resultado final de una escritura que no se pudo
			// confirmar: no se vuelve a reintentar sola.
			return { severidad: "warning", reintentable: false };

		case "WIALON_NO_DISPONIBLE":
			// Circuito abierto: no se llamó a Wialon en este intento.
			return { severidad: "warning", reintentable: false };

		case "WIALON_API_ERROR": {
			const codigo = error.wialonErrorCode;
			if (codigo === 7 && svc === "core/search_item") {
				// En la consulta de UNA unidad, Wialon responde 7 cuando la unidad
				// fue borrada o ya no es visible para la cuenta: es un resultado
				// esperado (nombreActualUnidad lo usa para liberar el vínculo),
				// no una falla de credenciales.
				return { severidad: "warning", reintentable: false };
			}
			if (codigo === 7 || codigo === 8 || codigo === 14) {
				// Acceso denegado, credenciales inválidas, facturación: requieren
				// intervención humana, reintentar no cambia nada.
				return { severidad: "critical", reintentable: false };
			}
			if (codigo === 5 || codigo === 11) {
				// Error de servidor / BD no disponible en Wialon: transitorio.
				return { severidad: "warning", reintentable: true };
			}
			if (codigo === 9 || codigo === 10) {
				// Cuota o tamaño de paquete excedido: reintentar de inmediato
				// solo empeora el problema.
				return { severidad: "warning", reintentable: false };
			}
			// 2 (servicio inválido), 4 (parámetros inválidos), 6 (parámetros
			// desconocidos) y cualquier código no listado: error de programación
			// o de contrato, no de red.
			return { severidad: "critical", reintentable: false };
		}

		default:
			return { severidad: "critical", reintentable: false };
	}
}

/**
 * svc de Wialon que son lecturas puras: seguros de reintentar automáticamente
 * porque no cambian estado en el proveedor. Cualquier svc que no esté acá se
 * trata como escritura y NUNCA se reintenta (CB-121: no ejecutar acciones
 * ambiguas automáticamente ante una falla incierta).
 */
// Lista cerrada a los svc que el cliente REALMENTE usa hoy (ver wialon-client.ts):
// token/login, core/search_items, core/search_item, unit/calc_last y
// messages/load_interval son lecturas puras. token/update (crear/borrar link
// de Locator) es la única escritura y a propósito NO está acá.
// messages/unload (liberar la capa que carga load_interval del lado
// servidor) tampoco está: getHistorialPosiciones ya la llama best-effort
// (catch propio, nunca tumba el resultado ya obtenido), así que no necesita
// el reintento automático de este mecanismo.
export const WIALON_SVC_IDEMPOTENTES: ReadonlySet<string> = new Set([
	"token/login",
	"core/search_items",
	"core/search_item",
	"unit/calc_last",
	"messages/load_interval",
]);

export function esOperacionIdempotente(svc: string): boolean {
	return WIALON_SVC_IDEMPOTENTES.has(svc);
}

// "reintentado" se usa tanto para el éxito tras reintento (sin errorCode)
// como para un fallo que todavía tiene reintentos pendientes (con errorCode).
// La sesión vencida no cuenta como fallo: es la renovación esperada del sid
// (re-login + repetir la operación) y el intento siguiente decide el resultado.
export function esIntentoExitoso(fila: {
	resultado: string;
	errorCode: string | null;
}): boolean {
	return (
		fila.resultado === "ok" ||
		(fila.resultado === "reintentado" &&
			(fila.errorCode === null || fila.errorCode === "WIALON_INVALID_SESSION"))
	);
}

// "h": hash de un link público de Locator; con él cualquiera ve el rastreo en vivo.
const CAMPOS_SENSIBLES = new Set([
	"token",
	"sid",
	"eid",
	"password",
	"pass",
	"h",
]);

/**
 * Sanitiza un payload de request/response de Wialon antes de persistirlo en
 * la bitácora técnica: nunca debe guardarse el token, el sid/eid de sesión ni
 * campos de contraseña, y el resultado se trunca para no inflar la tabla con
 * respuestas grandes (listas de unidades, mensajes de telemetría).
 */
export function sanitizarPayloadWialon(
	valor: unknown,
	maxLength = 2000,
): unknown {
	const sanitizado = sanitizarProfundo(valor, 0);
	const serializado = JSON.stringify(sanitizado);
	if (serializado.length <= maxLength) {
		return sanitizado;
	}
	return { _truncado: true, preview: serializado.slice(0, maxLength) };
}

function sanitizarProfundo(valor: unknown, profundidad: number): unknown {
	if (profundidad > 6) return "[profundidad_excedida]";
	if (Array.isArray(valor)) {
		return valor.slice(0, 50).map((v) => sanitizarProfundo(v, profundidad + 1));
	}
	if (valor && typeof valor === "object") {
		const resultado: Record<string, unknown> = {};
		for (const [clave, val] of Object.entries(valor)) {
			if (CAMPOS_SENSIBLES.has(clave.toLowerCase())) {
				resultado[clave] = "[redactado]";
				continue;
			}
			resultado[clave] = sanitizarProfundo(val, profundidad + 1);
		}
		return resultado;
	}
	return valor;
}
