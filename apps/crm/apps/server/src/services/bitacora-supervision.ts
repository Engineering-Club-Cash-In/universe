/**
 * Bitácora unificada y paginada de decisiones del supervisor (tarea M3 de
 * docs/features/cobros-02/18-equipo-solicitudes-backend.md).
 *
 * Junta en el servidor lo que el Historial de Solicitudes armaba en el
 * navegador con topes distintos: convenios (cartera), apagados y
 * reactivaciones, recuperaciones, rebajas de mora, Jurídico, documentos (F6),
 * contrapropuestas de convenio (M4), reasignaciones manuales, traslados,
 * coberturas y ausencias indefinidas (M5). Cada fuente se pagina y se filtra
 * en su origen y acá solo se mezclan (lib/bitacora-supervision.ts).
 *
 * Búsqueda por texto (`busqueda`): número de crédito (SIFCO) o nombre del
 * cliente. Las fuentes del CRM la resuelven en SQL; las de cartera, como
 * cartera la permite (ver `convenios` y `reasignaciones`). Las acciones sobre
 * asesores no tienen crédito y quedan fuera mientras se busca.
 */

import {
	and,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	lt,
	ne,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	ausenciasAsesorCobros,
	casosCobros,
	coberturasAgendaCobros,
	contrapropuestasConvenioCobros,
	recuperacionesVehiculo,
	solicitudesDocumentosCobros,
	solicitudesJuridicoCobros,
	solicitudesRebajaMoraCobros,
} from "../db/schema/cobros";
import { inmovilizacionesUnidad } from "../db/schema/inmovilizacion-unidad";
import {
	admiteEvento,
	type Busqueda,
	coincideBusqueda,
	compararEntradas,
	type Decision,
	decisionDe,
	type EntradaBitacora,
	type EventoBitacora,
	estadoContrapropuesta,
	estadosNativos,
	eventoDeTraslado,
	type FuenteOrdenada,
	leerBusqueda,
	MAX_FILAS_BITACORA,
	type PersonaBitacora,
	paginarMezcla,
	TIPOS_BITACORA,
	TIPOS_CON_EVENTO,
	TIPOS_SIN_CREDITO,
	TIPOS_SOLICITUD,
	type TipoBitacora,
} from "../lib/bitacora-supervision";
import { nombreDocumento } from "../lib/documentos-ficha";
import { toDateStrGT } from "../lib/guatemala-month-window";
import {
	decisorInmovilizacionId,
	fechaDecisionInmovilizacion,
} from "../lib/inmovilizacion-decision-sql";
import { enRangoSql, rangoDiasGT } from "../lib/rango-dias-gt";
import { carteraBackClient } from "./cartera-back-client";
import { nombresClientePorSifco } from "./nombre-cliente-sifco";

export interface FiltroBitacora {
	page: number;
	perPage: number;
	/** Sin tipos, todos. */
	tipos?: TipoBitacora[];
	decisiones?: Decision[];
	/**
	 * Usuario del CRM que pidió la solicitud. Con este filtro solo entran los
	 * tipos que un asesor pide (convenio, apagado, reactivación, recuperación,
	 * rebaja, Jurídico y documento): reasignaciones, traslados, coberturas,
	 * ausencias y contrapropuestas las hace el supervisor.
	 */
	solicitanteId?: string;
	/** Días de Guatemala (YYYY-MM-DD), inclusivos. */
	desde?: string;
	hasta?: string;
	/**
	 * Eventos de las acciones sobre asesores (baja o traslado; ausencia o
	 * reactivación). Solo filtra los tipos que los tienen (traslado, cobertura y
	 * ausencia indefinida); el resto de los tipos no se toca.
	 */
	eventos?: EventoBitacora[];
	/** Número de crédito (SIFCO) o nombre del cliente. */
	busqueda?: string;
}

interface Contexto {
	/** Filas que cada fuente debe traer: las de la página y todas las anteriores. */
	top: number;
	decisiones?: Decision[];
	solicitanteId?: string;
	desde?: string;
	hasta?: string;
	rango: ReturnType<typeof rangoDiasGT>;
	eventos?: EventoBitacora[];
	busqueda: Busqueda | null;
}

const persona = (userId: string | null, nombre: string | null) =>
	userId || nombre ? ({ userId, nombre } satisfies PersonaBitacora) : null;

const decisor = alias(user, "decisor_bitacora");
const solicitante = alias(user, "solicitante_bitacora");

/* ── Búsqueda en SQL ──────────────────────────────────────────────────────── */

/** `%` y `_` del texto del usuario se buscan tal cual, no como comodines. */
const escaparLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Nombre completo del lead sin tildes ni mayúsculas (la base no tiene
 * `unaccent`). Mismas partes que `armarNombreCliente`.
 */
const NOMBRE_LEAD_NORMALIZADO = sql.raw(
	`translate(lower(concat_ws(' ', l.first_name, l.middle_name, l.last_name, l.second_last_name)), 'áéíóúüñàèìòùâêîôû', 'aeiouunaeiouaeiou')`,
);

/**
 * Condición de búsqueda sobre la columna del SIFCO de una fuente del CRM.
 *  - Número: el SIFCO contiene esos dígitos.
 *  - Nombre: el SIFCO contiene el texto, o su cliente tiene todas las
 *    palabras. El cliente es el mismo de `nombresClientePorSifco` (la
 *    oportunidad ganada o migrada del crédito y su lead), así que la búsqueda
 *    encuentra lo mismo que se muestra en la fila.
 * La subconsulta usa alias propios (`o`, `l`) y no depende de cómo Drizzle
 * califique las columnas de la consulta de afuera.
 */
function coincideCreditoSql(
	columnaSifco: AnyPgColumn,
	b: Busqueda | null,
): SQL | undefined {
	if (!b) return undefined;
	if (b.tipo === "sifco") {
		return sql`${columnaSifco} LIKE ${`%${escaparLike(b.digitos)}%`}`;
	}
	const palabras = sql.join(
		b.palabras.map(
			(p) => sql`${NOMBRE_LEAD_NORMALIZADO} LIKE ${`%${escaparLike(p)}%`}`,
		),
		sql` AND `,
	);
	return sql`(${columnaSifco} ILIKE ${`%${escaparLike(b.texto)}%`} OR ${columnaSifco} IN (
		SELECT o.numero_sifco FROM opportunities o
		INNER JOIN leads l ON l.id = o.lead_id
		WHERE o.numero_sifco IS NOT NULL
			AND o.status IN ('won', 'migrate')
			AND ${palabras}
	))`;
}

/* ── Fuentes en la BD del CRM ─────────────────────────────────────────────── */

