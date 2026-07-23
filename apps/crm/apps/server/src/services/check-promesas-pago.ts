/**
 * CB-020 — Cierre nocturno de Promesas de Pago.
 *
 * getEstadoPromesasPago (routers/cobros.ts) recalcula el estado de una
 * promesa cada vez que un asesor abre el caso — pero si nadie lo abre, una
 * promesa vencida se queda "pendiente" indefinidamente. Este job corre TODAS
 * las noches y evalúa TODAS las promesas activas (pendiente o incumplida —
 * una incumplida puede volverse cumplida si el cliente pagó después) sin
 * depender de que alguien visite la página del caso.
 *
 * Usa la MISMA lógica pura que el endpoint on-demand (lib/promesa-pago.ts) —
 * una sola fuente de verdad, no se puede divergir entre ambos caminos.
 *
 * Nunca lanza al caller: devuelve un resumen y loguea (patrón premora).
 */

import { and, eq, inArray, isNull, max, ne, or } from "drizzle-orm";
import { db } from "../db";
import { casosCobros, contactosCobros } from "../db/schema/cobros";
import { notifications } from "../db/schema/notifications";
import {
	derivarEstadoCredito,
	type EstadoPromesa,
	evaluarPromesa,
} from "../lib/promesa-pago";
import { carteraBackClient } from "./cartera-back-client";
import { isCarteraBackEnabled } from "./cartera-back-integration";
import {
	construirMapaAsesorUsuario,
	filasNotificacionCobros,
	obtenerSupervisoresCobros,
	resolverUsuarioSistemaCobros,
} from "./cobros-notif-helpers";

const LOG_PREFIX = "[PromesasPago]";

export interface CheckPromesasResumen {
	evaluadas: number;
	cumplidas: number;
	incumplidas: number;
	pendientes: number;
	sinCaso: number;
	errores: number;
	skipped?: boolean;
	reason?: string;
}

function resumenVacio(
	partial: Partial<CheckPromesasResumen> = {},
): CheckPromesasResumen {
	return {
		evaluadas: 0,
		cumplidas: 0,
		incumplidas: 0,
		pendientes: 0,
		sinCaso: 0,
		errores: 0,
		...partial,
	};
}

