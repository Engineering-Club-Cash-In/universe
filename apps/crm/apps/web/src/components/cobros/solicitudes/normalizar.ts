/**
 * Solicitudes que esperan la decisión del supervisor, en una forma común.
 *
 * Hay tres fuentes y cada una trae sus campos:
 *  - convenios por aprobar (`getConveniosListado({ estado: "pending" })`);
 *  - apagados y reactivaciones (`getColaInmovilizaciones`: `pendiente_aprobacion`
 *    espera decisión; `aprobada` espera que el asesor registre la ejecución);
 *  - recuperaciones del vehículo (`getSolicitudesRecuperacion().pendientes`).
 *
 * Lo usan el Dashboard del supervisor (bloque «Aprobaciones pendientes»), la
 * bandeja de /cobros/solicitudes y las solicitudes de cada asesor. Funciones
 * puras: sin consultas ni React.
 */
import type { PasoChecklist } from "server/src/lib/recuperacion-solicitud";
import type {
	BandejaAprobacion,
	FilaAprobacion,
} from "@/components/cobros/supervision/aprobaciones-pendientes";
import type { Destino } from "@/components/cobros/supervision/destino";
import { nombreCorto } from "@/components/cobros/supervision/formato";

/* ── Fuentes (lo que se lee de cada procedimiento) ──────────────────────────── */

/** Fila de `getConveniosListado` (cartera-back, CB-027). */
export type ConvenioFuente = {
	convenio_id: number;
	numero_credito_sifco: string;
	cliente_nombre: string;
	asesor_nombre: string | null;
	fecha_convenio: string;
	asesor_id?: number | null;
	credito_id?: number;
	monto_total_convenio?: string;
	cuota_mensual?: string;
	numero_meses?: number;
	/** Nota con la que el asesor creó el convenio. */
	motivo?: string | null;
	activo?: boolean;
	completado?: boolean;
	/** Último bucket antes de salir del funnel por el convenio. */
	bucket_previo?: number | null;
	bucket_previo_prefijo?: string | null;
};

/** Ubicación guardada con la solicitud de apagado (UbicacionInmovilizacion). */
type UbicacionGuardadaFuente = {
	fuente: "gps" | "manual" | "sin_ubicacion";
	[campo: string]: unknown;
} | null;

/** Fila de `getColaInmovilizaciones` (y la parte común del historial). */
export type InmovilizacionFuente = {
	id: string;
	numeroCreditoSifco: string;
	accion: string;
	estado: string;
	solicitadoAt: string | Date | null;
	solicitanteNombre: string | null;
	clienteNombre: string | null;
	casoCobroId?: string;
	motivo?: string | null;
	quePaso?: string | null;
	respaldoReactivacion?: unknown;
	ubicacionSolicitud?: UbicacionGuardadaFuente;
	bucketSnapshot?: number | null;
};

/** Fila de `getHistorialInmovilizaciones`: todos los estados, con quién decidió y ejecutó. */
export type InmovilizacionHistorialFuente = InmovilizacionFuente & {
	motivoRechazo?: string | null;
	decididoAt?: string | Date | null;
	decididoPorNombre?: string | null;
	ejecutadoAt?: string | Date | null;
	ejecutadoPorNombre?: string | null;
	referenciaEjecucion?: string | null;
	ubicacionEjecucion?: UbicacionGuardadaFuente;
	evidenciaUrl?: string | null;
	evidenciaNombreArchivo?: string | null;
};

/** Fila de `getSolicitudesRecuperacion` (pendientes e historial, CB-043). */
export type RecuperacionFuente = {
	id: string;
	numeroSifco: string | null;
	cliente: string | null;
	solicitante: string | null;
	solicitadoAt: string | Date | null;
	casoCobroId?: string;
	estadoSolicitud?: string | null;
	bucketOrigen?: number | null;
	motivos?: string[];
	motivoDetalle?: string | null;
	observaciones?: string | null;
	checklist?: PasoChecklist[];
	ubicacionDireccion?: string | null;
	ubicacionEnlace?: string | null;
	ubicacionLat?: string | number | null;
	ubicacionLng?: string | number | null;
	estadoVehiculo?: string | null;
	saldoPendiente?: string | number | null;
	cuotasVencidas?: number | null;
	totalParaPonerseAlDia?: string | number | null;
	/** La pidió quien mira: no la puede decidir (regla de cuatro ojos). */
	esMia?: boolean;
	decidioPor?: string | null;
	decididoAt?: string | Date | null;
	motivoDecision?: string | null;
};

/* ── Forma común ────────────────────────────────────────────────────────────── */

export type TipoSolicitud =
	| "convenio"
	| "apagado"
	| "reactivacion"
	| "recuperacion";

