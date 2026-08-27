/**
 * Págalo usa una sola fila por número de cuota. Si Cartera devuelve
 * duplicados físicos, conserva mayor cuota_id; dentro de esa misma fila,
 * conserva mayor pago_id.
 */
export function deduplicarCuotasPagalo<
	T extends { numero_cuota: number; cuota_id: number; pago_id?: number },
>(cuotas: T[]): T[] {
	const porNumero = new Map<number, T>();
	for (const cuota of cuotas) {
		const actual = porNumero.get(cuota.numero_cuota);
		if (
			!actual ||
			cuota.cuota_id > actual.cuota_id ||
			(cuota.cuota_id === actual.cuota_id &&
				(cuota.pago_id ?? 0) > (actual.pago_id ?? 0))
		) {
			porNumero.set(cuota.numero_cuota, cuota);
		}
	}
	return [...porNumero.values()].sort(
		(a, b) => a.numero_cuota - b.numero_cuota,
	);
}
