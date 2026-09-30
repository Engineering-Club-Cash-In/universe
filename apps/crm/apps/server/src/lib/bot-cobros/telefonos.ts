/**
 * Normalización de teléfonos guatemaltecos.
 *
 * Archivo aparte de `identificadores.ts` —que lo re-exporta— por una razón de
 * build: `lib/referencias-cobros.ts` usa `normalizarTelefono` y ese módulo
 * entra al bundle de la WEB. El Dockerfile de la web solo copia
 * `server/src/lib` y `server/src/db/schema`, y `identificadores.ts` importa
 * `utils/cui-validation` (la validación de DPI), que queda afuera: el build
 * de la web se rompía con "Could not resolve ../../utils/cui-validation".
 * Acá no se importa nada, así que sirve en los dos lados.
 *
 * Ver docs/features/bot-whatsapp-cobros/01-identificacion-y-acceso.md
 */

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
