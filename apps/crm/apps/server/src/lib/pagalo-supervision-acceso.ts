export type AsesorPoolPagalo = {
	asesor_id: number;
	nombre: string;
	email_cash_in: string | null;
	activo?: boolean | null;
	buckets: number[];
};

const normalizarEmail = (email: string | null | undefined) =>
	email?.trim().toLowerCase() ?? "";

export function asesoresActivosConBuckets<T extends AsesorPoolPagalo>(
	asesores: readonly T[],
): T[] {
	return asesores.filter(
		(asesor) => asesor.activo === true && asesor.buckets.length > 0,
	);
}

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

export function debeUsarFallbackAtribucion(
	asesores: readonly AsesorPoolPagalo[],
	sifcosPagina: readonly string[],
	asignaciones: readonly { asesor_id: number; numero_credito_sifco: string }[],
): boolean {
	return (
		sifcosPagina.length > 0 &&
		asesoresActivosConBuckets(asesores).length > 0 &&
		asignaciones.length === 0
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
