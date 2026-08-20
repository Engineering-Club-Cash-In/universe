/**
 * La red de seguridad del circuito de vuelta (D-35).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "TRY/CATCH, LOG Y SEGUIR" TIENE UN COSTO, Y ESTE JOB ES EL QUE LO PAGA.
 *
 * Cartera emite el aviso después del commit y, si el CRM está caído en ese
 * segundo, **ese evento no vuelve nunca**. No es cosmético: el aviso *es* el
 * producto. Un pago validado del que el cliente jamás se entera deja en mentira
 * el "te avisamos cuando se acredite" con el que se cerró la conversación.
 *
 * La alternativa era un outbox con reintentos del lado de cartera —tabla nueva
 * y worker nuevo dentro de la app que mueve el dinero—, y se descartó a
 * propósito: en vez de eso, el CRM **no depende del aviso** y va a preguntar.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * **Pregunta por `pago_id`, no por la boleta.** Una reversión borra las filas de
 * `boletas`, así que preguntar "¿qué pasó con la boleta tal?" devolvería
 * silencio justo en el caso que más urge avisar. Los ids ya los tenemos.
 *
 * Contrato: docs/features/bot-whatsapp-cobros/04-validacion-de-boleta.md (§6)
 */

import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import {
	botCobrosBoletaPagos,
	botCobrosBoletas,
	type EstadoBoletaBot,
} from "../db/schema/bot-cobros-boletas";
import {
	avisarAlAsesor,
	type EventoPago,
	procesarEventoPago,
} from "../lib/bot-cobros/eventos-pago";
import { carteraBackClient } from "../services/cartera-back-client";
import type {
	EstadoPagoCartera,
	ReversionCartera,
} from "../types/cartera-back";

/** Estados de boleta que todavía esperan un desenlace de contabilidad. */
const ESPERANDO: EstadoBoletaBot[] = ["confirmada", "confirmada_a_verificar"];

/** Tope por corrida: si hay más, se atienden a la hora siguiente. */
const MAXIMO_POR_CORRIDA = 200;

/**
 * A partir de acá, una boleta a medias deja de ser un retraso y es un problema.
 *
 * §6: si a las 24 h la boleta sigue con pagos resueltos **y** pagos sin
 * resolver, se avisa **solo al asesor** — nunca al cliente, porque no hay nada
 * cierto que decirle todavía.
 */
const HORAS_PARA_AVISAR_MEDIAS = 24;

export type ResultadoRespaldo = {
	pagosRevisados: number;
	eventosRecuperados: number;
	boletasAMedias: number;
};

/**
 * Traduce lo que cartera sabe del pago a uno de nuestros cuatro eventos.
 *
 * Es puro para poder probar la tabla de §6 sin base: cada fila de esa tabla es
 * una rama de acá.
 */
export function eventoSegunCartera(
	pago: EstadoPagoCartera | undefined,
	/** Cuando no vino ninguna fila del pago, la reversión puede venir aparte. */
	reversionSuelta?: ReversionCartera | null,
): { evento: EventoPago; ocurridoEn?: string } | null {
	const reversion = pago?.reversion ?? reversionSuelta ?? null;

	// ⚠️ La reversión manda sobre el estado de la fila.
	//
	// `reversePayment` deja el pago reseteado en `no_required`, que es un estado
	// "aplicado": mirar solo `validation_status` haría que un pago revertido se
	// leyera como validado y el cliente recibiera un "tu pago fue acreditado"
	// justo después de que se lo rechazaron.
	if (reversion?.estado === "completada") {
		return {
			evento: "revertido",
			ocurridoEn: reversion.revertido_en ?? undefined,
		};
	}

	// `iniciada` NO es un rechazo (D-36): es una reversión a medias en cartera.
	// No se le dice nada al cliente; lo levanta el llamador como alerta.
	if (reversion?.estado === "iniciada") return null;

	// El pago desapareció y no hay reversión que lo explique. No se inventa un
	// desenlace: sin evidencia, callarse es lo correcto.
	if (!pago) return null;

	if (pago.payment_false === true) return { evento: "marcado_falso" };

	if (
		pago.validation_status === "validated" ||
		pago.validation_status === "capital_validated"
	) {
		return { evento: "validado" };
	}

	// `pending` (y cualquier otro): sigue esperando a contabilidad.
	return null;
}