async function inmovilizaciones(
	ctx: Contexto,
	tipos: ("apagado" | "reactivacion")[],
): Promise<FuenteOrdenada> {
	const estados = estadosNativos("inmovilizacion", ctx.decisiones);
	if (estados.length === 0 || tipos.length === 0)
		return { filas: [], total: 0 };
	// Una cancelada se fecha y se atribuye con su evento de cancelación, no con
	// la solicitud ni con quien la aprobó (lib/inmovilizacion-decision-sql.ts).
	const fecha = fechaDecisionInmovilizacion;
	const donde = and(
		inArray(inmovilizacionesUnidad.estado, estados as never[]),
		inArray(inmovilizacionesUnidad.accion, tipos),
		ctx.solicitanteId
			? eq(inmovilizacionesUnidad.solicitadoPor, ctx.solicitanteId)
			: undefined,
		coincideCreditoSql(inmovilizacionesUnidad.numeroCreditoSifco, ctx.busqueda),
		enRangoSql(fecha, ctx.rango),
	);
	const [filas, [{ total }]] = await Promise.all([
		db
			.select({
				id: inmovilizacionesUnidad.id,
				accion: inmovilizacionesUnidad.accion,
				estado: inmovilizacionesUnidad.estado,
				sifco: inmovilizacionesUnidad.numeroCreditoSifco,
				motivo: inmovilizacionesUnidad.motivo,
				motivoRechazo: inmovilizacionesUnidad.motivoRechazo,
				notaDecision: inmovilizacionesUnidad.notaDecision,
				fechaEfectiva: sql<Date>`${fecha}`.mapWith(
					inmovilizacionesUnidad.solicitadoAt,
				),
				solicitadoPor: inmovilizacionesUnidad.solicitadoPor,
				solicitanteNombre: solicitante.name,
				decididoPor: decisorInmovilizacionId,
				decisorNombre: decisor.name,
			})
			.from(inmovilizacionesUnidad)
			.leftJoin(
				solicitante,
				eq(inmovilizacionesUnidad.solicitadoPor, solicitante.id),
			)
			.leftJoin(decisor, eq(decisorInmovilizacionId, decisor.id))
			.where(donde)
			.orderBy(desc(fecha), desc(inmovilizacionesUnidad.id))
			.limit(ctx.top),
		db
			.select({ total: sql<number>`count(*)::int` })
			.from(inmovilizacionesUnidad)
			.where(donde),
	]);
	return {
		total,
		filas: filas.map((f) => ({
			id: `${f.accion}-${f.id}`,
			tipo: f.accion,
			fecha: f.fechaEfectiva.toISOString(),
			decision: decisionDe("inmovilizacion", f.estado),
			estado: f.estado,
			solicitante: persona(f.solicitadoPor, f.solicitanteNombre),
			decididoPor: persona(f.decididoPor, f.decisorNombre),
			credito: { sifco: f.sifco, cliente: null },
			resumen: null,
			motivo: f.motivo,
			nota: f.motivoRechazo ?? f.notaDecision,
			refId: f.id,
		})),
	};
}

async function recuperaciones(ctx: Contexto): Promise<FuenteOrdenada> {
	const estados = estadosNativos("recuperacion", ctx.decisiones);
	if (estados.length === 0) return { filas: [], total: 0 };
	const fecha = sql`coalesce(${recuperacionesVehiculo.decididoAt}, ${recuperacionesVehiculo.createdAt})`;
	const donde = and(
		isNotNull(recuperacionesVehiculo.estadoSolicitud),
		inArray(recuperacionesVehiculo.estadoSolicitud, estados),
		ctx.solicitanteId
			? eq(recuperacionesVehiculo.registradoPor, ctx.solicitanteId)
			: undefined,
		coincideCreditoSql(casosCobros.numeroCreditoSifco, ctx.busqueda),
		enRangoSql(fecha, ctx.rango),
	);
	const [filas, [{ total }]] = await Promise.all([
		db
			.select({
				id: recuperacionesVehiculo.id,
				estado: recuperacionesVehiculo.estadoSolicitud,
				sifco: casosCobros.numeroCreditoSifco,
				bucket: recuperacionesVehiculo.bucketOrigen,
				motivoDetalle: recuperacionesVehiculo.motivoDetalle,
				motivoDecision: recuperacionesVehiculo.motivoDecision,
				creadaAt: recuperacionesVehiculo.createdAt,
				decididoAt: recuperacionesVehiculo.decididoAt,
				solicitadoPor: recuperacionesVehiculo.registradoPor,
				solicitanteNombre: solicitante.name,
				decididoPor: recuperacionesVehiculo.decididoPor,
				decisorNombre: decisor.name,
			})
			.from(recuperacionesVehiculo)
			.innerJoin(
				casosCobros,
				eq(recuperacionesVehiculo.casoCobroId, casosCobros.id),
			)
			.leftJoin(
				solicitante,
				eq(recuperacionesVehiculo.registradoPor, solicitante.id),
			)
			.leftJoin(decisor, eq(recuperacionesVehiculo.decididoPor, decisor.id))
			.where(donde)
			.orderBy(desc(fecha), desc(recuperacionesVehiculo.id))
			.limit(ctx.top),
		db
			.select({ total: sql<number>`count(*)::int` })
			.from(recuperacionesVehiculo)
			// El join hace falta para buscar por el SIFCO del caso.
			.innerJoin(
				casosCobros,
				eq(recuperacionesVehiculo.casoCobroId, casosCobros.id),
			)
			.where(donde),
	]);
	return {
		total,
		filas: filas.map((f) => ({
			id: `recuperacion-${f.id}`,
			tipo: "recuperacion" as const,
			fecha: (f.decididoAt ?? f.creadaAt).toISOString(),
			decision: decisionDe("recuperacion", f.estado ?? ""),
			estado: f.estado ?? "",
			solicitante: persona(f.solicitadoPor, f.solicitanteNombre),
			decididoPor: persona(f.decididoPor, f.decisorNombre),
			credito: f.sifco ? { sifco: f.sifco, cliente: null } : null,
			resumen: null,
			motivo: f.motivoDetalle,
			nota: f.motivoDecision,
			refId: f.id,
			bucket: f.bucket ?? null,
		})),
	};
}

