/**
 * Selección del caso de cobros "vigente" cuando un mismo numero_credito_sifco
 * tiene varias filas en casos_cobros.
 *
 * No hay índice único sobre numero_credito_sifco, así que los duplicados son
 * posibles (reaperturas, migraciones, altas manuales). Criterio, ya usado por
 * getAgendaDia y getColaDia: gana el ACTIVO y, a igualdad de activo, el más
 * reciente por updatedAt.
 *
 * Vive acá porque estaba copiado en dos lugares y faltaba en un tercero
 * (getTodosLosCreditos), que agrupaba con un `.set()` incondicional sobre una
 * query sin ORDER BY — o sea se quedaba con la fila que Postgres devolviera
 * última, que es arbitrario. Eso hacía que el listado pudiera mostrar
 * etiquetas, casoCobroId y el badge "Promesa activa" de un caso viejo/inactivo
 * y contradecir al detalle y a la cola (Codex PR #1238).
 */

export interface CasoSeleccionable {
	numeroCreditoSifco: string | null;
	activo?: boolean | null;
	updatedAt?: Date | null;
}

/**
 * ¿`candidato` debe reemplazar a `previo` como caso vigente del SIFCO?
 * Exportada para poder testear el criterio aislado del agrupamiento.
 */
export function ganaComoCasoVigente(
	candidato: CasoSeleccionable,
	previo: CasoSeleccionable | undefined,
): boolean {
	if (!previo) return true;
	// Activo le gana a inactivo.
	if (Boolean(candidato.activo) !== Boolean(previo.activo)) {
		return Boolean(candidato.activo);
	}
	// Mismo estado de activo → el más reciente.
	return (
		(candidato.updatedAt?.getTime() ?? 0) > (previo.updatedAt?.getTime() ?? 0)
	);
}

/**
 * Agrupa casos por numero_credito_sifco quedándose con el vigente de cada uno.
 * Las filas sin SIFCO se ignoran (no hay clave con la cual asociarlas).
 */
export function agruparCasosVigentesPorSifco<T extends CasoSeleccionable>(
	casos: T[],
): Map<string, T> {
	const porSifco = new Map<string, T>();
	for (const caso of casos) {
		const sifco = caso.numeroCreditoSifco;
		if (!sifco) continue;
		if (ganaComoCasoVigente(caso, porSifco.get(sifco))) {
			porSifco.set(sifco, caso);
		}
	}
	return porSifco;
}
