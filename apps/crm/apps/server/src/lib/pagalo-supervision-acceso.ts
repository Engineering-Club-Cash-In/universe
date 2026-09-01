export type AsesorPoolPagalo = {
	asesor_id: number;
	nombre: string;
	email_cash_in: string | null;
	buckets: number[];
};

const normalizarEmail = (email: string | null | undefined) =>
	email?.trim().toLowerCase() ?? "";

export function buscarAsesorPorEmail<T extends AsesorPoolPagalo>(
	asesores: readonly T[],
	email: string | null | undefined,
): T | null {
	const normalizado = normalizarEmail(email);
	if (!normalizado) return null;
	return (
		asesores.find(
			(asesor) => normalizarEmail(asesor.email_cash_in) === normalizado,
		) ?? null
	);
}

export function buscarAsesorPorId<T extends AsesorPoolPagalo>(
	asesores: readonly T[],
	asesorId: number,
): T | null {
	return asesores.find((asesor) => asesor.asesor_id === asesorId) ?? null;
}

export function nombresAsesoresPorSifco(
	asesores: readonly (AsesorPoolPagalo & { sifcos: readonly string[] })[],
	sifcosPagina: readonly string[],
): Map<string, string[]> {
	const sifcosBuscados = new Set(sifcosPagina);
	const nombres = new Map<string, string[]>();
	for (const asesor of asesores) {
		for (const sifco of asesor.sifcos) {
			if (!sifcosBuscados.has(sifco)) continue;
			const asignados = nombres.get(sifco) ?? [];
			if (!asignados.includes(asesor.nombre)) asignados.push(asesor.nombre);
			nombres.set(sifco, asignados);
		}
	}
	return nombres;
}
