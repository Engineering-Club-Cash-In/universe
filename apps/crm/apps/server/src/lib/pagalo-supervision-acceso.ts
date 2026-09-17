export type AsesorPoolPagalo = {
	asesor_id: number;
	nombre: string;
	email_cash_in: string | null;
	activo?: boolean | null;
	buckets: number[];
};

const normalizarEmail = (email: string | null | undefined) =>
	email?.trim().toLowerCase() ?? "";

/**
 * Compatibilidad mientras CRM y Cartera Back se despliegan en momentos
 * distintos: backend previo omitía `activo`; false/null siguen excluidos.
 */
export function asesoresConBucketsCompatibles<T extends AsesorPoolPagalo>(
	asesores: readonly T[],
): T[] {
	return asesores.filter(
		(asesor) =>
			asesor.buckets.length > 0 &&
			(asesor.activo === true || asesor.activo === undefined),
	);
}

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
