/**
 * «Historial de decisiones» (Figma 3602:5360): lo que decidió o hizo el
 * supervisor. Funciones puras.
 *
 * La fuente es la bitácora del servidor (`getBitacoraDecisiones`, M3):
 * convenios, apagados, reactivaciones, recuperaciones del vehículo, rebajas de
 * mora, Jurídico, documentos, contrapropuestas de convenio, reasignaciones
 * manuales, traslados (y bajas de asesor), coberturas y ausencias indefinidas,
 * ya mezclados, paginados, filtrados y buscados en el servidor. Cada entrada
 * trae lo que su detalle necesita (montos de la rebaja, nota para Jurídico,
 * bucket, asesor de origen…). Aquí solo se traduce cada entrada a la fila de
 * la tabla y los filtros de pantalla a los del servidor.
 */
import {
	type Decision,
	type EntradaBitacora,
	type EventoBitacora,
	esBajaDeAsesor,
	type PlanConvenioBitacora,
	TIPOS_SIN_CREDITO,
	type TipoBitacora,
} from "server/src/lib/bitacora-supervision";
import {
	ETIQUETA_TIPO,
	etiquetaMotivoJuridico,
	type InmovilizacionHistorialFuente,
	type RecuperacionFuente,
	type TipoSolicitud,
} from "./normalizar";
import {
	fechaCorta,
	fechaHoraCorta,
	quetzales,
	type TonoDecision,
} from "./piezas";

export type { EntradaBitacora, TipoBitacora };

/** Entrada de `getHistorialDecisionesConvenio` (bitácora del supervisor, M3). */
export type DecisionConvenioFuente = {
	id: string;
	fecha: string;
	decision: "aprobada" | "rechazada" | "cancelada" | "sin_efecto" | null;
	solicitante: { userId: string | null; nombre: string | null } | null;
	decididoPor: { userId: string | null; nombre: string | null } | null;
	credito: { sifco: string; cliente: string | null } | null;
	/** «6 cuotas de Q 487.40». */
	resumen: string | null;
	/** Nota con la que el asesor armó el convenio. */
	motivo: string | null;
	/** Nota del supervisor al decidir. */
	nota: string | null;
	refId: string;
};

/* ── Entradas ───────────────────────────────────────────────────────────────── */

export type CategoriaHistorial =
	| "solicitud"
	| "contrapropuesta"
	| "reasignacion"
	| "traslado"
	| "baja"
	| "ausencia"
	| "reactivacion_asesor";

export type EstadoHistorial =
	| "pendiente"
	| "aprobada"
	| "por_ejecutar"
	| "ejecutada"
	| "aplicando"
	| "aplicada"
	| "error_aplicacion"
	| "rechazada"
	| "cancelada"
	| "sin_efecto"
	| "aceptada"
	| "descartada"
	| "retirada"
	| "realizada";

export const ESTADO_HISTORIAL: Record<
	EstadoHistorial,
	{ etiqueta: string; tono: TonoDecision }
> = {
	pendiente: { etiqueta: "Pendiente", tono: "warning" },
	aprobada: { etiqueta: "Aprobada", tono: "success" },
	por_ejecutar: { etiqueta: "Aprobada · por ejecutar", tono: "success" },
	ejecutada: { etiqueta: "Ejecutada", tono: "success" },
	aplicando: { etiqueta: "Aprobada · aplicándose", tono: "info" },
	aplicada: { etiqueta: "Aplicada", tono: "success" },
	error_aplicacion: { etiqueta: "No se pudo aplicar", tono: "danger" },
	rechazada: { etiqueta: "Rechazada", tono: "danger" },
	cancelada: { etiqueta: "Cancelada", tono: "neutral" },
	sin_efecto: { etiqueta: "Sin efecto", tono: "neutral" },
	aceptada: { etiqueta: "Aceptada por el asesor", tono: "success" },
	descartada: { etiqueta: "Descartada por el asesor", tono: "neutral" },
	retirada: { etiqueta: "Retirada", tono: "neutral" },
	realizada: { etiqueta: "Realizada", tono: "info" },
};

