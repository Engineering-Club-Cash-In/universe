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
