/**
 * Solicitudes que esperan la decisión del supervisor, en una forma común.
 *
 * Cada fuente trae sus campos:
 *  - convenios por aprobar (`getConveniosListado({ estado: "pending" })`);
 *  - apagados y reactivaciones (`getColaInmovilizaciones`: `pendiente_aprobacion`
 *    espera decisión; `aprobada` espera que el asesor registre la ejecución);
 *  - recuperaciones del vehículo (`getSolicitudesRecuperacion().pendientes`);
 *  - rebajas de mora (`getSolicitudesRebajaMora`, W2) y escalados a Jurídico
 *    (`getSolicitudesJuridico`, W3): `pendiente` y `error_aplicacion` (no se
 *    pudo aplicar en cartera: se reintenta o se rechaza) esperan al supervisor;
 *  - solicitudes de documentos (`getSolicitudesDocumentos`, F6): `pendiente`.
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
	/** Usuario del CRM que la pidió (M3); sirve para asociarla al asesor sin comparar nombres. */
	solicitadoPorId?: string | null;
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
	/** Usuario del CRM que la pidió (M3). */
	solicitanteId?: string | null;
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

/** Fila de `getSolicitudesRebajaMora` (W2). */
export type RebajaFuente = {
	id: string;
	casoCobroId: string;
	numeroCreditoSifco: string | null;
	/** pendiente · aprobada (aplicándose) · aplicada · error_aplicacion · rechazada · cancelada */
	estado: string;
	/** Mora del crédito cuando se pidió. */
	moraSnapshot: string;
	montoSolicitado: string;
	montoAplicado?: string | null;
	/** Motivo del asesor. */
	notas: string;
	solicitadoEn: string | Date | null;
	/** Usuario del CRM que la pidió (regla de cuatro ojos). */
	solicitadoPorId?: string | null;
	solicitadoPor: string | null;
	resueltoEn?: string | Date | null;
	resueltoPor?: string | null;
	/** Nota del supervisor o, en `error_aplicacion`, el motivo de cartera. */
	notaResolucion?: string | null;
	clienteNombre: string | null;
};

/** Fila de `getSolicitudesJuridico` (W3). */
export type JuridicoFuente = {
	id: string;
	casoCobroId: string;
	numeroCreditoSifco: string | null;
	/** Bucket del crédito cuando se pidió (B3 o B4). */
	bucketSnapshot: number | null;
	/** no_contacto · no_quiere_pagar · sin_acuerdo */
	motivo: string;
	/** Nota del asesor para Jurídico. */
	notaJuridico: string;
	estado: string;
	solicitadoEn: string | Date | null;
	solicitadoPorId?: string | null;
	solicitadoPor: string | null;
	resueltoEn?: string | Date | null;
	resueltoPor?: string | null;
	notaResolucion?: string | null;
	clienteNombre: string | null;
};

/** Fila de `getSolicitudesDocumentos` (F6). */
export type DocumentoFuente = {
	id: string;
	casoCobroId: string;
	numeroCreditoSifco: string | null;
	clave?: string;
	comentario: string | null;
	estado?: string;
	solicitadoEn: string | Date | null;
	/** Usuario del CRM que la pidió («Su solicitud»). */
	solicitadoPorId?: string | null;
	/** Nombre de quien la pidió. */
	solicitadoPor: string | null;
	resueltoEn?: string | Date | null;
	resueltoPor?: string | null;
	notaResolucion?: string | null;
	/** Nombre para mostrar del documento («Contrato de crédito»). */
	documento: string;
	/** Nombre del cliente del crédito (mismo criterio que rebajas y Jurídico). */
	clienteNombre?: string | null;
};

/** Motivos del escalado a Jurídico (`MOTIVOS_JURIDICO` del servidor). */
const MOTIVO_JURIDICO: Record<string, string> = {
	no_contacto: "No contacto",
	no_quiere_pagar: "No quiere pagar",
	sin_acuerdo: "Sin acuerdo",
};

export function etiquetaMotivoJuridico(motivo: string | null | undefined) {
	if (!motivo) return "—";
	return MOTIVO_JURIDICO[motivo] ?? motivo;
}

/** Rebajas y escalados que todavía esperan al supervisor. */
export const ESTADOS_ACCIONABLES_APLICACION = ["pendiente", "error_aplicacion"];

/* ── Forma común ────────────────────────────────────────────────────────────── */

export type TipoSolicitud =
	| "convenio"
	| "apagado"
	| "reactivacion"
	| "recuperacion"
	| "rebaja"
	| "juridico"
	| "documentos";

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
	  })
	| (SolicitudBase & {
			tipo: "rebaja";
			rebaja: RebajaFuente;
			/** Cartera no la pudo aplicar: se reintenta o se rechaza. */
			errorAplicacion: boolean;
	  })
	| (SolicitudBase & {
			tipo: "juridico";
			juridico: JuridicoFuente;
			errorAplicacion: boolean;
	  })
	| (SolicitudBase & { tipo: "documentos"; documento: DocumentoFuente });

