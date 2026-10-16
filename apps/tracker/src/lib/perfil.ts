export function esGerente(
	perfil: { agencias: { rol: "gerente" | "usuario" }[] } | undefined,
) {
	return perfil?.agencias.some((agencia) => agencia.rol === "gerente") ?? false;
}
