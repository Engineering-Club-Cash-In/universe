/**
 * COBROS-02 · Fase 1 — aviso de CONVENIO INCUMPLIDO (job de las 8:00 GT, junto
 * al resto de alertas de cobros).
 *
 * Qué resuelve: hasta hoy un convenio que se dejó de pagar no le avisaba a
 * nadie. Los recordatorios D-5/D-3/D-1/D-0 van al CLIENTE por WhatsApp; del lado
 * interno no existía ninguna señal, así que el asesor se enteraba solo si abría
 * la ficha. Incumplir un acuerdo YA negociado es de las peores señales de la
 * cartera y era justo la que no se veía.
 *
 * A quién: al asesor dueño del crédito Y a los `cobros_supervisor` (decisión 7
 * del plan 08) — es un escalamiento, no una tarea más.
 *
 * Deduplicación POR EPISODIO, no por ventana de tiempo: un convenio incumplido
 * sigue incumplido mañana, así que la ventana de 24 h de los jobs viejos
 * produciría un aviso diario a todo el mundo. La llave es
 * `convenio:<id>:venc:<fecha de la cuota vencida más vieja>`: un aviso por
 * cuota incumplida. Si el cliente paga la más vieja y sigue debiendo otra, la
 * llave cambia y sí vuelve a avisar — que es exactamente lo que se quiere.
 * La unicidad la sostiene el índice `uq_notifications_cobros_dedup` (migración
 * 0054) con `onConflictDoNothing`, no un SELECT previo: dos instancias del job
 * corriendo a la vez lo pasarían ambas.
 *
 * Nunca lanza al caller: devuelve un resumen y loguea (patrón de
 * check-cobros-alertas / checkPromesasPago).
 */

import { inArray } from "drizzle-orm";
import { db } from "../db";
import { casosCobros } from "../db/schema/cobros";
import { agruparCasosVigentesPorSifco } from "../lib/caso-vigente";
import type { NewNotification } from "../db/schema/notifications";
import { notifications } from "../db/schema/notifications";
import type { CarteraConvenioAlerta } from "../types/cartera-back";
import { carteraBackClient } from "./cartera-back-client";
import { isCarteraBackEnabled } from "./cartera-back-integration";
import {
	construirMapaAsesorUsuario,
	filasNotificacionCobros,
	obtenerSupervisoresCobros,
	resolverUsuarioSistemaCobros,
} from "./cobros-notif-helpers";

const LOG_PREFIX = "[ConveniosIncumplidos]";

export interface ConveniosIncumplidosResumen {
	/** Convenios con al menos una cuota vencida impaga. */
	incumplidos: number;
	/** Casos para los que se creó al menos una notificación nueva. */
	notificados: number;
	/** Convenios incumplidos sin caso de cobros en el CRM (no se puede notificar). */
	sinCaso: number;
	skipped?: boolean;
	reason?: string;
}

const Q = (valor: string | number) => {
	const n = Number(valor);
	return Number.isFinite(n)
		? `Q${n.toLocaleString("es-GT", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			})}`
		: `Q${valor}`;
};

const fechaLegible = (iso: string) => {
	const [y, m, d] = String(iso ?? "").split("-");
	return y && m && d ? `${d}/${m}/${y}` : String(iso ?? "");
};

/** La llave del episodio. Ver la cabecera: identifica la cuota, no el día. */
export function llaveDedup(alerta: CarteraConvenioAlerta): string {
	return `convenio:${alerta.convenio_id}:venc:${alerta.fecha_vencimiento}`;
}

