import type { FiltroGestionCartera } from "@/components/cobros/asesor/filtros-cartera";

/**
 * Segmentos de la Cartera general del supervisor (Figma «Cartera general»,
 * 2262:12). Reemplazan a tres páginas que vivían sueltas en el menú:
 *
 *   - Cola del día (/cobros/cola)                 → `?cola=<categoría>`
 *   - Alertas de promesas (/cobros/promesas)       → `?promesa=<categoría>`
 *   - Alertas de convenios (/cobros/alertas-convenios) → `?convenio=<categoría>`
 *
 * Las categorías son las mismas que devuelven `getColaDia`, `getAlertasPromesas`
 * y `getAlertasConvenios`, más «todas» (lo que antes mostraba cada página
 * completa). Un segmento y un filtro de gestión (`?gestion=`) son excluyentes:
 * elegir uno limpia el otro.
 *
 * Aquí solo hay tipos, textos y helpers puros (sin consultas ni JSX).
 */

/* ── Categorías ─────────────────────────────────────────────────────────────── */

export const CATEGORIAS_COLA = [
	"todas",
	"sla_hoy",
	"promesa_hoy",
	"vence_hoy",
	"incumplida",
	"promesa_proxima",
	"sin_contacto",
	"llamada_hoy",
	"sin_intento_hoy",
] as const;
export type CategoriaCola = (typeof CATEGORIAS_COLA)[number];

/** Las que `getColaDia` recibe como `filtroExtra` (no son categorías de la cola). */
export const EXTRAS_COLA = ["llamada_hoy", "sin_intento_hoy"] as const;

export const CATEGORIAS_PROMESA = [
	"todas",
	"vencida",
	"vence_hoy",
	"por_vencer",
	"programada",
] as const;
export type CategoriaPromesa = (typeof CATEGORIAS_PROMESA)[number];

export const CATEGORIAS_CONVENIO = [
	"todas",
	"vencida",
	"vence_hoy",
	"por_vencer",
	"proxima",
] as const;
export type CategoriaConvenio = (typeof CATEGORIAS_CONVENIO)[number];

export type Segmento =
	| { tipo: "cola"; valor: CategoriaCola }
	| { tipo: "promesa"; valor: CategoriaPromesa }
	| { tipo: "convenio"; valor: CategoriaConvenio };

export type TipoSegmento = Segmento["tipo"];

/* ── Filas de las fuentes ───────────────────────────────────────────────────── */

/** Fila de `getAlertasPromesas` (el cliente ORPC la infiere como `{}`). */
export type AlertaPromesa = {
	id: string;
	casoCobroId: string;
	numeroCreditoSifco: string | null;
	clienteNombre: string | null;
	asesorNombre: string | null;
	fechaPrometida: string | Date | null;
	fechaAlerta: string | Date | null;
	montoComprometido: string | null;
	cuotaInicio: number | null;
	cuotaFin: number | null;
	incluyeMora: boolean;
	estadoPromesa: string | null;
	categoria: Exclude<CategoriaPromesa, "todas">;
};

/** Fila de `getAlertasConvenios` (una por convenio). */
export type AlertaConvenio = {
	convenio_id: number;
	credito_id: number;
	numero_credito_sifco: string;
	cliente: string | null;
	asesor_id: number | null;
	asesor: string | null;
	fecha_vencimiento: string;
	dias_para_vencer: number;
	cuotas_vencidas: number;
	cuotas_pendientes: number;
	monto_vencido: string;
	monto_pendiente_convenio: string;
	cuota_convenio: string;
	monto_cuota: string;
	fecha_convenio: string;
	bucket: number | null;
	categoria: Exclude<CategoriaConvenio, "todas">;
	casoCobroId: string | null;
};

/** Ítem de la Cola del día con lo que pinta la celda del segmento. */
export type ItemCola = {
	numeroCreditoSifco: string;
	cliente: string;
	asesor: string;
	cubierto?: boolean;
	suplente?: string | null;
	fechaLimiteSla: string | null;
	fechaPromesa: string | Date | null;
	telefono: string | null;
	slaHoy: boolean;
	promesaHoy: boolean;
	venceHoy?: boolean;
	incumplida: boolean;
	promesaProxima: boolean;
	sinContacto: boolean;
	promesaActiva: boolean;
	diasSinContacto: number | null;
};

/** Lo que la fuente dice de un crédito: se pinta en la columna del segmento. */
export type DetalleSegmento =
	| { tipo: "cola"; item: ItemCola; mostrarAsesor: boolean }
	| { tipo: "promesa"; alertas: AlertaPromesa[] }
	| { tipo: "convenio"; alerta: AlertaConvenio };

