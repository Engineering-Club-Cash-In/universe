/**
 * Dashboard del supervisor · «Sus pendientes de hoy» (tareas S1 y S2).
 * Decisiones en docs/features/cobros-02/23-plan-backend-supervision.md.
 *
 * Cada conteo falla solo: si una fuente no responde ese campo llega `null` y
 * el front muestra «—». La barra «x de y resueltas hoy» es todo o nada: con
 * una sola fuente caída se deja en `null` en vez de mostrar un número corto.
 */

import { and, count, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
	casosCobros,
	contactosCobros,
	recuperacionesVehiculo,
	solicitudesDocumentosCobros,
	solicitudesJuridicoCobros,
	solicitudesRebajaMoraCobros,
} from "../db/schema/cobros";
import { inmovilizacionesUnidadEventos } from "../db/schema/inmovilizacion-unidad";
import { agruparCasosVigentesPorSifco } from "../lib/caso-vigente";
import { fetchAllPages } from "../lib/fetch-all-pages";
import { gtDateStrToDate, toDateStrGT } from "../lib/guatemala-month-window";
import { esGestionAutomatica } from "../lib/historial-agendas";
import {
	DIAS_VENTANA_PREJURIDICO,
	listosPrejuridico,
	sifcosProximosAB4,
} from "../lib/prejuridico";
import { esPromesaVigente } from "../lib/promesa-vigente";
import { diasHabilesSinContacto, estaSinContacto } from "../lib/sin-contacto";
import type { PendientesSupervision } from "../routers/supervision-cobros";
import { carteraBackClient } from "./cartera-back-client";

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

/** Solicitudes de documentos que esperan autorización (F6). */
async function documentosPorAutorizar(): Promise<number> {
	const [fila] = await db
		.select({ total: count() })
		.from(solicitudesDocumentosCobros)
		.where(eq(solicitudesDocumentosCobros.estado, "pendiente"));
	return Number(fila?.total ?? 0);
}

/**
 * Rebajas de mora que el supervisor todavía puede resolver: `pendiente` y
 * `error_aplicacion` (la aprobación quedó a medias y se puede repetir).
 */
async function rebajasPorRevisar(): Promise<number> {
	const [fila] = await db
		.select({ total: count() })
		.from(solicitudesRebajaMoraCobros)
		.where(
			inArray(solicitudesRebajaMoraCobros.estado, [
				"pendiente",
				"error_aplicacion",
			]),
		);
	return Number(fila?.total ?? 0);
}

/** Créditos del equipo a punto de caer a B4 (criterio en lib/prejuridico.ts). */
async function contarListosPrejuridico(ahora: Date): Promise<number> {
	const dias = Array.from(
		{ length: DIAS_VENTANA_PREJURIDICO + 1 },
		(_, i) => i,
	);
	const cuotas = await fetchAllPages(
		async (page) => {
			const resp = await carteraBackClient.getCuotasProximasVencer(dias, {
				soloAlDia: false,
				buckets: [3],
				page,
				perPage: 200,
			});
			return { data: resp.data ?? [], totalPages: resp.totalPages ?? 0 };
		},
		{ maxPages: 100 },
	);
	const proximos = sifcosProximosAB4(cuotas);
	if (proximos.size === 0) return 0;

	// Solo el caso vigente de cada SIFCO: una promesa olvidada en un caso viejo
	// (reaperturas, migraciones) no debe sacar al crédito del conteo.
	const casos = await db
		.select({
			id: casosCobros.id,
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			activo: casosCobros.activo,
			updatedAt: casosCobros.updatedAt,
		})
		.from(casosCobros)
		.where(inArray(casosCobros.numeroCreditoSifco, [...proximos]));
	const vigentes = [...agruparCasosVigentesPorSifco(casos).values()];
	const sifcoPorCaso = new Map(
		vigentes.map((c) => [c.id, c.numeroCreditoSifco]),
	);
	const conPromesa =
		vigentes.length === 0
			? []
			: await db
					.selectDistinct({ casoCobroId: contactosCobros.casoCobroId })
					.from(contactosCobros)
					.where(
						and(
							inArray(
								contactosCobros.casoCobroId,
								vigentes.map((c) => c.id),
							),
							esPromesaVigente(ahora),
						),
					);
	return listosPrejuridico(
		proximos,
		new Set(
			conPromesa.flatMap((f) => {
				const sifco = sifcoPorCaso.get(f.casoCobroId);
				return sifco ? [sifco] : [];
			}),
		),
	).length;
}

/**
 * Aprobaciones que ESTE supervisor resolvió hoy: convenios, recuperaciones,
 * apagados y reactivaciones, rebajas, jurídico y documentos. Solo cuentan las
 * aprobadas y rechazadas; una cancelación no es una decisión del supervisor.
 */
