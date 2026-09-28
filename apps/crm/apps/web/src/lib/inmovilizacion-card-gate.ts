/**
 * CB-041 — ¿La carta de inmovilización de unidad aporta algo en este caso?
 *
 * Separado de InmovilizacionCard para poder testear el gate sin renderizar
 * el componente (el repo no tiene convención de tests de componentes React,
 * sí de lógica pura — mismo criterio que lib/inmovilizacion-unidad.ts en el
 * server).
 *
 * Fuera de B2/B3/B4 la carta no aporta nada nuevo: sin solicitud abierta, sin
 * historial, sin llamada pendiente y con la unidad activa, no hay nada que
 * mostrar ni hacer. Si el crédito bajó de bucket con algo en curso (p. ej. pagó
 * y hay una reactivación pendiente), o la unidad física compartida (D-10) quedó
 * inmovilizada desde otro caso, la carta se muestra para permitir reactivar.
 *
 * Si el vehículo no tiene GPS vinculado (tieneGps === false), el server rechaza
 * cualquier acción; se suprime la tarjeta a menos que haya historial o algo
 * en curso que auditar.
 */
export const BUCKETS_CON_CARD_INMOVILIZACION = [2, 3, 4];

export function debeMostrarCardInmovilizacion(params: {
	bucketNumero: number | null;
	haySolicitudAbierta: boolean;
	hayPendienteLlamar: boolean;
	historialLength: number;
	unidadInmovilizada?: boolean;
	tieneGps?: boolean;
}): boolean {
	if (
		params.tieneGps === false &&
		!params.haySolicitudAbierta &&
		!params.hayPendienteLlamar &&
		params.historialLength === 0
	) {
		return false;
	}

	const bucketHabilitado =
		params.bucketNumero !== null &&
		BUCKETS_CON_CARD_INMOVILIZACION.includes(params.bucketNumero);
	const hayAlgoQueMostrar =
		params.haySolicitudAbierta ||
		params.hayPendienteLlamar ||
		params.historialLength > 0 ||
		!!params.unidadInmovilizada;
	return bucketHabilitado || hayAlgoQueMostrar;
}