export async function recuperarEventosPerdidos(): Promise<ResultadoRespaldo> {
	// Los pagos sin resolver de boletas que todavía esperan desenlace.
	const pendientes = await db
		.select({
			pagoId: botCobrosBoletaPagos.pagoId,
			boletaId: botCobrosBoletaPagos.boletaId,
			numeroSifco: botCobrosBoletas.numeroSifco,
			r2Key: botCobrosBoletas.r2Key,
		})
		.from(botCobrosBoletaPagos)
		.innerJoin(
			botCobrosBoletas,
			eq(botCobrosBoletas.id, botCobrosBoletaPagos.boletaId),
		)
		.where(
			and(
				isNull(botCobrosBoletaPagos.resueltoEn),
				inArray(botCobrosBoletas.estado, ESPERANDO),
			),
		)
		.limit(MAXIMO_POR_CORRIDA);

	const resultado: ResultadoRespaldo = {
		pagosRevisados: pendientes.length,
		eventosRecuperados: 0,
		boletasAMedias: 0,
	};

	if (pendientes.length > 0) {
		const estados = await carteraBackClient.getEstadoPagos(
			pendientes.map((p) => p.pagoId),
		);

		// Cartera no contestó: no se hace nada. Se vuelve a intentar en una hora.
		if (estados === null) {
			console.warn(
				"[BotCobrosRespaldo] cartera no respondió: se reintenta en la próxima corrida",
			);
			return { ...resultado, pagosRevisados: 0 };
		}

		const porId = new Map(estados.map((e) => [e.pago_id, e]));

		for (const pendiente of pendientes) {
			const pago = porId.get(pendiente.pagoId);

			// El pago desapareció de `pagos_credito` —una reversión borra la fila
			// si era un parcial con hermanos—, así que su reversión hay que
			// buscarla por la boleta, que es donde quedaron copiadas las URLs
			// antes del borrado (D-36). Solo en ese caso: es una llamada de más.
			const reversionSuelta =
				!pago && pendiente.r2Key
					? ((
							(await carteraBackClient.getPagosPorBoleta(pendiente.r2Key))
								?.reversiones ?? []
						).find((r) => r.pago_id === pendiente.pagoId) ?? null)
					: null;

			const deduccion = eventoSegunCartera(pago, reversionSuelta);

			// Una reversión a medias no se traduce en evento, pero tampoco se
			// ignora: alguien tiene que mirar ese crédito.
			const aMedias =
				(pago?.reversion ?? reversionSuelta)?.estado === "iniciada";

			if (!deduccion && aMedias) {
				await avisarAlAsesor({
					numeroSifco: pendiente.numeroSifco,
					titulo: `Reversión a medias en cartera · ${pendiente.numeroSifco}`,
					descripcion: `El pago ${pendiente.pagoId} tiene una reversión que quedó en 'iniciada': no se sabe si se revirtió de verdad. Al cliente NO se le dijo nada. Revisar el crédito.`,
				});
				continue;
			}

			if (!deduccion) continue;

			// Se procesa por el MISMO camino que el webhook: idempotente, así que
			// si el aviso sí había llegado, esto no manda un segundo WhatsApp.
			const procesado = await procesarEventoPago({
				pagoId: pendiente.pagoId,
				numeroSifco: pendiente.numeroSifco,
				evento: deduccion.evento,
				usuario: null,
				motivo: null,
				ocurridoEn: deduccion.ocurridoEn ?? new Date().toISOString(),
			});

			if (procesado.motivo !== "EVENTO_REPETIDO") {
				resultado.eventosRecuperados++;
			}
		}
	}

	resultado.boletasAMedias = await avisarBoletasAMedias();

	if (resultado.eventosRecuperados > 0 || resultado.boletasAMedias > 0) {
		console.log(
			`[BotCobrosRespaldo] ${resultado.pagosRevisados} pago(s) revisado(s), ` +
				`${resultado.eventosRecuperados} evento(s) que el webhook no entregó, ` +
				`${resultado.boletasAMedias} boleta(s) a medias avisada(s).`,
		);
	}

	return resultado;
}

/**
 * Boletas que llevan 24 h con unos pagos resueltos y otros no.
 *
 * Se avisa **solo al asesor**: al cliente no hay nada cierto que decirle
 * todavía, y un "tu pago fue acreditado a medias" no es un mensaje.
 */
async function avisarBoletasAMedias(): Promise<number> {
	const aMedias = await db
		.select({
			id: botCobrosBoletas.id,
			numeroSifco: botCobrosBoletas.numeroSifco,
			monto: botCobrosBoletas.monto,
		})
		.from(botCobrosBoletas)
		.where(
			and(
				inArray(botCobrosBoletas.estado, ESPERANDO),
				isNull(botCobrosBoletas.notificadoClienteAt),
				lt(
					botCobrosBoletas.updatedAt,
					sql`now() - interval '${sql.raw(String(HORAS_PARA_AVISAR_MEDIAS))} hours'`,
				),
				// Con resueltos Y sin resolver a la vez: eso es "a medias". Una
				// boleta con todo sin resolver es simplemente una que conta no ha
				// mirado, y esa no es noticia.
				sql`EXISTS (
					SELECT 1 FROM bot_cobros_boleta_pagos p
					WHERE p.boleta_id = ${botCobrosBoletas.id} AND p.resuelto_en IS NOT NULL
				)`,
				sql`EXISTS (
					SELECT 1 FROM bot_cobros_boleta_pagos p
					WHERE p.boleta_id = ${botCobrosBoletas.id} AND p.resuelto_en IS NULL
				)`,
			),
		)
		.limit(MAXIMO_POR_CORRIDA);

	for (const boleta of aMedias) {
		await avisarAlAsesor({
			numeroSifco: boleta.numeroSifco,
			titulo: `Boleta del bot a medias hace 24 h · ${boleta.numeroSifco}`,
			descripcion: `La boleta de Q${boleta.monto ?? "?"} tiene unos pagos resueltos y otros sin resolver desde hace más de ${HORAS_PARA_AVISAR_MEDIAS} h. Al cliente no se le ha dicho nada. Terminar la validación en cartera.`,
		});

		// Se toca `updated_at` para que no vuelva a avisar cada hora sobre lo
		// mismo: el asesor ya tiene su notificación.
		await db
			.update(botCobrosBoletas)
			.set({ updatedAt: new Date() })
			.where(eq(botCobrosBoletas.id, boleta.id));
	}

	return aMedias.length;
}
