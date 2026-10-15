/**
 * Bitácora unificada de decisiones del supervisor (tarea M3 de
 * docs/features/cobros-02/18-equipo-solicitudes-backend.md). Reglas puras:
 * la forma de una entrada, cómo se traducen las decisiones a los estados de
 * cada fuente, cómo se clasifican los eventos de los asesores, cómo se lee la
 * búsqueda por texto y cómo se mezclan y paginan fuentes que ya vienen
 * ordenadas.
 */

export const TIPOS_BITACORA = [
	"convenio",
	"apagado",
	"reactivacion",
	"recuperacion",
	"rebaja",
	"juridico",
	// F6: solicitudes de documentos ya resueltas.
	"documento",
	// M4: contrapropuestas de convenio ya respondidas (aceptada, descartada,
	// retirada o sin efecto).
	"contrapropuesta",
	"reasignacion",
	"traslado",
	"cobertura",
	// M5: ausencia indefinida con la cartera repartida al equipo.
	"ausencia_indefinida",
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
	"documento",
];

/**
 * Tipos sin crédito: acciones sobre los asesores. No tienen número de crédito
 * ni cliente, así que una búsqueda por texto los deja fuera.
 */
export const TIPOS_SIN_CREDITO: readonly TipoBitacora[] = [
	"traslado",
	"cobertura",
	"ausencia_indefinida",
];

/**
 * Eventos de las acciones sobre asesores, para separarlos en el filtro:
 *  - traslado: `baja` (el motivo empieza con «Despido» o «Renuncia») o
 *    `traslado` (cualquier otro);
 *  - cobertura y ausencia indefinida: la `ausencia` (cuando se registró) y, si
 *    ya terminó, la `reactivacion` del asesor.
 */
export const EVENTOS_BITACORA = [
	"traslado",
	"baja",
	"ausencia",
	"reactivacion",
] as const;
export type EventoBitacora = (typeof EVENTOS_BITACORA)[number];

/** Tipos cuyas entradas llevan `evento` (el filtro `eventos` solo los afecta a ellos). */
export const TIPOS_CON_EVENTO: readonly TipoBitacora[] = [
	"traslado",
	"cobertura",
	"ausencia_indefinida",
];

/**
 * ¿El traslado es la baja de un asesor? El motivo se arma en el panel de
 * traslados como «Despido: …» o «Renuncia: …» (o solo «Despido»), y en «Dar de
 * baja» de Mi equipo como «Baja de asesor: …» (`motivoDeLaBaja`).
 */
export function esBajaDeAsesor(motivo: string | null | undefined) {
	return /^(despido|renuncia|baja de asesor)\b/i.test((motivo ?? "").trim());
}

/** Evento de un traslado según su motivo. */
export function eventoDeTraslado(
	motivo: string | null | undefined,
): "baja" | "traslado" {
	return esBajaDeAsesor(motivo) ? "baja" : "traslado";
}

/**
 * ¿Entra una entrada de un tipo con evento? Sin `eventos`, todas; los tipos
 * sin evento nunca se filtran por aquí.
 */
export function admiteEvento(
	evento: EventoBitacora,
	eventos?: readonly EventoBitacora[],
) {
	return !eventos?.length || eventos.includes(evento);
}

/**
 * Búsqueda por texto, ya leída. Un número de crédito (solo dígitos, con o sin
 * «#», espacios o guiones) busca en el SIFCO; lo demás busca en el nombre del
 * cliente, palabra por palabra (todas deben aparecer, sin tildes ni
 * mayúsculas), o en un SIFCO que contenga el texto. Así «María López»
 * encuentra a «María José López Pérez».
 */
export type Busqueda =
	| { tipo: "sifco"; digitos: string }
	| { tipo: "nombre"; palabras: string[]; texto: string };

