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
import { botCobrosBoletas } from "../db/schema/bot-cobros-boletas";
import { avisarRechazoAlCliente } from "../lib/bot-cobros/eventos-pago";

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
	};

	for (const boleta of debidas) {
		// El reintento solo le debe el mensaje al cliente: la alerta del asesor
		// salió con el evento, una sola vez.
		const enviado = await avisarRechazoAlCliente(boleta.id);
		if (enviado.notificado) resultado.avisosReintentados++;
		// Rotación: aunque no haya salido, la boleta ya quedó tocada por el
		// reclamo/suelta de `avisarRechazoAlCliente`.
		await db
			.update(botCobrosBoletas)
			.set({ updatedAt: new Date() })
			.where(eq(botCobrosBoletas.id, boleta.id));
	}

	if (resultado.avisosReintentados > 0) {
		console.log(
			`[BotCobrosRespaldo] ${resultado.revisadas} boleta(s) rechazadas sin avisar; ${resultado.avisosReintentados} aviso(s) salieron en el reintento.`,
		);
	}

	return resultado;
}