export type DetalleEntrada =
	| { tipo: "inmovilizacion"; item: InmovilizacionHistorialFuente }
	| { tipo: "recuperacion"; item: RecuperacionFuente }
	| { tipo: "filas"; filas: Array<{ etiqueta: string; valor: string }> };

export type EntradaHistorial = {
	id: string;
	/** ISO de la decisión (o del registro). */
	fecha: string | null;
	/** La fecha es un día sin hora (fin del período de una cobertura). */
	soloDia?: boolean;
	categoria: CategoriaHistorial;
	tipoSolicitud?: TipoSolicitud;
	/** «Aprobación · Apagado», «Reasignación», «Baja de asesor»… */
	tipoEtiqueta: string;
	objeto: { titulo: string; detalle: string | null };
	/** Quien pidió la solicitud (o respondió la contrapropuesta); null en lo que hace el supervisor. */
	asesor: string | null;
	estado: EstadoHistorial;
	motivo: string | null;
	/** Ficha 360 relacionada (id de /cobros/$id). */
	ficha: { id: string; seccion?: "inmovilizacion" } | null;
	/** Lo que la bitácora trae de la fila (siempre se puede mostrar). */
	detalle: DetalleEntrada;
	/**
	 * De dónde salió, para completar el detalle al abrir la fila (ubicación y
	 * evidencia del apagado, checklist de la recuperación) con la consulta de
	 * su tipo.
	 */
	origen?: {
		tipo: TipoBitacora;
		refId: string;
		/** Estado propio de la fuente. */
		estado: string;
		solicitanteId: string | null;
	};
};

export { esBajaDeAsesor };

const MOTIVO_AUSENCIA: Record<string, string> = {
	vacaciones: "Vacaciones",
	permiso: "Permiso",
	incidente: "Incidente",
};

const ESTADO_INMOVILIZACION: Record<string, EstadoHistorial> = {
	pendiente_aprobacion: "pendiente",
	aprobada: "por_ejecutar",
	ejecutada: "ejecutada",
	rechazada: "rechazada",
	cancelada: "cancelada",
};

/** Rebajas y Jurídico: `aprobada` es la aplicación en vuelo. */
const ESTADO_APLICACION: Record<string, EstadoHistorial> = {
	pendiente: "pendiente",
	aprobada: "aplicando",
	aplicada: "aplicada",
	error_aplicacion: "error_aplicacion",
	rechazada: "rechazada",
	cancelada: "cancelada",
};

const ESTADO_CONTRAPROPUESTA: Record<string, EstadoHistorial> = {
	aceptada: "aceptada",
	descartada: "descartada",
	retirada: "retirada",
	sin_efecto: "sin_efecto",
};

const TIPO_SOLICITUD: Partial<Record<TipoBitacora, TipoSolicitud>> = {
	convenio: "convenio",
	apagado: "apagado",
	reactivacion: "reactivacion",
	recuperacion: "recuperacion",
	rebaja: "rebaja",
	juridico: "juridico",
	documento: "documentos",
};

const ETIQUETA_APROBACION: Partial<Record<TipoSolicitud, string>> = {
	reactivacion: "Reactivación",
	juridico: "Escalar a Jurídico",
};

function estadoDeEntrada(b: EntradaBitacora): EstadoHistorial {
	switch (b.tipo) {
		case "apagado":
		case "reactivacion":
			return ESTADO_INMOVILIZACION[b.estado] ?? b.decision ?? "pendiente";
		case "rebaja":
		case "juridico":
			return ESTADO_APLICACION[b.estado] ?? b.decision ?? "pendiente";
		case "contrapropuesta":
			return ESTADO_CONTRAPROPUESTA[b.estado] ?? "sin_efecto";
		case "convenio":
		case "recuperacion":
		case "documento":
			return b.decision ?? "pendiente";
		default:
			return "realizada";
	}
}

