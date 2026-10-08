/**
 * Rediseño COBROS-02 · Dashboard del asesor y Mi Cartera (Figma «CRM Ventas» ›
 * Asesor Junior / Asesor Senior). Datos personales del asesor logueado: SIEMPRE
 * se resuelven desde la sesión, nunca desde lo que mande el front.
 *
 * Un dato que no se pudo calcular (cartera caída, asesor sin pool) llega como
 * `null` y la card del front muestra "—"; nunca tumba el resto del bloque.
 * Detalle de cada tarea: docs/features/cobros-02/13-dashboard-asesor-backend.md
 */

import { and, eq, gte, inArray, lt, ne, not, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
	cierreDiarioCreditoCobros,
	contactosCobros,
	metasAsesorCobros,
} from "../db/schema/cobros";
import {
	calcularMovimientosBucketDelDia,
	type MovimientoBucketDelDia,
} from "../jobs/cierre-diario-asesores";
import {
	metaRecuperacionDelRango,
	PERIODOS_DESEMPENO,
	type PeriodoDesempeno,
	type RangoFechas,
	rangosDesempeno,
} from "../lib/desempeno-asesor";
import { toDateStrGT } from "../lib/guatemala-month-window";
import {
	esContactoEfectivo,
	esGestionAutomatica,
} from "../lib/historial-agendas";
import { cobrosProcedure, cobrosSupervisorProcedure } from "../lib/orpc";
import { PERMISSIONS } from "../lib/roles";
import { carteraBackClient } from "../services/cartera-back-client";

/** Nivel del asesor según los buckets de su pool en cartera (no es un rol del CRM). */
export type NivelAsesor = "junior" | "senior";

/**
 * Junior = B0–B1; senior = B2 en adelante (regla de negocio 2026-10-06: "los
 * junior están en B0 y B1, los senior en B2, B3, B4; es por bucket").
 */
export function nivelPorBuckets(buckets: number[]): NivelAsesor {
	return buckets.some((b) => b >= 2) ? "senior" : "junior";
}

/** Contrato de "Recuperación" (KPI de Mi desempeño). */
export interface RecuperacionAsesor {
	/**
	 * Q recuperados en el período: lo aplicado a cuotas ya vencidas el día del
	 * pago + la mora pagada (B2, regla de negocio 2026-10-07).
	 */
	monto: number;
	/** Q del mismo tramo del período anterior (para la tendencia ▲▼). */
	montoAnterior: number | null;
	/** Meta del asesor para el período en Q (tarea B3); null si no hay meta cargada. */
	meta: number | null;
}

async function contactabilidad(userId: string, r: RangoFechas) {
	const [fila] = await db
		.select({
			total: sql<number>`count(*)::int`,
			logrados: sql<number>`count(*) FILTER (WHERE ${esContactoEfectivo()} OR ${contactosCobros.estadoContacto} IN ('promesa_pago', 'pago_registrado'))::int`,
		})
		.from(contactosCobros)
		.where(
			and(
				eq(contactosCobros.realizadoPor, userId),
				gte(contactosCobros.fechaContacto, r.desde),
				lt(contactosCobros.fechaContacto, r.hasta),
				ne(contactosCobros.estadoContacto, "link_pago_generado"),
				not(esGestionAutomatica()),
			),
		);
	const total = Number(fila?.total ?? 0);
	const logrados = Number(fila?.logrados ?? 0);
	return {
		total,
		logrados,
		porcentaje: total > 0 ? Math.round((logrados / total) * 1000) / 10 : null,
	};
}

/**
 * Promesas del asesor cuya fecha prometida cae en el rango (hasta hoy):
 * pactadas = todas, cumplidas = las que cartera ya marcó cumplidas.
 */
