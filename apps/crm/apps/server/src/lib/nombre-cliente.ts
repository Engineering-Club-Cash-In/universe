/**
 * Nombre completo del titular de un crédito, armado con las partes de `leads`.
 * Sin base de datos, para probarla aislada (la consulta vive en
 * services/nombre-cliente-sifco.ts).
 */
export function armarNombreCliente(partes: {
	firstName: string | null;
	middleName: string | null;
	lastName: string | null;
	secondLastName: string | null;
}): string | null {
	const nombre = [
		partes.firstName,
		partes.middleName,
		partes.lastName,
		partes.secondLastName,
	]
		.map((parte) => (parte ?? "").trim())
		.filter(Boolean)
		.join(" ");
	return nombre || null;
}