async function aprobacionesResueltasHoy(
	userId: string,
	email: string | undefined,
	ahora: Date,
): Promise<{
	aprobaciones: number;
	otras: { rebajas: number; documentos: number; juridico: number };
}> {
	const inicioHoy = gtDateStrToDate(toDateStrGT(ahora));
	const conteo = async (
		tabla:
			| typeof solicitudesRebajaMoraCobros
			| typeof solicitudesJuridicoCobros
			| typeof solicitudesDocumentosCobros,
	) => {
		const [fila] = await db
			.select({ total: count() })
			.from(tabla)
			.where(
				and(
					eq(tabla.resueltoPor, userId),
					gte(tabla.resueltoEn, inicioHoy),
					// «aplicada» es una rebaja/escalamiento aprobado y ya aplicado.
					inArray(tabla.estado, [
						"aprobada",
						"aplicada",
						"rechazada",
						"error_aplicacion",
					]),
				),
			);
		return Number(fila?.total ?? 0);
	};

	const [
		recuperaciones,
		inmovilizaciones,
		rebajas,
		juridico,
		documentos,
		convenios,
	] = await Promise.all([
		db
			.select({ total: count() })
			.from(recuperacionesVehiculo)
			.where(
				and(
					eq(recuperacionesVehiculo.decididoPor, userId),
					gte(recuperacionesVehiculo.decididoAt, inicioHoy),
					inArray(recuperacionesVehiculo.estadoSolicitud, [
						"aprobada",
						"rechazada",
					]),
				),
			)
			.then(([f]) => Number(f?.total ?? 0)),
		// Se cuentan los EVENTOS de decisión de hoy, no el estado actual: una
		// aprobación que luego se cancela (falla una precondición o la cancela un
		// supervisor) sigue siendo trabajo que se hizo hoy.
		db
			.select({
				total: sql<number>`count(DISTINCT ${inmovilizacionesUnidadEventos.inmovilizacionId})::int`,
			})
			.from(inmovilizacionesUnidadEventos)
			.where(
				and(
					eq(inmovilizacionesUnidadEventos.usuarioId, userId),
					gte(inmovilizacionesUnidadEventos.createdAt, inicioHoy),
					eq(
						inmovilizacionesUnidadEventos.estadoAnterior,
						"pendiente_aprobacion",
					),
					inArray(inmovilizacionesUnidadEventos.estadoNuevo, [
						"aprobada",
						"rechazada",
					]),
				),
			)
			.then(([f]) => Number(f?.total ?? 0)),
		conteo(solicitudesRebajaMoraCobros),
		conteo(solicitudesJuridicoCobros),
		conteo(solicitudesDocumentosCobros),
		email
			? carteraBackClient
					.getConvenioDecisionesConteo({
						decididoPorEmail: email,
						desde: inicioHoy,
					})
					.then((r) => r.total)
			: Promise.resolve(0),
	]);
	// `aprobaciones` solo suma los tipos que el Dashboard ya trae en su lista de
	// pendientes (convenios, recuperaciones y apagados): la barra «x de y» usa
	// pendientes + resueltas, y sumar aquí tipos que no están del lado de los
	// pendientes daría «1 de 1» con trabajo todavía por hacer. Los demás tipos
	// van aparte, hasta que el front los incluya en ambos lados.
	return {
		aprobaciones: recuperaciones + inmovilizaciones + convenios,
		otras: { rebajas, documentos, juridico },
	};
}

export async function calcularPendientes(
	sesion: { userId: string; email?: string | null },
	ahora: Date = new Date(),
): Promise<PendientesSupervision> {
	const email = sesion.email?.trim().toLowerCase();
	const [documentos, rebajas, prejuridico, resueltas] = await Promise.all([
		intentar("documentos por autorizar", documentosPorAutorizar),
		intentar("rebajas por revisar", rebajasPorRevisar),
		intentar("listos para Prejurídico", () => contarListosPrejuridico(ahora)),
		intentar("aprobaciones resueltas hoy", () =>
			aprobacionesResueltasHoy(sesion.userId, email, ahora),
		),
	]);
	return {
		documentosPorAutorizar: documentos,
		rebajasPorRevisar: rebajas,
		listosPrejuridico: prejuridico,
		aprobacionesResueltasHoy: resueltas?.aprobaciones ?? null,
		otrasResueltasHoy: resueltas?.otras ?? null,
	};
}

/**
 * S2 · créditos del equipo con al menos 3 días hábiles completos sin gestión
 * manual. Mismo universo y misma regla que la categoría `sin_contacto` de
 * `getColaDia` (lib/sin-contacto.ts), así el conteo cuadra con la lista a la
 * que enlaza el Dashboard.
 */
export async function contarSinContactoEquipo(
	ahora: Date = new Date(),
): Promise<number> {
	const universo = await fetchAllPages(
		async (page) => {
			const resp = await carteraBackClient.getColaDiaSLA({
				page,
				perPage: 100,
			});
			return { data: resp.data, totalPages: resp.totalPages ?? 0 };
		},
		{ maxPages: 200 },
	);
	const sifcos = [...new Set(universo.map((c) => c.numero_credito_sifco))];
	if (sifcos.length === 0) return 0;

	const casos = await db
		.select({
			id: casosCobros.id,
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			activo: casosCobros.activo,
			updatedAt: casosCobros.updatedAt,
		})
		.from(casosCobros)
		.where(inArray(casosCobros.numeroCreditoSifco, sifcos));
	const casoIds = [...agruparCasosVigentesPorSifco(casos).values()].map(
		(c) => c.id,
	);
	if (casoIds.length === 0) return 0;

	const ultimas = await db
		.select({
			casoCobroId: contactosCobros.casoCobroId,
			ultimaManual:
				sql<Date | null>`max(${contactosCobros.fechaContacto})`.mapWith(
					contactosCobros.fechaContacto,
				),
		})
		.from(contactosCobros)
		.where(
			and(
				inArray(contactosCobros.casoCobroId, casoIds),
				isNotNull(contactosCobros.fechaContacto),
				sql`${contactosCobros.estadoContacto} <> 'link_pago_generado'`,
				sql`NOT ${esGestionAutomatica()}`,
			),
		)
		.groupBy(contactosCobros.casoCobroId);

	return ultimas.filter(
		(u) =>
			u.ultimaManual != null &&
			estaSinContacto(diasHabilesSinContacto(u.ultimaManual, ahora)),
	).length;
}
