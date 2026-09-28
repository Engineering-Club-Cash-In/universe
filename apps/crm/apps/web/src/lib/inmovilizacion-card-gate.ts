/**
 * CB-041 — ¿La carta de inmovilización de unidad aporta algo en este caso?
 *
 * Separado de InmovilizacionCard para poder testear el gate sin renderizar
 * el componente (el repo no tiene convención de tests de componentes React,
 * sí de lógica pura — mismo criterio que lib/inmovilizacion-unidad.ts en el
 * server).
 *
 * Fuera de B2/B3/B4 la carta no aporta nada nuevo: sin solicitud abierta, sin
 * historial y sin llamada pendiente, no hay nada que mostrar ni hacer. Si el
 * crédito bajó de bucket con algo en curso (p. ej. pagó y hay una
 * reactivación pendiente), la carta se sigue mostrando — no puede
 * desaparecer con una solicitud abierta.
 */
export const BUCKETS_CON_CARD_INMOVILIZACION = [2, 3, 4];

export function debeMostrarCardInmovilizacion(params: {
	bucketNumero: number | null;
	haySolicitudAbierta: boolean;
	hayPendienteLlamar: boolean;
	historialLength: number;
}): boolean {
	const bucketHabilitado =
		params.bucketNumero !== null &&
		BUCKETS_CON_CARD_INMOVILIZACION.includes(params.bucketNumero);
	const hayAlgoQueMostrar =
		params.haySolicitudAbierta ||
		params.hayPendienteLlamar ||
		params.historialLength > 0;
	return bucketHabilitado || hayAlgoQueMostrar;
}