/** «Ana Díaz → Luis Morales · 2026-10-01 al 2026-10-10» → sus partes. */
function partesCobertura(resumen: string | null) {
	const m =
		/^(.*?)(?: → (.*?))? · (\d{4}-\d{2}-\d{2}) al (\d{4}-\d{2}-\d{2})$/.exec(
			resumen ?? "",
		);
	if (!m) return null;
	return { titular: m[1], suplente: m[2] ?? null, desde: m[3], hasta: m[4] };
}

const diaCorto = (ymd: string) => fechaCorta(`${ymd}T12:00:00-06:00`);

type Fila = { etiqueta: string; valor: string };
const fila = (etiqueta: string, valor: string | null | undefined) =>
	valor?.trim() ? { etiqueta, valor } : null;
const filas = (lista: Array<Fila | null>) =>
	lista.filter((f): f is Fila => f !== null);

const bucketTexto = (n: number | null | undefined) =>
	n === null || n === undefined ? null : `B${n}`;

const plural = (n: number, uno: string, varios: string) =>
	`${n.toLocaleString("es-GT")} ${n === 1 ? uno : varios}`;

/** «6 cuotas de Q 2,150.00 · primer pago 5 nov». */
function textoPlan(p: PlanConvenioBitacora) {
	return [
		`${plural(p.numeroMeses, "cuota", "cuotas")} de ${quetzales(p.cuotaMensual)}`,
		p.primerPago ? `primer pago ${diaCorto(p.primerPago)}` : null,
	]
		.filter(Boolean)
		.join(" · ");
}

/** Nombre del asesor que dejó la cartera (traslado, cobertura, ausencia). */
function nombreAsesor(b: EntradaBitacora) {
	const a = b.asesorAfectado;
	if (a?.nombre?.trim()) return a.nombre;
	if (a?.asesorId != null) return `Asesor #${a.asesorId}`;
	return null;
}

