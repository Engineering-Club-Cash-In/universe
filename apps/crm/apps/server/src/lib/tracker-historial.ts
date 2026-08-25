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

	// Sin transiciones, el caso sigue donde nació. Con transiciones, la etapa
	// inicial es el origen de la primera; si ese origen no quedó registrado no
	// se puede inferir, y asumir la etapa actual afirmaría que estuvo ahí desde
	// el inicio cuando hay un cambio hacia ella.
	const pctInicial =
		ordenados.length === 0 ? caso.closurePercentage : ordenados[0].pctOrigen;

	// La etapa inicial se siembra antes de recorrer las transiciones: el caso
	// estuvo ahí desde que se creó, así que si más tarde regresa a ese mismo
	// porcentaje no debe pisar la fecha original con la del retroceso.
	const primeraVez = new Map<number, Date>();
	if (pctInicial !== null) {
		primeraVez.set(pctInicial, caso.createdAt);
	}

	for (const evento of ordenados) {
		if (!primeraVez.has(evento.pctDestino)) {
			primeraVez.set(evento.pctDestino, evento.changedAt);
		}
	}

	return [...primeraVez.entries()]
		.sort(([a], [b]) => a - b)
		.map(([porcentaje, fecha]) => ({
			paso: pasoDesdeCierre(porcentaje),
			porcentaje,
			fecha: fecha.toISOString(),
		}));
}
