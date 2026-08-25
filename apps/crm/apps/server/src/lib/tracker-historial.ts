import { pasoDesdeCierre } from "./tracker-pasos";

export type EventoEtapa = {
	changedAt: Date;
	pctDestino: number;
	pctOrigen: number | null;
};

export type EntradaHistorial = {
	paso: number;
	porcentaje: number;
	fecha: string;
};

/**
 * Fecha en que un caso llegó a cada porcentaje.
 *
 * `opportunity_stage_history` solo registra *cambios* de etapa, así que el 43%
 * de las oportunidades no tiene ninguna fila: nacieron en una etapa y no se
 * movieron. Para no perderlas se sintetiza la entrada inicial con `createdAt`,
 * tomando la etapa de origen de la primera transición (o la etapa actual si no
 * hubo ninguna).
 *
 * Se conserva la *primera* fecha de cada porcentaje: hay retrocesos reales
 * (overrides de ventas, devoluciones de análisis) que no deben pisarla.
 */
export function construirHistorial(
	eventos: EventoEtapa[],
	caso: { createdAt: Date; closurePercentage: number },
): EntradaHistorial[] {
	const ordenados = [...eventos].sort(
		(a, b) => a.changedAt.getTime() - b.changedAt.getTime(),
	);

	const primeraVez = new Map<number, Date>();
	for (const evento of ordenados) {
		if (!primeraVez.has(evento.pctDestino)) {
			primeraVez.set(evento.pctDestino, evento.changedAt);
		}
	}

	const pctInicial = ordenados[0]?.pctOrigen ?? caso.closurePercentage;
	if (pctInicial !== null && !primeraVez.has(pctInicial)) {
		primeraVez.set(pctInicial, caso.createdAt);
	}

	return [...primeraVez.entries()]
		.sort(([a], [b]) => a - b)
		.map(([porcentaje, fecha]) => ({
			paso: pasoDesdeCierre(porcentaje),
			porcentaje,
			fecha: fecha.toISOString(),
		}));
}
