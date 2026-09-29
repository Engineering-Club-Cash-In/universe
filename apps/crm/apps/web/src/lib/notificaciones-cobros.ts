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

/**
 * Valor del filtro que muestra solo las TAREAS de cobros (las que piden una
 * acción con plazo, no las alertas). Hoy: la llamada al supervisor por ingreso a
 * B3 (CB-035). Espejo de `COBROS_TIPOS_TAREA` del servidor (lib/b3-llamada.ts);
 * `b3_llamada_vencida` NO entra: es la alerta de que la tarea no se cumplió.
 */
export const FILTRO_COBROS_TAREAS = "__tareas__";
export const COBROS_TIPOS_TAREA: readonly string[] = ["b3_llamada_supervisor"];

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
 * solo las de cobros, `FILTRO_COBROS_TAREAS` deja solo las tareas, y cualquier
 * otro valor es un `cobros_tipo` exacto.
 */
export function coincideFiltroCobros(
	n: { cobrosTipo?: string | null },
	filtro: string,
): boolean {
	if (filtro === "all") return true;
	if (filtro === FILTRO_COBROS_TODAS) return Boolean(n.cobrosTipo);
	if (filtro === FILTRO_COBROS_TAREAS) {
		return Boolean(n.cobrosTipo && COBROS_TIPOS_TAREA.includes(n.cobrosTipo));
	}
	return n.cobrosTipo === filtro;
}

const diaGT = (d: Date) =>
	new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(d);

/**
 * ¿El plazo de la tarea ya pasó? Se compara por DÍA GT: el vencimiento es
 * 23:59:59 GT del día límite, así que ese día aún "vence"; al siguiente "venció".
 * Espejo de `estadoPlazoTarea` del servidor.
 */
export function tareaVencida(
	fechaVencimiento: Date | string,
	ahora: Date = new Date(),
): boolean {
	return diaGT(new Date(fechaVencimiento)) < diaGT(ahora);
}