/** Rebajas de mora (W2), con los montos que se pidieron y aplicaron. */
async function rebajas(ctx: Contexto): Promise<FuenteOrdenada> {
	const estados = estadosNativos("rebaja", ctx.decisiones);
	if (estados.length === 0) return { filas: [], total: 0 };
	const t = solicitudesRebajaMoraCobros;
	const fecha = sql`coalesce(${t.resueltoEn}, ${t.solicitadoEn})`;
	const donde = and(
		inArray(t.estado, estados),
		ctx.solicitanteId ? eq(t.solicitadoPor, ctx.solicitanteId) : undefined,
		coincideCreditoSql(t.numeroCreditoSifco, ctx.busqueda),
		enRangoSql(fecha, ctx.rango),
	);
	const [filas, [{ total }]] = await Promise.all([
		db
			.select({
				id: t.id,
				estado: t.estado,
				sifco: t.numeroCreditoSifco,
				notas: t.notas,
				moraSnapshot: t.moraSnapshot,
				montoSolicitado: t.montoSolicitado,
				montoAplicado: t.montoAplicado,
				notaResolucion: t.notaResolucion,
				solicitadoEn: t.solicitadoEn,
				resueltoEn: t.resueltoEn,
				solicitadoPor: t.solicitadoPor,
				solicitanteNombre: solicitante.name,
				resueltoPor: t.resueltoPor,
				decisorNombre: decisor.name,
			})
			.from(t)
			.leftJoin(solicitante, eq(t.solicitadoPor, solicitante.id))
			.leftJoin(decisor, eq(t.resueltoPor, decisor.id))
			.where(donde)
			.orderBy(desc(fecha), desc(t.id))
			.limit(ctx.top),
		db.select({ total: sql<number>`count(*)::int` }).from(t).where(donde),
	]);
	return {
		total,
		filas: filas.map((f) => ({
			id: `rebaja-${f.id}`,
			tipo: "rebaja" as const,
			fecha: (f.resueltoEn ?? f.solicitadoEn).toISOString(),
			decision: decisionDe("rebaja", f.estado),
			estado: f.estado,
			solicitante: persona(f.solicitadoPor, f.solicitanteNombre),
			decididoPor: persona(f.resueltoPor, f.decisorNombre),
			credito: { sifco: f.sifco, cliente: null },
			resumen: null,
			motivo: f.notas,
			nota: f.notaResolucion,
			refId: f.id,
			montos: {
				solicitado: f.montoSolicitado,
				moraAlPedir: f.moraSnapshot,
				aplicado: f.montoAplicado,
			},
		})),
	};
}

/** Escalados a Jurídico (W3), con la nota para Jurídico y el bucket al pedir. */
async function juridico(ctx: Contexto): Promise<FuenteOrdenada> {
	const estados = estadosNativos("juridico", ctx.decisiones);
	if (estados.length === 0) return { filas: [], total: 0 };
	const t = solicitudesJuridicoCobros;
	const fecha = sql`coalesce(${t.resueltoEn}, ${t.solicitadoEn})`;
	const donde = and(
		inArray(t.estado, estados),
		ctx.solicitanteId ? eq(t.solicitadoPor, ctx.solicitanteId) : undefined,
		coincideCreditoSql(t.numeroCreditoSifco, ctx.busqueda),
		enRangoSql(fecha, ctx.rango),
	);
	const [filas, [{ total }]] = await Promise.all([
		db
			.select({
				id: t.id,
				estado: t.estado,
				sifco: t.numeroCreditoSifco,
				motivo: t.motivo,
				notaJuridico: t.notaJuridico,
				bucket: t.bucketSnapshot,
				notaResolucion: t.notaResolucion,
				solicitadoEn: t.solicitadoEn,
				resueltoEn: t.resueltoEn,
				solicitadoPor: t.solicitadoPor,
				solicitanteNombre: solicitante.name,
				resueltoPor: t.resueltoPor,
				decisorNombre: decisor.name,
			})
			.from(t)
			.leftJoin(solicitante, eq(t.solicitadoPor, solicitante.id))
			.leftJoin(decisor, eq(t.resueltoPor, decisor.id))
			.where(donde)
			.orderBy(desc(fecha), desc(t.id))
			.limit(ctx.top),
		db.select({ total: sql<number>`count(*)::int` }).from(t).where(donde),
	]);
	return {
		total,
		filas: filas.map((f) => ({
			id: `juridico-${f.id}`,
			tipo: "juridico" as const,
			fecha: (f.resueltoEn ?? f.solicitadoEn).toISOString(),
			decision: decisionDe("juridico", f.estado),
			estado: f.estado,
			solicitante: persona(f.solicitadoPor, f.solicitanteNombre),
			decididoPor: persona(f.resueltoPor, f.decisorNombre),
			credito: { sifco: f.sifco, cliente: null },
			resumen: null,
			motivo: f.motivo,
			nota: f.notaResolucion,
			refId: f.id,
			bucket: f.bucket,
			notaJuridico: f.notaJuridico,
		})),
	};
}

/** Solicitudes de documentos (F6) ya resueltas. */
async function documentos(ctx: Contexto): Promise<FuenteOrdenada> {
	const estados = estadosNativos("documento", ctx.decisiones);
	if (estados.length === 0) return { filas: [], total: 0 };
	const t = solicitudesDocumentosCobros;
	const fecha = sql`coalesce(${t.resueltoEn}, ${t.solicitadoEn})`;
	const donde = and(
		inArray(t.estado, estados),
		ctx.solicitanteId ? eq(t.solicitadoPor, ctx.solicitanteId) : undefined,
		coincideCreditoSql(t.numeroCreditoSifco, ctx.busqueda),
		enRangoSql(fecha, ctx.rango),
	);
	const [filas, [{ total }]] = await Promise.all([
		db
			.select({
				id: t.id,
				estado: t.estado,
				sifco: t.numeroCreditoSifco,
				clave: t.clave,
				comentario: t.comentario,
				notaResolucion: t.notaResolucion,
				solicitadoEn: t.solicitadoEn,
				resueltoEn: t.resueltoEn,
				solicitadoPor: t.solicitadoPor,
				solicitanteNombre: solicitante.name,
				resueltoPor: t.resueltoPor,
				decisorNombre: decisor.name,
			})
			.from(t)
			.leftJoin(solicitante, eq(t.solicitadoPor, solicitante.id))
			.leftJoin(decisor, eq(t.resueltoPor, decisor.id))
			.where(donde)
			.orderBy(desc(fecha), desc(t.id))
			.limit(ctx.top),
		db.select({ total: sql<number>`count(*)::int` }).from(t).where(donde),
	]);
	return {
		total,
		filas: filas.map((f) => ({
			id: `documento-${f.id}`,
			tipo: "documento" as const,
			fecha: (f.resueltoEn ?? f.solicitadoEn).toISOString(),
			decision: decisionDe("documento", f.estado),
			estado: f.estado,
			solicitante: persona(f.solicitadoPor, f.solicitanteNombre),
			decididoPor: persona(f.resueltoPor, f.decisorNombre),
			credito: f.sifco ? { sifco: f.sifco, cliente: null } : null,
			resumen: null,
			motivo: f.comentario,
			nota: f.notaResolucion,
			refId: f.id,
			documento: nombreDocumento(f.clave),
		})),
	};
}