export async function checkPromesasPago(): Promise<CheckPromesasResumen> {
	try {
		if (!isCarteraBackEnabled()) {
			console.log(`${LOG_PREFIX} Cartera-back deshabilitado; job omitido`);
			return resumenVacio({ skipped: true, reason: "cartera_back_disabled" });
		}

		// 1. Promesas activas — pendiente O incumplida (una incumplida puede
		// pasar a cumplida si el cliente pagó después de que se marcó así).
		// "cumplida" no se re-evalúa: es terminal, no hay forma de "des-cumplir".
		const promesas = await db
			.select({
				id: contactosCobros.id,
				casoCobroId: contactosCobros.casoCobroId,
				cuotaInicio: contactosCobros.cuotaInicio,
				cuotaFin: contactosCobros.cuotaFin,
				incluyeMora: contactosCobros.incluyeMora,
				fechaProximoContacto: contactosCobros.fechaProximoContacto,
			})
			.from(contactosCobros)
			.where(
				and(
					eq(contactosCobros.estadoContacto, "promesa_pago"),
					or(
						isNull(contactosCobros.estadoPromesa),
						ne(contactosCobros.estadoPromesa, "cumplida"),
					),
				),
			);

		if (promesas.length === 0) return resumenVacio();
		// evaluadas NO se fija aquí — se calcula al final como cumplidas +
		// incumplidas + pendientes, así siempre cuadra con lo que realmente se
		// evaluó (promesas.length incluye filas que después se saltan por
		// sinCaso o fecha faltante, y fijar evaluadas=promesas.length de
		// entrada dejaba el log desalineado: "evaluó N" pero solo sumaba N-X).
		const resumen = resumenVacio();

		// 2. Batch: numeroCreditoSifco de cada caso (la llave hacia cartera-back).
		const casoIds = [...new Set(promesas.map((p) => p.casoCobroId))];
		const casos = await db
			.select({
				id: casosCobros.id,
				numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			})
			.from(casosCobros)
			.where(inArray(casosCobros.id, casoIds));
		const sifcoPorCaso = new Map(
			casos.map((c) => [c.id, c.numeroCreditoSifco]),
		);

		// 3. Agrupar promesas por SIFCO — un solo getCredito por crédito, sin
		// importar cuántas promesas tenga (varias comparten la misma foto).
		const promesasPorSifco = new Map<string, typeof promesas>();
		for (const promesa of promesas) {
			const sifco = sifcoPorCaso.get(promesa.casoCobroId);
			if (!sifco) {
				resumen.sinCaso++;
				continue;
			}
			const grupo = promesasPorSifco.get(sifco) ?? [];
			grupo.push(promesa);
			promesasPorSifco.set(sifco, grupo);
		}

		// Promesas incumplidas de ESTA corrida → alimentan la notificación del
		// propósito 1 tras confirmar que el UPDATE persistió. No se depende de
		// "atrapar la transición": la de-duplicación se hace contra las
		// notificaciones ya existentes (ver notificarPromesasIncumplidas), así que
		// si una creación falló, la próxima corrida la reintenta (Codex P2).
		const incumplidas: Array<{
			casoId: string;
			sifco: string;
			cliente: string;
			asesorId: number | null;
			asesorNombre: string;
			fechaPrometida: Date;
		}> = [];

		const hoy = new Date();
		for (const [sifco, grupo] of promesasPorSifco) {
			try {
				const credito = await carteraBackClient.getCredito(sifco);
				const estadoCredito = derivarEstadoCredito(credito);

				const actualizaciones: Array<{ id: string; estado: EstadoPromesa }> =
					[];
				// Candidatas a notificar: toda promesa incumplida de este crédito
				// (con su fecha prometida, que ancla el dedup por episodio).
				const candidatos: Array<{
					promesaId: string;
					casoId: string;
					fechaPrometida: Date;
				}> = [];
				for (const promesa of grupo) {
					if (!promesa.fechaProximoContacto) continue; // fecha obligatoria en el modal, defensivo
					const estado = evaluarPromesa(
						{
							id: promesa.id,
							cuotaInicio: promesa.cuotaInicio,
							cuotaFin: promesa.cuotaFin,
							incluyeMora: promesa.incluyeMora,
							fechaPrometida: promesa.fechaProximoContacto,
						},
						estadoCredito,
						hoy,
					);
					actualizaciones.push({ id: promesa.id, estado });
					if (estado === "incumplida") {
						candidatos.push({
							promesaId: promesa.id,
							casoId: promesa.casoCobroId,
							fechaPrometida: promesa.fechaProximoContacto,
						});
					}
					if (estado === "cumplida") resumen.cumplidas++;
					else if (estado === "incumplida") resumen.incumplidas++;
					else resumen.pendientes++;
				}

				// allSettled, no all: un UPDATE que falle no debe tumbar los demás
				// del mismo crédito — con Promise.all, una fila mala bloqueaba la
				// persistencia de TODAS sus hermanas (aunque ya se hubieran
				// calculado bien), y el catch de abajo las contaba a todas como
				// error aunque solo una fallara.
				const resultados = await Promise.allSettled(
					actualizaciones.map(({ id, estado }) =>
						db
							.update(contactosCobros)
							.set({ estadoPromesa: estado })
							.where(eq(contactosCobros.id, id)),
					),
				);
				const idsRechazados = new Set<string>();
				for (let i = 0; i < resultados.length; i++) {
					const resultado = resultados[i];
					if (resultado.status === "rejected") {
						const { estado } = actualizaciones[i];
						// Revertir el conteo de éxito hecho arriba — la evaluación fue
						// correcta pero la escritura falló, no debe contar como logro.
						if (estado === "cumplida") resumen.cumplidas--;
						else if (estado === "incumplida") resumen.incumplidas--;
						else resumen.pendientes--;
						resumen.errores++;
						idsRechazados.add(actualizaciones[i].id);
						console.error(
							`${LOG_PREFIX} Error persistiendo promesa ${actualizaciones[i].id}:`,
							resultado.reason,
						);
					}
				}

				// Solo considerar incumplidas cuyo UPDATE sí persistió.
				for (const c of candidatos) {
					if (idsRechazados.has(c.promesaId)) continue;
					incumplidas.push({
						casoId: c.casoId,
						sifco,
						cliente: credito.usuario?.nombre ?? "",
						asesorId: credito.asesor?.asesor_id ?? null,
						asesorNombre: credito.asesor?.nombre ?? "",
						fechaPrometida: c.fechaPrometida,
					});
				}
			} catch (error) {
				resumen.errores += grupo.length;
				console.error(
					`${LOG_PREFIX} Error evaluando promesas del crédito ${sifco}:`,
					error,
				);
			}
		}

		// evaluadas = suma real de lo que se resolvió, no promesas.length (que
		// incluía sinCaso/fecha-faltante/errores de credito no evaluados).
		resumen.evaluadas =
			resumen.cumplidas + resumen.incumplidas + resumen.pendientes;

		// Propósito 1: avisar al asesor + supervisores de cada promesa que venció
		// en esta corrida. Nunca tumba el job (patrón del resto de notificaciones).
		try {
			await notificarPromesasIncumplidas(incumplidas);
		} catch (err) {
			console.error(
				`${LOG_PREFIX} Error creando notificaciones de promesa incumplida:`,
				err,
			);
		}

		console.log(
			`${LOG_PREFIX} ${resumen.evaluadas} evaluada(s) → ${resumen.cumplidas} cumplida(s), ${resumen.incumplidas} incumplida(s), ${resumen.pendientes} pendiente(s), ${resumen.sinCaso} sin caso, ${resumen.errores} error(es)`,
		);
		return resumen;
	} catch (err) {
		console.error(`${LOG_PREFIX} Error general del job:`, err);
		return resumenVacio({ errores: 1 });
	}
}

