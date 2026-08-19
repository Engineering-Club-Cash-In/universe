export function resumirVencimientosAgenda(
	filas: readonly { dia: number; total: number }[],
) {
	const porDia = new Map<number, number>(
		Array.from({ length: 6 }, (_, dia) => [dia, 0]),
	);
	for (const fila of filas) {
		porDia.set(fila.dia, fila.total);
	}

	return {
		total: filas.reduce((acumulado, fila) => acumulado + fila.total, 0),
		porDia,
	};
}