/**
 * Contrapropuestas de convenio (M4) ya respondidas: aceptadas, descartadas
 * por el asesor, retiradas por el supervisor y sin efecto (el convenio cambió
 * por fuera o una nueva la reemplazó). Las que esperan respuesta se ven en el
 * Espacio de aprobación del convenio, que sigue pendiente.
 */
async function contrapropuestas(ctx: Contexto): Promise<FuenteOrdenada> {
	const t = contrapropuestasConvenioCobros;
	const propone = alias(user, "propone_contrapropuesta");
	const cierra = alias(user, "cierra_contrapropuesta");
	const fecha = sql`coalesce(${t.resueltaEn}, ${t.creadaEn})`;
	const donde = and(
		ne(t.estado, "pendiente"),
		coincideCreditoSql(t.numeroCreditoSifco, ctx.busqueda),
		enRangoSql(fecha, ctx.rango),
	);
	const [filas, [{ total }]] = await Promise.all([
		db
			.select({
				id: t.id,
				estado: t.estado,
				sifco: t.numeroCreditoSifco,
				convenioId: t.convenioId,
				montoTotal: t.montoTotal,
				numeroMesesOriginal: t.numeroMesesOriginal,
				cuotaMensualOriginal: t.cuotaMensualOriginal,
				primerPagoOriginal: t.primerPagoOriginal,
				numeroMeses: t.numeroMeses,
				cuotaMensual: t.cuotaMensual,
				primerPago: t.primerPago,
				nota: t.nota,
				notaRespuesta: t.notaRespuesta,
				creadaEn: t.creadaEn,
				resueltaEn: t.resueltaEn,
				creadaPor: t.creadaPor,
				proponeNombre: propone.name,
				resueltaPor: t.resueltaPor,
				cierraNombre: cierra.name,
				cierraRol: cierra.role,
			})
			.from(t)
			.leftJoin(propone, eq(t.creadaPor, propone.id))
			.leftJoin(cierra, eq(t.resueltaPor, cierra.id))
			.where(donde)
			.orderBy(desc(fecha), desc(t.id))
			.limit(ctx.top),
		db.select({ total: sql<number>`count(*)::int` }).from(t).where(donde),
	]);
	return {
		total,
		filas: filas.map((f) => ({
			id: `contrapropuesta-${f.id}`,
			tipo: "contrapropuesta" as const,
			fecha: (f.resueltaEn ?? f.creadaEn).toISOString(),
			decision: null,
			estado: estadoContrapropuesta(f.estado, f.cierraRol),
			solicitante: null,
			// Quien la cerró: el asesor que la aceptó o descartó, o el supervisor
			// que la retiró. Sin efecto no tiene a nadie.
			decididoPor: persona(f.resueltaPor, f.cierraNombre),
			credito: { sifco: f.sifco, cliente: null },
			resumen: `${f.numeroMesesOriginal} → ${f.numeroMeses} cuotas de Q ${f.cuotaMensual}`,
			motivo: f.nota,
			nota: f.notaRespuesta,
			refId: f.id,
			plan: {
				montoTotal: f.montoTotal,
				original: {
					numeroMeses: f.numeroMesesOriginal,
					cuotaMensual: f.cuotaMensualOriginal,
					primerPago: f.primerPagoOriginal,
				},
				propuesto: {
					numeroMeses: f.numeroMeses,
					cuotaMensual: f.cuotaMensual,
					primerPago: f.primerPago,
				},
				propuestaPor: persona(f.creadaPor, f.proponeNombre),
				nota: f.nota,
			},
		})),
	};
}

/**
 * Coberturas: cada una da una «ausencia» (cuando se registró) y, si ya se
 * canceló o terminó su período, una «reactivación» del asesor (igual que el
 * Historial de Solicitudes de antes). Son dos eventos con fecha propia: cada uno
 * se filtra por su fecha y se cuenta aparte, así un rango que incluye solo la
 * cancelación o el fin del período todavía los encuentra.
 */
async function coberturas(ctx: Contexto): Promise<FuenteOrdenada> {
	const quiereAusencia = admiteEvento("ausencia", ctx.eventos);
	const quiereReactivacion = admiteEvento("reactivacion", ctx.eventos);
	if (!quiereAusencia && !quiereReactivacion) return { filas: [], total: 0 };
	const titular = alias(user, "titular_bitacora");
	const suplente = alias(user, "suplente_bitacora");
	const t = coberturasAgendaCobros;
	// El fin del período es el último minuto de `hasta` en Guatemala (23:59 GT =
	// +6 h en UTC, que es como se guardan los timestamps).
	const hoyGT = sql`(now() AT TIME ZONE 'America/Guatemala')::date`;
	const fechaFin = sql`coalesce(${t.canceladaEn}, (${t.hasta}::timestamp + interval '23 hours 59 minutes') + interval '6 hours')`;
	const enRango = (columna: SQL) => enRangoSql(columna, ctx.rango);
	const dondeAusencia = enRango(sql`${t.createdAt}`);
	const dondeReactivacion = and(
		or(isNotNull(t.canceladaEn), sql`${t.hasta} < ${hoyGT}`),
		enRango(fechaFin),
	);
	const columnas = {
		id: t.id,
		motivo: t.motivo,
		desde: t.desde,
		hasta: t.hasta,
		canceladaEn: t.canceladaEn,
		createdAt: t.createdAt,
		creadaPor: t.creadaPor,
		creadaPorNombre: decisor.name,
		titularId: t.titularId,
		titularNombre: titular.name,
		suplenteNombre: suplente.name,
	};
	const consulta = () =>
		db
			.select({
				...columnas,
				fechaFin: sql<Date>`${fechaFin}`.mapWith(t.createdAt),
			})
			.from(t)
			.leftJoin(titular, eq(t.titularId, titular.id))
			.leftJoin(suplente, eq(t.suplenteId, suplente.id))
			.leftJoin(decisor, eq(t.creadaPor, decisor.id));
	const vacio = Promise.resolve([] as Awaited<ReturnType<typeof consulta>>);
	const cero = (n: string) => Promise.resolve([{ [n]: 0 }]);
	const [ausencias, reactivaciones, [{ nAusencias }], [{ nReactivaciones }]] =
		await Promise.all([
			quiereAusencia
				? consulta()
						.where(dondeAusencia)
						.orderBy(desc(t.createdAt), desc(t.id))
						.limit(ctx.top)
				: vacio,
			quiereReactivacion
				? consulta()
						.where(dondeReactivacion)
						.orderBy(desc(fechaFin), desc(t.id))
						.limit(ctx.top)
				: vacio,
			quiereAusencia
				? db
						.select({ nAusencias: sql<number>`count(*)::int` })
						.from(t)
						.where(dondeAusencia)
				: (cero("nAusencias") as Promise<{ nAusencias: number }[]>),
			quiereReactivacion
				? db
						.select({ nReactivaciones: sql<number>`count(*)::int` })
						.from(t)
						.where(dondeReactivacion)
				: (cero("nReactivaciones") as Promise<{ nReactivaciones: number }[]>),
		]);
	const afectado = (f: (typeof ausencias)[number]) => ({
		asesorId: null,
		userId: f.titularId,
		nombre: f.titularNombre,
	});
	const filas: EntradaBitacora[] = [
		...ausencias.map((f) => ({
			id: `cobertura-${f.id}`,
			tipo: "cobertura" as const,
			evento: "ausencia" as const,
			fecha: f.createdAt.toISOString(),
			decision: null,
			estado: f.canceladaEn ? "cancelada" : "realizada",
			solicitante: null,
			decididoPor: persona(f.creadaPor, f.creadaPorNombre),
			credito: null,
			resumen: `${f.titularNombre ?? "Asesor"} → ${f.suplenteNombre ?? "suplente"} · ${f.desde} al ${f.hasta}`,
			motivo: f.motivo,
			nota: null,
			refId: f.id,
			asesorAfectado: afectado(f),
			periodo: { desde: f.desde, hasta: f.hasta },
		})),
		...reactivaciones.map((f) => ({
			id: `reactivacion-${f.id}`,
			tipo: "cobertura" as const,
			evento: "reactivacion" as const,
			fecha: f.fechaFin.toISOString(),
			decision: null,
			estado: "realizada",
			solicitante: null,
			// El CRM no guarda quién canceló una cobertura.
			decididoPor: null,
			credito: null,
			resumen: `${f.titularNombre ?? "Asesor"} · ${f.desde} al ${f.hasta}`,
			motivo: f.motivo,
			nota: f.canceladaEn
				? "Se canceló la cobertura"
				: "Terminó el período de la cobertura",
			refId: f.id,
			asesorAfectado: afectado(f),
			periodo: { desde: f.desde, hasta: f.hasta },
		})),
	]
		.sort(compararEntradas)
		.slice(0, ctx.top);
	return { total: nAusencias + nReactivaciones, filas };
}

