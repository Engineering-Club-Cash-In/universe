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

// Los teléfonos viven en ./telefonos (sin dependencias, porque también los usa
// la web). Se re-exportan acá para que el bot siga importando todo de un lugar.
export * from "./telefonos";
