/**
 * «Historial de decisiones» (Figma 3602:5360): lo que decidió o hizo el
 * supervisor, unido en el navegador desde varias fuentes. Funciones puras.
 *
 *  - Apagados y reactivaciones: `getHistorialInmovilizaciones` (todos los
 *    estados, paginado).
 *  - Recuperaciones del vehículo: `getSolicitudesRecuperacion().historial`
 *    (las últimas 100 decididas).
 *  - Reasignaciones manuales: `getHistorialReasignaciones({ origen: "API_MANUAL" })`.
 *  - Traslados de cartera: `listarTraslados` (despido o renuncia = baja de asesor).
 *  - Coberturas: `listarCoberturas` (registro = ausencia; cancelada o con el
 *    período terminado = reactivación del asesor).
 *
 * Las decisiones de convenios no tienen fuente global: cartera borra el
 * convenio al rechazarlo y su historial se consulta por crédito.
 * TODO(José) · tarea M3: bitácora unificada y paginada de decisiones del
 * supervisor, con el historial global de decisiones de convenios.
 */
import { etiquetaMotivo } from "server/src/lib/recuperacion-vehiculo";
import {
	aIso,
	type InmovilizacionHistorialFuente,
	normalizarTexto,
	type RecuperacionFuente,
	type TipoSolicitud,
} from "./normalizar";
import { fechaCorta, type TonoDecision } from "./piezas";

/* ── Fuentes extra ──────────────────────────────────────────────────────────── */

/** Fila de `getHistorialReasignaciones` (AsesorCambioRow de cartera-back). */
export type ReasignacionFuente = {
	historial_id: number | string;
	fecha: string;
	numero_credito_sifco: string;
	cliente: string | null;
	asesor_anterior: string | null;
	asesor_nuevo: string | null;
	bucket: number | null;
	bucket_prefijo?: string | null;
	origen: string;
	motivo: string | null;
	usuario: string | null;
};

/** Fila de `listarTraslados` (HistorialTraslado). */
export type TrasladoFuente = {
	id: string;
	motivo: string;
	asesor_origen_id: number;
	actor_email: string;
	created_at: string;
	cuentas: number;
};

/** Fila de `listarCoberturas` (coberturas_agenda_cobros). */
export type CoberturaFuente = {
	id: string;
	titularId: string;
	suplenteId: string;
	motivo: string;
	desde: string;
	hasta: string;
	canceladaEn: string | Date | null;
	createdAt: string | Date;
};

/* ── Entradas ───────────────────────────────────────────────────────────────── */

export type CategoriaHistorial =
	| "solicitud"
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
	| "rechazada"
	| "cancelada"
	| "sin_efecto"
	| "realizada";

export const ESTADO_HISTORIAL: Record<
	EstadoHistorial,
	{ etiqueta: string; tono: TonoDecision }
> = {
	pendiente: { etiqueta: "Pendiente", tono: "warning" },
	aprobada: { etiqueta: "Aprobada", tono: "success" },
	por_ejecutar: { etiqueta: "Aprobada · por ejecutar", tono: "success" },
	ejecutada: { etiqueta: "Ejecutada", tono: "success" },
	rechazada: { etiqueta: "Rechazada", tono: "danger" },
	cancelada: { etiqueta: "Cancelada", tono: "neutral" },
	sin_efecto: { etiqueta: "Sin efecto", tono: "neutral" },
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
	/** Quien pidió la solicitud; null en lo que hace el supervisor. */
	asesor: string | null;
	estado: EstadoHistorial;
	motivo: string | null;
	/** Ficha 360 relacionada (id de /cobros/$id). */
	ficha: { id: string; seccion?: "inmovilizacion" } | null;
	detalle: DetalleEntrada;
};

const ESTADO_INMOVILIZACION: Record<string, EstadoHistorial> = {
	pendiente_aprobacion: "pendiente",
	aprobada: "por_ejecutar",
	ejecutada: "ejecutada",
	rechazada: "rechazada",
	cancelada: "cancelada",
};

export function entradaDeInmovilizacion(
	i: InmovilizacionHistorialFuente,
): EntradaHistorial {
	const reactivacion = i.accion === "reactivacion";
	return {
		id: `inmovilizacion-${i.id}`,
		fecha: aIso(i.decididoAt) ?? aIso(i.solicitadoAt),
		categoria: "solicitud",
		tipoSolicitud: reactivacion ? "reactivacion" : "apagado",
		tipoEtiqueta: `Aprobación · ${reactivacion ? "Reactivación" : "Apagado"}`,
		objeto: {
			titulo: `Crédito #${i.numeroCreditoSifco}`,
			detalle: i.clienteNombre,
		},
		asesor: i.solicitanteNombre,
		estado: ESTADO_INMOVILIZACION[i.estado] ?? "pendiente",
		motivo:
			i.estado === "rechazada" ? (i.motivoRechazo ?? null) : (i.motivo ?? null),
		ficha: {
			id: i.casoCobroId ?? i.numeroCreditoSifco,
			seccion: "inmovilizacion",
		},
		detalle: { tipo: "inmovilizacion", item: i },
	};
}