/**
 * Propósito 1 (COBROS-02): notifica al asesor + supervisores cada promesa de
 * pago incumplida. Una notificación por caso (la promesa incumplida más reciente
 * si hay varias).
 *
 * IDEMPOTENTE Y RETRYABLE (Codex P2): en vez de depender de "atrapar la
 * transición" pendiente→incumplida, se dispara para TODA incumplida y se
 * deduplica contra las notificaciones ya existentes: se crea solo si NO hay una
 * promesa_incumplida para el caso creada DESPUÉS de la fecha prometida. Así, si
 * un insert falló (sin usuario sistema, error de DB, etc.), la próxima corrida
 * lo reintenta; y una promesa posterior (fecha más nueva) vuelve a disparar.
 */
async function notificarPromesasIncumplidas(
	incumplidas: Array<{
		casoId: string;
		sifco: string;
		cliente: string;
		asesorId: number | null;
		asesorNombre: string;
		fechaPrometida: Date;
	}>,
): Promise<void> {
	if (incumplidas.length === 0) return;

	// Una por caso: la promesa incumplida con la fecha prometida más reciente.
	const porCaso = new Map<string, (typeof incumplidas)[number]>();
	for (const it of incumplidas) {
		const prev = porCaso.get(it.casoId);
		if (!prev || it.fechaPrometida.getTime() > prev.fechaPrometida.getTime()) {
			porCaso.set(it.casoId, it);
		}
	}
	const items = [...porCaso.values()];
	const casoIds = items.map((t) => t.casoId);

	// Dedup por episodio: última promesa_incumplida creada por caso. Se salta si
	// ya hay una posterior a la fecha prometida de esta incumplida.
	const ultimaNotif = await maxNotifPromesaPorCaso(casoIds);
	const pendientes = items.filter((t) => {
		const notif = ultimaNotif.get(t.casoId);
		return !notif || notif.getTime() < t.fechaPrometida.getTime();
	});
	if (pendientes.length === 0) return;

	const [mapaAsesor, supervisores, usuarioSistema] = await Promise.all([
		construirMapaAsesorUsuario(),
		obtenerSupervisoresCobros(),
		resolverUsuarioSistemaCobros(),
	]);
	if (!usuarioSistema) {
		console.error(
			`${LOG_PREFIX} Sin usuario sistema (PREMORA_SYSTEM_USER_ID o admin); no se crean notificaciones de promesa incumplida`,
		);
		return;
	}

	const filas = pendientes.flatMap((t) => {
		const credito = `${t.sifco}${t.cliente ? ` (${t.cliente})` : ""}`;
		const asesor = t.asesorNombre || "Sin asesor asignado";
		return filasNotificacionCobros({
			casoId: t.casoId,
			cobrosTipo: "promesa_incumplida",
			titulo: "Promesa de pago incumplida",
			descripcion: `La promesa de pago del crédito ${credito} venció y la(s) cuota(s) prometida(s) siguen pendientes.`,
			descripcionSupervisor: `El asesor ${asesor} tiene una promesa de pago incumplida sin gestionar: crédito ${credito} venció y la(s) cuota(s) siguen pendientes.`,
			asesorUserId:
				t.asesorId != null ? (mapaAsesor.get(t.asesorId) ?? null) : null,
			supervisores,
			usuarioSistema,
		});
	});

	if (filas.length > 0) {
		await db.insert(notifications).values(filas);
		console.log(
			`${LOG_PREFIX} ${pendientes.length} promesa(s) incumplida(s) → ${filas.length} notificación(es) creada(s)`,
		);
	}
}

/** max(created_at) por caso de las notificaciones promesa_incumplida. */
async function maxNotifPromesaPorCaso(
	casoIds: string[],
): Promise<Map<string, Date>> {
	if (casoIds.length === 0) return new Map();
	const rows = await db
		.select({
			casoId: notifications.relatedEntityId,
			ultima: max(notifications.createdAt),
		})
		.from(notifications)
		.where(
			and(
				inArray(notifications.relatedEntityId, casoIds),
				eq(notifications.cobrosTipo, "promesa_incumplida"),
			),
		)
		.groupBy(notifications.relatedEntityId);
	const map = new Map<string, Date>();
	for (const r of rows) if (r.casoId && r.ultima) map.set(r.casoId, r.ultima);
	return map;
}
