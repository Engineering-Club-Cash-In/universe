/**
 * COBROS-02 — Alertas de cobros con propósito (job de las 8:00 GT).
 *
 * Reemplaza las notificaciones masivas "Caso sin contacto reciente" por dos
 * alertas ancladas a la SUBIDA de bucket (que corre a medianoche en cartera):
 *
 *   2. cliente_subido  → un crédito subió de bucket anoche. Avisa SOLO AL ASESOR
 *                        para que priorice bajarlo.
 *   3. sin_contacto_3d → pasaron 3 días hábiles (regla de oro) desde la subida
 *                        sin ningún registro de contacto. Escala AL ASESOR +
 *                        SUPERVISORES (es una falta del asesor).
 *
 * El asesor destinatario es el de cartera (`asesor_id` del evento) enlazado a un
 * usuario del CRM por correo (ver cobros-notif-helpers). Nunca lanza al caller:
 * devuelve un resumen y loguea (patrón premora / checkPromesasPago).
 */

import { and, eq, inArray, max } from "drizzle-orm";
import { db } from "../db";
import { casosCobros, contactosCobros } from "../db/schema/cobros";
import type { NewNotification } from "../db/schema/notifications";
import { notifications } from "../db/schema/notifications";
import { contarDiasHabilesGT, siguienteDiaGT } from "../lib/business-days-gt";
import type { CarteraBucketHistorialRow } from "../types/cartera-back";
import { carteraBackClient } from "./cartera-back-client";
import { isCarteraBackEnabled } from "./cartera-back-integration";
import {
	type CobrosNotifTipo,
	construirMapaAsesorUsuario,
	filasNotificacionCobros,
	obtenerSupervisoresCobros,
	resolverUsuarioSistemaCobros,
} from "./cobros-notif-helpers";

const LOG_PREFIX = "[CobrosAlertas]";

// Ventana (días calendario) para reconstruir el último evento de bucket por
// crédito. Un crédito estancado sin contacto más allá de esto no se re-alerta
// (ya se habría alertado al cruzar el día 3): es una guarda de volumen.
const VENTANA_DIAS = 60;

// Umbral de la regla: 3 días hábiles en el bucket sin contacto = falta.
const DIAS_HABILES_LIMITE = 3;

const GT_TZ = "America/Guatemala";
/** Día calendario GT como "YYYY-MM-DD". */
function gtDateKey(d: Date): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: GT_TZ,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(d);
}

export interface CobrosAlertasResumen {
	subidas: number; // notificaciones cliente_subido (una por caso)
	sinContacto: number; // casos escalados por sin_contacto_3d
	skipped?: boolean;
	reason?: string;
}

export async function checkCobrosAlertas(): Promise<CobrosAlertasResumen> {
	try {
		if (!isCarteraBackEnabled()) {
			console.log(`${LOG_PREFIX} Cartera-back deshabilitado; job omitido`);
			return {
				subidas: 0,
				sinContacto: 0,
				skipped: true,
				reason: "cartera_back_disabled",
			};
		}

		const usuarioSistema = await resolverUsuarioSistemaCobros();
		if (!usuarioSistema) {
			console.error(
				`${LOG_PREFIX} Sin usuario sistema (PREMORA_SYSTEM_USER_ID o admin); job omitido`,
			);
			return {
				subidas: 0,
				sinContacto: 0,
				skipped: true,
				reason: "sin_usuario_sistema",
			};
		}

		const [mapaAsesor, supervisores] = await Promise.all([
			construirMapaAsesorUsuario(),
			obtenerSupervisoresCobros(),
		]);

		// Una sola pasada al historial (paginado): sirve a ambos propósitos.
		const ahora = new Date();
		const desde = new Date(ahora.getTime() - VENTANA_DIAS * 86_400_000);
		const eventos = await traerHistorialCompleto(gtDateKey(desde));

		const subidas = await notificarClientesSubidos(
			eventos,
			ahora,
			mapaAsesor,
			usuarioSistema,
		);
		const sinContacto = await notificarSinContacto(
			eventos,
			ahora,
			mapaAsesor,
			supervisores,
			usuarioSistema,
		);

		console.log(
			`${LOG_PREFIX} cliente_subido: ${subidas} · sin_contacto_3d: ${sinContacto} caso(s)`,
		);
		return { subidas, sinContacto };
	} catch (err) {
		console.error(`${LOG_PREFIX} Error general del job:`, err);
		return { subidas: 0, sinContacto: 0 };
	}
}

/** Trae todos los eventos de bucket desde `desde` (YYYY-MM-DD), paginando. */
async function traerHistorialCompleto(
	desde: string,
): Promise<CarteraBucketHistorialRow[]> {
	const acc: CarteraBucketHistorialRow[] = [];
	let page = 1;
	let totalPages = 1;
	do {
		const resp = await carteraBackClient.getBucketsHistorial({
			desde,
			page,
			pageSize: 500,
		});
		acc.push(...(resp.data ?? []));
		totalPages = resp.pagination?.totalPages ?? 1;
		page++;
	} while (page <= totalPages && page <= 50); // guarda: máx 50 páginas
	return acc;
}