export const ETIQUETA_TIPO: Record<TipoSolicitud, string> = {
	convenio: "Convenio",
	apagado: "Apagado",
	reactivacion: "Reactivación",
	recuperacion: "Recuperación del vehículo",
	rebaja: "Rebaja de mora",
	juridico: "Jurídico",
	documentos: "Documentos",
};

/** Usuario del CRM que pidió la solicitud, si la fuente lo trae (cuatro ojos). */
export function idSolicitante(s: Solicitud): string | null {
	switch (s.tipo) {
		case "rebaja":
			return s.rebaja.solicitadoPorId ?? null;
		case "juridico":
			return s.juridico.solicitadoPorId ?? null;
		case "recuperacion":
			return s.recuperacion.solicitanteId ?? null;
		case "apagado":
		case "reactivacion":
			return s.inmovilizacion.solicitadoPorId ?? null;
		case "documentos":
			return s.documento.solicitadoPorId ?? null;
		default:
			return null;
	}
}

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

export function solicitudDeRebaja(r: RebajaFuente): Solicitud {
	return {
		id: `rebaja-${r.id}`,
		tipo: "rebaja",
		rebaja: r,
		errorAplicacion: r.estado === "error_aplicacion",
		cliente: r.clienteNombre?.trim() || "Sin nombre",
		credito: r.numeroCreditoSifco,
		casoCobroId: r.casoCobroId,
		asesor: r.solicitadoPor,
		solicitadoEn: aIso(r.solicitadoEn),
		monto: numero(r.montoSolicitado),
		bucket: null,
	};
}

export function solicitudDeJuridico(j: JuridicoFuente): Solicitud {
	return {
		id: `juridico-${j.id}`,
		tipo: "juridico",
		juridico: j,
		errorAplicacion: j.estado === "error_aplicacion",
		cliente: j.clienteNombre?.trim() || "Sin nombre",
		credito: j.numeroCreditoSifco,
		casoCobroId: j.casoCobroId,
		asesor: j.solicitadoPor,
		solicitadoEn: aIso(j.solicitadoEn),
		monto: null,
		bucket: j.bucketSnapshot ?? null,
	};
}

/** El documento pedido va en la segunda línea de la fila (con el crédito). */
export function solicitudDeDocumento(d: DocumentoFuente): Solicitud {
	return {
		id: `documento-${d.id}`,
		tipo: "documentos",
		documento: d,
		cliente: d.clienteNombre?.trim() || "Sin nombre",
		credito: d.numeroCreditoSifco,
		casoCobroId: d.casoCobroId,
		asesor: d.solicitadoPor,
		solicitadoEn: aIso(d.solicitadoEn),
		monto: null,
		bucket: null,
	};
}

/** Rebajas y escalados que esperan al supervisor (pendientes o con error al aplicar). */
export function rebajasAccionables(filas: unknown[] | undefined) {
	return ((filas ?? []) as RebajaFuente[]).filter((r) =>
		ESTADOS_ACCIONABLES_APLICACION.includes(r.estado),
	);
}

export function juridicoAccionables(filas: unknown[] | undefined) {
	return ((filas ?? []) as JuridicoFuente[]).filter((j) =>
		ESTADOS_ACCIONABLES_APLICACION.includes(j.estado),
	);
}

/** Documentos pendientes (la consulta ya filtra; se vuelve a mirar por si acaso). */
export function documentosPendientes(filas: unknown[] | undefined) {
	return ((filas ?? []) as DocumentoFuente[]).filter(
		(d) => !d.estado || d.estado === "pendiente",
	);
}

/** Las más antiguas primero; sin fecha, al final (orden estable). */
export function ordenarPorAntiguedad<T extends { solicitadoEn: string | null }>(
	filas: T[],
): T[] {
	return [...filas].sort((a, b) => {
		if (!a.solicitadoEn && !b.solicitadoEn) return 0;
		if (!a.solicitadoEn) return 1;
		if (!b.solicitadoEn) return -1;
		return (
			new Date(a.solicitadoEn).getTime() - new Date(b.solicitadoEn).getTime()
		);
	});
}

/**
 * Todas las fuentes en una sola lista. `pendientes` esperan la decisión del
 * supervisor (las más antiguas primero); `porEjecutar` son los apagados y
 * reactivaciones ya aprobados que el asesor todavía no registró como
 * ejecutados (lo que el supervisor seguía en «Por ejecutar»). Rebajas,
 * Jurídico y documentos son opcionales y llegan crudos: aquí se quedan solo
 * los que esperan al supervisor.
 */
