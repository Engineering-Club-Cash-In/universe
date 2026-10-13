/**
 * Bitácora unificada de decisiones del supervisor (tarea M3 de
 * docs/features/cobros-02/18-equipo-solicitudes-backend.md). Reglas puras:
 * la forma de una entrada, cómo se traducen las decisiones a los estados de
 * cada fuente y cómo se mezclan y paginan fuentes que ya vienen ordenadas.
 */

export const TIPOS_BITACORA = [
	"convenio",
	"apagado",
	"reactivacion",
	"recuperacion",
	"rebaja",
	"juridico",
	"reasignacion",
	"traslado",
	"cobertura",
] as const;
export type TipoBitacora = (typeof TIPOS_BITACORA)[number];

/** Tipos que un asesor pide y el supervisor decide; el resto son acciones del supervisor. */
export const TIPOS_SOLICITUD: readonly TipoBitacora[] = [
	"convenio",
	"apagado",
	"reactivacion",
	"recuperacion",
	"rebaja",
	"juridico",
];

export const DECISIONES = [
	"aprobada",
	"rechazada",
	"cancelada",
	"sin_efecto",
] as const;
export type Decision = (typeof DECISIONES)[number];

export interface PersonaBitacora {
	userId: string | null;
	nombre: string | null;
}

export interface EntradaBitacora {
	/** `${tipo}-${refId}`, estable entre páginas. */
	id: string;
	tipo: TipoBitacora;
	/** ISO. Fecha de la decisión o, si no hay, de la solicitud. */
	fecha: string;
	/** Decisión unificada; `null` en las acciones del supervisor que no se deciden. */
	decision: Decision | null;
	/** Estado propio de la fuente (aprobada, ejecutada, error_aplicacion…). */
	estado: string;
	solicitante: PersonaBitacora | null;
	decididoPor: PersonaBitacora | null;
	credito: { sifco: string; cliente: string | null } | null;
	/** Lo que no es un crédito (traslado, cobertura, reasignación). */
	resumen: string | null;
	/**
	 * Una cobertura tiene dos eventos: la `ausencia` (cuando se registró) y, si ya
	 * se canceló o terminó su período, la `reactivacion` del asesor. `null` en el resto.
	 */
	evento?: "ausencia" | "reactivacion" | null;
	/** Motivo de la solicitud. */
	motivo: string | null;
	/** Nota del supervisor: al aprobar, la nota; al rechazar, el motivo del rechazo. */
	nota: string | null;
	refId: string;
}

export type FuenteDecision =
	| "inmovilizacion"
	| "recuperacion"
	| "rebaja"
	| "juridico"
	| "convenio";

/** Estados propios de cada fuente que equivalen a cada decisión unificada. */
const ESTADOS_NATIVOS: Record<FuenteDecision, Record<Decision, string[]>> = {
	inmovilizacion: {
		// Una apagada o reactivada ya ejecutada conserva su aprobación.
		aprobada: ["aprobada", "ejecutada"],
		rechazada: ["rechazada"],
		cancelada: ["cancelada"],
		sin_efecto: [],
	},
	recuperacion: {
		aprobada: ["aprobada"],
		rechazada: ["rechazada"],
		cancelada: ["cancelada"],
		sin_efecto: ["sin_efecto"],
	},
	rebaja: {
		aprobada: ["aprobada", "aplicada", "error_aplicacion"],
		rechazada: ["rechazada"],
		cancelada: ["cancelada"],
		sin_efecto: [],
	},
	juridico: {
		aprobada: ["aprobada", "aplicada", "error_aplicacion"],
		rechazada: ["rechazada"],
		cancelada: ["cancelada"],
		sin_efecto: [],
	},
	convenio: {
		aprobada: ["aprobado"],
		rechazada: ["rechazado"],
		cancelada: [],
		sin_efecto: [],
	},
};