/**
 * Propósito 2: subidas de HOY (la corrida de medianoche) a bucket ≥ 1 → aviso
 * al asesor. Devuelve cuántas notificaciones creó.
 */
async function notificarClientesSubidos(
	eventos: CarteraBucketHistorialRow[],
	ahora: Date,
	mapaAsesor: Map<number, string>,
	usuarioSistema: string,
): Promise<number> {
	// El motor de buckets corre a las 23:59 GT (procesarMoras, cartera-back), así
	// que las SUBIDA "de anoche" llevan la fecha GT de AYER. A las 08:00 GT hay
	// que mirar ayer + hoy (ventana), no solo hoy, o el aviso cliente_subido
	// nunca dispararía (Codex P2). El dedup de ~20h evita repetir.
	const hoyKey = gtDateKey(ahora);
	const ayerKey = gtDateKey(new Date(ahora.getTime() - 86_400_000));
	const ventana = new Set([ayerKey, hoyKey]);
	const subidasRecientes = eventos.filter(
		(e) =>
			e.tipo_evento === "SUBIDA" &&
			e.bucket_nuevo >= 1 &&
			ventana.has(gtDateKey(new Date(e.fecha))),
	);
	if (subidasRecientes.length === 0) return 0;

	// Una por crédito (por si hubiese doble evento en la ventana).
	const porCredito = new Map<number, CarteraBucketHistorialRow>();
	for (const e of subidasRecientes) {
		if (!porCredito.has(e.credito_id)) porCredito.set(e.credito_id, e);
	}
	const subs = [...porCredito.values()];

	const casoPorSifco = await mapearCasosPorSifco(
		subs.map((e) => e.numero_credito_sifco),
	);
	const casoIds = subs
		.map((e) => casoPorSifco.get(e.numero_credito_sifco))
		.filter((v): v is string => Boolean(v));

	// Dedup: casos ya avisados con cliente_subido en las últimas ~20h.
	const ultimaNotif = await maxNotifPorCaso(casoIds, "cliente_subido");
	const corte = ahora.getTime() - 20 * 60 * 60 * 1000;

	const filas: NewNotification[] = [];
	for (const e of subs) {
		const casoId = casoPorSifco.get(e.numero_credito_sifco);
		if (!casoId) continue;
		const notif = ultimaNotif.get(casoId);
		if (notif && notif.getTime() >= corte) continue;
		// Solo al asesor: sin asesor enlazado no hay a quién avisar.
		const asesorUserId =
			e.asesor_id != null ? (mapaAsesor.get(e.asesor_id) ?? null) : null;
		if (!asesorUserId) continue;
		const bucketNombre = e.bucket_nuevo_nombre ?? `bucket ${e.bucket_nuevo}`;
		filas.push(
			...filasNotificacionCobros({
				casoId,
				cobrosTipo: "cliente_subido",
				titulo: "Cliente subió de bucket",
				descripcion: `El crédito ${e.numero_credito_sifco} (${e.cliente}) subió a ${bucketNombre}. Priorizá el contacto para bajarlo.`,
				asesorUserId,
				supervisores: [], // solo asesor
				usuarioSistema,
			}),
		);
	}
	if (filas.length > 0) await db.insert(notifications).values(filas);
	return filas.length;
}

/**
 * Propósito 3: créditos cuyo ÚLTIMO evento es una SUBIDA a bucket ≥ 1 y ya
 * pasaron ≥ 3 días hábiles sin registro de contacto → escala a asesor +
 * supervisores. Usar el último evento (no solo subidas) descarta los que ya
 * bajaron de bucket. Devuelve cuántos CASOS se escalaron.
 */
