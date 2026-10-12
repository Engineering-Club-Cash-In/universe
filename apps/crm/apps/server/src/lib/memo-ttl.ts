/**
 * Memoria con vencimiento para cálculos caros que no dependen de quien pregunta
 * ni del período (p. ej. el conteo de «sin contacto» del equipo). Comparte la
 * misma promesa entre llamadas simultáneas y no guarda los fallos.
 */
export function memoConTtl<T>(ttlMs: number, ahora: () => number = Date.now) {
	const guardado = new Map<string, { en: number; valor: Promise<T> }>();
	return (clave: string, calcular: () => Promise<T>): Promise<T> => {
		const previo = guardado.get(clave);
		if (previo && ahora() - previo.en < ttlMs) return previo.valor;
		const valor = calcular();
		guardado.set(clave, { en: ahora(), valor });
		valor.catch(() => {
			if (guardado.get(clave)?.valor === valor) guardado.delete(clave);
		});
		return valor;
	};
}
