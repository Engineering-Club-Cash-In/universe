/**
 * Utilidades de teléfono compartidas por los envíos automáticos de WhatsApp.
 */

/**
 * Un campo de teléfono (p. ej. `leads.phone`) puede traer varios números
 * separados por coma y/o "/" (ej. "30295849 / 34831060, 66372557"). Devuelve
 * SOLO el primero válido (saltando los que no tienen 8 dígitos); sin esto `normalizePhone` (simpletech) concatenaría
 * los dígitos de todos en un número inválido. La normalización a +502 la hace
 * `sendWhatsappTemplate`.
 */
export function primerTelefono(raw: string | null | undefined): string | null {
	if (!raw) return null;
	// El primero que tenga el mínimo de dígitos (8 = GT local): un campo como
	// "Sin teléfono / 30295849" o "123 / 30295849" sí tiene a quién escribirle.
	for (const parte of raw.split(/[/,]/)) {
		const candidato = parte.trim();
		if (candidato.replace(/\D/g, "").length >= 8) return candidato;
	}
	return null;
}