/**
 * Ausencias indefinidas (M5): la cartera del asesor se repartió al equipo con
 * un traslado real y vuelve cuando se lo reactiva. Como la cobertura, cada una
 * da la «ausencia» (al confirmar el reparto) y, si ya se lo reactivó, la
 * «reactivación». Las que no llegaron a confirmar el reparto (sin operación
 * de traslado) no entran: no movieron nada y se descartan solas.
 */
async function ausenciasIndefinidas(ctx: Contexto): Promise<FuenteOrdenada> {
	const quiereAusencia = admiteEvento("ausencia", ctx.eventos);
	const quiereReactivacion = admiteEvento("reactivacion", ctx.eventos);
	if (!quiereAusencia && !quiereReactivacion) return { filas: [], total: 0 };
	const t = ausenciasAsesorCobros;
	const titular = alias(user, "titular_ausencia");
	const reactivo = alias(user, "reactivo_ausencia");
	const dondeAusencia = and(
		isNotNull(t.operacionTrasladoId),
		enRangoSql(sql`${t.inicioAt}`, ctx.rango),
	);
	const dondeReactivacion = and(
		eq(t.estado, "reactivada"),
		isNotNull(t.finAt),
		enRangoSql(sql`${t.finAt}`, ctx.rango),
	);
	const consulta = () =>
		db
			.select({
				id: t.id,
				asesorId: t.asesorId,
				titularId: t.titularId,
				titularNombre: titular.name,
				motivo: t.motivo,
				nota: t.nota,
				estado: t.estado,
				inicioAt: t.inicioAt,
				finAt: t.finAt,
				cuentasRepartidas: t.cuentasRepartidas,
				cuentasDevueltas: t.cuentasDevueltas,
				cuentasRetenidas: t.cuentasRetenidas,
				creadaPor: t.creadaPor,
				creadaPorNombre: decisor.name,
				reactivadaPor: t.reactivadaPor,
				reactivadaPorNombre: reactivo.name,
			})
			.from(t)
			.leftJoin(titular, eq(t.titularId, titular.id))
			.leftJoin(decisor, eq(t.creadaPor, decisor.id))
			.leftJoin(reactivo, eq(t.reactivadaPor, reactivo.id));
	const vacio = Promise.resolve([] as Awaited<ReturnType<typeof consulta>>);
	const contar = (donde: SQL | undefined) =>
		db
			.select({ n: sql<number>`count(*)::int` })
			.from(t)
			.where(donde)
			.then(([r]) => r?.n ?? 0);
	const [ausencias, reactivaciones, nAusencias, nReactivaciones] =
		await Promise.all([
			quiereAusencia
				? consulta()
						.where(dondeAusencia)
						.orderBy(desc(t.inicioAt), desc(t.id))
						.limit(ctx.top)
				: vacio,
			quiereReactivacion
				? consulta()
						.where(dondeReactivacion)
						.orderBy(desc(t.finAt), desc(t.id))
						.limit(ctx.top)
				: vacio,
			quiereAusencia ? contar(dondeAusencia) : 0,
			quiereReactivacion ? contar(dondeReactivacion) : 0,
		]);
	const afectado = (f: (typeof ausencias)[number]) => ({
		asesorId: f.asesorId,
		userId: f.titularId,
		nombre: f.titularNombre,
	});
	const nombre = (f: (typeof ausencias)[number]) =>
		f.titularNombre ?? `Asesor #${f.asesorId}`;
	const periodo = (f: (typeof ausencias)[number]) => ({
		desde: toDateStrGT(f.inicioAt),
		hasta: f.finAt ? toDateStrGT(f.finAt) : null,
	});
	const filas: EntradaBitacora[] = [
		...ausencias.map((f) => ({
			id: `ausencia_indefinida-${f.id}`,
			tipo: "ausencia_indefinida" as const,
			evento: "ausencia" as const,
			fecha: f.inicioAt.toISOString(),
			decision: null,
			estado: f.estado,
			solicitante: null,
			decididoPor: persona(f.creadaPor, f.creadaPorNombre),
			credito: null,
			resumen: `${nombre(f)} · ${f.cuentasRepartidas} ${f.cuentasRepartidas === 1 ? "cuenta repartida" : "cuentas repartidas"}`,
			motivo: f.motivo,
			nota: f.nota,
			refId: f.id,
			asesorAfectado: afectado(f),
			periodo: periodo(f),
			cuentas: { movidas: f.cuentasRepartidas },
		})),
		...reactivaciones.map((f) => ({
			id: `reactivacion_indefinida-${f.id}`,
			tipo: "ausencia_indefinida" as const,
			evento: "reactivacion" as const,
			// biome-ignore lint/style/noNonNullAssertion: el WHERE exige fin_at
			fecha: f.finAt!.toISOString(),
			decision: null,
			estado: f.estado,
			solicitante: null,
			decididoPor: persona(f.reactivadaPor, f.reactivadaPorNombre),
			credito: null,
			resumen: `${nombre(f)} · ausente desde el ${toDateStrGT(f.inicioAt)}`,
			motivo: f.motivo,
			nota: f.nota,
			refId: f.id,
			asesorAfectado: afectado(f),
			periodo: periodo(f),
			cuentas: {
				movidas: f.cuentasRepartidas,
				devueltas: f.cuentasDevueltas,
				retenidas: f.cuentasRetenidas,
			},
		})),
	]
		.sort(compararEntradas)
		.slice(0, ctx.top);
	return { total: nAusencias + nReactivaciones, filas };
}

