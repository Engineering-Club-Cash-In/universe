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
import { toDateStrGT } from "../lib/guatemala-month-window";
import {
	aplicarCambiosEstadoPromesa,
	auditarTransiciones,
} from "../lib/promesa-estado-batch";
import {
	derivarEstadoCredito,
	type EstadoPromesa,
	evaluarPromesa,
} from "../lib/promesa-pago";
import { pushPromesaActivaHaciaCarteraBack } from "../lib/push-promesa-cartera-back";
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
				fechaAlerta: contactosCobros.fechaAlerta,
				// CB-128: estado ANTES de esta corrida — es el "de" de la transición
				// que se audita cuando el estado efectivamente cambia.
				estadoPromesa: contactosCobros.estadoPromesa,
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
		// CB-029: promesas POR VENCER (fecha_alerta = hoy GT y aún pendientes) →
		// recordatorio proactivo al asesor. Mismo patrón idempotente/retryable.
		const porVencer: Array<{
			casoId: string;
			sifco: string;
			cliente: string;
			asesorId: number | null;
			asesorNombre: string;
			fechaPrometida: Date;
			fechaAlerta: Date;
		}> = [];

		const hoy = new Date();
		for (const [sifco, grupo] of promesasPorSifco) {
			try {
				const credito = await carteraBackClient.getCredito(sifco);
				const estadoCredito = derivarEstadoCredito(credito);

				// CB-128: se arrastra el caso para la FK del audit. El estado PREVIO
				// NO se guarda acá a propósito — se lee dentro de la transacción que
				// escribe, porque para entonces este valor ya puede estar
				// desactualizado (ver la nota del bloque de persistencia).
				const actualizaciones: Array<{
					id: string;
					estado: EstadoPromesa;
					casoCobroId: string;
				}> = [];
				// Candidatas a notificar: toda promesa incumplida de este crédito
				// (con su fecha prometida, que ancla el dedup por episodio).
				const candidatos: Array<{
					promesaId: string;
					casoId: string;
					fechaPrometida: Date;
				}> = [];
				const candidatosPorVencer: Array<{
					promesaId: string;
					casoId: string;
					fechaPrometida: Date;
					fechaAlerta: Date;
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
					actualizaciones.push({
						id: promesa.id,
						estado,
						casoCobroId: promesa.casoCobroId,
					});
					if (estado === "incumplida") {
						candidatos.push({
							promesaId: promesa.id,
							casoId: promesa.casoCobroId,
							fechaPrometida: promesa.fechaProximoContacto,
						});
					}
					// CB-029: sigue pendiente y su alerta YA cayó (hoy o antes) → por
					// vencer. La alerta efectiva es la programada (fecha_alerta) o D-1
					// por default, así también aplica a promesas viejas sin fecha_alerta.
					if (estado === "pendiente") {
						const alertaEf =
							promesa.fechaAlerta ??
							new Date(
								promesa.fechaProximoContacto.getTime() - 24 * 60 * 60 * 1000,
							);
						// `<=` (no `===`): si la alerta cayó hoy DESPUÉS del run de
						// medianoche (promesa recién creada), el próximo run igual la agarra
						// aunque su día ya pasó. El dedup por episodio (fecha_alerta) evita
						// repetir día a día (Codex PR #1232).
						if (toDateStrGT(alertaEf) <= toDateStrGT(hoy)) {
							candidatosPorVencer.push({
								promesaId: promesa.id,
								casoId: promesa.casoCobroId,
								fechaPrometida: promesa.fechaProximoContacto,
								fechaAlerta: alertaEf,
							});
						}
					}
					if (estado === "cumplida") resumen.cumplidas++;
					else if (estado === "incumplida") resumen.incumplidas++;
					else resumen.pendientes++;
				}

				// CB-128: guard de no-op + auditoría de la transición, todo el lote
				// de este crédito en UNA transacción.
				//
				// Cuando el estado calculado ya es el guardado no se escribe nada.
				// Eso NO es un error ni un cambio de semántica para el resumen — el
				// resumen cuenta EVALUACIONES (arriba, sobre `estado`), no
				// escrituras, y una promesa que sigue igual sí se evaluó. Solo un
				// fallo de escritura revierte el conteo, igual que antes.
				//
				// Antes esto era un `Promise.allSettled` con una transacción por
				// promesa. Dos problemas: N conexiones concurrentes del pool (que es
				// de 10 para toda la app), y locks tomados en orden arbitrario, lo
				// que podía trabar este job contra una Ficha 360 abierta sobre las
				// mismas filas. El helper toma los locks ordenados por id, así que el
				// deadlock deja de ser posible. Ver lib/promesa-estado-batch.ts.
				//
				// El "de" que se audita se lee DENTRO de la transacción que escribe y
				// no del SELECT del inicio del job: entre ambos momentos pudo correr
				// getEstadoPromesasPago (cada apertura de Ficha 360 recalcula), y
				// auditar el valor viejo registraría una transición que nunca ocurrió.
				const idsRechazados = new Set<string>();
				try {
					const transiciones =
						await aplicarCambiosEstadoPromesa(actualizaciones);
					await auditarTransiciones(transiciones, "sistema_job");
				} catch (error) {
					// La transacción es todo-o-nada: si falla, NINGUNA promesa de este
					// crédito quedó persistida. Antes el allSettled podía dejar algunas
					// escritas y otras no, y por eso el rechazo se rastreaba por id;
					// ahora el conjunto rechazado es, siempre, el lote completo.
					for (const { id, estado } of actualizaciones) {
						// Revertir el conteo de éxito hecho arriba — la evaluación fue
						// correcta pero la escritura falló, no debe contar como logro.
						if (estado === "cumplida") resumen.cumplidas--;
						else if (estado === "incumplida") resumen.incumplidas--;
						else resumen.pendientes--;
						resumen.errores++;
						idsRechazados.add(id);
					}
					console.error(
						`${LOG_PREFIX} Error persistiendo el lote de promesas de ${sifco}:`,
						error,
					);
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
				for (const c of candidatosPorVencer) {
					if (idsRechazados.has(c.promesaId)) continue;
					porVencer.push({
						casoId: c.casoId,
						sifco,
						cliente: credito.usuario?.nombre ?? "",
						asesorId: credito.asesor?.asesor_id ?? null,
						asesorNombre: credito.asesor?.nombre ?? "",
						fechaPrometida: c.fechaPrometida,
						fechaAlerta: c.fechaAlerta,
					});
				}

				// CB-030: promesas recién CUMPLIDAS en esta corrida → push
				// best-effort marcando activa=false en el espejo de cartera-back
				// (destraba el freeze de inmediato). "incumplida" no empuja: el
				// freeze en cartera-back ya se autodestraba por fecha_promesa <
				// hoy, no depende de este push para ser correcto.
				const promesaPorId = new Map(grupo.map((p) => [p.id, p]));
				for (const { id, estado } of actualizaciones) {
					if (estado !== "cumplida" || idsRechazados.has(id)) continue;
					const promesa = promesaPorId.get(id);
					if (!promesa) continue;
					await pushPromesaActivaHaciaCarteraBack({
						id: promesa.id,
						numeroCreditoSifco: sifco,
						cuotaInicio: promesa.cuotaInicio,
						cuotaFin: promesa.cuotaFin,
						incluyeMora: promesa.incluyeMora,
						fechaProximoContacto: promesa.fechaProximoContacto,
						activa: false,
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

		// CB-029: recordatorio proactivo (por vencer). También aislado del job.
		try {
			await notificarPromesasPorVencer(porVencer);
		} catch (err) {
			console.error(
				`${LOG_PREFIX} Error creando notificaciones de promesa por vencer:`,
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

/**
 * CB-029 (Propósito proactivo): recordatorio al asesor de una promesa POR
 * VENCER (su fecha_alerta cae hoy y sigue pendiente). SOLO al asesor — es un
 * recordatorio, no un escalamiento. Idempotente: se deduplica con una ventana
 * de ~20h (la alerta cae un solo día; el job corre a las 00:00 GT + boot, así
 * que sin la ventana un doble run del mismo día duplicaría).
 */
async function notificarPromesasPorVencer(
	porVencer: Array<{
		casoId: string;
		sifco: string;
		cliente: string;
		asesorId: number | null;
		asesorNombre: string;
		fechaPrometida: Date;
		fechaAlerta: Date;
	}>,
): Promise<void> {
	if (porVencer.length === 0) return;

	// Una por caso: la promesa con la fecha prometida más próxima.
	const porCaso = new Map<string, (typeof porVencer)[number]>();
	for (const it of porVencer) {
		const prev = porCaso.get(it.casoId);
		if (!prev || it.fechaPrometida.getTime() < prev.fechaPrometida.getTime()) {
			porCaso.set(it.casoId, it);
		}
	}
	const items = [...porCaso.values()];
	const casoIds = items.map((t) => t.casoId);

	// Dedup por EPISODIO (fecha de alerta): se salta si ya hay una
	// promesa_por_vencer del caso creada EN/DESPUÉS de la fecha de alerta de ESTE
	// episodio → fire-once por promesa. Cubre reinicios del mismo día (Codex #7) y
	// alertas que cayeron tarde sin repetir día a día (Codex #9); un episodio
	// nuevo (otra fecha de alerta, más reciente) vuelve a disparar.
	const ultimaNotif = await maxNotifPorVencerPorCaso(casoIds);
	const pendientes = items.filter((t) => {
		const notif = ultimaNotif.get(t.casoId);
		return !notif || notif.getTime() < t.fechaAlerta.getTime();
	});
	if (pendientes.length === 0) return;

	const [mapaAsesor, usuarioSistema] = await Promise.all([
		construirMapaAsesorUsuario(),
		resolverUsuarioSistemaCobros(),
	]);
	if (!usuarioSistema) {
		console.error(
			`${LOG_PREFIX} Sin usuario sistema; no se crean notificaciones de promesa por vencer`,
		);
		return;
	}

	const filas = pendientes.flatMap((t) => {
		const credito = `${t.sifco}${t.cliente ? ` (${t.cliente})` : ""}`;
		const fechaStr = toDateStrGT(t.fechaPrometida);
		return filasNotificacionCobros({
			casoId: t.casoId,
			cobrosTipo: "promesa_por_vencer",
			titulo: "Promesa de pago por vencer",
			descripcion: `La promesa de pago del crédito ${credito} vence el ${fechaStr}. Dale seguimiento antes de que se caiga.`,
			asesorUserId:
				t.asesorId != null ? (mapaAsesor.get(t.asesorId) ?? null) : null,
			supervisores: [], // solo asesor
			usuarioSistema,
		});
	});

	if (filas.length > 0) {
		await db.insert(notifications).values(filas);
		console.log(
			`${LOG_PREFIX} ${pendientes.length} promesa(s) por vencer → ${filas.length} notificación(es) creada(s)`,
		);
	}
}

/** max(created_at) por caso de las notificaciones promesa_por_vencer. */
async function maxNotifPorVencerPorCaso(
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
				eq(notifications.cobrosTipo, "promesa_por_vencer"),
			),
		)
		.groupBy(notifications.relatedEntityId);
	const map = new Map<string, Date>();
	for (const r of rows) if (r.casoId && r.ultima) map.set(r.casoId, r.ultima);
	return map;
}
