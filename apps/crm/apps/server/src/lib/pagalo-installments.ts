/**
 * Págalo usa una sola fila por número de cuota. Si Cartera devuelve
 * duplicados físicos, conserva la más reciente: mayor cuota_id.
 */
export function deduplicarCuotasPagalo<
	T extends { numero_cuota: number; cuota_id: number },
>(cuotas: T[]): T[] {
	const porNumero = new Map<number, T>();
	for (const cuota of cuotas) {
		const actual = porNumero.get(cuota.numero_cuota);
		if (!actual || cuota.cuota_id > actual.cuota_id) {
			porNumero.set(cuota.numero_cuota, cuota);
		}
	}
	return [...porNumero.values()].sort(
		(a, b) => a.numero_cuota - b.numero_cuota,
	);
}
