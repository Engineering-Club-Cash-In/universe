/**
 * Purga de los borradores de boleta que nunca llegaron a ser un pago.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ES UNA OBLIGACIÓN DE RETENCIÓN, NO UNA LIMPIEZA DE ORDEN.
 *
 * Cada fila guarda la URL de origen del cliente, a qué lead pertenece, el hash
 * de su imagen y **la extracción cruda del modelo**. Eso es PII: el contrato
 * (§10) dice que los borradores sin confirmar viven 7 días, y hasta ahora nada
 * lo cumplía — `expira_en` solo servía para invalidar el borrador, jamás para
 * borrarlo.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Contrato: docs/features/bot-whatsapp-cobros/04-validacion-de-boleta.md (§10)
 * Decisión: D-14 (retención de PII y logs)
 */

import { and, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db";
import {
	botCobrosBoletas,
	type EstadoBoletaBot,
} from "../db/schema/bot-cobros-boletas";

const DIAS_DE_RETENCION = 7;

/**
 * Estados que se pueden borrar: los que nunca produjeron un pago.
 *
 * Fuera quedan a propósito:
 *   · `confirmada`, `confirmada_a_verificar` y `rechazada` — tienen un pago en
 *     cartera, y esta fila es la única prueba de por qué hay una boleta que
 *     nadie del equipo subió;
 *   · `confirmando` — está a mitad de camino, la resuelve la reconciliación;
 *   · `revision_manual` — está esperando que la mire una persona; borrarla es
 *     justamente perder lo que había que revisar.
 */
const PURGABLES: EstadoBoletaBot[] = [
	"leyendo",
	"leida",
	"fallida",
	"descartada",
];

export async function purgarBoletasSinConfirmar(): Promise<number> {
	const borradas = await db
		.delete(botCobrosBoletas)
		.where(
			and(
				inArray(botCobrosBoletas.estado, PURGABLES),
				lt(
					botCobrosBoletas.createdAt,
					sql`now() - interval '${sql.raw(String(DIAS_DE_RETENCION))} days'`,
				),
				// Cinturón y tirantes: si por lo que sea una fila purgable quedó
				// amarrada a un pago, no se toca. La retención nunca puede borrar
				// el respaldo de plata que entró.
				sql`NOT EXISTS (
					SELECT 1 FROM bot_cobros_boleta_pagos p
					WHERE p.boleta_id = ${botCobrosBoletas.id}
				)`,
			),
		)
		.returning({ id: botCobrosBoletas.id });

	if (borradas.length > 0) {
		console.log(
			`[BotCobrosPurga] ${borradas.length} borrador(es) de boleta sin confirmar, de más de ${DIAS_DE_RETENCION} días, eliminados.`,
		);
	}

	return borradas.length;
}