/** Una entrada de la bitácora como fila del historial. */
export function entradaDeBitacora(b: EntradaBitacora): EntradaHistorial {
	const estado = estadoDeEntrada(b);
	const origen = {
		tipo: b.tipo,
		refId: b.refId,
		estado: b.estado,
		solicitanteId: b.solicitante?.userId ?? null,
	};
	const decidio = b.decididoPor?.nombre
		? `${b.decididoPor.nombre} · ${fechaHoraCorta(b.fecha)}`
		: null;
	const tipoSolicitud = TIPO_SOLICITUD[b.tipo];

	if (tipoSolicitud) {
		const motivoAsesor =
			b.tipo === "juridico" ? etiquetaMotivoJuridico(b.motivo) : b.motivo;
		const cerrada =
			estado === "rechazada" ||
			estado === "cancelada" ||
			estado === "sin_efecto" ||
			estado === "error_aplicacion";
		const inmovilizacion = b.tipo === "apagado" || b.tipo === "reactivacion";
		const montos = b.montos;
		const detalle = filas([
			fila("Cliente", b.credito?.cliente),
			fila("Solicitado por", b.solicitante?.nombre),
			fila(estado === "cancelada" ? "Cancelado por" : "Decidido por", decidio),
			fila("Documento", b.documento),
			fila(b.tipo === "convenio" ? "Plan" : "Resumen", b.resumen),
			montos ? fila("Monto pedido", quetzales(montos.solicitado)) : null,
			montos ? fila("Mora al pedir", quetzales(montos.moraAlPedir)) : null,
			montos?.aplicado
				? fila("Monto aplicado", quetzales(montos.aplicado))
				: null,
			fila(
				b.tipo === "juridico" || b.tipo === "recuperacion"
					? "Bucket al pedir"
					: "Bucket",
				bucketTexto(b.bucket),
			),
			fila(
				b.tipo === "juridico"
					? "Motivo del escalado"
					: b.tipo === "documento"
						? "Comentario del asesor"
						: "Motivo del asesor",
				motivoAsesor,
			),
			fila("Nota para Jurídico", b.notaJuridico),
			fila(
				estado === "error_aplicacion"
					? "Respuesta de cartera"
					: "Nota del supervisor",
				b.nota,
			),
		]);
		// Documentos: el documento va siempre en el motivo (Figma: «Carta de saldo enviada»).
		const motivo =
			b.tipo === "documento"
				? [b.documento, b.nota ?? b.motivo].filter(Boolean).join(" · ") || null
				: cerrada
					? (b.nota ?? motivoAsesor ?? null)
					: (motivoAsesor ?? b.nota ?? null);
		return {
			id: b.id,
			fecha: b.fecha,
			categoria: "solicitud",
			tipoSolicitud,
			tipoEtiqueta: `Aprobación · ${ETIQUETA_APROBACION[tipoSolicitud] ?? ETIQUETA_TIPO[tipoSolicitud]}`,
			objeto: {
				titulo: b.credito ? `Crédito #${b.credito.sifco}` : "Crédito",
				detalle: b.credito?.cliente?.trim() || null,
			},
			asesor: b.solicitante?.nombre ?? null,
			estado,
			motivo,
			ficha: b.credito
				? {
						id: b.credito.sifco,
						...(inmovilizacion ? { seccion: "inmovilizacion" as const } : {}),
					}
				: null,
			detalle: { tipo: "filas", filas: detalle },
			origen,
		};
	}

	if (b.tipo === "contrapropuesta") {
		const p = b.plan;
		// Quien la cerró es el asesor cuando la aceptó o la descartó.
		const respondio =
			estado === "aceptada" || estado === "descartada"
				? (b.decididoPor?.nombre ?? null)
				: null;
		const cambio = p
			? `${plural(p.original.numeroMeses, "cuota", "cuotas")} → ${textoPlan(p.propuesto)}`
			: b.resumen;
		return {
			id: b.id,
			fecha: b.fecha,
			categoria: "contrapropuesta",
			tipoEtiqueta: "Contrapropuesta de convenio",
			objeto: {
				titulo: b.credito ? `Crédito #${b.credito.sifco}` : "Crédito",
				detalle: b.credito?.cliente?.trim() || null,
			},
			asesor: respondio,
			estado,
			motivo:
				estado === "sin_efecto"
					? "El convenio cambió o se envió otra contrapropuesta"
					: (b.nota ?? cambio ?? null),
			ficha: b.credito ? { id: b.credito.sifco } : null,
			detalle: {
				tipo: "filas",
				filas: filas([
					fila("Cliente", b.credito?.cliente),
					fila("Propuesta por", p?.propuestaPor?.nombre ?? null),
					fila("Plan del asesor", p ? textoPlan(p.original) : null),
					fila("Contrapropuesta", p ? textoPlan(p.propuesto) : b.resumen),
					fila("Monto total", p ? quetzales(p.montoTotal) : null),
					fila("Nota del supervisor", p?.nota ?? b.motivo),
					fila(
						estado === "retirada"
							? "Retirada por"
							: estado === "sin_efecto"
								? "Cerrada"
								: "Respondida por",
						decidio ??
							(estado === "sin_efecto" ? fechaHoraCorta(b.fecha) : null),
					),
					fila("Nota de la respuesta", b.nota),
				]),
			},
			origen,
		};
	}

	if (b.tipo === "reasignacion") {
		const cambio = b.resumen ? `de ${b.resumen}` : null;
		return {
			id: b.id,
			fecha: b.fecha,
			categoria: "reasignacion",
			tipoEtiqueta: "Reasignación",
			objeto: {
				titulo: b.credito ? `Crédito #${b.credito.sifco}` : "Crédito",
				detalle: cambio,
			},
			asesor: null,
			estado,
			motivo: b.motivo,
			ficha: b.credito ? { id: b.credito.sifco } : null,
			detalle: {
				tipo: "filas",
				filas: filas([
					fila("Cliente", b.credito?.cliente),
					fila("Cambio de asesor", cambio),
					fila("Bucket", bucketTexto(b.bucket)),
					{ etiqueta: "Origen", valor: "Manual" },
					fila("Usuario", decidio),
				]),
			},
			origen,
		};
	}

	if (b.tipo === "traslado") {
		const baja = b.evento ? b.evento === "baja" : esBajaDeAsesor(b.motivo);
		const asesorOrigen = nombreAsesor(b);
		const n =
			b.cuentas?.movidas ??
			(() => {
				const m = /^(\d+) cuentas?/.exec(b.resumen ?? "")?.[1];
				return m ? Number(m) : null;
			})();
		return {
			id: b.id,
			fecha: b.fecha,
			categoria: baja ? "baja" : "traslado",
			tipoEtiqueta: baja ? "Baja de asesor" : "Traslado de cartera",
			objeto: {
				titulo:
					asesorOrigen ?? (baja ? "Baja de asesor" : "Traslado de cartera"),
				detalle:
					n !== null
						? plural(n, "crédito trasladado", "créditos trasladados")
						: b.resumen,
			},
			asesor: null,
			estado,
			motivo: b.motivo,
			ficha: null,
			detalle: {
				tipo: "filas",
				filas: filas([
					fila("Asesor de origen", asesorOrigen),
					fila("Cuentas", b.resumen),
					fila("Usuario", decidio),
					{ etiqueta: "Operación", valor: b.refId },
				]),
			},
			origen,
		};
	}

	if (b.tipo === "ausencia_indefinida") {
		const titular = nombreAsesor(b) ?? "Asesor";
		const motivoAusencia = MOTIVO_AUSENCIA[b.motivo ?? ""] ?? b.motivo ?? "";
		const desde = b.periodo?.desde ? diaCorto(b.periodo.desde) : null;
		const c = b.cuentas;
		const reactivacion = b.evento === "reactivacion";
		const repartidas =
			c?.movidas != null
				? plural(c.movidas, "crédito repartido", "créditos repartidos")
				: null;
		const devueltas =
			c?.devueltas != null
				? plural(c.devueltas, "devuelto", "devueltos")
				: null;
		const retenidas =
			c?.retenidas != null && c.retenidas > 0
				? `${plural(c.retenidas, "se quedó", "se quedaron")} con otro asesor`
				: null;
		return {
			id: b.id,
			fecha: b.fecha,
			categoria: reactivacion ? "reactivacion_asesor" : "ausencia",
			tipoEtiqueta: reactivacion
				? "Reactivación de asesor"
				: "Ausencia indefinida",
			objeto: {
				titulo: titular,
				detalle: reactivacion
					? [devueltas, retenidas].filter(Boolean).join(" · ") || null
					: repartidas
						? `${repartidas} al equipo`
						: null,
			},
			asesor: null,
			estado,
			motivo: reactivacion
				? `Volvió de su ausencia (${motivoAusencia || "sin motivo"})${desde ? ` · ausente desde el ${desde}` : ""}`
				: [motivoAusencia, "sin fecha de regreso"].filter(Boolean).join(" · "),
			ficha: null,
			detalle: {
				tipo: "filas",
				filas: filas([
					fila("Asesor", titular),
					fila("Motivo", motivoAusencia),
					fila("Ausente desde", desde),
					fila(
						"Reactivado",
						b.periodo?.hasta ? diaCorto(b.periodo.hasta) : null,
					),
					fila("Cuentas repartidas", repartidas),
					reactivacion ? fila("Cuentas devueltas", devueltas) : null,
					reactivacion ? fila("Cuentas retenidas", retenidas) : null,
					fila("Nota", b.nota),
					fila(reactivacion ? "Reactivado por" : "Registrada por", decidio),
				]),
			},
			origen,
		};
	}

	// Cobertura: una «ausencia» (cuando se registró) y, si ya se canceló o
	// terminó su período, una «reactivación» del asesor.
	const partes = partesCobertura(b.resumen);
	const titular = nombreAsesor(b) ?? (partes?.titular || "Asesor");
	const motivo = MOTIVO_AUSENCIA[b.motivo ?? ""] ?? b.motivo ?? "";
	const periodoDesde = b.periodo?.desde ?? partes?.desde ?? null;
	const periodoHasta = b.periodo?.hasta ?? partes?.hasta ?? null;
	const periodo =
		periodoDesde && periodoHasta
			? `del ${diaCorto(periodoDesde)} al ${diaCorto(periodoHasta)}`
			: null;
	const reactivacion = b.evento === "reactivacion";
	return {
		id: b.id,
		fecha: b.fecha,
		soloDia: reactivacion && /^Terminó/.test(b.nota ?? ""),
		categoria: reactivacion ? "reactivacion_asesor" : "ausencia",
		tipoEtiqueta: reactivacion
			? "Reactivación de asesor"
			: "Ausencia de asesor",
		objeto: {
			titulo: titular,
			detalle: reactivacion
				? b.nota
				: partes?.suplente
					? `Lo cubre ${partes.suplente}`
					: null,
		},
		asesor: null,
		estado,
		motivo: [motivo, periodo].filter(Boolean).join(" · ") || null,
		ficha: null,
		detalle: {
			tipo: "filas",
			filas: filas([
				fila("Titular", titular),
				fila("Suplente", partes?.suplente),
				fila(
					"Fechas incluidas",
					periodoDesde && periodoHasta
						? `${periodoDesde} → ${periodoHasta}`
						: null,
				),
				fila("Motivo", motivo),
				fila(
					"Estado",
					reactivacion
						? b.nota
						: b.estado === "cancelada"
							? "Cancelada"
							: "Registrada",
				),
				fila("Registrada por", decidio),
			]),
		},
		origen,
	};
}