export function solicitudesDeFuentes(fuentes: {
	convenios: ConvenioFuente[];
	inmovilizaciones: InmovilizacionFuente[];
	recuperaciones: RecuperacionFuente[];
	rebajas?: unknown[];
	juridico?: unknown[];
	documentos?: unknown[];
}): { pendientes: Solicitud[]; porEjecutar: Solicitud[] } {
	const pendientes = [
		...fuentes.convenios.map(solicitudDeConvenio),
		...fuentes.recuperaciones.map(solicitudDeRecuperacion),
		...fuentes.inmovilizaciones
			.filter((i) => i.estado === "pendiente_aprobacion")
			.map(solicitudDeInmovilizacion),
		...rebajasAccionables(fuentes.rebajas).map(solicitudDeRebaja),
		...juridicoAccionables(fuentes.juridico).map(solicitudDeJuridico),
		...documentosPendientes(fuentes.documentos).map(solicitudDeDocumento),
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
	rebaja: Destino;
	documentos: Destino;
	juridico: Destino;
};

/**
 * El bloque «Aprobaciones pendientes» del Dashboard: las filas (las más
 * antiguas primero), el total y el acceso por bandeja. Cada fuente es
 * `undefined` mientras carga (su conteo queda en `null` y no suma al total).
 * Rebajas, documentos y Jurídico llegan crudos (mismas consultas que la
 * bandeja de /cobros/solicitudes): aquí se filtran los que esperan al
 * supervisor, igual que en la bandeja, para que los conteos coincidan.
 */
export function aprobacionesParaDashboard(fuentes: {
	convenios?: { items?: unknown[]; total?: number };
	recuperaciones?: { pendientes?: unknown[] };
	inmovilizaciones?: unknown[];
	/** `getSolicitudesRebajaMora({ limite: 200 })`. */
	rebajas?: unknown[];
	/** `getSolicitudesDocumentos({ estado: "pendiente" })`. */
	documentos?: unknown[];
	/** `getSolicitudesJuridico({ limite: 200 })`. */
	juridico?: unknown[];
	destinos: DestinosAprobacion;
}): { filas: FilaAprobacion[]; total: number; bandejas: BandejaAprobacion[] } {
	const { destinos } = fuentes;
	const convenios = (fuentes.convenios?.items ?? []) as ConvenioFuente[];
	const recuperaciones = (fuentes.recuperaciones?.pendientes ??
		[]) as RecuperacionFuente[];
	const inmovilizaciones = (
		(fuentes.inmovilizaciones ?? []) as InmovilizacionFuente[]
	).filter((i) => i.estado === "pendiente_aprobacion");
	const rebajas = rebajasAccionables(fuentes.rebajas);
	const documentos = documentosPendientes(fuentes.documentos);
	const juridico = juridicoAccionables(fuentes.juridico);

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
		...rebajas.map((r) => fila(solicitudDeRebaja(r), destinos.rebaja)),
		...juridico.map((j) => fila(solicitudDeJuridico(j), destinos.juridico)),
		...documentos.map((d) =>
			fila(solicitudDeDocumento(d), destinos.documentos),
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
		{
			clave: "rebajas",
			etiqueta: "Rebaja de mora",
			cantidad: fuentes.rebajas ? rebajas.length : null,
			destino: destinos.rebaja,
		},
		{
			clave: "juridico",
			etiqueta: "Jurídico",
			cantidad: fuentes.juridico ? juridico.length : null,
			destino: destinos.juridico,
		},
		{
			clave: "documentos",
			etiqueta: "Documentos",
			cantidad: fuentes.documentos ? documentos.length : null,
			destino: destinos.documentos,
		},
	];
	return {
		filas,
		total:
			(fuentes.convenios ? totalConvenios : 0) +
			recuperaciones.length +
			inmovilizaciones.length +
			rebajas.length +
			juridico.length +
			documentos.length,
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
export function coincideBusqueda(
	s: Pick<Solicitud, "cliente" | "credito" | "asesor">,
	busqueda: string,
) {
	const q = normalizarTexto(busqueda);
	if (!q) return true;
	return [s.cliente, s.credito, s.asesor].some((v) =>
		normalizarTexto(v).includes(q),
	);
}

/**
 * ¿La pidió este asesor? Apagados, reactivaciones y recuperaciones traen el id
 * del usuario que las pidió (M3): si el asesor tiene usuario del CRM se compara
 * por id. Sin id (o sin usuario vinculado) se cae al nombre, sin tildes ni
 * mayúsculas.
 */
export function esSolicitudDeAsesor(params: {
	idSolicitante: string | null | undefined;
	nombreSolicitante: string | null | undefined;
	userIdAsesor: string | null;
	nombres: Array<string | null | undefined>;
}) {
	if (params.userIdAsesor && params.idSolicitante) {
		return params.idSolicitante === params.userIdAsesor;
	}
	return esDelAsesor(params.nombreSolicitante, params.nombres);
}

/** Comparación por nombre (respaldo cuando no hay id). */
export function esDelAsesor(
	nombreSolicitante: string | null | undefined,
	nombres: Array<string | null | undefined>,
) {
	const n = normalizarTexto(nombreSolicitante);
	if (!n) return false;
	return nombres.some((x) => normalizarTexto(x) === n);
}
