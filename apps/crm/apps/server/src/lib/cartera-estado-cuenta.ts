import type { WhatsappSendResult } from "./simpletech";

/**
 * Lógica pura del envío del estado de cuenta de cancelación que pide Cartera.
 *
 * Cartera no guarda teléfonos de clientes: los tiene el CRM. El orden de las
 * fuentes es el mismo que usa Cobros para escribirle a un cliente: primero el
 * caso de cobros (principal, luego alternativo), después el lead y al final la
 * solicitud de crédito.
 */

export type FuenteTelefono = "CASO_COBROS" | "LEAD" | "SOLICITUD";

export interface TelefonoCandidato {
	valor: string | null | undefined;
	fuente: FuenteTelefono;
}

export interface ContactoEstadoCuenta {
	/** Normalizado, listo para WhatsApp: `+502XXXXXXXX`. */
	telefono: string;
	fuente: FuenteTelefono;
	/** El primero de la lista: el que se sugiere al asesor. */
	sugerido: boolean;
}

/** Desde cuántos registros distintos un número se considera de relleno. */
export const UMBRAL_TELEFONO_COMPARTIDO = 5;

/**
 * Los 8 dígitos de un celular de Guatemala, o `null` si no lo es.
 *
 * Un registro puede traer varios teléfonos separados por coma o "/": se usa
 * solo el primero (igual que `normalizePhone`). WhatsApp solo vive en
 * celulares, así que los fijos (2, 6, 7…) quedan fuera, igual que los rellenos
 * del tipo `00000000` o `12345678`.
 */
export function celularGuatemala(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const primero = (raw.split(/[,/]/)[0] ?? "").trim();
	let digitos = primero.replaceAll(/\D/g, "");
	if (digitos.length === 11 && digitos.startsWith("502")) {
		digitos = digitos.slice(3);
	}
	if (digitos.length !== 8) return null;
	if (/^(\d)\1{7}$/.test(digitos)) return null;
	if (digitos === "12345678" || digitos === "87654321") return null;
	if (!"345".includes(digitos[0])) return null;
	return digitos;
}

/**
 * Ordena, filtra y deduplica los teléfonos. `compartidos` son los números que
 * aparecen en muchos registros distintos (oficina, asesor, relleno): no son
 * del cliente.
 */
export function ordenarContactos(
	candidatos: TelefonoCandidato[],
	compartidos: ReadonlySet<string> = new Set(),
): ContactoEstadoCuenta[] {
	const vistos = new Set<string>();
	const contactos: ContactoEstadoCuenta[] = [];
	for (const c of candidatos) {
		const digitos = celularGuatemala(c.valor);
		if (!digitos || compartidos.has(digitos) || vistos.has(digitos)) continue;
		vistos.add(digitos);
		contactos.push({
			telefono: `+502${digitos}`,
			fuente: c.fuente,
			sugerido: contactos.length === 0,
		});
	}
	return contactos;
}

/**
 * A quién va el mensaje con `TEST_MESSAGE=true`: al número elegido si YA es uno
 * de los números de prueba (así quien prueba lo recibe en su propio teléfono);
 * si no, al número de prueba por defecto. En modo prueba nunca sale a un número
 * que no esté en la lista. Solo aplica a este envío; Cobros y Contratos siguen
 * desviando siempre al número por defecto.
 */
export function destinoModoPrueba(
	digitosElegido: string,
	telefonosPrueba: readonly string[],
	porDefecto: string,
): string {
	return telefonosPrueba.includes(digitosElegido) ? digitosElegido : porDefecto;
}

/**
 * Lo que se sabe de un envío:
 *  - ENVIADO: el proveedor lo aceptó.
 *  - NO_ENVIADO: el proveedor lo rechazó o nunca se llegó a llamar. Se puede reintentar.
 *  - INCIERTO: timeout, caída o respuesta ilegible después de llamar. Pudo salir:
 *    no se reenvía sin revisar.
 */
export type ResultadoEnvioWhatsapp =
	| { resultado: "ENVIADO"; mensajeId: string | null }
	| { resultado: "NO_ENVIADO" | "INCIERTO"; error: string };

export function clasificarEnvioWhatsapp(
	envio: WhatsappSendResult,
): ResultadoEnvioWhatsapp {
	if (envio.success) {
		return { resultado: "ENVIADO", mensajeId: envio.templateMessageId ?? null };
	}
	const error = (envio.error ?? "Error desconocido").slice(0, 500);
	const respuesta = envio.providerResponse ?? {};
	// Sin excepción: el proveedor contestó con error o el servicio no está
	// configurado. El mensaje no salió.
	if (!("exception" in respuesta)) return { resultado: "NO_ENVIADO", error };

	if (respuesta.errorName === "ConnectionError") {
		const status = Number(respuesta.statusCode);
		// Un 4xx es un rechazo explícito; sin status (timeout, red, JSON roto) o
		// con 5xx no se sabe si el mensaje salió.
		const rechazo = Number.isFinite(status) && status >= 400 && status < 500;
		return { resultado: rechazo ? "NO_ENVIADO" : "INCIERTO", error };
	}
	// El proveedor contestó `status: error` o falló la validación local.
	if (respuesta.errorName === "SimpleTechError" || respuesta.errorName === "ValidationError") {
		return { resultado: "NO_ENVIADO", error };
	}
	// Cualquier otra excepción pudo ocurrir después de llamar al proveedor.
	return { resultado: "INCIERTO", error };
}
