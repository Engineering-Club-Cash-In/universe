/**
 * Bitácora unificada y paginada de decisiones del supervisor (tarea M3 de
 * docs/features/cobros-02/18-equipo-solicitudes-backend.md).
 *
 * Junta en el servidor lo que el Historial de Solicitudes armaba en el
 * navegador con topes distintos: convenios (cartera), apagados y
 * reactivaciones, recuperaciones, rebajas de mora, Jurídico, reasignaciones
 * manuales, traslados y coberturas. Cada fuente se pagina y se filtra en su
 * origen y acá solo se mezclan (lib/bitacora-supervision.ts).
 */

import {
	and,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	lt,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	casosCobros,
	coberturasAgendaCobros,
	recuperacionesVehiculo,
	solicitudesJuridicoCobros,
	solicitudesRebajaMoraCobros,
} from "../db/schema/cobros";
import { inmovilizacionesUnidad } from "../db/schema/inmovilizacion-unidad";
import {
	compararEntradas,
	type Decision,
	decisionDe,
	type EntradaBitacora,
	estadosNativos,
	type FuenteOrdenada,
	type PersonaBitacora,
	paginarMezcla,
	TIPOS_BITACORA,
	TIPOS_SOLICITUD,
	type TipoBitacora,
} from "../lib/bitacora-supervision";
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
	 * rebaja y Jurídico): reasignaciones, traslados y coberturas las hace el
	 * supervisor.
	 */
	solicitanteId?: string;
	/** Días de Guatemala (YYYY-MM-DD), inclusivos. */
	desde?: string;
	hasta?: string;
}

interface Contexto {
	/** Filas que cada fuente debe traer: las de la página y todas las anteriores. */
	top: number;
	decisiones?: Decision[];
	solicitanteId?: string;
	desde?: string;
	hasta?: string;
	rango: ReturnType<typeof rangoDiasGT>;
}

const persona = (userId: string | null, nombre: string | null) =>
	userId || nombre ? ({ userId, nombre } satisfies PersonaBitacora) : null;

const decisor = alias(user, "decisor_bitacora");
const solicitante = alias(user, "solicitante_bitacora");

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
		enRangoSql(fecha, ctx.rango),
	);
	const [filas, [{ total }]] = await Promise.all([
		db
			.select({
				id: recuperacionesVehiculo.id,
				estado: recuperacionesVehiculo.estadoSolicitud,
				sifco: casosCobros.numeroCreditoSifco,
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
		})),
	};
}