/** Conteos por categoría (`undefined` = sin dato todavía). */
export type ConteosSegmentos = {
	cola: Partial<Record<CategoriaCola, number>>;
	promesa: Partial<Record<CategoriaPromesa, number>>;
	convenio: Partial<Record<CategoriaConvenio, number>>;
};

/* ── Textos ─────────────────────────────────────────────────────────────────── */

type Vacio = { titulo: string; descripcion: string };
type DefCategoria = {
	etiqueta: string;
	/** Lo que decía la página vieja de esta categoría. */
	descripcion: string;
	vacio: Vacio;
};

const NADA = "Nada requiere su atención en este segmento.";

export const GRUPOS_SEGMENTO: Record<
	TipoSegmento,
	{ titulo: string; descripcion: string }
> = {
	cola: {
		titulo: "Cola del día",
		descripcion:
			"Cuentas priorizadas para gestionar hoy: SLA vencido, promesas de pago que vencen hoy, promesas incumplidas y cuentas sin contacto reciente.",
	},
	promesa: {
		titulo: "Alertas de promesas",
		descripcion:
			"Promesas de pago del equipo que requieren seguimiento: vencidas, de hoy y próximas a vencer.",
	},
	convenio: {
		titulo: "Alertas de convenios",
		descripcion:
			"Convenios del equipo que requieren seguimiento: incumplidos, de hoy y próximos a vencer.",
	},
};

export const DEF_COLA: Record<CategoriaCola, DefCategoria> = {
	todas: {
		etiqueta: "Todas (priorizado)",
		descripcion: GRUPOS_SEGMENTO.cola.descripcion,
		vacio: {
			titulo: "Sin cuentas en la cola de hoy",
			descripcion: `El equipo no tiene cuentas pendientes en la cola de hoy. ${NADA}`,
		},
	},
	sla_hoy: {
		etiqueta: "SLA vence hoy",
		descripcion: "El plazo de gestión del bucket (SLA) vence hoy.",
		vacio: {
			titulo: "Sin SLA que venza hoy",
			descripcion: `Ningún crédito del equipo tiene el SLA venciendo hoy. ${NADA}`,
		},
	},
	promesa_hoy: {
		etiqueta: "Promesa vence hoy",
		descripcion: "El cliente prometió pagar hoy.",
		vacio: {
			titulo: "Sin promesas que venzan hoy",
			descripcion: `Ningún cliente del equipo prometió pagar hoy. ${NADA}`,
		},
	},
	vence_hoy: {
		etiqueta: "Cuota vence hoy",
		descripcion: "La cuota del crédito vence hoy.",
		vacio: {
			titulo: "Sin cuotas que venzan hoy",
			descripcion: `Ningún crédito del equipo tiene una cuota que venza hoy. ${NADA}`,
		},
	},
	incumplida: {
		etiqueta: "Promesa incumplida",
		descripcion: "El cliente no pagó en la fecha que prometió.",
		vacio: {
			titulo: "Sin promesas incumplidas",
			descripcion: `El equipo no tiene promesas incumplidas en la cola. ${NADA}`,
		},
	},
	promesa_proxima: {
		etiqueta: "Promesa próxima",
		descripcion:
			"La promesa aún no vence, pero su alerta programada ya llegó (baja prioridad).",
		vacio: {
			titulo: "Sin promesas próximas",
			descripcion: `No hay promesas con la alerta programada para hoy. ${NADA}`,
		},
	},
	sin_contacto: {
		etiqueta: "+5 días sin contacto",
		descripcion: "Cuentas sin contacto efectivo en más de 5 días.",
		vacio: {
			titulo: "Sin casos sin contacto",
			descripcion: `Todo el equipo tiene contacto reciente. ${NADA}`,
		},
	},
	llamada_hoy: {
		etiqueta: "Llamada agendada hoy",
		descripcion: "Cuentas con una llamada agendada para hoy.",
		vacio: {
			titulo: "Sin llamadas agendadas hoy",
			descripcion: `El equipo no tiene llamadas agendadas para hoy. ${NADA}`,
		},
	},
	sin_intento_hoy: {
		etiqueta: "Sin intento hoy",
		descripcion: "Cuentas de la cola que nadie intentó contactar hoy.",
		vacio: {
			titulo: "Sin cuentas por intentar",
			descripcion: `El equipo ya intentó contactar todas las cuentas de la cola. ${NADA}`,
		},
	},
};