async function notificarSinContacto(
	eventos: CarteraBucketHistorialRow[],
	ahora: Date,
	mapaAsesor: Map<number, string>,
	supervisores: string[],
	usuarioSistema: string,
): Promise<number> {
	// Último evento por crédito dentro de la ventana.
	const ultimoPorCredito = new Map<number, CarteraBucketHistorialRow>();
	for (const e of eventos) {
		const prev = ultimoPorCredito.get(e.credito_id);
		if (!prev || new Date(e.fecha).getTime() > new Date(prev.fecha).getTime()) {
			ultimoPorCredito.set(e.credito_id, e);
		}
	}

	// Candidatos: último evento = SUBIDA a bucket ≥ 1 con reloj vencido. El
	// conteo arranca el DÍA SIGUIENTE a la subida (sellada 23:59 GT → ese día no
	// cuenta), si no se acusaría al asesor un día hábil antes (Codex P2).
	const candidatos = [...ultimoPorCredito.values()].filter(
		(e) =>
			e.tipo_evento === "SUBIDA" &&
			e.bucket_nuevo >= 1 &&
			contarDiasHabilesGT(siguienteDiaGT(new Date(e.fecha)), ahora) >=
				DIAS_HABILES_LIMITE,
	);
	if (candidatos.length === 0) return 0;

	const casoPorSifco = await mapearCasosPorSifco(
		candidatos.map((e) => e.numero_credito_sifco),
	);
	const conCaso = candidatos
		.map((e) => ({
			evento: e,
			casoId: casoPorSifco.get(e.numero_credito_sifco),
			fechaSubida: new Date(e.fecha),
		}))
		.filter(
			(
				x,
			): x is {
				evento: CarteraBucketHistorialRow;
				casoId: string;
				fechaSubida: Date;
			} => Boolean(x.casoId),
		);
	if (conCaso.length === 0) return 0;

	const casoIds = conCaso.map((x) => x.casoId);
	// ¿Contactaron desde la subida? ¿Ya se alertó este episodio?
	const [ultimoContacto, ultimaNotif] = await Promise.all([
		maxContactoPorCaso(casoIds),
		maxNotifPorCaso(casoIds, "sin_contacto_3d"),
	]);

	const filas: NewNotification[] = [];
	for (const x of conCaso) {
		const contacto = ultimoContacto.get(x.casoId);
		if (contacto && contacto.getTime() >= x.fechaSubida.getTime()) continue; // ya lo contactaron
		const notif = ultimaNotif.get(x.casoId);
		if (notif && notif.getTime() >= x.fechaSubida.getTime()) continue; // ya se escaló este episodio
		const asesorUserId =
			x.evento.asesor_id != null
				? (mapaAsesor.get(x.evento.asesor_id) ?? null)
				: null;
		const bucketNombre =
			x.evento.bucket_nuevo_nombre ?? `bucket ${x.evento.bucket_nuevo}`;
		const credito = `${x.evento.numero_credito_sifco} (${x.evento.cliente})`;
		const asesor = x.evento.asesor || "Sin asesor asignado";
		filas.push(
			...filasNotificacionCobros({
				casoId: x.casoId,
				cobrosTipo: "sin_contacto_3d",
				titulo: "Cliente vencido: 3 días hábiles sin contacto",
				descripcion: `El crédito ${credito} lleva 3+ días hábiles en ${bucketNombre} sin registro de contacto. Es una falta pendiente por atender.`,
				descripcionSupervisor: `El asesor ${asesor} lleva 3+ días hábiles sin contactar el crédito ${credito} en ${bucketNombre}. Falta sin atender.`,
				asesorUserId,
				supervisores,
				usuarioSistema,
			}),
		);
	}
	if (filas.length > 0) await db.insert(notifications).values(filas);
	// #casos (no #filas: cada caso genera asesor + N supervisores).
	return new Set(filas.map((f) => f.relatedEntityId)).size;
}

/** Mapa `numero_credito_sifco → caso.id` (solo casos activos). */
async function mapearCasosPorSifco(
	sifcos: string[],
): Promise<Map<string, string>> {
	const unicos = [...new Set(sifcos.filter(Boolean))];
	if (unicos.length === 0) return new Map();
	const rows = await db
		.select({ id: casosCobros.id, sifco: casosCobros.numeroCreditoSifco })
		.from(casosCobros)
		.where(
			and(
				eq(casosCobros.activo, true),
				inArray(casosCobros.numeroCreditoSifco, unicos),
			),
		);
	const map = new Map<string, string>();
	for (const r of rows) if (r.sifco) map.set(r.sifco, r.id);
	return map;
}

/** max(fecha_contacto) por caso. */
async function maxContactoPorCaso(
	casoIds: string[],
): Promise<Map<string, Date>> {
	if (casoIds.length === 0) return new Map();
	const rows = await db
		.select({
			casoId: contactosCobros.casoCobroId,
			ultima: max(contactosCobros.fechaContacto),
		})
		.from(contactosCobros)
		.where(inArray(contactosCobros.casoCobroId, casoIds))
		.groupBy(contactosCobros.casoCobroId);
	const map = new Map<string, Date>();
	for (const r of rows) if (r.ultima) map.set(r.casoId, r.ultima);
	return map;
}

/** max(created_at) por caso de las notificaciones de un `cobros_tipo`. */
async function maxNotifPorCaso(
	casoIds: string[],
	tipo: CobrosNotifTipo,
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
				eq(notifications.cobrosTipo, tipo),
			),
		)
		.groupBy(notifications.relatedEntityId);
	const map = new Map<string, Date>();
	for (const r of rows) if (r.casoId && r.ultima) map.set(r.casoId, r.ultima);
	return map;
}