/* ── Fuentes en cartera ───────────────────────────────────────────────────── */

/** Pide páginas a cartera hasta juntar `top` filas o agotar la fuente. */
async function juntarPaginas<T>(
	top: number,
	porPagina: number,
	pedir: (page: number) => Promise<{ filas: T[]; total: number }>,
): Promise<{ filas: T[]; total: number }> {
	const filas: T[] = [];
	let total = 0;
	for (let page = 1; filas.length < top; page++) {
		const r = await pedir(page);
		total = r.total;
		filas.push(...r.filas);
		if (r.filas.length < porPagina || filas.length >= total) break;
	}
	return { filas: filas.slice(0, top), total };
}

/**
 * Filtra en memoria una fuente de cartera que no filtra lo que hace falta:
 * trae todas sus filas (hasta el límite de la bitácora) y devuelve las
 * primeras `top` que cumplen, con el total exacto de las que cumplen.
 */
async function filtrarEnMemoria<T>(
	top: number,
	porPagina: number,
	pedir: (page: number) => Promise<{ filas: T[]; total: number }>,
	cumple: (fila: T) => boolean,
): Promise<{ filas: T[]; total: number }> {
	const { filas } = await juntarPaginas(MAX_FILAS_BITACORA, porPagina, pedir);
	const coinciden = filas.filter(cumple);
	return { filas: coinciden.slice(0, top), total: coinciden.length };
}

async function convenios(
	ctx: Contexto,
	emailSolicitante: string | null,
): Promise<FuenteOrdenada> {
	const estados = estadosNativos("convenio", ctx.decisiones);
	if (estados.length === 0) return { filas: [], total: 0 };
	// Cartera filtra por una sola decisión; con las dos se pide sin filtro.
	const decision =
		estados.length === 1 ? (estados[0] as "aprobado" | "rechazado") : undefined;
	// Páginas grandes: llegar al límite de la bitácora no debe costar decenas de llamadas.
	const POR_PAGINA = 500;
	const pedir = async (page: number) => {
		const r = await carteraBackClient.getDecisionesConvenioHistorial({
			page,
			perPage: POR_PAGINA,
			desde: ctx.rango.desde,
			hasta: ctx.rango.hastaExcl,
			decision,
			creadoPorEmail: emailSolicitante ?? undefined,
		});
		return { filas: r.data, total: r.pagination.total };
	};
	// Cartera no busca por texto: con búsqueda se recorren las decisiones del
	// rango (hasta el límite de la bitácora) y se filtran aquí, con el nombre
	// del cliente que trae cartera.
	const busqueda = ctx.busqueda;
	const { filas, total } = busqueda
		? await filtrarEnMemoria(ctx.top, POR_PAGINA, pedir, (f) =>
				coincideBusqueda(busqueda, {
					sifco: f.numeroCreditoSifco,
					cliente: f.clienteNombre,
				}),
			)
		: await juntarPaginas(ctx.top, POR_PAGINA, pedir);
	return {
		total,
		filas: filas.map((f) => ({
			id: `convenio-${f.decisionId}`,
			tipo: "convenio" as const,
			fecha: new Date(f.decididoEn).toISOString(),
			decision: decisionDe("convenio", f.decision),
			estado: f.decision,
			// El correo se cambia por el usuario del CRM al final (resolverCorreos).
			solicitante: f.creadoPorEmail
				? { userId: null, nombre: f.creadoPorEmail }
				: null,
			decididoPor: { userId: null, nombre: f.decididoPorEmail },
			credito: { sifco: f.numeroCreditoSifco, cliente: f.clienteNombre },
			resumen: `${f.snapshot.numero_meses} cuotas de Q ${f.snapshot.cuota_mensual}`,
			motivo: f.snapshot.motivo_creacion,
			nota: f.motivo,
			refId: String(f.decisionId),
		})),
	};
}

/**
 * Reasignaciones manuales. Con búsqueda se usan los filtros de cartera: el
 * número va a `numero_credito_sifco` y el nombre a `nombre_usuario`, que
 * cartera compara tal cual (con tildes y como un solo texto).
 */
async function reasignaciones(ctx: Contexto): Promise<FuenteOrdenada> {
	const POR_PAGINA = 200;
	const b = ctx.busqueda;
	const { filas, total } = await juntarPaginas(
		ctx.top,
		POR_PAGINA,
		async (page) => {
			const r = await carteraBackClient.getAsesorHistorial({
				origen: "API_MANUAL",
				desde: ctx.desde,
				hasta: ctx.hasta,
				...(b?.tipo === "sifco" ? { numero_credito_sifco: b.digitos } : {}),
				...(b?.tipo === "nombre" ? { nombre_usuario: b.texto } : {}),
				page,
				pageSize: POR_PAGINA,
			});
			return { filas: r.data, total: r.pagination.total };
		},
	);
	return {
		total,
		filas: filas.map((f) => ({
			id: `reasignacion-${f.historial_id}`,
			tipo: "reasignacion" as const,
			fecha: new Date(f.fecha).toISOString(),
			decision: null,
			estado: "realizada",
			solicitante: null,
			decididoPor: f.usuario ? { userId: null, nombre: f.usuario } : null,
			credito: { sifco: f.numero_credito_sifco, cliente: f.cliente },
			resumen: `${f.asesor_anterior ?? "Sin asesor"} → ${f.asesor_nuevo ?? "Sin asesor"}`,
			motivo: f.motivo,
			nota: null,
			refId: String(f.historial_id),
			// El bucket del crédito al reasignarlo, tal como lo guardó el motor.
			bucket: f.bucket,
		})),
	};
}

