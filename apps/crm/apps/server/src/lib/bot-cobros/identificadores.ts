/**
 * Normalización de los datos que manda el bot de cobros.
 *
 * El cliente escribe en WhatsApp y el CRM tiene 15 años de datos cargados a
 * mano, así que ninguno de los dos lados viene limpio. Todo lo que se compara
 * acá se normaliza en AMBOS extremos: lo que escribe el cliente y lo que está
 * guardado.
 *
 * Ver docs/features/bot-whatsapp-cobros/01-identificacion-y-acceso.md
 */

import { normalizarDpi, validarDpi } from "../../utils/cui-validation";

export type TipoBusqueda = "dpi" | "nit" | "placa";

export type ResultadoDeteccion =
	| { tipo: TipoBusqueda; valor: string }
	| { tipo: null; motivo: string };

/**
 * Deja solo letras y dígitos, en mayúsculas.
 *
 * Las placas llegan como `P-185KKW`, `P185KKW`, `p 185 kkw` o `185KKW`, y en la
 * base están igual de dispersas: de 1,369 vehículos con placa, 1,155 tienen
 * guion, 98 tienen espacios, 8 están en minúsculas y 19 ni siquiera empiezan
 * con letra.
 */
export function normalizarPlaca(valor: string): string {
	return valor.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/**
 * Deduce si el `search` es un DPI, un NIT o una placa.
 *
 * Regla acordada con Cobros (D-09): la placa tiene letras, el NIT no.
 *   1. 13 dígitos            → DPI
 *   2. Tiene alguna letra    → placa
 *   3. Solo dígitos          → NIT
 *
 * El NIT guatemalteco puede llevar `K` como dígito verificador (`1234567-K`);
 * ese caso se atrapa antes de la regla de la placa para que no caiga del lado
 * equivocado.
 */
export function detectarTipoBusqueda(search: string): ResultadoDeteccion {
	const limpio = normalizarPlaca(search);

	if (limpio.length === 0) {
		return { tipo: null, motivo: "El dato viene vacío" };
	}

	// 1. DPI: 13 dígitos. Se valida el CUI para no salir a buscar un número que
	// de entrada no puede ser un DPI.
	if (/^\d{13}$/.test(limpio)) {
		const resultado = validarDpi(limpio);
		if (!resultado.valid) {
			return { tipo: null, motivo: resultado.error };
		}
		return { tipo: "dpi", valor: normalizarDpi(limpio) };
	}

	// 2. NIT con dígito verificador K (7 a 12 dígitos + K).
	if (/^\d{6,12}K$/.test(limpio)) {
		return { tipo: "nit", valor: limpio };
	}

	// 3. Con letras es una placa, siempre que tenga forma de placa: en Guatemala
	// son 6 caracteres (`185KKW`) más la letra de tipo (`P185KKW`), y siempre
	// llevan dígitos. Sin este filtro, cualquier palabra suelta que escriba el
	// cliente ("hola") saldría a buscarse como placa.
	if (/[A-Z]/.test(limpio)) {
		if (!/\d/.test(limpio) || limpio.length < 5 || limpio.length > 9) {
			return { tipo: null, motivo: "No se reconoce como DPI, NIT ni placa" };
		}
		return { tipo: "placa", valor: limpio };
	}

	// 4. Solo dígitos y no son 13 → NIT.
	if (/^\d+$/.test(limpio)) {
		return { tipo: "nit", valor: limpio };
	}

	return { tipo: null, motivo: "No se reconoce como DPI, NIT ni placa" };
}

/**
 * Normaliza un teléfono a los 8 dígitos guatemaltecos, o `null` si no lo es.
 *
 * En la base conviven `50258446376` y `58446376`, y también basura: 3 registros
 * de 16 dígitos que parecen números de tarjeta, un `0` y un fijo viejo de 7
 * dígitos. Todo lo que no quede en 8 dígitos se descarta.
 */
export function normalizarTelefono(valor: string): string | null {
	const digitos = valor.replace(/\D/g, "");

	if (digitos.length === 8) return digitos;
	if (digitos.length === 11 && digitos.startsWith("502")) {
		return digitos.slice(3);
	}

	return null;
}

/**
 * ¿Es un móvil? En Guatemala los móviles empiezan en 3, 4 o 5; el 2, 6 y 7 son
 * fijos y un SMS ahí no llega nunca.
 */
export function esMovil(telefono8: string): boolean {
	return /^[345]/.test(telefono8);
}

/**
 * Saca todos los teléfonos utilizables de un campo del CRM.
 *
 * 570 de los 1,760 clientes con crédito tienen varios números metidos en el
 * mismo campo, separados por coma o por barra ("58446376, 22215273").
 */
export function extraerTelefonos(campo: string | null | undefined): string[] {
	if (!campo) return [];

	const partes = campo.split(/[,/]/);
	const telefonos: string[] = [];

	for (const parte of partes) {
		const normalizado = normalizarTelefono(parte);
		if (normalizado && !telefonos.includes(normalizado)) {
			telefonos.push(normalizado);
		}
	}

	return telefonos;
}

/**
 * Elige a qué número mandarle el código: el PRIMER MÓVIL, no el primero de la
 * lista (D-19).
 *
 * Hay clientes cuyo primer teléfono es un fijo; mandarles el SMS ahí los deja
 * esperando un código que nunca va a llegar.
 */
export function elegirTelefonoParaOtp(
	...campos: (string | null | undefined)[]
): string | null {
	const telefonos = campos.flatMap((campo) => extraerTelefonos(campo));
	return telefonos.find(esMovil) ?? null;
}

/** Formato que espera el proveedor de SMS: `502XXXXXXXX`. */
export function aFormatoSms(telefono8: string): string {
	return `502${telefono8}`;
}

/** `58446376` → `****6376`. Lo único del teléfono que sale del CRM. */
export function enmascararTelefono(telefono8: string): string {
	return `****${telefono8.slice(-4)}`;
}

/**
 * ¿El número desde el que escribe es uno de los que tenemos registrados?
 *
 * Solo informativo: el OTP se manda igual (D-03).
 */
export function telefonoEstaRegistrado(
	telefonoChat: string,
	...campos: (string | null | undefined)[]
): boolean {
	const normalizado = normalizarTelefono(telefonoChat);
	if (!normalizado) return false;

	return campos
		.flatMap((campo) => extraerTelefonos(campo))
		.includes(normalizado);
}
