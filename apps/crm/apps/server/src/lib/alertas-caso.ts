/**
 * W5 · Alertas del caso: agrupación y separación de las leídas. Puro: la
 * consulta vive en el router (`getAlertasCaso`, `getAlertasLeidasCaso`) y en el
 * job diario (`jobs/alertas-caso-leidas.ts`).
 *
 * Los jobs repiten la misma alerta cada día y `filasNotificacionCobros` inserta
 * una fila por destinatario. Por eso una alerta se agrupa por TIPO (o por título
 * si no tiene tipo) y se deduplica por evento (tipo + instante).
 */

/** Fila de `notifications` tal como la lee el router. */
export interface FilaAlertaCaso {
	id: string;
	titulo: string;
	descripcion: string | null;
	cobrosTipo: string | null;
	status: string;
	createdAt: Date | null;
	assignedTo: string | null;
}

export interface GrupoAlertaCaso {
	/** Clave de agrupación: `cobrosTipo ?? titulo`. */
	clave: string;
	/** `id` de la repetición más reciente del grupo. */
	id: string;
	titulo: string;
	descripcion: string | null;
	cobrosTipo: string | null;
	status: string;
	/** Fecha de la repetición más reciente. */
	createdAt: Date;
	repeticiones: number;
	/** Fecha de la repetición más antigua vista. */
	desde: Date;
}

/** Marca de lectura de un grupo para un usuario (`alertas_caso_leidas_cobros`). */
export interface MarcaAlertaLeida {
	leidaHasta: Date;
	leidaEn: Date;
	leidaPor: string | null;
	nombreLeidaPor: string | null;
	origen: "manual" | "automatico";
}

export function claveAlerta(
	fila: Pick<FilaAlertaCaso, "cobrosTipo" | "titulo">,
) {
	return fila.cobrosTipo ?? fila.titulo;
}

/**
 * Agrupa las filas abiertas del caso por tipo. Las filas de un mismo evento
 * (mismo tipo e instante, una por destinatario) cuentan una sola vez,
 * prefiriendo la del usuario que mira: es la que trae el texto escrito para él.
 */
export function agruparAlertasCaso(
	filas: FilaAlertaCaso[],
	usuarioId: string,
): GrupoAlertaCaso[] {
	const porEvento = new Map<string, FilaAlertaCaso & { createdAt: Date }>();
	for (const r of filas) {
		if (!r.createdAt) continue;
		const claveEvento = `${claveAlerta(r)}|${r.createdAt.getTime()}`;
		const previa = porEvento.get(claveEvento);
		if (!previa || r.assignedTo === usuarioId) {
			porEvento.set(claveEvento, { ...r, createdAt: r.createdAt });
		}
	}

	// `filas` viene ordenado desc: la primera de cada tipo es la más reciente.
	const porTipo = new Map<string, GrupoAlertaCaso>();
	for (const r of porEvento.values()) {
		const clave = claveAlerta(r);
		const previa = porTipo.get(clave);
		if (!previa) {
			porTipo.set(clave, {
				clave,
				id: r.id,
				titulo: r.titulo,
				descripcion: r.descripcion,
				cobrosTipo: r.cobrosTipo,
				status: r.status,
				createdAt: r.createdAt,
				repeticiones: 1,
				desde: r.createdAt,
			});
			continue;
		}
		previa.repeticiones += 1;
		if (r.createdAt < previa.desde) previa.desde = r.createdAt;
		if (r.createdAt > previa.createdAt) {
			previa.createdAt = r.createdAt;
			previa.id = r.id;
			previa.titulo = r.titulo;
			previa.descripcion = r.descripcion;
			previa.status = r.status;
		}
	}
	return [...porTipo.values()];
}

/**
 * Un grupo queda leído mientras su repetición más reciente NO sea posterior a
 * la que el usuario vio al marcarlo. Si un job la vuelve a generar, la
 * repetición nueva es posterior y el grupo reaparece.
 */
export function estaLeido(grupo: GrupoAlertaCaso, marca: MarcaAlertaLeida) {
	return grupo.createdAt.getTime() <= marca.leidaHasta.getTime();
}

/** Separa los grupos en activos y leídos según las marcas del usuario. */
export function separarLeidas(
	grupos: GrupoAlertaCaso[],
	marcas: Map<string, MarcaAlertaLeida>,
): { activas: GrupoAlertaCaso[]; leidas: GrupoAlertaCaso[] } {
	const activas: GrupoAlertaCaso[] = [];
	const leidas: GrupoAlertaCaso[] = [];
	for (const g of grupos) {
		const marca = marcas.get(g.clave);
		if (marca && estaLeido(g, marca)) leidas.push(g);
		else activas.push(g);
	}
	return { activas, leidas };
}

/** Texto de «leída por» que ve el asesor. */
export function textoLeidaPor(marca: MarcaAlertaLeida): string {
	if (marca.origen === "automatico") return "Automático (más de 30 días)";
	return marca.nombreLeidaPor ?? "Sin dato";
}

/** Días sin repetirse a partir de los cuales el job marca la alerta como leída. */
export const DIAS_ALERTA_AUTOMATICA_LEIDA = 30;
