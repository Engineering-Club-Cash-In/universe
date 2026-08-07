/**
 * Utilidades de teléfono compartidas por los envíos automáticos de WhatsApp.
 */

/**
 * Un campo de teléfono (p. ej. `leads.phone`) puede traer varios números
 * separados por coma y/o "/" (ej. "30295849 / 34831060, 66372557"). Devuelve
 * SOLO el primero válido; sin esto `normalizePhone` (simpletech) concatenaría
 * los dígitos de todos en un número inválido. La normalización a +502 la hace
 * `sendWhatsappTemplate`.
 */
export function primerTelefono(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const primero = raw.split(/[/,]/)[0]?.trim();
	if (!primero) return null;
	// Debe tener un mínimo de dígitos para considerarse válido (8 = GT local).
	const digits = primero.replace(/\D/g, "");
	return digits.length >= 8 ? primero : null;
}
