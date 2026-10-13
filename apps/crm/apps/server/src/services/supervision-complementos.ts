/**
 * Dashboard del supervisor · KPIs del equipo (S3) y columnas de la tabla
 * Equipo (S4). Reglas puras en lib/supervision-kpis.ts; decisiones en
 * docs/features/cobros-02/23-plan-backend-supervision.md.
 *
 * Cada bloque se calcula aparte y, si su fuente falla, queda en `null`: el
 * front muestra «—» y el resto del Dashboard sigue.
 */

import { and, eq, gte, inArray, lt, ne, not, or, sql } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	cierreDiarioCreditoCobros,
	contactosCobros,
	metasAsesorCobros,
} from "../db/schema/cobros";
import {
	metaRecuperacionDelRango,
	type PeriodoDesempeno,
	type RangoFechas,
	rangosDesempeno,
} from "../lib/desempeno-asesor";
import { gtDateStrToDate, toDateStrGT } from "../lib/guatemala-month-window";
import { esGestionAutomatica } from "../lib/historial-agendas";
import {
	metaCumplidaPct,
	metaDelEquipo,
	montoDe,
	rescatePct,
	resultadoCartera,
} from "../lib/supervision-kpis";
import { movimientosDeHoySinCerrar } from "../routers/cobros-asesor";
import type {
	EquipoAsesorSupervision,
	KpisEquipoSupervision,
	RecuperacionAsesorSupervision,
} from "../routers/supervision-cobros";
import { carteraBackClient } from "./cartera-back-client";

interface AsesorEquipo {
	asesorId: number;
	/** Usuario del CRM (match por `email_cash_in`); null si no está vinculado. */
	userId: string | null;
}

/** Mismo pool que muestra la tabla Equipo: activos y con buckets. */
async function asesoresDelEquipo(): Promise<AsesorEquipo[]> {
	const [pool, usuarios] = await Promise.all([
		carteraBackClient.getPoolPorAsesor(),
		db.select({ id: user.id, email: user.email }).from(user),
	]);
	const porEmail = new Map(
		usuarios.map((u) => [u.email.trim().toLowerCase(), u.id]),
	);
	return pool
		.filter((a) => a.activo !== false && a.buckets.length > 0)
		.map((a) => ({
			asesorId: a.asesor_id,
			userId: porEmail.get(a.email_cash_in?.trim().toLowerCase() ?? "") ?? null,
		}));
}

/** Recuperación por asesor (Q) en un rango; asesores sin pagos = 0. */
async function recuperacionPorAsesor(
	r: RangoFechas,
	asesorIds: number[],
): Promise<Map<number, number>> {
	const resp = await carteraBackClient.getRecuperacionPorAsesorRango({
		fechaDesde: r.desdeStr,
		fechaHasta: r.hastaStr,
		asesores: asesorIds,
	});
	const mapa = new Map<number, number>(asesorIds.map((id) => [id, 0]));
	for (const fila of resp.porAsesor) {
		if (mapa.has(fila.asesorId)) mapa.set(fila.asesorId, montoDe(fila.monto));
	}
	return mapa;
}

/** Metas mensuales de los asesores para los meses que toca el rango. */
async function metasPorAsesor(
	asesorIds: number[],
	r: RangoFechas,
): Promise<Map<number, Map<string, number>>> {
	const meses = new Map<string, { anio: number; mes: number }>();
	for (const fecha of [r.desdeStr, r.hastaStr]) {
		const [anio, mes] = fecha.split("-").map(Number);
		meses.set(`${anio}-${mes}`, { anio, mes });
	}
	const resultado = new Map<number, Map<string, number>>();
	if (asesorIds.length === 0) return resultado;
	const filas = await db
		.select({
			asesorId: metasAsesorCobros.asesorId,
			anio: metasAsesorCobros.anio,
			mes: metasAsesorCobros.mes,
			monto: metasAsesorCobros.montoRecuperacion,
		})
		.from(metasAsesorCobros)
		.where(
			and(
				inArray(metasAsesorCobros.asesorId, asesorIds),
				or(
					...[...meses.values()].map((m) =>
						and(
							eq(metasAsesorCobros.anio, m.anio),
							eq(metasAsesorCobros.mes, m.mes),
						),
					),
				),
			),
		);
	for (const f of filas) {
		const porMes = resultado.get(f.asesorId) ?? new Map<string, number>();
		porMes.set(`${f.anio}-${f.mes}`, Number(f.monto));
		resultado.set(f.asesorId, porMes);
	}
	return resultado;
}