/* ── Fuentes paginadas (Solicitudes de un asesor) ───────────────────────────── */

const ms = (fecha: string | null) => {
	if (!fecha) return null;
	const t = new Date(fecha).getTime();
	return Number.isNaN(t) ? null : t;
};

/**
 * Cada fuente se pagina aparte (de la más reciente a la más antigua). Al
 * mezclarlas, una que trajo solo su última semana deja huecos frente a otra que
 * trajo meses: lo de hace un mes de la primera todavía no se cargó. El corte es
 * la fecha hasta la que TODAS las fuentes que tienen más páginas están
 * completas (la más reciente de sus fechas más viejas cargadas); null si
 * ninguna tiene más páginas cargadas.
 */
export function fechaDeCorte(
	incompletas: Array<ReadonlyArray<{ fecha: string | null }>>,
): number | null {
	let corte: number | null = null;
	for (const filas of incompletas) {
		let masVieja: number | null = null;
		for (const f of filas) {
			const t = ms(f.fecha);
			if (t !== null && (masVieja === null || t < masVieja)) masVieja = t;
		}
		if (masVieja !== null && (corte === null || masVieja > corte))
			corte = masVieja;
	}
	return corte;
}

/**
 * Deja solo lo que está antes del corte (`fechaDeCorte`): lo más viejo aparece
 * con «Cargar más», en su lugar, sin saltarse filas de otras fuentes.
 * `conservar` deja pasar filas que se muestran siempre (las pendientes).
 */
