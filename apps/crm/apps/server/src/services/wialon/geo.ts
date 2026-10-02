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

/** Margen sobre el radio del cluster para dar por confirmada una "probable casa". */
export const UMBRAL_CONFIRMACION_DOMICILIO_M = 150;

/**
 * Lee coordenadas de lo que el asesor pega desde Google Maps: "14.63, -90.50",
 * o un link con `@lat,lon`, `!3dLAT!4dLON` o `?q=lat,lon`. Devuelve null si no
 * hay un par válido (rango lat/lon, y no 0,0).
 */
export function parsearCoordenadas(
	entrada: string,
): { lat: number; lon: number } | null {
	let texto = entrada.trim();
	try {
		texto = decodeURIComponent(texto);
	} catch {
		// Texto con % suelto: se usa tal cual.
	}
	const num = "(-?\\d{1,3}(?:\\.\\d+)?)";
	const patrones = [
		new RegExp(`!3d${num}!4d${num}`),
		new RegExp(`@${num},\\s*${num}`),
		new RegExp(`[?&](?:q|ll|query)=${num}[,\\s]+${num}`),
		new RegExp(`^${num}\\s*[,;\\s]\\s*${num}$`),
	];
	for (const patron of patrones) {
		const m = texto.match(patron);
		if (!m) continue;
		const lat = Number(m[1]);
		const lon = Number(m[2]);
		if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
		if (lat === 0 && lon === 0) continue;
		return { lat, lon };
	}
	return null;
}

/** ¿La ubicación (con su radio) queda dentro del margen del domicilio declarado? */
export function confirmaDomicilio(distanciaM: number, radioM: number): boolean {
	return distanciaM <= radioM + UMBRAL_CONFIRMACION_DOMICILIO_M;
}