async function promesas(userId: string, r: RangoFechas, ahora: Date) {
	const tope = r.hasta.getTime() < ahora.getTime() ? r.hasta : ahora;
	const [fila] = await db
		.select({
			pactadas: sql<number>`count(*)::int`,
			cumplidas: sql<number>`count(*) FILTER (WHERE ${contactosCobros.estadoPromesa} = 'cumplida')::int`,
		})
		.from(contactosCobros)
		.where(
			and(
				eq(contactosCobros.realizadoPor, userId),
				eq(contactosCobros.estadoContacto, "promesa_pago"),
				gte(contactosCobros.fechaProximoContacto, r.desde),
				lt(contactosCobros.fechaProximoContacto, tope),
			),
		);
	return {
		pactadas: Number(fila?.pactadas ?? 0),
		cumplidas: Number(fila?.cumplidas ?? 0),
	};
}

/** El asesor de cartera del usuario de la sesión (match por `email_cash_in`). */
async function asesorDeLaSesion(email: string | undefined) {
	if (!email) return undefined;
	const pool = await carteraBackClient.getPoolPorAsesor();
	return pool.find((a) => a.email_cash_in?.trim().toLowerCase() === email);
}

function emailDeLaSesion(context: {
	session?: { user?: { email?: string | null } | null } | null;
}): string | undefined {
	return context.session?.user?.email?.trim().toLowerCase() || undefined;
}

/**
 * B2 + B3: recuperación del asesor en el período y el anterior, con su meta
 * prorrateada. null si cartera no responde: el KPI muestra "—".
 */
async function recuperacionDelAsesor(
	asesorId: number,
	periodo: PeriodoDesempeno,
	actual: RangoFechas,
	anterior: RangoFechas,
): Promise<RecuperacionAsesor | null> {
	try {
		const montoDe = async (r: RangoFechas) => {
			const resp = await carteraBackClient.getRecuperacionPorAsesorRango({
				fechaDesde: r.desdeStr,
				fechaHasta: r.hastaStr,
				asesores: [asesorId],
			});
			const fila = resp.porAsesor.find((a) => a.asesorId === asesorId);
			return fila ? Number(fila.monto) : 0;
		};
		const [monto, montoAnterior, metas] = await Promise.all([
			montoDe(actual),
			montoDe(anterior),
			metasDelAsesorEnRango(asesorId, actual),
		]);
		const meta = metaRecuperacionDelRango(
			periodo,
			actual,
			(anio, mes) => metas.get(`${anio}-${mes}`) ?? null,
		);
		return { monto, montoAnterior, meta };
	} catch (error) {
		console.error("[getMiDesempeno] recuperación no disponible:", error);
		return null;
	}
}