export function recortarAlCorte<T extends { fecha: string | null }>(
	filas: T[],
	corte: number | null,
	conservar?: (fila: T) => boolean,
): T[] {
	if (corte === null) return filas;
	return filas.filter((f) => {
		if (conservar?.(f)) return true;
		const t = ms(f.fecha);
		return t !== null && t >= corte;
	});
}

/* ── Filtros ────────────────────────────────────────────────────────────────── */

/** Chips del Figma (3602:5360). */
export type VistaHistorial =
	| "todas"
	| "aprobadas"
	| "rechazadas"
	| "reasignaciones"
	| "bajas"
	| "reactivaciones";

export const VISTAS_HISTORIAL: Array<{ value: VistaHistorial; label: string }> =
	[
		{ value: "todas", label: "Todas" },
		{ value: "aprobadas", label: "Aprobadas" },
		{ value: "rechazadas", label: "Rechazadas" },
		{ value: "reasignaciones", label: "Reasignaciones" },
		{ value: "bajas", label: "Bajas de asesor" },
		{ value: "reactivaciones", label: "Reactivaciones de asesor" },
	];

/**
 * Qué trae cada chip de las acciones sobre asesores (como el Historial de
 * antes): las reasignaciones incluyen los traslados de cartera; las bajas, los
 * despidos y renuncias y las ausencias (coberturas e indefinidas); las
 * reactivaciones, el regreso del asesor.
 */
