/**
 * Workspace · panel de gestión: datos de contacto «de relleno».
 *
 * Algunos créditos migrados traen teléfonos como «00000000» o correos como
 * «sin-email@example.com». No son destinos reales: el Workspace los muestra
 * con «Dato no válido», deshabilitados, y no se los pasa a los formularios
 * para que nada se envíe a un destino falso.
 *
 * Funciones puras.
 */

/** El teléfono no sirve como destino (ceros, un solo dígito repetido, corto). */
export function telefonoDeRelleno(
	telefono: string | null | undefined,
): boolean {
	const digitos = (telefono ?? "").replace(/\D/g, "");
	if (digitos.length < 8) return true;
	// Sin el código de país (502…), los 8 dígitos guatemaltecos.
	const local = digitos.slice(-8);
	return /^(\d)\1+$/.test(local);
}

/** El correo no sirve como destino (mal formado o de ejemplo). */
export function correoDeRelleno(correo: string | null | undefined): boolean {
	const c = (correo ?? "").trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return true;
	const [usuario, dominio] = c.split("@");
	if (/^(example|ejemplo|test|prueba)\.[a-z.]+$/.test(dominio)) return true;
	return /^(sin|no)[-_.]?(e-?mail|correo|tiene)/.test(usuario);
}

/** Solo los teléfonos válidos de una lista separada por comas («a, b»). */
export function telefonosValidos(lista: string | null | undefined): string {
	return (lista ?? "")
		.split(",")
		.map((t) => t.trim())
		.filter((t) => t && !telefonoDeRelleno(t))
		.join(", ");
}
