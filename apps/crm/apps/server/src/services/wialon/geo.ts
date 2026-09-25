import type { WialonZonaPunto } from "./wialon-types";

/**
 * Punto-en-polígono por ray-casting (algoritmo par/impar): traza un rayo
 * horizontal desde el punto hacia la derecha y cuenta cuántas veces cruza
 * los lados del polígono — impar significa adentro. Estándar, sin
 * dependencias nuevas (mismo criterio "cero dependencias de mapas" de D-11
 * en docs/features/cobros-02/09-integracion-gps-wialon.md).
 *
 * `poligono` es una lista de vértices `{x: longitud, y: latitud}` en el
 * mismo orden que devuelve Wialon (resource/get_zone_data). No se cierra el
 * polígono explícitamente: el último vértice se conecta con el primero
 * dentro del loop.
 */
export function puntoDentroDePoligono(
	lat: number,
	lon: number,
	poligono: WialonZonaPunto[],
): boolean {
	if (poligono.length < 3) return false;

	let dentro = false;
	for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
		const vi = poligono[i];
		const vj = poligono[j];

		// Paréntesis explícitos por legibilidad — mismo resultado que sin
		// ellos, la precedencia real de JS ya evalúa `>` antes que `!==` y `&&`.
		const cruza =
			vi.y > lat !== vj.y > lat &&
			lon < ((vj.x - vi.x) * (lat - vi.y)) / (vj.y - vi.y) + vi.x;

		if (cruza) dentro = !dentro;
	}

	return dentro;
}