/** Meta prorrateada al período de cada asesor (null si no tiene meta completa). */
function metasDelPeriodo(
	periodo: PeriodoDesempeno,
	r: RangoFechas,
	asesorIds: number[],
	metas: Map<number, Map<string, number>>,
): Map<number, number | null> {
	return new Map(
		asesorIds.map((id) => {
			const porMes = metas.get(id);
			const meta = porMes
				? metaRecuperacionDelRango(
						periodo,
						r,
						(anio, mes) => porMes.get(`${anio}-${mes}`) ?? null,
					)
				: null;
			return [id, meta];
		}),
	);
}

interface MovimientosUsuario {
	bajaron: number;
	subieron: number;
}

/**
 * Bajadas (recuperados) y subidas (escalados) de bucket por usuario del CRM en
 * un rango: cierre diario (días cerrados) más lo de hoy en vivo cuando el
 * cierre de hoy no ha corrido. Mismas cifras que la tarjeta «Migración de
 * bucket».
 */
async function movimientosPorUsuario(
	r: RangoFechas,
	userIds: string[],
	ahora: Date,
): Promise<Map<string, MovimientosUsuario>> {
	const mapa = new Map<string, MovimientosUsuario>(
		userIds.map((id) => [id, { bajaron: 0, subieron: 0 }]),
	);
	if (userIds.length === 0) return mapa;
	const [cerrados, hoy] = await Promise.all([
		db
			.select({
				asesorId: cierreDiarioCreditoCobros.asesorId,
				bajaron: sql<number>`count(*) FILTER (WHERE ${cierreDiarioCreditoCobros.tipo} = 'bajada')::int`,
				subieron: sql<number>`count(*) FILTER (WHERE ${cierreDiarioCreditoCobros.tipo} = 'subida')::int`,
			})
			.from(cierreDiarioCreditoCobros)
			.where(
				and(
					inArray(cierreDiarioCreditoCobros.asesorId, userIds),
					gte(cierreDiarioCreditoCobros.fecha, r.desdeStr),
					sql`${cierreDiarioCreditoCobros.fecha} <= ${r.hastaStr}`,
					inArray(cierreDiarioCreditoCobros.tipo, ["bajada", "subida"]),
				),
			)
			.groupBy(cierreDiarioCreditoCobros.asesorId),
		movimientosDeHoySinCerrar(r, ahora),
	]);
	// Si lo de hoy no se pudo calcular, el total estaría incompleto: se falla
	// el bloque entero (queda en null) en vez de mostrar cifras parciales.
	if (!hoy.incluyeHoy) {
		throw new Error("movimientos de bucket de hoy no disponibles");
	}
	for (const f of cerrados) {
		mapa.set(f.asesorId, {
			bajaron: Number(f.bajaron),
			subieron: Number(f.subieron),
		});
	}
	for (const m of hoy.movimientos) {
		const actual = mapa.get(m.asesorId);
		if (!actual) continue;
		if (m.tipo === "bajada") actual.bajaron += 1;
		else actual.subieron += 1;
	}
	return mapa;
}