export const DEF_PROMESA: Record<CategoriaPromesa, DefCategoria> = {
	todas: {
		etiqueta: "Todas",
		descripcion: GRUPOS_SEGMENTO.promesa.descripcion,
		vacio: {
			titulo: "Sin promesas por atender",
			descripcion: `El equipo no tiene promesas de pago que requieran seguimiento. ${NADA}`,
		},
	},
	vencida: {
		etiqueta: "Vencidas",
		descripcion: "La fecha comprometida ya pasó: prioridad alta.",
		vacio: {
			titulo: "Sin promesas vencidas",
			descripcion: `Ninguna promesa del equipo está vencida. ${NADA}`,
		},
	},
	vence_hoy: {
		etiqueta: "Vencen hoy",
		descripcion: "El cliente prometió pagar hoy.",
		vacio: {
			titulo: "Sin promesas que venzan hoy",
			descripcion: `Ningún cliente del equipo prometió pagar hoy. ${NADA}`,
		},
	},
	por_vencer: {
		etiqueta: "Por vencer",
		descripcion: "Se acerca la fecha comprometida: requieren seguimiento.",
		vacio: {
			titulo: "Sin promesas por vencer",
			descripcion: `Ninguna promesa del equipo está por vencer. ${NADA}`,
		},
	},
	programada: {
		etiqueta: "Próximas",
		descripcion: "Aún dentro de plazo, sin acción pendiente todavía.",
		vacio: {
			titulo: "Sin promesas próximas",
			descripcion: `El equipo no tiene promesas programadas. ${NADA}`,
		},
	},
};

export const DEF_CONVENIO: Record<CategoriaConvenio, DefCategoria> = {
	todas: {
		etiqueta: "Todos",
		descripcion: GRUPOS_SEGMENTO.convenio.descripcion,
		vacio: {
			titulo: "Sin convenios por atender",
			descripcion: `Ningún convenio del equipo se acerca a su fecha de pago ni está incumplido. ${NADA}`,
		},
	},
	vencida: {
		etiqueta: "Incumplidos",
		descripcion: "Cuota del convenio vencida e impaga: prioridad alta.",
		vacio: {
			titulo: "Sin convenios incumplidos",
			descripcion: `Todos los convenios del equipo están al día. ${NADA}`,
		},
	},
	vence_hoy: {
		etiqueta: "Vencen hoy",
		descripcion: "La cuota del convenio se paga hoy.",
		vacio: {
			titulo: "Sin convenios que venzan hoy",
			descripcion: `Ninguna cuota de convenio del equipo vence hoy. ${NADA}`,
		},
	},
	por_vencer: {
		etiqueta: "Por vencer",
		descripcion: "Se acerca la fecha: confirme el pago con el cliente.",
		vacio: {
			titulo: "Sin convenios por vencer",
			descripcion: `Ninguna cuota de convenio del equipo está por vencer. ${NADA}`,
		},
	},
	proxima: {
		etiqueta: "Próximos",
		descripcion: "Aún dentro de plazo, sin acción pendiente todavía.",
		vacio: {
			titulo: "Sin convenios próximos",
			descripcion: `El equipo no tiene cuotas de convenio programadas. ${NADA}`,
		},
	},
};

export function defSegmento(s: Segmento): DefCategoria {
	switch (s.tipo) {
		case "cola":
			return DEF_COLA[s.valor];
		case "promesa":
			return DEF_PROMESA[s.valor];
		case "convenio":
			return DEF_CONVENIO[s.valor];
	}
}

/** «Cola del día · SLA vence hoy». */
export function etiquetaSegmento(s: Segmento) {
	return `${GRUPOS_SEGMENTO[s.tipo].titulo} · ${defSegmento(s).etiqueta}`;
}

/** Chips rápidos del Figma con su texto exacto (los de gestión del supervisor). */
export const ETIQUETA_GESTION_SUPERVISION: Record<
	FiltroGestionCartera,
	string
> = {
	sin_gestion_48h: "Sin gestión >48h",
	promesa_por_vencer: "Promesa por vencer",
	convenio_pendiente: "Convenios por aprobar",
	sin_contactar_hoy: "Sin contactar hoy",
	sin_acuerdo: "Sin acuerdo",
};

/** Orden de los filtros de gestión dentro del selector de segmentos. */
export const GESTIONES_SUPERVISION: FiltroGestionCartera[] = [
	"sin_gestion_48h",
	"sin_contactar_hoy",
	"promesa_por_vencer",
	"convenio_pendiente",
	"sin_acuerdo",
];

export const DESCRIPCION_GESTION: Record<FiltroGestionCartera, string> = {
	sin_gestion_48h: "Sin gestiones registradas en las últimas 48 horas.",
	sin_contactar_hoy: "Nadie los contactó hoy.",
	promesa_por_vencer: "Promesa vigente que vence en los próximos 3 días.",
	convenio_pendiente: "Convenio solicitado que espera la aprobación.",
	sin_acuerdo: "Sin promesa ni convenio vigente.",
};

