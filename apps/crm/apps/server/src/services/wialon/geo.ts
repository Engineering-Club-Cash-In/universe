const RADIO_TIERRA_M = 6371000;

/**
 * Distancia en metros entre dos puntos (lat/lon), fórmula de Haversine —
 * suficiente para las distancias cortas que maneja "ubicaciones clave"
 * (agrupar puntos a pocos cientos de metros entre sí), sin dependencias
 * nuevas (mismo criterio "cero dependencias de mapas" de D-11 en
 * docs/features/cobros-02/09-integracion-gps-wialon.md).
 */
export function distanciaMetros(
	lat1: number,
	lon1: number,
	lat2: number,
	lon2: number,
): number {
	const radLat1 = (lat1 * Math.PI) / 180;
	const radLat2 = (lat2 * Math.PI) / 180;
	const deltaLat = ((lat2 - lat1) * Math.PI) / 180;
	const deltaLon = ((lon2 - lon1) * Math.PI) / 180;

	const a =
		Math.sin(deltaLat / 2) ** 2 +
		Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(deltaLon / 2) ** 2;
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

	return RADIO_TIERRA_M * c;
}