type SolicitudBase = {
	/** Único entre fuentes: «convenio-12», «inmovilizacion-uuid»… */
	id: string;
	/** Nombre del cliente, tal como lo trae la fuente. */
	cliente: string;
	/** No. de crédito (SIFCO). */
	credito: string | null;
	/** Caso de cobros (UUID), si la fuente lo trae. */
	casoCobroId: string | null;
	/** Quien la pidió (convenio: el asesor del crédito), nombre completo. */
	asesor: string | null;
	/** ISO; `null` si la fuente no trae fecha. */
	solicitadoEn: string | null;
	/** Monto que se decide (convenio: total; recuperación: para ponerse al día). */
	monto: number | null;
	/** Bucket del crédito al solicitar. */
	bucket: number | null;
};

export type Solicitud =
	| (SolicitudBase & { tipo: "convenio"; convenio: ConvenioFuente })
	| (SolicitudBase & {
			tipo: "apagado" | "reactivacion";
			inmovilizacion: InmovilizacionFuente;
			/** Aprobada y esperando que el asesor registre la ejecución. */
			porEjecutar: boolean;
	  })
	| (SolicitudBase & {
			tipo: "recuperacion";
			recuperacion: RecuperacionFuente;
	  });

export const ETIQUETA_TIPO: Record<TipoSolicitud, string> = {
	convenio: "Convenio",
	apagado: "Apagado",
	reactivacion: "Reactivación",
	recuperacion: "Recuperación del vehículo",
};

export function aIso(v: string | Date | null | undefined) {
	if (!v) return null;
	return typeof v === "string" ? v : v.toISOString();
}