const ESTADOS_RECUPERACION = new Set<EstadoHistorial>([
	"pendiente",
	"aprobada",
	"rechazada",
	"cancelada",
	"sin_efecto",
]);

export function entradaDeRecuperacion(r: RecuperacionFuente): EntradaHistorial {
	const estado = ESTADOS_RECUPERACION.has(r.estadoSolicitud as EstadoHistorial)
		? (r.estadoSolicitud as EstadoHistorial)
		: "pendiente";
	const motivos = (r.motivos ?? [])
		.filter((m) => m !== "otro")
		.map(etiquetaMotivo)
		.join(", ");
	return {
		id: `recuperacion-${r.id}`,
		fecha: aIso(r.decididoAt) ?? aIso(r.solicitadoAt),
		categoria: "solicitud",
		tipoSolicitud: "recuperacion",
		tipoEtiqueta: "Aprobación · Recuperación del vehículo",
		objeto: {
			titulo: r.numeroSifco ? `Crédito #${r.numeroSifco}` : "Crédito",
			detalle: r.cliente?.trim() || null,
		},
		asesor: r.solicitante,
		estado,
		motivo: r.motivoDecision || motivos || r.motivoDetalle || null,
		ficha: r.casoCobroId
			? { id: r.casoCobroId }
			: r.numeroSifco
				? { id: r.numeroSifco }
				: null,
		detalle: { tipo: "recuperacion", item: r },
	};
}

export function entradaDeReasignacion(r: ReasignacionFuente): EntradaHistorial {
	const cambio = `de ${r.asesor_anterior ?? "Sin asesor"} → ${r.asesor_nuevo ?? "—"}`;
	return {
		id: `reasignacion-${r.historial_id}`,
		fecha: r.fecha,
		categoria: "reasignacion",
		tipoEtiqueta: "Reasignación",
		objeto: { titulo: `Crédito #${r.numero_credito_sifco}`, detalle: cambio },
		asesor: null,
		estado: "realizada",
		motivo: r.motivo,
		ficha: { id: r.numero_credito_sifco },
		detalle: {
			tipo: "filas",
			filas: [
				{ etiqueta: "Cliente", valor: r.cliente || "—" },
				{ etiqueta: "Cambio de asesor", valor: cambio },
				{
					etiqueta: "Bucket",
					valor: r.bucket_prefijo || (r.bucket !== null ? `B${r.bucket}` : "—"),
				},
				{
					etiqueta: "Origen",
					valor: r.origen === "API_MANUAL" ? "Manual" : "Automático",
				},
				{ etiqueta: "Usuario", valor: r.usuario || "sistema" },
			],
		},
	};
}

/** Despido o renuncia (el motivo se guarda como «Despido: …» o «Renuncia: …»). */
export function esBajaDeAsesor(motivo: string | null | undefined) {
	return /^(despido|renuncia)\b/i.test((motivo ?? "").trim());
}

export function entradaDeTraslado(
	t: TrasladoFuente,
	nombreAsesor: (asesorId: number) => string | null,
): EntradaHistorial {
	const baja = esBajaDeAsesor(t.motivo);
	const origen =
		nombreAsesor(t.asesor_origen_id) ?? `Asesor #${t.asesor_origen_id}`;
	return {
		id: `traslado-${t.id}`,
		fecha: t.created_at,
		categoria: baja ? "baja" : "traslado",
		tipoEtiqueta: baja ? "Baja de asesor" : "Traslado de cartera",
		objeto: {
			titulo: origen,
			detalle: `${t.cuentas.toLocaleString("es-GT")} ${t.cuentas === 1 ? "crédito trasladado" : "créditos trasladados"}`,
		},
		asesor: null,
		estado: "realizada",
		motivo: t.motivo,
		ficha: null,
		detalle: {
			tipo: "filas",
			filas: [
				{ etiqueta: "Asesor de origen", valor: origen },
				{ etiqueta: "Cuentas", valor: String(t.cuentas) },
				{ etiqueta: "Usuario", valor: t.actor_email || "—" },
				{ etiqueta: "Operación", valor: t.id },
			],
		},
	};
}

const MOTIVO_COBERTURA: Record<string, string> = {
	vacaciones: "Vacaciones",
	permiso: "Permiso",
};

/**
 * Una cobertura da una «Ausencia de asesor» (cuando se registró) y, si ya se
 * canceló o terminó su período, una «Reactivación de asesor».
 */