/** Metas mensuales del asesor para los meses que toca el rango ("anio-mes" → Q). */
async function metasDelAsesorEnRango(asesorId: number, r: RangoFechas) {
	const meses = new Map<string, { anio: number; mes: number }>();
	for (const fecha of [r.desdeStr, r.hastaStr]) {
		const [anio, mes] = fecha.split("-").map(Number);
		meses.set(`${anio}-${mes}`, { anio, mes });
	}
	const filas = await db
		.select({
			anio: metasAsesorCobros.anio,
			mes: metasAsesorCobros.mes,
			monto: metasAsesorCobros.montoRecuperacion,
		})
		.from(metasAsesorCobros)
		.where(
			and(
				eq(metasAsesorCobros.asesorId, asesorId),
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
	return new Map(filas.map((f) => [`${f.anio}-${f.mes}`, Number(f.monto)]));
}

/**
 * B9: movimientos de bucket de HOY en vivo. Se recalculan con la misma regla
 * del cierre de las 22:00 (`calcularMovimientosBucketDelDia`), que lee toda la
 * bitácora del día: por eso se guarda unos minutos y la comparten todos los
 * asesores.
 */
const TTL_MOVIMIENTOS_HOY_MS = 2 * 60 * 1000;
let movimientosHoyCache:
	| { fecha: string; en: number; datos: Promise<MovimientoBucketDelDia[]> }
	| undefined;

function movimientosDeHoy(hoyStr: string): Promise<MovimientoBucketDelDia[]> {
	const ahora = Date.now();
	if (
		movimientosHoyCache &&
		movimientosHoyCache.fecha === hoyStr &&
		ahora - movimientosHoyCache.en < TTL_MOVIMIENTOS_HOY_MS
	) {
		return movimientosHoyCache.datos;
	}
	const datos = calcularMovimientosBucketDelDia(hoyStr);
	movimientosHoyCache = { fecha: hoyStr, en: ahora, datos };
	// Un fallo no se queda guardado: la próxima carga vuelve a intentar.
	datos.catch(() => {
		if (movimientosHoyCache?.datos === datos) movimientosHoyCache = undefined;
	});
	return datos;
}

/**
 * Lo que falta sumar al cierre para que el rango incluya hoy. Si el cierre de
 * movimientos de hoy ya corrió, sus filas ya están en `movimiento` y no se suma
 * nada (sin doble conteo). Solo cuentan las filas de subida/bajada: el cierre
 * inserta primero los contactos y después los movimientos, así que una fila de
 * contacto no prueba que el paso de movimientos terminó. `incluyeHoy: false`
 * solo si no se pudo calcular.
 */
async function movimientoDeHoyEnVivo(
	userId: string,
	r: RangoFechas,
	ahora: Date,
): Promise<{ subieron: number; bajaron: number; incluyeHoy: boolean }> {
	const hoyStr = toDateStrGT(ahora);
	const sinNada = { subieron: 0, bajaron: 0, incluyeHoy: true };
	if (r.hastaStr !== hoyStr) return sinNada;
	try {
		const [cierreDeHoy] = await db
			.select({ fecha: cierreDiarioCreditoCobros.fecha })
			.from(cierreDiarioCreditoCobros)
			.where(
				and(
					eq(cierreDiarioCreditoCobros.fecha, hoyStr),
					inArray(cierreDiarioCreditoCobros.tipo, ["subida", "bajada"]),
				),
			)
			.limit(1);
		if (cierreDeHoy) return sinNada;
		const propios = (await movimientosDeHoy(hoyStr)).filter(
			(m) => m.asesorId === userId,
		);
		return {
			subieron: propios.filter((m) => m.tipo === "subida").length,
			bajaron: propios.filter((m) => m.tipo === "bajada").length,
			incluyeHoy: true,
		};
	} catch (error) {
		console.error("[getMiDesempeno] movimiento de hoy no disponible:", error);
		return { subieron: 0, bajaron: 0, incluyeHoy: false };
	}
}

/** Créditos que bajaron / subieron de bucket, del cierre diario (corre a las 22:00). */
async function movimiento(userId: string, r: RangoFechas) {
	const [fila] = await db
		.select({
			subieron: sql<number>`count(*) FILTER (WHERE ${cierreDiarioCreditoCobros.tipo} = 'subida')::int`,
			bajaron: sql<number>`count(*) FILTER (WHERE ${cierreDiarioCreditoCobros.tipo} = 'bajada')::int`,
		})
		.from(cierreDiarioCreditoCobros)
		.where(
			and(
				eq(cierreDiarioCreditoCobros.asesorId, userId),
				gte(cierreDiarioCreditoCobros.fecha, r.desdeStr),
				sql`${cierreDiarioCreditoCobros.fecha} <= ${r.hastaStr}`,
				inArray(cierreDiarioCreditoCobros.tipo, ["subida", "bajada"]),
			),
		);
	return {
		subieron: Number(fila?.subieron ?? 0),
		bajaron: Number(fila?.bajaron ?? 0),
	};
}

export const cobrosAsesorRouter = {
	/**
	 * Quién es el usuario para cobros: su asesor de cartera, sus buckets y su
	 * nivel. El front arma con esto el Dashboard y los chips de bucket de Mi
	 * Cartera (B0/B1 para junior; B2–B4 para senior).
	 */
	getMiPerfilCobros: cobrosProcedure.handler(async ({ context }) => {
		const esSupervision = PERMISSIONS.canAssignCobros(context.userRole ?? "");
		const propio = await asesorDeLaSesion(emailDeLaSesion(context));
		const buckets = [...(propio?.buckets ?? [])].sort((a, b) => a - b);
		return {
			esSupervision,
			sinAsesor: !propio,
			asesorId: propio?.asesor_id ?? null,
			nombre: propio?.nombre ?? context.session?.user?.name ?? null,
			buckets,
			nivel: nivelPorBuckets(buckets),
		};
	}),

	/**
	 * KPIs de "Mi desempeño" (Figma: Recuperación, Promesas cumplidas,
	 * Contactabilidad, Movimiento). La "Mora de mi cartera" y "Cartera al día"
	 * salen de `getCobrosDashboardStats` (ya filtrado por sesión).
	 */
	getMiDesempeno: cobrosProcedure
		.input(z.object({ periodo: z.enum(PERIODOS_DESEMPENO) }))
		.handler(async ({ input, context }) => {
			const ahora = new Date();
			const { actual, anterior } = rangosDesempeno(input.periodo, ahora);
			const userId = context.userId;
			const asesor = await asesorDeLaSesion(emailDeLaSesion(context)).catch(
				(error) => {
					console.error(
						"[getMiDesempeno] pool de cartera no disponible:",
						error,
					);
					return undefined;
				},
			);
			const [cA, cP, pA, pP, mov, movHoy, recuperacion] = await Promise.all([
				contactabilidad(userId, actual),
				contactabilidad(userId, anterior),
				promesas(userId, actual, ahora),
				promesas(userId, anterior, ahora),
				movimiento(userId, actual),
				movimientoDeHoyEnVivo(userId, actual, ahora),
				asesor
					? recuperacionDelAsesor(
							asesor.asesor_id,
							input.periodo,
							actual,
							anterior,
						)
					: Promise.resolve(null),
			]);

			return {
				periodo: input.periodo,
				rango: { desde: actual.desdeStr, hasta: actual.hastaStr },
				rangoAnterior: { desde: anterior.desdeStr, hasta: anterior.hastaStr },
				recuperacion,
				promesas: {
					cumplidas: pA.cumplidas,
					pactadas: pA.pactadas,
					cumplidasAnterior: pP.cumplidas,
					pactadasAnterior: pP.pactadas,
				},
				contactabilidad: {
					porcentaje: cA.porcentaje,
					porcentajeAnterior: cP.porcentaje,
					logrados: cA.logrados,
					intentos: cA.total,
				},
				movimiento: {
					// Cierre diario (días cerrados) + lo de hoy en vivo (B9).
					bajaron: mov.bajaron + movHoy.bajaron,
					subieron: mov.subieron + movHoy.subieron,
					incluyeHoy: movHoy.incluyeHoy,
				},
			};
		}),

	/**
	 * Contadores de la "Agenda de hoy" que todavía no tienen fuente. Conectados
	 * en el front como "pronto" mientras sean null.
	 */
	getMiAgendaContadoresPendientes: cobrosProcedure.handler(async () => {
		// TODO(José) · tarea B6: pagos reportados por el cliente que esperan
		// validación, de los créditos del asesor de la sesión (definir con negocio
		// la fuente: pagos_credito.validation_status='pending' en cartera, boletas
		// del bot en revisión, …). Número, o null si no aplica.
		const pagosPorConfirmar: number | null = null;
		// TODO(José) · tarea B7: créditos del asesor con referencias que hay que
		// contactar (definir la regla: p. ej. N intentos fallidos al titular y
		// referencias sin gestión). Número, o null si no aplica.
		const referenciasPorContactar: number | null = null;
		return { pagosPorConfirmar, referenciasPorContactar };
	}),
};

/**
 * B3: metas de recuperación por asesor. Va en su propio router, montado en
 * `src/index.ts` y no en `routers/index.ts`: `cobrosAppRouter` está en el
 * límite donde TS7056 trunca el tipo en silencio (ver la nota de
 * `routers/bucket-capacidad.ts`); con dos miembros más, el web perdía el tipo
 * de todo cobros. Si el front lo consume, se tipa en `orpcAparte`.
 */
export const metasAsesorCobrosRouter = {
	/**
	 * B3: metas de recuperación (Q) de todos los asesores del pool para un mes.
	 * Las ve cualquiera de cobros; las edita el supervisor.
	 */
	getMetasAsesor: cobrosProcedure
		.input(
			z.object({
				mes: z.number().int().min(1).max(12),
				anio: z.number().int().min(2024),
			}),
		)
		.handler(async ({ input }) => {
			const [pool, filas] = await Promise.all([
				carteraBackClient.getPoolPorAsesor(),
				db
					.select({
						asesorId: metasAsesorCobros.asesorId,
						montoRecuperacion: metasAsesorCobros.montoRecuperacion,
						updatedAt: metasAsesorCobros.updatedAt,
					})
					.from(metasAsesorCobros)
					.where(
						and(
							eq(metasAsesorCobros.anio, input.anio),
							eq(metasAsesorCobros.mes, input.mes),
						),
					),
			]);
			const metaPorAsesor = new Map(filas.map((f) => [f.asesorId, f]));
			return pool
				.filter((a) => a.activo)
				.map((a) => ({
					asesorId: a.asesor_id,
					nombre: a.nombre,
					buckets: [...a.buckets].sort((x, y) => x - y),
					montoRecuperacion:
						metaPorAsesor.get(a.asesor_id)?.montoRecuperacion ?? null,
					actualizadaEn: metaPorAsesor.get(a.asesor_id)?.updatedAt ?? null,
				}))
				.sort((x, y) => x.nombre.localeCompare(y.nombre, "es"));
		}),

	/**
	 * B3: guarda las metas de un mes. `montoRecuperacion: null` borra la meta
	 * del asesor (queda "sin meta" y el KPI no muestra porcentaje).
	 */
	upsertMetasAsesor: cobrosSupervisorProcedure
		.input(
			z.object({
				mes: z.number().int().min(1).max(12),
				anio: z.number().int().min(2024),
				metas: z
					.array(
						z.object({
							asesorId: z.number().int().positive(),
							montoRecuperacion: z
								.string()
								.regex(/^\d{1,12}(\.\d{1,2})?$/, "Formato de monto inválido")
								.nullable(),
						}),
					)
					.max(200),
			}),
		)
		.handler(async ({ input, context }) => {
			await db.transaction(async (tx) => {
				for (const meta of input.metas) {
					const delAsesor = and(
						eq(metasAsesorCobros.asesorId, meta.asesorId),
						eq(metasAsesorCobros.anio, input.anio),
						eq(metasAsesorCobros.mes, input.mes),
					);
					if (meta.montoRecuperacion === null) {
						await tx.delete(metasAsesorCobros).where(delAsesor);
						continue;
					}
					await tx
						.insert(metasAsesorCobros)
						.values({
							asesorId: meta.asesorId,
							anio: input.anio,
							mes: input.mes,
							montoRecuperacion: meta.montoRecuperacion,
							actualizadoPor: context.userId,
						})
						.onConflictDoUpdate({
							target: [
								metasAsesorCobros.asesorId,
								metasAsesorCobros.anio,
								metasAsesorCobros.mes,
							],
							set: {
								montoRecuperacion: meta.montoRecuperacion,
								actualizadoPor: context.userId,
								updatedAt: new Date(),
							},
						});
				}
			});
			return { guardadas: input.metas.length };
		}),
};
