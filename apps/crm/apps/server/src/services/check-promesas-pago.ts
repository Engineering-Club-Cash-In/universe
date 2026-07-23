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

import { and, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
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
				// Estado ANTES de re-evaluar — para disparar la notificación solo en
				// la transición (pendiente → incumplida), no cada noche.
				estadoPromesaActual: contactosCobros.estadoPromesa,
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

		// Promesas que pasan a "incumplida" en ESTA corrida (transición) → alimentan
		// la notificación del propósito 1 tras confirmar que el UPDATE persistió.
		const transiciones: Array<{
			casoId: string;
			sifco: string;
			cliente: string;
			asesorId: number | null;
		}> = [];

		const hoy = new Date();
		for (const [sifco, grupo] of promesasPorSifco) {
			try {
				const credito = await carteraBackClient.getCredito(sifco);
				const estadoCredito = derivarEstadoCredito(credito);

				const actualizaciones: Array<{ id: string; estado: EstadoPromesa }> =
					[];
				// Candidatas a notificar (pendiente→incumplida) de este crédito.
				const candidatos: Array<{ promesaId: string; casoId: string }> = [];
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
					if (
						estado === "incumplida" &&
						promesa.estadoPromesaActual !== "incumplida"
					) {
						candidatos.push({
							promesaId: promesa.id,
							casoId: promesa.casoCobroId,
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

				// Solo notificar transiciones cuyo UPDATE sí persistió (si falló, el
				// estado sigue viejo y la próxima corrida la vuelve a detectar).
				for (const c of candidatos) {
					if (idsRechazados.has(c.promesaId)) continue;
					transiciones.push({
						casoId: c.casoId,
						sifco,
						cliente: credito.usuario?.nombre ?? "",
						asesorId: credito.asesor?.asesor_id ?? null,
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
			await notificarPromesasIncumplidas(transiciones);
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
 * Propósito 1 (COBROS-02): notifica al asesor + supervisores por cada promesa
 * de pago que venció en la corrida. Una notificación por caso (aunque tenga
 * varias promesas vencidas hoy), deduplicada a 24h por seguridad.
 */
async function notificarPromesasIncumplidas(
	transiciones: Array<{
		casoId: string;
		sifco: string;
		cliente: string;
		asesorId: number | null;
	}>,
): Promise<void> {
	if (transiciones.length === 0) return;

	// Una por caso (varias promesas del mismo caso → un solo aviso).
	const porCaso = new Map<string, (typeof transiciones)[number]>();
	for (const t of transiciones) {
		if (!porCaso.has(t.casoId)) porCaso.set(t.casoId, t);
	}
	const items = [...porCaso.values()];
	const casoIds = items.map((t) => t.casoId);

	// Dedup defensivo: casos ya notificados con promesa_incumplida en 24h.
	const yaNotificados = await db
		.select({ relatedEntityId: notifications.relatedEntityId })
		.from(notifications)
		.where(
			and(
				inArray(notifications.relatedEntityId, casoIds),
				eq(notifications.cobrosTipo, "promesa_incumplida"),
				gt(notifications.createdAt, sql`now() - interval '24 hours'`),
			),
		);
	const yaSet = new Set(yaNotificados.map((n) => n.relatedEntityId));
	const pendientes = items.filter((t) => !yaSet.has(t.casoId));
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

	const filas = pendientes.flatMap((t) =>
		filasNotificacionCobros({
			casoId: t.casoId,
			cobrosTipo: "promesa_incumplida",
			titulo: "Promesa de pago incumplida",
			descripcion: `La promesa de pago del crédito ${t.sifco}${t.cliente ? ` (${t.cliente})` : ""} venció y la(s) cuota(s) prometida(s) siguen pendientes.`,
			asesorUserId:
				t.asesorId != null ? (mapaAsesor.get(t.asesorId) ?? null) : null,
			supervisores,
			usuarioSistema,
		}),
	);

	if (filas.length > 0) {
		await db.insert(notifications).values(filas);
		console.log(
			`${LOG_PREFIX} ${pendientes.length} promesa(s) incumplida(s) → ${filas.length} notificación(es) creada(s)`,
		);
	}
}