/** Rebajas de mora (W2) y Jurídico (W3): misma forma, dos tablas. */
async function rebajasYJuridico(
	ctx: Contexto,
	cual: "rebaja" | "juridico",
): Promise<FuenteOrdenada> {
	const estados = estadosNativos(cual, ctx.decisiones);
	if (estados.length === 0) return { filas: [], total: 0 };
	const t =
		cual === "rebaja" ? solicitudesRebajaMoraCobros : solicitudesJuridicoCobros;
	const fecha = sql`coalesce(${t.resueltoEn}, ${t.solicitadoEn})`;
	const donde = and(
		inArray(t.estado, estados),
		ctx.solicitanteId ? eq(t.solicitadoPor, ctx.solicitanteId) : undefined,
		enRangoSql(fecha, ctx.rango),
	);
	const motivo =
		cual === "rebaja"
			? solicitudesRebajaMoraCobros.notas
			: solicitudesJuridicoCobros.motivo;
	const [filas, [{ total }]] = await Promise.all([
		db
			.select({
				id: t.id,
				estado: t.estado,
				sifco: t.numeroCreditoSifco,
				motivo,
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
			id: `${cual}-${f.id}`,
			tipo: cual,
			fecha: (f.resueltoEn ?? f.solicitadoEn).toISOString(),
			decision: decisionDe(cual, f.estado),
			estado: f.estado,
			solicitante: persona(f.solicitadoPor, f.solicitanteNombre),
			decididoPor: persona(f.resueltoPor, f.decisorNombre),
			credito: { sifco: f.sifco, cliente: null },
			resumen: null,
			motivo: f.motivo,
			nota: f.notaResolucion,
			refId: f.id,
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
	const [ausencias, reactivaciones, [{ nAusencias }], [{ nReactivaciones }]] =
		await Promise.all([
			consulta()
				.where(dondeAusencia)
				.orderBy(desc(t.createdAt), desc(t.id))
				.limit(ctx.top),
			consulta()
				.where(dondeReactivacion)
				.orderBy(desc(fechaFin), desc(t.id))
				.limit(ctx.top),
			db
				.select({ nAusencias: sql<number>`count(*)::int` })
				.from(t)
				.where(dondeAusencia),
			db
				.select({ nReactivaciones: sql<number>`count(*)::int` })
				.from(t)
				.where(dondeReactivacion),
		]);
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
	const { filas, total } = await juntarPaginas(
		ctx.top,
		POR_PAGINA,
		async (page) => {
			const r = await carteraBackClient.getDecisionesConvenioHistorial({
				page,
				perPage: POR_PAGINA,
				desde: ctx.rango.desde,
				hasta: ctx.rango.hastaExcl,
				decision,
				creadoPorEmail: emailSolicitante ?? undefined,
			});
			return { filas: r.data, total: r.pagination.total };
		},
	);
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

async function reasignaciones(ctx: Contexto): Promise<FuenteOrdenada> {
	const POR_PAGINA = 200;
	const { filas, total } = await juntarPaginas(
		ctx.top,
		POR_PAGINA,
		async (page) => {
			const r = await carteraBackClient.getAsesorHistorial({
				origen: "API_MANUAL",
				desde: ctx.desde,
				hasta: ctx.hasta,
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
		})),
	};
}

async function traslados(ctx: Contexto): Promise<FuenteOrdenada> {
	const POR_PAGINA = 500;
	const { filas, total } = await juntarPaginas(
		ctx.top,
		POR_PAGINA,
		async (page) => {
			const r = await carteraBackClient.listarTrasladosCarteraPaginado({
				page,
				perPage: POR_PAGINA,
				desde: ctx.rango.desde,
				hasta: ctx.rango.hastaExcl,
			});
			return { filas: r.data, total: r.pagination.total };
		},
	);
	return {
		total,
		filas: filas.map((f) => ({
			id: `traslado-${f.id}`,
			tipo: "traslado" as const,
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

export async function getBitacoraDecisiones(filtro: FiltroBitacora) {
	let tipos: TipoBitacora[] = filtro.tipos?.length
		? filtro.tipos
		: [...TIPOS_BITACORA];
	// Pedir por asesor o por decisión deja afuera lo que no es una solicitud.
	if (filtro.solicitanteId || filtro.decisiones?.length) {
		tipos = tipos.filter((t) => TIPOS_SOLICITUD.includes(t));
	}
	const ctx: Contexto = {
		top: filtro.page * filtro.perPage,
		decisiones: filtro.decisiones,
		solicitanteId: filtro.solicitanteId,
		desde: filtro.desde,
		hasta: filtro.hasta,
		rango: rangoDiasGT(filtro.desde, filtro.hasta),
	};
	const quiere = (t: TipoBitacora) => tipos.includes(t);

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
		quiere("rebaja") ? rebajasYJuridico(ctx, "rebaja") : null,
		quiere("juridico") ? rebajasYJuridico(ctx, "juridico") : null,
		quiere("reasignacion") ? reasignaciones(ctx) : null,
		quiere("traslado") ? traslados(ctx) : null,
		quiere("cobertura") ? coberturas(ctx) : null,
	]);
	const pagina = paginarMezcla(
		fuentes.filter((f): f is FuenteOrdenada => f !== null),
		filtro.page,
		filtro.perPage,
	);

	// Solo a la página que se devuelve: nombre del cliente y correos → usuarios.
	const sinCliente = pagina.items
		.filter((i) => i.credito && !i.credito.cliente)
		.map((i) => (i.credito as { sifco: string }).sifco);
	const [clientes] = await Promise.all([
		nombresClientePorSifco(sinCliente),
		resolverCorreos(pagina.items),
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