/**
 * Estados de la fuente que entran al filtro. Sin `decisiones` entran todas las
 * ya decididas (nunca las pendientes: la bitácora es el historial).
 */
export function estadosNativos(
	fuente: FuenteDecision,
	decisiones?: readonly Decision[],
): string[] {
	const mapa = ESTADOS_NATIVOS[fuente];
	const pedidas = decisiones?.length ? decisiones : DECISIONES;
	return [...new Set(pedidas.flatMap((d) => mapa[d]))];
}

/** Decisión unificada de un estado propio de la fuente; `null` si sigue pendiente. */
export function decisionDe(
	fuente: FuenteDecision,
	estado: string,
): Decision | null {
	const mapa = ESTADOS_NATIVOS[fuente];
	return DECISIONES.find((d) => mapa[d].includes(estado)) ?? null;
}

/**
 * Entradas más recientes que una consulta puede alcanzar (`page × perPage`).
 * Para dar la página N cada fuente tiene que traer sus primeras `N × perPage`
 * filas, así que sin un límite una página lejana sería una consulta enorme a
 * cada fuente. Para ver lo anterior se acota por fecha (`desde` y `hasta`): el
 * total de la respuesta ya cuenta solo lo que cae en ese rango.
 */
export const MAX_FILAS_BITACORA = 5000;

/** Mensaje si la página pedida queda más allá del límite; `null` si se puede dar. */
export function mensajeFueraDeAlcance(
	page: number,
	perPage: number,
): string | null {
	if (page * perPage <= MAX_FILAS_BITACORA) return null;
	return `La bitácora llega hasta las ${MAX_FILAS_BITACORA.toLocaleString("es-GT")} entradas más recientes de cada consulta. Para ver las anteriores acote el rango de fechas (desde y hasta).`;
}

export interface FuenteOrdenada {
	/** Las primeras filas de la fuente, ya ordenadas de más reciente a más vieja. */
	filas: EntradaBitacora[];
	/** Total de la fuente con los mismos filtros. */
	total: number;
}

/**
 * Compara dos identificadores como lo hace la base al ordenar por `id`: si los
 * dos son numéricos, por valor (999 < 1000); si no (uuid), como texto. Sin esto
 * el texto ordenaría "1000" antes que "999" y la mezcla no coincidiría con el
 * orden con que cada fuente recortó sus filas.
 */
function compararIds(a: string, b: string) {
	if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
		if (a.length !== b.length) return a.length < b.length ? -1 : 1;
	}
	return a < b ? -1 : a > b ? 1 : 0;
}

/** Parte del id de la entrada que es el id de la fila de su fuente. */
function idDeFila(id: string) {
	return id.slice(id.indexOf("-") + 1);
}

/**
 * Más reciente primero. Desempata igual que las consultas de cada fuente (el id
 * de la fila, de mayor a menor) para que la página sea estable al pedir más
 * filas por fuente; el prefijo solo separa filas de fuentes distintas.
 */
export function compararEntradas(a: EntradaBitacora, b: EntradaBitacora) {
	if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
	const porFila = compararIds(idDeFila(b.id), idDeFila(a.id));
	if (porFila !== 0) return porFila;
	return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Mezcla fuentes ya ordenadas y devuelve una página. Cada fuente tiene que
 * traer al menos `page * perPage` filas (o todas, si tiene menos): con eso la
 * página `page` de la mezcla es exacta. El total es la suma de los totales.
 */
export function paginarMezcla(
	fuentes: readonly FuenteOrdenada[],
	page: number,
	perPage: number,
) {
	const total = fuentes.reduce((a, f) => a + f.total, 0);
	const todas = fuentes.flatMap((f) => f.filas).sort(compararEntradas);
	const desde = (page - 1) * perPage;
	return {
		items: todas.slice(desde, desde + perPage),
		page,
		perPage,
		total,
		totalPages: Math.max(1, Math.ceil(total / perPage)),
	};
}