function numero(v: string | number | null | undefined) {
	if (v === null || v === undefined || v === "") return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

export function solicitudDeConvenio(c: ConvenioFuente): Solicitud {
	return {
		id: `convenio-${c.convenio_id}`,
		tipo: "convenio",
		convenio: c,
		cliente: c.cliente_nombre,
		credito: c.numero_credito_sifco,
		casoCobroId: null,
		asesor: c.asesor_nombre,
		solicitadoEn: c.fecha_convenio,
		monto: numero(c.monto_total_convenio),
		bucket: c.bucket_previo ?? null,
	};
}

export function solicitudDeInmovilizacion(i: InmovilizacionFuente): Solicitud {
	return {
		id: `inmovilizacion-${i.id}`,
		tipo: i.accion === "reactivacion" ? "reactivacion" : "apagado",
		inmovilizacion: i,
		porEjecutar: i.estado === "aprobada",
		cliente: i.clienteNombre ?? "Sin nombre",
		credito: i.numeroCreditoSifco,
		casoCobroId: i.casoCobroId ?? null,
		asesor: i.solicitanteNombre,
		solicitadoEn: aIso(i.solicitadoAt),
		monto: null,
		bucket: i.bucketSnapshot ?? null,
	};
}

export function solicitudDeRecuperacion(r: RecuperacionFuente): Solicitud {
	return {
		id: `recuperacion-${r.id}`,
		tipo: "recuperacion",
		recuperacion: r,
		cliente: r.cliente ?? "Sin nombre",
		credito: r.numeroSifco,
		casoCobroId: r.casoCobroId ?? null,
		asesor: r.solicitante,
		solicitadoEn: aIso(r.solicitadoAt),
		monto: numero(r.totalParaPonerseAlDia),
		bucket: r.bucketOrigen ?? null,
	};
}

/** Las más antiguas primero; sin fecha, al final (orden estable). */
export function ordenarPorAntiguedad<T extends { solicitadoEn: string | null }>(
	filas: T[],
): T[] {
	return [...filas].sort((a, b) => {
		if (!a.solicitadoEn) return 1;
		if (!b.solicitadoEn) return -1;
		return (
			new Date(a.solicitadoEn).getTime() - new Date(b.solicitadoEn).getTime()
		);
	});
}

/**
 * Las tres fuentes en una sola lista. `pendientes` esperan la decisión del
 * supervisor (las más antiguas primero); `porEjecutar` son los apagados y
 * reactivaciones ya aprobados que el asesor todavía no registró como
 * ejecutados (lo que el supervisor seguía en «Por ejecutar»).
 */
export function solicitudesDeFuentes(fuentes: {
	convenios: ConvenioFuente[];
	inmovilizaciones: InmovilizacionFuente[];
	recuperaciones: RecuperacionFuente[];
}): { pendientes: Solicitud[]; porEjecutar: Solicitud[] } {
	const pendientes = [
		...fuentes.convenios.map(solicitudDeConvenio),
		...fuentes.recuperaciones.map(solicitudDeRecuperacion),
		...fuentes.inmovilizaciones
			.filter((i) => i.estado === "pendiente_aprobacion")
			.map(solicitudDeInmovilizacion),
	];
	const porEjecutar = fuentes.inmovilizaciones
		.filter((i) => i.estado === "aprobada")
		.map(solicitudDeInmovilizacion);
	return {
		pendientes: ordenarPorAntiguedad(pendientes),
		porEjecutar: ordenarPorAntiguedad(porEjecutar),
	};
}

/* ── Dashboard del supervisor ───────────────────────────────────────────────── */

/** A dónde lleva cada fila y cada bandeja del bloque del Dashboard. */
export type DestinosAprobacion = {
	convenio: Destino;
	recuperacion: Destino;
	inmovilizacion: Destino;
};

/**
 * El bloque «Aprobaciones pendientes» del Dashboard: las filas (las más
 * antiguas primero), el total y el acceso por bandeja. Cada fuente es
 * `undefined` mientras carga (su conteo queda en `null`).
 */
export function aprobacionesParaDashboard(fuentes: {
	convenios?: { items?: unknown[]; total?: number };
	recuperaciones?: { pendientes?: unknown[] };
	inmovilizaciones?: unknown[];
	destinos: DestinosAprobacion;
}): { filas: FilaAprobacion[]; total: number; bandejas: BandejaAprobacion[] } {
	const { destinos } = fuentes;
	const convenios = (fuentes.convenios?.items ?? []) as ConvenioFuente[];
	const recuperaciones = (fuentes.recuperaciones?.pendientes ??
		[]) as RecuperacionFuente[];
	const inmovilizaciones = (
		(fuentes.inmovilizaciones ?? []) as InmovilizacionFuente[]
	).filter((i) => i.estado === "pendiente_aprobacion");

	const fila = (s: Solicitud, destino: Destino): FilaAprobacion => ({
		id: s.id,
		tipo: s.tipo,
		cliente: s.cliente,
		credito: s.credito,
		asesor: nombreCorto(s.asesor) || null,
		solicitadoEn: s.solicitadoEn,
		destino,
	});
	const filas = ordenarPorAntiguedad([
		...convenios.map((c) => fila(solicitudDeConvenio(c), destinos.convenio)),
		...recuperaciones.map((r) =>
			fila(solicitudDeRecuperacion(r), destinos.recuperacion),
		),
		...inmovilizaciones.map((i) =>
			fila(solicitudDeInmovilizacion(i), destinos.inmovilizacion),
		),
	]);

	const totalConvenios = fuentes.convenios?.total ?? convenios.length;
	const bandejas: BandejaAprobacion[] = [
		{
			clave: "convenios",
			etiqueta: "Convenios",
			cantidad: fuentes.convenios ? totalConvenios : null,
			destino: destinos.convenio,
		},
		{
			clave: "recuperaciones",
			etiqueta: "Recuperación del vehículo",
			cantidad: fuentes.recuperaciones ? recuperaciones.length : null,
			destino: destinos.recuperacion,
		},
		{
			clave: "inmovilizaciones",
			etiqueta: "Apagado y reactivación",
			cantidad: fuentes.inmovilizaciones ? inmovilizaciones.length : null,
			destino: destinos.inmovilizacion,
		},
	];
	return {
		filas,
		total: totalConvenios + recuperaciones.length + inmovilizaciones.length,
		bandejas,
	};
}

/* ── Búsqueda y asesores ────────────────────────────────────────────────────── */

/** Minúsculas y sin tildes, para comparar nombres y buscar. */
export function normalizarTexto(v: string | null | undefined) {
	return (v ?? "")
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

/** ¿La solicitud coincide con la búsqueda (cliente, crédito o SIFCO)? */
export function coincideBusqueda(s: Solicitud, busqueda: string) {
	const q = normalizarTexto(busqueda);
	if (!q) return true;
	return [s.cliente, s.credito, s.asesor].some((v) =>
		normalizarTexto(v).includes(q),
	);
}

/**
 * ¿La pidió este asesor? Apagados, reactivaciones y recuperaciones solo traen
 * el NOMBRE del usuario que las pidió (no su id), así que se compara el
 * nombre sin tildes ni mayúsculas.
 * TODO(José) · tarea M3: devolver el id del solicitante en
 * getColaInmovilizaciones, getHistorialInmovilizaciones y
 * getSolicitudesRecuperacion para no depender del nombre.
 */
export function esDelAsesor(
	nombreSolicitante: string | null | undefined,
	nombres: Array<string | null | undefined>,
) {
	const n = normalizarTexto(nombreSolicitante);
	if (!n) return false;
	return nombres.some((x) => normalizarTexto(x) === n);
}
