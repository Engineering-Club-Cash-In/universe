/**
 * La red de seguridad del rechazo (D-39): reintentar los avisos que fallaron.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL AVISO ES EL PRODUCTO DEL BOTÓN.
 *
 * El botón de conta espera la respuesta del CRM y muestra en pantalla si el
 * cliente quedó avisado. Pero entre "el CRM recibió el evento" y "el WhatsApp
 * salió" hay envíos que fallan (SimpleTech, red) y procesos que se caen con el
 * reclamo tomado. Este job barre, cada hora, las boletas rechazadas a las que
 * todavía se les debe el mensaje.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Es TODO lo que hace. Ya no consulta a cartera, ni deduce eventos, ni conoce
 * más desenlace que el rechazo: la validación la avisa otro equipo y los
 * movimientos internos no le hablan a ningún cliente (D-39).
 */

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
	botCobrosBoletas,
	botCobrosPagoEventos,
} from "../db/schema/bot-cobros-boletas";
import {
	alertarAsesorDelRechazo,
	avisarRechazoAlCliente,
} from "../lib/bot-cobros/eventos-pago";

/**
 * Horas GT en las que barre. Son fijas, NO un `setInterval` cada 3 h: un
 * intervalo queda con la fase del arranque, y con una ventana de 10 h eso
 * alcanza para saltársela entera. Un proceso que bootea 15:01 dispararía a las
 * 18:01 (fuera de ventana), y de ahí 21:01, 00:01, 03:01, 06:01… hasta las
 * 09:01 del día siguiente: 18 horas sin barrer, justo el escenario que este
 * job existe para cubrir (hallazgo Codex). Con horas fijas la cadencia no
 * depende de cuándo se desplegó.
 */
export const HORAS_GT_RESPALDO = [8, 11, 14, 17] as const;

/** Hora de Guatemala (UTC-6, sin horario de verano). */
export function horaGuatemala(fecha = new Date()): number {
	return (fecha.getUTCHours() + 18) % 24;
}

/** Milisegundos hasta la próxima hora de la lista (mañana si ya pasaron todas). */
export function msHastaProximoRespaldo(ahora = new Date()): number {
	const proxima = new Date(ahora);
	for (const horaGT of HORAS_GT_RESPALDO) {
		// GT = UTC-6: la hora GT h es la h+6 UTC del mismo día UTC.
		proxima.setUTCHours(horaGT + 6, 0, 0, 0);
		if (proxima > ahora) return proxima.getTime() - ahora.getTime();
	}
	proxima.setUTCHours(HORAS_GT_RESPALDO[0] + 6, 0, 0, 0);
	proxima.setUTCDate(proxima.getUTCDate() + 1);
	return proxima.getTime() - ahora.getTime();
}

/** Tope por corrida: lo que no entre en esta, entra en la siguiente. */
const MAXIMO_POR_CORRIDA = 200;

/**
 * Tiene que ser el mismo plazo que usa `avisarRechazoAlCliente` para tomar el
 * reclamo. Si acá fuera más corto, este job le arrebataría la boleta a un
 * envío que todavía está en curso.
 */
const MINUTOS_DE_RECLAMO_VENCIDO = 10;

export type ResultadoRespaldo = {
	revisadas: number;
	avisosReintentados: number;
	alertasAsesorEntregadas: number;
};

/**
 * Boletas rechazadas a las que se les debe el mensaje: sin
 * `notificado_cliente_at` y sin nadie mandándolo ahora mismo (el reclamo
 * vencido cuenta como nadie — cubre el proceso que murió con la marca tomada).
 */
export async function reintentarAvisosDeRechazo(): Promise<ResultadoRespaldo> {
	const debidas = await db
		.select({ id: botCobrosBoletas.id })
		.from(botCobrosBoletas)
		.where(
			and(
				inArray(botCobrosBoletas.estado, ["rechazada"]),
				isNull(botCobrosBoletas.notificadoClienteAt),
				or(
					isNull(botCobrosBoletas.avisoReclamadoEn),
					sql`${botCobrosBoletas.avisoReclamadoEn} < now() - interval '${sql.raw(
						String(MINUTOS_DE_RECLAMO_VENCIDO),
					)} minutes'`,
				),
			),
		)
		// La que hace más rato que no se toca, primero. Cada intento la toca, así
		// que las que fallan rotan al final en vez de monopolizar el tope.
		.orderBy(asc(botCobrosBoletas.updatedAt))
		.limit(MAXIMO_POR_CORRIDA);

	const resultado: ResultadoRespaldo = {
		revisadas: debidas.length,
		avisosReintentados: 0,
		alertasAsesorEntregadas: 0,
	};

	for (const boleta of debidas) {
		const enviado = await avisarRechazoAlCliente(boleta.id);
		if (enviado.notificado) resultado.avisosReintentados++;
		// Rotación: aunque no haya salido, la boleta ya quedó tocada por el
		// reclamo/suelta de `avisarRechazoAlCliente`.
		await db
			.update(botCobrosBoletas)
			.set({ updatedAt: new Date() })
			.where(eq(botCobrosBoletas.id, boleta.id));
	}

	// La OTRA deuda del rechazo: alertas al asesor con el acta en blanco
	// (`notificado_asesor_at`). El caso que cubre: el evento se insertó pero su
	// alerta falló en aquel único intento — sin esto, el cliente leyó "tu
	// asesor te va a contactar" y ningún asesor se enteró jamás. No necesita
	// reclamo que venza: la marca y la notificación van en una transacción
	// dentro de `alertarAsesorDelRechazo`, no hay ventana entre las dos. Sin
	// columna de rotación tampoco pasa nada: los eventos son pocos, el tope es
	// amplio y una alerta que falla hoy reintenta en la corrida siguiente.
	const alertasDebidas = await db
		.select({ id: botCobrosPagoEventos.id })
		.from(botCobrosPagoEventos)
		.where(
			and(
				eq(botCobrosPagoEventos.evento, "rechazado"),
				isNull(botCobrosPagoEventos.notificadoAsesorAt),
			),
		)
		.orderBy(asc(botCobrosPagoEventos.createdAt))
		.limit(MAXIMO_POR_CORRIDA);

	for (const evento of alertasDebidas) {
		if (await alertarAsesorDelRechazo(evento.id)) {
			resultado.alertasAsesorEntregadas++;
		}
	}

	if (resultado.alertasAsesorEntregadas > 0) {
		console.log(
			`[BotCobrosRespaldo] ${resultado.alertasAsesorEntregadas} alerta(s) de asesor que estaban debidas se entregaron.`,
		);
	}

	if (resultado.avisosReintentados > 0) {
		console.log(
			`[BotCobrosRespaldo] ${resultado.revisadas} boleta(s) rechazadas sin avisar; ${resultado.avisosReintentados} aviso(s) salieron en el reintento.`,
		);
	}

	return resultado;
}