/** Promesas del equipo con fecha en el rango (hasta hoy). */
async function promesasDelEquipo(
	r: RangoFechas,
	userIds: string[],
	ahora: Date,
) {
	if (userIds.length === 0) {
		return { pactadas: 0, cumplidas: 0, montoIncumplido: 0 };
	}
	const tope = r.hasta.getTime() < ahora.getTime() ? r.hasta : ahora;
	const [fila] = await db
		.select({
			pactadas: sql<number>`count(*)::int`,
			cumplidas: sql<number>`count(*) FILTER (WHERE ${contactosCobros.estadoPromesa} = 'cumplida')::int`,
			// `monto_comprometido` es opcional e informativo: una promesa sin monto
			// suma 0 al incumplido.
			montoIncumplido: sql<string>`COALESCE(SUM(${contactosCobros.montoComprometido}) FILTER (WHERE ${contactosCobros.estadoPromesa} = 'incumplida'), 0)`,
		})
		.from(contactosCobros)
		.where(
			and(
				inArray(contactosCobros.realizadoPor, userIds),
				eq(contactosCobros.estadoContacto, "promesa_pago"),
				gte(contactosCobros.fechaProximoContacto, r.desde),
				lt(contactosCobros.fechaProximoContacto, tope),
			),
		);
	return {
		pactadas: Number(fila?.pactadas ?? 0),
		cumplidas: Number(fila?.cumplidas ?? 0),
		montoIncumplido: montoDe(fila?.montoIncumplido),
	};
}

/** Gestiones manuales registradas hoy por cada usuario (en vivo). */
async function contactosDeHoy(
	userIds: string[],
	ahora: Date,
): Promise<Map<string, number>> {
	const mapa = new Map<string, number>(userIds.map((id) => [id, 0]));
	if (userIds.length === 0) return mapa;
	const filas = await db
		.select({
			userId: contactosCobros.realizadoPor,
			total: sql<number>`count(*)::int`,
		})
		.from(contactosCobros)
		.where(
			and(
				inArray(contactosCobros.realizadoPor, userIds),
				gte(contactosCobros.fechaContacto, gtDateStrToDate(toDateStrGT(ahora))),
				ne(contactosCobros.estadoContacto, "link_pago_generado"),
				not(esGestionAutomatica()),
			),
		)
		.groupBy(contactosCobros.realizadoPor);
	for (const f of filas) if (f.userId) mapa.set(f.userId, Number(f.total));
	return mapa;
}

/** Corre un bloque; si falla lo deja en null y lo registra. */
async function intentar<T>(
	nombre: string,
	fn: () => Promise<T>,
): Promise<T | null> {
	try {
		return await fn();
	} catch (error) {
		console.error(
			`[getSupervisionComplementos] ${nombre} no disponible:`,
			error,
		);
		return null;
	}
}