const CHIP_ACCION: Partial<
	Record<VistaHistorial, { tipos: TipoBitacora[]; eventos: EventoBitacora[] }>
> = {
	reasignaciones: {
		tipos: ["reasignacion", "traslado"],
		eventos: ["traslado"],
	},
	bajas: {
		tipos: ["traslado", "cobertura", "ausencia_indefinida"],
		eventos: ["baja", "ausencia"],
	},
	reactivaciones: {
		tipos: ["cobertura", "ausencia_indefinida"],
		eventos: ["reactivacion"],
	},
};

/** Tipos del filtro (mismo `?tipo=` de la URL que la bandeja). */
export const TIPOS_FILTRO_HISTORIAL = [
	{ value: "todas", label: "Todos los tipos" },
	{ value: "convenio", label: "Convenio" },
	{ value: "contrapropuesta", label: "Contrapropuesta de convenio" },
	{ value: "apagado", label: "Apagado" },
	{ value: "reactivacion", label: "Reactivación de la unidad" },
	{ value: "recuperacion", label: "Recuperación del vehículo" },
	{ value: "rebaja", label: "Rebaja de mora" },
	{ value: "juridico", label: "Jurídico" },
	{ value: "documentos", label: "Documentos" },
] as const;

export type EstadoFiltroHistorial =
	| "todos"
	| "aprobada"
	| "rechazada"
	| "cancelada"
	| "sin_efecto"
	| "realizada";

export const ESTADOS_FILTRO_HISTORIAL: Array<{
	value: EstadoFiltroHistorial;
	label: string;
}> = [
	{ value: "todos", label: "Todos los estados" },
	{ value: "aprobada", label: "Aprobada" },
	{ value: "rechazada", label: "Rechazada" },
	{ value: "cancelada", label: "Cancelada" },
	{ value: "sin_efecto", label: "Sin efecto" },
	{ value: "realizada", label: "Realizada (acción del supervisor)" },
];

export type FiltrosHistorial = {
	vista: VistaHistorial;
	/** `tipo` de la URL (compartido con la bandeja). */
	tipo: string;
	estado: EstadoFiltroHistorial;
	/** Número de crédito (SIFCO) o nombre del cliente; lo busca el servidor. */
	busqueda: string;
	/** Usuario del CRM que pidió la solicitud; null = todos. */
	asesorId: string | null;
	/** Días de Guatemala (YYYY-MM-DD), inclusivos; null = sin límite. */
	desde: string | null;
	hasta: string | null;
};

const TIPOS_SOLICITUD_BITACORA: TipoBitacora[] = [
	"convenio",
	"apagado",
	"reactivacion",
	"recuperacion",
	"rebaja",
	"juridico",
	"documento",
];
/** Lo que hace el supervisor y queda «Realizada». */
const TIPOS_ACCION: TipoBitacora[] = [
	"reasignacion",
	"traslado",
	"cobertura",
	"ausencia_indefinida",
];
const TODOS_LOS_TIPOS: TipoBitacora[] = [
	...TIPOS_SOLICITUD_BITACORA,
	"contrapropuesta",
	...TIPOS_ACCION,
];