/** Operaciones de traslado que son el reparto de una ausencia indefinida (M5). */
async function operacionesDeAusencias(): Promise<Set<string>> {
	const filas = await db
		.select({ id: ausenciasAsesorCobros.operacionTrasladoId })
		.from(ausenciasAsesorCobros)
		.where(isNotNull(ausenciasAsesorCobros.operacionTrasladoId));
	return new Set(filas.flatMap((f) => (f.id ? [f.id] : [])));
}

/**
 * Traslados de cartera: bajas de asesor (despido o renuncia) y traslados.
 * Cartera no filtra por motivo, así que se traen todos los del rango (son
 * pocos: casi siempre cabe en una página) y se clasifican aquí, con el total
 * exacto de cada evento. El reparto de una ausencia indefinida no se repite:
 * ya sale como su ausencia.
 */
async function traslados(ctx: Contexto): Promise<FuenteOrdenada> {
	const POR_PAGINA = 500;
	const [{ filas: todas }, deAusencias] = await Promise.all([
		juntarPaginas(MAX_FILAS_BITACORA, POR_PAGINA, async (page) => {
			const r = await carteraBackClient.listarTrasladosCarteraPaginado({
				page,
				perPage: POR_PAGINA,
				desde: ctx.rango.desde,
				hasta: ctx.rango.hastaExcl,
			});
			return { filas: r.data, total: r.pagination.total };
		}),
		operacionesDeAusencias(),
	]);
	const filas = todas
		.filter((f) => !deAusencias.has(f.id))
		.map((f) => ({ ...f, evento: eventoDeTraslado(f.motivo) }))
		.filter((f) => admiteEvento(f.evento, ctx.eventos));
	return {
		total: filas.length,
		filas: filas.slice(0, ctx.top).map((f) => ({
			id: `traslado-${f.id}`,
			tipo: "traslado" as const,
			evento: f.evento,
			fecha: new Date(f.created_at).toISOString(),
			decision: null,
			estado: "realizada",
			solicitante: null,
			decididoPor: { userId: null, nombre: f.actor_email },
			credito: null,
			resumen: `${f.cuentas} cuentas (${f.modo})`,
			motivo: f.motivo,
			nota: null,
			refId: f.id,
			// El nombre se completa al final, solo para la página (resolverAsesores).
			asesorAfectado: {
				asesorId: f.asesor_origen_id,
				userId: null,
				nombre: null,
			},
			cuentas: { movidas: f.cuentas },
		})),
	};
}

/* ── Armado ───────────────────────────────────────────────────────────────── */

