/**
 * COBROS-02 — orden y filtro de las alertas de cobros en la campanita.
 *
 * `bot_modo_agente` es la única alerta en la que hay un cliente ESPERANDO en
 * este momento (pidió un humano en el bot de WhatsApp). Todo lo demás puede
 * esperar a que el asesor termine lo que está haciendo; esto no. Por eso sube
 * arriba de la lista mientras siga abierta, sin importar su fecha.
 */

/** Estados en los que una alerta sigue pidiendo algo. */
const ESTADOS_ABIERTOS = new Set(["pending", "read", "in_progress"]);

export const COBROS_TIPO_PRIORITARIO = "bot_modo_agente";

/** Valor del filtro de alertas de cobros que muestra solo las de cobros. */
export const FILTRO_COBROS_TODAS = "__cobros__";

export type NotificacionOrdenable = {
	status: string;
	cobrosTipo?: string | null;
	createdAt: Date | string;
};

export function esPrioritaria(n: NotificacionOrdenable): boolean {
	return (
		n.cobrosTipo === COBROS_TIPO_PRIORITARIO && ESTADOS_ABIERTOS.has(n.status)
	);
}

/** Prioritarias primero; dentro de cada grupo, la más reciente primero. */
export function ordenarPorPrioridad<T extends NotificacionOrdenable>(
	items: readonly T[],
): T[] {
	return [...items].sort((a, b) => {
		const pa = esPrioritaria(a) ? 1 : 0;
		const pb = esPrioritaria(b) ? 1 : 0;
		if (pa !== pb) return pb - pa;
		return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
	});
}

/**
 * Filtro por subtipo de cobros: `all` no filtra, `FILTRO_COBROS_TODAS` deja
 * solo las de cobros, y cualquier otro valor es un `cobros_tipo` exacto.
 */
export function coincideFiltroCobros(
	n: { cobrosTipo?: string | null },
	filtro: string,
): boolean {
	if (filtro === "all") return true;
	if (filtro === FILTRO_COBROS_TODAS) return Boolean(n.cobrosTipo);
	return n.cobrosTipo === filtro;
}