export function entradasDeCobertura(
	c: CoberturaFuente,
	nombreUsuario: (userId: string) => string | null,
	hoy: string,
): EntradaHistorial[] {
	const titular = nombreUsuario(c.titularId) ?? "Asesor";
	const suplente = nombreUsuario(c.suplenteId) ?? "otro asesor";
	const motivo = MOTIVO_COBERTURA[c.motivo] ?? c.motivo;
	const dia = (ymd: string) => fechaCorta(`${ymd}T12:00:00-06:00`);
	const periodo = `del ${dia(c.desde)} al ${dia(c.hasta)}`;
	const filas = [
		{ etiqueta: "Titular", valor: titular },
		{ etiqueta: "Suplente", valor: suplente },
		{ etiqueta: "Fechas incluidas", valor: `${c.desde} → ${c.hasta}` },
		{ etiqueta: "Motivo", valor: motivo },
		{
			etiqueta: "Estado",
			valor: c.canceladaEn
				? "Cancelada"
				: c.hasta < hoy
					? "Período finalizado"
					: "Registrada",
		},
	];
	const ausencia: EntradaHistorial = {
		id: `cobertura-${c.id}`,
		fecha: aIso(c.createdAt),
		categoria: "ausencia",
		tipoEtiqueta: "Ausencia de asesor",
		objeto: { titulo: titular, detalle: `Lo cubre ${suplente}` },
		asesor: null,
		estado: "realizada",
		motivo: `${motivo} · ${periodo}`,
		ficha: null,
		detalle: { tipo: "filas", filas },
	};
	const entradas = [ausencia];
	if (c.canceladaEn || c.hasta < hoy) {
		entradas.push({
			id: `reactivacion-${c.id}`,
			fecha: c.canceladaEn ? aIso(c.canceladaEn) : `${c.hasta}T23:59:00-06:00`,
			soloDia: !c.canceladaEn,
			categoria: "reactivacion_asesor",
			tipoEtiqueta: "Reactivación de asesor",
			objeto: {
				titulo: titular,
				detalle: c.canceladaEn
					? "Se canceló la cobertura"
					: "Terminó el período de la cobertura",
			},
			asesor: null,
			estado: "realizada",
			motivo: `${motivo} · ${periodo}`,
			ficha: null,
			detalle: { tipo: "filas", filas },
		});
	}
	return entradas;
}

/** Las más recientes primero; sin fecha, al final. */
export function ordenarHistorial(entradas: EntradaHistorial[]) {
	return [...entradas].sort((a, b) => {
		if (!a.fecha) return 1;
		if (!b.fecha) return -1;
		return new Date(b.fecha).getTime() - new Date(a.fecha).getTime();
	});
}

/* ── Filtros ────────────────────────────────────────────────────────────────── */

/** Chips del Figma. */
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

export type EstadoFiltroHistorial = "todos" | EstadoHistorial;

export const ESTADOS_FILTRO_HISTORIAL: Array<{
	value: EstadoFiltroHistorial;
	label: string;
}> = [
	{ value: "todos", label: "Todos los estados" },
	{ value: "pendiente", label: "Pendiente" },
	{ value: "aprobada", label: "Aprobada" },
	{ value: "por_ejecutar", label: "Aprobada · por ejecutar" },
	{ value: "ejecutada", label: "Ejecutada" },
	{ value: "rechazada", label: "Rechazada" },
	{ value: "cancelada", label: "Cancelada" },
	{ value: "sin_efecto", label: "Sin efecto" },
	{ value: "realizada", label: "Realizada" },
];

export type FiltrosHistorial = {
	vista: VistaHistorial;
	/** `tipo` de la URL (compartido con la bandeja). */
	tipo: string;
	estado: EstadoFiltroHistorial;
	busqueda: string;
};

const APROBADAS = new Set<EstadoHistorial>([
	"aprobada",
	"por_ejecutar",
	"ejecutada",
]);

export function cumpleVista(e: EntradaHistorial, vista: VistaHistorial) {
	switch (vista) {
		case "todas":
			return true;
		case "aprobadas":
			return APROBADAS.has(e.estado);
		case "rechazadas":
			return e.estado === "rechazada";
		case "reasignaciones":
			return e.categoria === "reasignacion" || e.categoria === "traslado";
		case "bajas":
			return e.categoria === "baja" || e.categoria === "ausencia";
		case "reactivaciones":
			return e.categoria === "reactivacion_asesor";
	}
}

export function filtrarHistorial(
	entradas: EntradaHistorial[],
	f: FiltrosHistorial,
) {
	const q = normalizarTexto(f.busqueda);
	return entradas.filter((e) => {
		if (!cumpleVista(e, f.vista)) return false;
		if (f.tipo === "por_ejecutar" && e.estado !== "por_ejecutar") return false;
		if (
			(f.tipo === "convenio" ||
				f.tipo === "apagado" ||
				f.tipo === "reactivacion" ||
				f.tipo === "recuperacion") &&
			e.tipoSolicitud !== f.tipo
		)
			return false;
		if (f.tipo === "rebaja" || f.tipo === "documentos") return false;
		if (f.estado !== "todos" && e.estado !== f.estado) return false;
		if (!q) return true;
		return [
			e.objeto.titulo,
			e.objeto.detalle,
			e.asesor,
			e.tipoEtiqueta,
			ESTADO_HISTORIAL[e.estado].etiqueta,
			e.motivo,
		].some((v) => normalizarTexto(v).includes(q));
	});
}