export const VACIO_GESTION: Record<FiltroGestionCartera, Vacio> = {
	sin_gestion_48h: {
		titulo: "Sin casos sin gestión",
		descripcion: `Todo el equipo registró gestiones en las últimas 48 horas. ${NADA}`,
	},
	sin_contactar_hoy: {
		titulo: "Sin casos por contactar hoy",
		descripcion: `El equipo ya contactó hoy a todos sus clientes. ${NADA}`,
	},
	promesa_por_vencer: {
		titulo: "Sin promesas por vencer",
		descripcion: `Ninguna promesa del equipo vence en los próximos días. ${NADA}`,
	},
	convenio_pendiente: {
		titulo: "Sin convenios por aprobar",
		descripcion: `No hay convenios que esperen su aprobación. ${NADA}`,
	},
	sin_acuerdo: {
		titulo: "Sin casos sin acuerdo",
		descripcion: `Todos los créditos de esta página tienen una promesa o un convenio vigente. ${NADA}`,
	},
};

/* ── URL ────────────────────────────────────────────────────────────────────── */

export type SearchSegmento = {
	cola?: CategoriaCola;
	promesa?: CategoriaPromesa;
	convenio?: CategoriaConvenio;
};

function incluye<T extends string>(
	lista: readonly T[],
	valor: unknown,
): valor is T {
	return (
		typeof valor === "string" && (lista as readonly string[]).includes(valor)
	);
}

/**
 * Lee `?cola`, `?promesa` y `?convenio`. Si vienen varios (link armado a mano),
 * gana el primero en ese orden: son excluyentes.
 */
export function leerSearchSegmento(
	search: Record<string, unknown>,
): SearchSegmento {
	if (incluye(CATEGORIAS_COLA, search.cola)) return { cola: search.cola };
	if (incluye(CATEGORIAS_PROMESA, search.promesa))
		return { promesa: search.promesa };
	if (incluye(CATEGORIAS_CONVENIO, search.convenio))
		return { convenio: search.convenio };
	return {};
}

export function segmentoDeSearch(s: SearchSegmento): Segmento | null {
	if (s.cola) return { tipo: "cola", valor: s.cola };
	if (s.promesa) return { tipo: "promesa", valor: s.promesa };
	if (s.convenio) return { tipo: "convenio", valor: s.convenio };
	return null;
}

export function searchDeSegmento(s: Segmento | null): SearchSegmento {
	if (!s) return {};
	return { [s.tipo]: s.valor } as SearchSegmento;
}

export function mismoSegmento(a: Segmento | null, b: Segmento | null) {
	return a?.tipo === b?.tipo && a?.valor === b?.valor;
}

export function esCategoriaCola(v: unknown): v is CategoriaCola {
	return incluye(CATEGORIAS_COLA, v);
}
export function esCategoriaPromesa(v: unknown): v is CategoriaPromesa {
	return incluye(CATEGORIAS_PROMESA, v);
}
export function esCategoriaConvenio(v: unknown): v is CategoriaConvenio {
	return incluye(CATEGORIAS_CONVENIO, v);
}

/* ── Helpers de las fuentes ─────────────────────────────────────────────────── */

/** Lista sin repetidos, en el orden en que llegó (el orden de prioridad de la fuente). */
export function sinRepetidos(valores: (string | null | undefined)[]) {
	const vistos = new Set<string>();
	const out: string[] = [];
	for (const v of valores) {
		if (!v || vistos.has(v)) continue;
		vistos.add(v);
		out.push(v);
	}
	return out;
}

/** Créditos distintos por categoría (la tabla lista créditos, no alertas). */
export function contarPorCategoria<C extends string>(
	filas: { categoria: C; sifco: string | null }[],
): Partial<Record<C | "todas", number>> {
	const por = new Map<string, Set<string>>();
	const todas = new Set<string>();
	for (const f of filas) {
		if (!f.sifco) continue;
		todas.add(f.sifco);
		const set = por.get(f.categoria) ?? new Set<string>();
		set.add(f.sifco);
		por.set(f.categoria, set);
	}
	const out: Partial<Record<string, number>> = { todas: todas.size };
	for (const [cat, set] of por) out[cat] = set.size;
	return out as Partial<Record<C | "todas", number>>;
}

/** Nombre de asesor comparable (cartera manda el mismo nombre en ambos lados). */
export function normalizarNombre(nombre: string | null | undefined) {
	return (nombre ?? "")
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.trim()
		.toLowerCase();
}
