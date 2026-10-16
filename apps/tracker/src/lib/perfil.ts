export function esGerente(
	perfil: { agencias: { rol: "gerente" | "usuario" }[] } | undefined,
) {
	return perfil?.agencias.some((agencia) => agencia.rol === "gerente") ?? false;
}

export function etiquetaDeRol(rol: "gerente" | "usuario") {
	return rol === "gerente" ? "Gerente" : "Usuario de agencia";
}