export async function checkConveniosIncumplidos(): Promise<ConveniosIncumplidosResumen> {
	try {
		if (!isCarteraBackEnabled()) {
			console.log(`${LOG_PREFIX} Cartera-back deshabilitado; job omitido`);
			return {
				incumplidos: 0,
				notificados: 0,
				sinCaso: 0,
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
				incumplidos: 0,
				notificados: 0,
				sinCaso: 0,
				skipped: true,
				reason: "sin_usuario_sistema",
			};
		}

		// Solo las vencidas: `diasAdelante: 0` deja fuera las que aún no vencen
		// (esas viven en la pantalla de alertas, no en un aviso de incumplimiento).
		const respuesta = await carteraBackClient.getConvenioAlertas({
			diasAdelante: 0,
		});
		const incumplidos = (respuesta.data ?? []).filter(
			(a) => a.categoria === "vencida",
		);
		if (incumplidos.length === 0) {
			console.log(`${LOG_PREFIX} Sin convenios incumplidos`);
			return { incumplidos: 0, notificados: 0, sinCaso: 0 };
		}

		const [mapaAsesor, supervisores, casoPorSifco] = await Promise.all([
			construirMapaAsesorUsuario(),
			obtenerSupervisoresCobros(),
			mapearCasosPorSifco(incumplidos.map((a) => a.numero_credito_sifco)),
		]);

		const filas: NewNotification[] = [];
		let sinCaso = 0;
		for (const alerta of incumplidos) {
			const casoId = casoPorSifco.get(alerta.numero_credito_sifco);
			if (!casoId) {
				sinCaso++;
				continue;
			}
			const asesorUserId =
				alerta.asesor_id != null
					? (mapaAsesor.get(alerta.asesor_id) ?? null)
					: null;

			const cliente = alerta.cliente?.trim() || alerta.numero_credito_sifco;
			const diasVencida = Math.abs(alerta.dias_para_vencer);
			const cuantas =
				alerta.cuotas_vencidas > 1
					? `${alerta.cuotas_vencidas} cuotas vencidas`
					: "una cuota vencida";
			const desde = `desde el ${fechaLegible(alerta.fecha_vencimiento)} (${diasVencida} día${diasVencida === 1 ? "" : "s"})`;

			filas.push(
				...filasNotificacionCobros({
					casoId,
					cobrosTipo: "convenio_incumplido",
					titulo: "Convenio incumplido",
					descripcion: `${cliente} (crédito ${alerta.numero_credito_sifco}) tiene ${cuantas} de su convenio ${desde}. Debe ${Q(alerta.monto_vencido)}. Contactalo y dejá registrada la gestión.`,
					descripcionSupervisor: `El crédito ${alerta.numero_credito_sifco} (${cliente}), de ${alerta.asesor || "sin asesor asignado"}, tiene ${cuantas} de su convenio ${desde} por ${Q(alerta.monto_vencido)}.`,
					asesorUserId,
					supervisores,
					usuarioSistema,
					dedupKey: llaveDedup(alerta),
				}),
			);
		}

		if (filas.length > 0) {
			// La dedup es el índice único parcial, no una consulta previa.
			await db.insert(notifications).values(filas).onConflictDoNothing();
		}

		const notificados = new Set(filas.map((f) => f.relatedEntityId)).size;
		console.log(
			`${LOG_PREFIX} incumplidos: ${incumplidos.length} · casos notificados: ${notificados}${sinCaso > 0 ? ` · sin caso en el CRM: ${sinCaso}` : ""}`,
		);
		return { incumplidos: incumplidos.length, notificados, sinCaso };
	} catch (err) {
		console.error(`${LOG_PREFIX} Error general del job:`, err);
		return { incumplidos: 0, notificados: 0, sinCaso: 0 };
	}
}

/**
 * Mapa `numero_credito_sifco → caso.id` del caso VIGENTE de cada crédito.
 *
 * No hay índice único sobre `numero_credito_sifco`, así que un crédito puede
 * tener varias filas (reaperturas, migraciones, altas manuales). Quedarse con
 * la última que devuelva Postgres es quedarse con una arbitraria: el aviso
 * podía colgarse de un caso viejo y no aparecer en la ficha que el asesor
 * abre (review de Codex, P2). `agruparCasosVigentesPorSifco` aplica el criterio
 * de siempre: gana el activo y, a igualdad, el más reciente.
 */
async function mapearCasosPorSifco(
	sifcos: string[],
): Promise<Map<string, string>> {
	const unicos = [...new Set(sifcos.filter(Boolean))];
	if (unicos.length === 0) return new Map();
	const rows = await db
		.select({
			id: casosCobros.id,
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			activo: casosCobros.activo,
			updatedAt: casosCobros.updatedAt,
		})
		.from(casosCobros)
		.where(inArray(casosCobros.numeroCreditoSifco, unicos));
	const map = new Map<string, string>();
	for (const [sifco, caso] of agruparCasosVigentesPorSifco(rows)) {
		map.set(sifco, caso.id);
	}
	return map;
}