/** Cambia los correos de cartera por el usuario del CRM, cuando existe. */
async function resolverCorreos(items: EntradaBitacora[]) {
	const correos = new Set<string>();
	for (const i of items) {
		for (const p of [i.solicitante, i.decididoPor]) {
			if (p && !p.userId && p.nombre?.includes("@"))
				correos.add(p.nombre.toLowerCase());
		}
	}
	if (correos.size === 0) return;
	const usuarios = await db
		.select({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.where(inArray(sql`lower(${user.email})`, [...correos]));
	const porCorreo = new Map(usuarios.map((u) => [u.email.toLowerCase(), u]));
	const cambiar = (p: PersonaBitacora | null): PersonaBitacora | null => {
		if (!p || p.userId || !p.nombre?.includes("@")) return p;
		const u = porCorreo.get(p.nombre.toLowerCase());
		return u ? { userId: u.id, nombre: u.name } : p;
	};
	for (const i of items) {
		i.solicitante = cambiar(i.solicitante);
		i.decididoPor = cambiar(i.decididoPor);
	}
}

/**
 * Nombre del asesor de los traslados y de las ausencias sin usuario del CRM,
 * del catálogo de asesores de cartera (el mismo de `getAsesoresTraslados`,
 * con su caché). Si cartera no responde, la entrada queda sin nombre y la
 * pantalla muestra «Asesor #id»: no tumba la bitácora.
 */
async function resolverAsesores(items: EntradaBitacora[]) {
	const sinNombre = items.filter(
		(i) => i.asesorAfectado?.asesorId != null && !i.asesorAfectado.nombre,
	);
	if (sinNombre.length === 0) return;
	try {
		const pool = await carteraBackClient.getPoolPorAsesor({
			useCircuitBreaker: false,
		});
		const nombres = new Map(pool.map((a) => [a.asesor_id, a.nombre]));
		for (const i of sinNombre) {
			const a = i.asesorAfectado;
			if (a?.asesorId != null) a.nombre = nombres.get(a.asesorId) ?? null;
		}
	} catch (error) {
		console.warn(
			"[bitacora] No se pudieron leer los nombres de los asesores:",
			error instanceof Error ? error.message : error,
		);
	}
}

export async function getBitacoraDecisiones(filtro: FiltroBitacora) {
	let tipos: TipoBitacora[] = filtro.tipos?.length
		? filtro.tipos
		: [...TIPOS_BITACORA];
	// Pedir por asesor o por decisión deja afuera lo que no es una solicitud.
	if (filtro.solicitanteId || filtro.decisiones?.length) {
		tipos = tipos.filter((t) => TIPOS_SOLICITUD.includes(t));
	}
	// La búsqueda es por crédito o cliente: lo que no tiene crédito no entra.
	const busqueda = leerBusqueda(filtro.busqueda);
	if (busqueda) {
		tipos = tipos.filter((t) => !TIPOS_SIN_CREDITO.includes(t));
	}
	// Los eventos pedidos dejan afuera los tipos con evento que no los tienen
	// (pedir «baja» no trae coberturas).
	const eventos = filtro.eventos?.length ? filtro.eventos : undefined;
	if (eventos) {
		const posibles: Record<string, readonly EventoBitacora[]> = {
			traslado: ["traslado", "baja"],
			cobertura: ["ausencia", "reactivacion"],
			ausencia_indefinida: ["ausencia", "reactivacion"],
		};
		tipos = tipos.filter(
			(t) =>
				!TIPOS_CON_EVENTO.includes(t) ||
				posibles[t]?.some((e) => eventos.includes(e)),
		);
	}
	const ctx: Contexto = {
		top: filtro.page * filtro.perPage,
		decisiones: filtro.decisiones,
		solicitanteId: filtro.solicitanteId,
		desde: filtro.desde,
		hasta: filtro.hasta,
		rango: rangoDiasGT(filtro.desde, filtro.hasta),
		eventos,
		busqueda,
	};
	const quiere = (t: TipoBitacora) => tipos.includes(t);
	if (tipos.length === 0) return paginarMezcla([], filtro.page, filtro.perPage);

	// Los convenios guardan el correo de quien los armó, no el id del CRM.
	let emailSolicitante: string | null = null;
	if (filtro.solicitanteId && quiere("convenio")) {
		const [u] = await db
			.select({ email: user.email })
			.from(user)
			.where(eq(user.id, filtro.solicitanteId))
			.limit(1);
		if (!u) return paginarMezcla([], filtro.page, filtro.perPage);
		emailSolicitante = u.email;
	}

	const fuentes = await Promise.all([
		quiere("convenio") ? convenios(ctx, emailSolicitante) : null,
		quiere("apagado") || quiere("reactivacion")
			? inmovilizaciones(ctx, [
					...(quiere("apagado") ? (["apagado"] as const) : []),
					...(quiere("reactivacion") ? (["reactivacion"] as const) : []),
				])
			: null,
		quiere("recuperacion") ? recuperaciones(ctx) : null,
		quiere("rebaja") ? rebajas(ctx) : null,
		quiere("juridico") ? juridico(ctx) : null,
		quiere("documento") ? documentos(ctx) : null,
		quiere("contrapropuesta") ? contrapropuestas(ctx) : null,
		quiere("reasignacion") ? reasignaciones(ctx) : null,
		quiere("traslado") ? traslados(ctx) : null,
		quiere("cobertura") ? coberturas(ctx) : null,
		quiere("ausencia_indefinida") ? ausenciasIndefinidas(ctx) : null,
	]);
	const pagina = paginarMezcla(
		fuentes.filter((f): f is FuenteOrdenada => f !== null),
		filtro.page,
		filtro.perPage,
	);

	// Solo a la página que se devuelve: nombre del cliente, correos → usuarios y
	// nombre de los asesores de cartera.
	const sinCliente = pagina.items
		.filter((i) => i.credito && !i.credito.cliente)
		.map((i) => (i.credito as { sifco: string }).sifco);
	const [clientes] = await Promise.all([
		nombresClientePorSifco(sinCliente),
		resolverCorreos(pagina.items),
		resolverAsesores(pagina.items),
	]);
	for (const i of pagina.items) {
		if (i.credito && !i.credito.cliente) {
			i.credito.cliente = clientes.get(i.credito.sifco) ?? null;
		}
	}
	return pagina;
}

/* ── Escaladas por asesor ─────────────────────────────────────────────────── */

export interface FiltroEscaladas {
	/** Usuario del CRM del asesor. */
	userId: string;
	desde?: string;
	hasta?: string;
	limite: number;
}

/**
 * Casos que el asesor escaló: sus solicitudes a Jurídico y de recuperación del
 * vehículo (decisión del 2026-10-12: el apagado del GPS no cuenta como
 * escalar). Alimenta el chip «Escaladas» de Detalle › Actividad.
 */
export async function getEscaladasDelAsesor(filtro: FiltroEscaladas) {
	const rango = rangoDiasGT(filtro.desde, filtro.hasta);
	const ctx: Contexto = {
		top: filtro.limite,
		solicitanteId: filtro.userId,
		desde: filtro.desde,
		hasta: filtro.hasta,
		rango,
		busqueda: null,
	};
	// Fecha de la solicitud (cuándo escaló), no la de la decisión, y también las
	// que siguen pendientes: se trae todo el ciclo y se ordena por fecha pedida.
	const fechaJ = solicitudesJuridicoCobros.solicitadoEn;
	const fechaR = recuperacionesVehiculo.createdAt;
	const dondeJ = and(
		eq(solicitudesJuridicoCobros.solicitadoPor, filtro.userId),
		rango.desde ? gte(fechaJ, rango.desde) : undefined,
		rango.hastaExcl ? lt(fechaJ, rango.hastaExcl) : undefined,
	);
	const dondeR = and(
		isNotNull(recuperacionesVehiculo.estadoSolicitud),
		eq(recuperacionesVehiculo.registradoPor, filtro.userId),
		rango.desde ? gte(fechaR, rango.desde) : undefined,
		rango.hastaExcl ? lt(fechaR, rango.hastaExcl) : undefined,
	);
	const [[{ nJ }], [{ nR }]] = await Promise.all([
		db
			.select({ nJ: sql<number>`count(*)::int` })
			.from(solicitudesJuridicoCobros)
			.where(dondeJ),
		db
			.select({ nR: sql<number>`count(*)::int` })
			.from(recuperacionesVehiculo)
			.where(dondeR),
	]);
	const [juridico, recuperacion] = await Promise.all([
		db
			.select({
				id: solicitudesJuridicoCobros.id,
				estado: solicitudesJuridicoCobros.estado,
				sifco: solicitudesJuridicoCobros.numeroCreditoSifco,
				motivo: solicitudesJuridicoCobros.motivo,
				fecha: fechaJ,
				bucket: solicitudesJuridicoCobros.bucketSnapshot,
			})
			.from(solicitudesJuridicoCobros)
			.where(dondeJ)
			.orderBy(desc(fechaJ))
			.limit(ctx.top),
		db
			.select({
				id: recuperacionesVehiculo.id,
				estado: recuperacionesVehiculo.estadoSolicitud,
				sifco: casosCobros.numeroCreditoSifco,
				motivo: recuperacionesVehiculo.motivoDetalle,
				fecha: fechaR,
			})
			.from(recuperacionesVehiculo)
			.innerJoin(
				casosCobros,
				eq(recuperacionesVehiculo.casoCobroId, casosCobros.id),
			)
			.where(dondeR)
			.orderBy(desc(fechaR))
			.limit(ctx.top),
	]);
	const items = [
		...juridico.map((f) => ({
			id: `juridico-${f.id}`,
			tipo: "juridico" as const,
			fecha: f.fecha.toISOString(),
			estado: f.estado,
			sifco: f.sifco,
			motivo: f.motivo,
		})),
		...recuperacion.map((f) => ({
			id: `recuperacion-${f.id}`,
			tipo: "recuperacion" as const,
			fecha: f.fecha.toISOString(),
			estado: f.estado ?? "",
			sifco: f.sifco,
			motivo: f.motivo,
		})),
	]
		.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))
		.slice(0, filtro.limite);
	const clientes = await nombresClientePorSifco(
		items.flatMap((i) => (i.sifco ? [i.sifco] : [])),
	);
	return {
		// Total exacto (no el de la lista recortada) para el contador del chip.
		total: nJ + nR,
		porTipo: { juridico: nJ, recuperacion: nR },
		items: items.map((i) => ({
			...i,
			cliente: i.sifco ? (clientes.get(i.sifco) ?? null) : null,
		})),
	};
}
