export type AsesorPoolPagalo = {
	asesor_id: number;
	nombre: string;
	email_cash_in: string | null;
	buckets: number[];
};

export type CreditoBucketPagalo = {
	numeroCreditoSifco: string;
	bucketNumero: number | null;
	bucketEsAutoritativo: boolean;
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

export function dividirEnLotes<T>(items: readonly T[], tamano: number): T[][] {
	if (!Number.isInteger(tamano) || tamano < 1) {
		throw new Error("El tamaño de lote debe ser un entero positivo.");
	}
	const lotes: T[][] = [];
	for (let inicio = 0; inicio < items.length; inicio += tamano) {
		lotes.push(items.slice(inicio, inicio + tamano));
	}
	return lotes;
}

export function sifcosEnBucketsPermitidos(
	creditos: readonly CreditoBucketPagalo[],
	bucketsPermitidos: readonly number[],
): Set<string> {
	const buckets = new Set(bucketsPermitidos);
	return new Set(
		creditos
			.filter(
				(credito) =>
					credito.bucketEsAutoritativo &&
					credito.bucketNumero !== null &&
					buckets.has(credito.bucketNumero),
			)
			.map((credito) => credito.numeroCreditoSifco),
	);
}