/** `?tipo=` de la URL → tipo de la bitácora. */
const TIPO_URL: Record<string, TipoBitacora> = {
	convenio: "convenio",
	contrapropuesta: "contrapropuesta",
	apagado: "apagado",
	reactivacion: "reactivacion",
	recuperacion: "recuperacion",
	rebaja: "rebaja",
	juridico: "juridico",
	documentos: "documento",
};

export type FiltroServidorHistorial = {
	/** Sin tipos = todos. */
	tipos?: TipoBitacora[];
	decisiones?: Decision[];
	solicitanteId?: string;
	desde?: string;
	hasta?: string;
	/** Separa bajas de traslados y ausencias de reactivaciones. */
	eventos?: EventoBitacora[];
	/** Crédito o cliente. */
	busqueda?: string;
	/** La combinación no puede tener resultados: no se consulta. */
	vacio: boolean;
};

function interseccion<T>(a: T[] | null, b: T[] | null): T[] | null {
	if (a === null) return b;
	if (b === null) return a;
	return a.filter((x) => b.includes(x));
}

/**
 * Los filtros de pantalla como filtros de la bitácora. Chips, tipo y estado
 * se combinan (intersección); si no queda nada posible, `vacio`.
 */
export function filtroServidorHistorial(
	f: FiltrosHistorial,
): FiltroServidorHistorial {
	const vistaDecision: Decision[] | null =
		f.vista === "aprobadas"
			? ["aprobada"]
			: f.vista === "rechazadas"
				? ["rechazada"]
				: null;
	const chip = CHIP_ACCION[f.vista] ?? null;
	const estadoDecision: Decision[] | null =
		f.estado === "aprobada" ||
		f.estado === "rechazada" ||
		f.estado === "cancelada" ||
		f.estado === "sin_efecto"
			? [f.estado]
			: null;
	const estadoTipos: TipoBitacora[] | null =
		f.estado === "realizada" ? TIPOS_ACCION : null;
	const decisiones = interseccion(vistaDecision, estadoDecision);

	const tipoElegido = TIPO_URL[f.tipo];
	let tipos = interseccion(
		interseccion(chip?.tipos ?? null, estadoTipos),
		tipoElegido ? [tipoElegido] : null,
	);
	// Con decisión o asesor, el servidor solo trae solicitudes.
	if (decisiones !== null || f.asesorId) {
		tipos = (tipos ?? TODOS_LOS_TIPOS).filter((t) =>
			TIPOS_SOLICITUD_BITACORA.includes(t),
		);
	}
	// La búsqueda es por crédito o cliente: lo que no tiene crédito no entra.
	const busqueda = f.busqueda.trim();
	if (busqueda) {
		tipos = (tipos ?? TODOS_LOS_TIPOS).filter(
			(t) => !TIPOS_SIN_CREDITO.includes(t),
		);
	}
	const vacio =
		(tipos !== null && tipos.length === 0) ||
		(decisiones !== null && decisiones.length === 0);
	return {
		...(tipos !== null && tipos.length < TODOS_LOS_TIPOS.length
			? { tipos }
			: {}),
		...(decisiones?.length ? { decisiones } : {}),
		...(f.asesorId ? { solicitanteId: f.asesorId } : {}),
		...(f.desde ? { desde: f.desde } : {}),
		...(f.hasta ? { hasta: f.hasta } : {}),
		...(chip ? { eventos: chip.eventos } : {}),
		...(busqueda ? { busqueda } : {}),
		vacio,
	};
}

/** Día de Guatemala (YYYY-MM-DD) de un instante ISO. */
export function diaGT(fecha: string | Date | null | undefined) {
	if (!fecha) return null;
	const d = fecha instanceof Date ? fecha : new Date(fecha);
	if (Number.isNaN(d.getTime())) return null;
	return d.toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
}