export async function calcularKpisYEquipo(
	periodo: PeriodoDesempeno,
	ahora: Date = new Date(),
): Promise<{
	kpis: KpisEquipoSupervision | null;
	equipo: EquipoAsesorSupervision[] | null;
}> {
	const { actual, anterior } = rangosDesempeno(periodo, ahora);
	const equipo = await intentar("pool del equipo", asesoresDelEquipo);
	if (!equipo) return { kpis: null, equipo: null };

	const asesorIds = equipo.map((a) => a.asesorId);
	const userIds = equipo.flatMap((a) => (a.userId ? [a.userId] : []));
	// Bajadas, subidas y promesas se guardan por usuario del CRM. Si un asesor
	// activo del pool no tiene usuario vinculado (mismo correo), esos totales
	// quedarían sin su parte: se dejan en null en vez de mostrarlos incompletos.
	const equipoCompleto = userIds.length === equipo.length;
	if (!equipoCompleto) {
		console.warn(
			"[getSupervisionComplementos] asesores activos sin usuario del CRM:",
			equipo.filter((a) => !a.userId).map((a) => a.asesorId),
		);
	}

	const [
		recActual,
		recAnterior,
		metas,
		movActual,
		movAnterior,
		promesas,
		contactos,
		carga,
	] = await Promise.all([
		intentar("recuperación", () => recuperacionPorAsesor(actual, asesorIds)),
		intentar("recuperación anterior", () =>
			recuperacionPorAsesor(anterior, asesorIds),
		),
		intentar("metas", () => metasPorAsesor(asesorIds, actual)),
		intentar("movimientos de bucket", () =>
			movimientosPorUsuario(actual, userIds, ahora),
		),
		intentar("movimientos de bucket anteriores", () =>
			movimientosPorUsuario(anterior, userIds, ahora),
		),
		equipoCompleto
			? intentar("promesas", () => promesasDelEquipo(actual, userIds, ahora))
			: Promise.resolve(null),
		intentar("contactos de hoy", () => contactosDeHoy(userIds, ahora)),
		intentar("carga por bucket", () =>
			carteraBackClient.getCargaPorAsesorBucket(),
		),
	]);

	const metaPorAsesor = metas
		? metasDelPeriodo(periodo, actual, asesorIds, metas)
		: null;
	const sumar = (m: Map<unknown, number> | null) =>
		m ? [...m.values()].reduce((a, b) => a + b, 0) : null;
	const sumarBajadas = (m: Map<string, MovimientosUsuario> | null) =>
		m ? [...m.values()].reduce((a, v) => a + v.bajaron, 0) : null;

	const montoEquipo = sumar(recActual);
	const kpis: KpisEquipoSupervision = {
		recuperacion:
			montoEquipo == null
				? null
				: {
						monto: montoEquipo,
						meta: metaPorAsesor
							? metaDelEquipo([...metaPorAsesor.values()])
							: null,
						montoAnterior: sumar(recAnterior),
					},
		cuentasCuradas:
			movActual && carga && equipoCompleto
				? {
						curadas: sumarBajadas(movActual) ?? 0,
						// Universo: cuentas con mora hoy (B1 en adelante) de los asesores
						// del equipo; el resumen global de `buckets` incluiría también las
						// de asesores inactivos o fuera del pool.
						total: carga.porAsesor
							.filter((a) => asesorIds.includes(a.asesor_id))
							.flatMap((a) => a.porBucket)
							.filter((b) => b.bucket >= 1)
							.reduce((acc, b) => acc + b.cuentas, 0),
						curadasAnterior: sumarBajadas(movAnterior),
					}
				: null,
		promesasCumplidas: promesas,
	};

	const filas: EquipoAsesorSupervision[] = equipo.map((a) => {
		const mov = a.userId && movActual ? movActual.get(a.userId) : undefined;
		return {
			asesorId: a.asesorId,
			contactosHoy:
				a.userId && contactos ? (contactos.get(a.userId) ?? 0) : null,
			meta: metaCumplidaPct(
				recActual?.get(a.asesorId) ?? null,
				metaPorAsesor?.get(a.asesorId) ?? null,
			),
			rescate: mov ? rescatePct(mov.bajaron, mov.subieron) : null,
			recuperacion: resultadoCartera(
				recActual?.get(a.asesorId) ?? null,
				recAnterior?.get(a.asesorId) ?? null,
				metaPorAsesor?.get(a.asesorId) ?? null,
			),
		};
	});

	return { kpis, equipo: filas };
}

/**
 * M1 · Resultado de cartera por asesor, sin el resto de los KPIs. Misma fuente
 * que las filas de `calcularKpisYEquipo` (cartera por rango + metas), así las
 * tarjetas de Mi equipo y el dashboard cuadran. `null` si no hay pool o falla
 * la recuperación del período; si solo falla la anterior o las metas, esos
 * campos van `null` y el monto se muestra igual.
 */
export async function calcularRecuperacionAsesores(
	periodo: PeriodoDesempeno,
	ahora: Date = new Date(),
): Promise<RecuperacionAsesorSupervision[] | null> {
	const { actual, anterior } = rangosDesempeno(periodo, ahora);
	const equipo = await intentar("pool del equipo", asesoresDelEquipo);
	if (!equipo) return null;
	const asesorIds = equipo.map((a) => a.asesorId);
	const [recActual, recAnterior, metas] = await Promise.all([
		intentar("recuperación", () => recuperacionPorAsesor(actual, asesorIds)),
		intentar("recuperación anterior", () =>
			recuperacionPorAsesor(anterior, asesorIds),
		),
		intentar("metas", () => metasPorAsesor(asesorIds, actual)),
	]);
	if (!recActual) return null;
	const metaPorAsesor = metas
		? metasDelPeriodo(periodo, actual, asesorIds, metas)
		: null;
	return asesorIds.map((id) => ({
		asesorId: id,
		recuperacion: resultadoCartera(
			recActual.get(id) ?? null,
			recAnterior?.get(id) ?? null,
			metaPorAsesor?.get(id) ?? null,
		),
	}));
}