/** Minúsculas, sin tildes y con un solo espacio entre palabras. */
export function normalizarTexto(v: string | null | undefined) {
	return (v ?? "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

export function leerBusqueda(
	texto: string | null | undefined,
): Busqueda | null {
	const limpio = (texto ?? "").trim();
	if (!limpio) return null;
	if (/^#?[\d\s-]+$/.test(limpio)) {
		const digitos = limpio.replace(/\D/g, "");
		if (digitos) return { tipo: "sifco", digitos };
	}
	const normal = normalizarTexto(limpio);
	const palabras = normal.split(" ").filter(Boolean);
	if (palabras.length === 0) return null;
	return { tipo: "nombre", palabras, texto: limpio };
}

/** ¿Coincide un crédito con la búsqueda? (para fuentes que se filtran en memoria). */
export function coincideBusqueda(
	busqueda: Busqueda,
	credito: { sifco: string | null; cliente: string | null },
) {
	if (busqueda.tipo === "sifco") {
		return (credito.sifco ?? "").includes(busqueda.digitos);
	}
	// Como en SQL: el SIFCO que contiene el texto (p. ej. «CRM-07ba») también cuenta.
	const sifco = (credito.sifco ?? "").toLowerCase();
	if (sifco.includes(busqueda.texto.toLowerCase())) return true;
	const cliente = normalizarTexto(credito.cliente);
	return busqueda.palabras.every((p) => cliente.includes(p));
}

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
	 * Evento de las acciones sobre asesores (ver `EVENTOS_BITACORA`): un traslado
	 * es `baja` o `traslado`; una cobertura o una ausencia indefinida tienen la
	 * `ausencia` (cuando se registró) y, si ya terminó, la `reactivacion` del
	 * asesor. `null` en el resto.
	 */
	evento?: EventoBitacora | null;
	/** Motivo de la solicitud. */
	motivo: string | null;
	/** Nota del supervisor: al aprobar, la nota; al rechazar, el motivo del rechazo. */
	nota: string | null;
	refId: string;
	/**
	 * Bucket que asignó el motor: el del crédito al reasignarlo (reasignación) o
	 * al pedir (Jurídico). Nunca se deriva de las cuotas atrasadas.
	 */
	bucket?: number | null;
	/** Rebaja de mora: montos en quetzales, como texto decimal. */
	montos?: {
		solicitado: string;
		/** Mora del crédito cuando se pidió. */
		moraAlPedir: string;
		/** Lo que cartera rebajó; null mientras no se aplica. */
		aplicado: string | null;
	} | null;
	/** Jurídico: la nota del asesor para Jurídico. */
	notaJuridico?: string | null;
	/** Documento: el nombre para mostrar («Contrato de crédito»). */
	documento?: string | null;
	/**
	 * Traslado, cobertura y ausencia indefinida: el asesor que dejó la cartera
	 * (`asesorId` de cartera; `userId` del CRM cuando se conoce).
	 */
	asesorAfectado?: {
		asesorId: number | null;
		userId: string | null;
		nombre: string | null;
	} | null;
	/**
	 * Cobertura y ausencia indefinida: días de Guatemala (YYYY-MM-DD). En la
	 * ausencia indefinida `hasta` es el día en que se lo reactivó (null mientras
	 * sigue ausente).
	 */
	periodo?: { desde: string; hasta: string | null } | null;
	/**
	 * Cuentas movidas: las del traslado o las que se repartieron (ausencia) y,
	 * al reactivar, las que volvieron y las que se quedaron con otro asesor.
	 */
	cuentas?: {
		movidas: number | null;
		devueltas?: number | null;
		retenidas?: number | null;
	} | null;
	/** Contrapropuesta: el plan del asesor y el que propuso el supervisor. */
	plan?: {
		montoTotal: string;
		original: PlanConvenioBitacora;
		propuesto: PlanConvenioBitacora;
		/** Quien la propuso (el supervisor). */
		propuestaPor: PersonaBitacora | null;
		/** Nota con la que la propuso. */
		nota: string | null;
	} | null;
}

export interface PlanConvenioBitacora {
	numeroMeses: number;
	cuotaMensual: string;
	/** YYYY-MM-DD; null si no se conocía. */
	primerPago: string | null;
}

export type FuenteDecision =
	| "inmovilizacion"
	| "recuperacion"
	| "rebaja"
	| "juridico"
	| "documento"
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
	documento: {
		aprobada: ["aprobada"],
		rechazada: ["rechazada"],
		cancelada: [],
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
 * Estado de una contrapropuesta resuelta. La tabla guarda `descartada` tanto
 * si la descartó el asesor como si el supervisor la retiró: se distingue por
 * quién la cerró (un supervisor o administrador de cobros solo puede
 * retirarla).
 */
export type EstadoContrapropuestaBitacora =
	| "aceptada"
	| "descartada"
	| "retirada"
	| "sin_efecto";

export function estadoContrapropuesta(
	estado: string,
	rolQuienCerro: string | null | undefined,
): EstadoContrapropuestaBitacora {
	if (estado === "aceptada" || estado === "sin_efecto") return estado;
	return rolQuienCerro === "admin" || rolQuienCerro === "cobros_supervisor"
		? "retirada"
		: "descartada";
}

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
