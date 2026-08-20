/**
 * Paso 4 · El circuito de vuelta: contabilidad resolvió, el cliente se entera.
 *
 * Contrato: docs/features/bot-whatsapp-cobros/04-validacion-de-boleta.md (§6)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESTE ARCHIVO ES EL PRODUCTO, NO UN ACCESORIO.
 *
 * Todo lo anterior —leer la boleta, confirmarla, registrarla— termina con un
 * "te avisamos cuando se acredite". Un pago validado del que el cliente jamás
 * se entera convierte esa promesa en mentira, y es peor que no haber tenido
 * circuito.
 *
 * Dos caminos llegan acá y hacen lo mismo (D-35):
 *   · el webhook `/pagos/evento`, que avisa en segundos;
 *   · el job de respaldo, que cada hora le pregunta a cartera por los pagos sin
 *     resolver, para el día que el webhook se pierda.
 *
 * Y una regla de agrupación que no es cosmética: **una boleta puede haber
 * creado tres pagos** (§5.2) y conta los valida uno por uno. Mandarle tres
 * WhatsApp al cliente por un solo depósito sería ridículo, así que el mensaje
 * sale cuando **ya no falta ninguno**.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import {
	botCobrosBoletaPagos,
	botCobrosBoletas,
	botCobrosPagoEventos,
} from "../../db/schema/bot-cobros-boletas";
import { casosCobros } from "../../db/schema/cobros";
import { coDebtors, leads } from "../../db/schema/crm";
import { notifications } from "../../db/schema/notifications";
import { resolverUsuarioSistemaCobros } from "../../services/cobros-notif-helpers";
import { sendWhatsappTemplate } from "../simpletech";
import { elegirTelefonoParaOtp } from "./identificadores";
import {
	mensajesPagoEnRevision,
	mensajesPagoRechazado,
	mensajesPagoValidado,
} from "./mensajes-boleta";

/**
 * Qué le pasó al pago del lado de cartera.
 *
 * Son los cinco caminos que existen hoy en carteraFront, no una taxonomía
 * inventada: cada uno corresponde a un botón que conta puede apretar.
 */
export type EventoPago =
	/** `GET /aplicar-pago` (el botón "Validar Pago") o `POST /revalidatePayment`. */
	| "validado"
	/** `POST /reversePayment`. **Este es el rechazo**: es el que devuelve la mora. */
	| "revertido"
	/** `POST /revertPaymentToPending`. Vuelve a la cola de conta. */
	| "regresado_a_pendiente"
	/** `POST /false-payment`. No restaura la mora: por eso es alerta, no rechazo. */
	| "marcado_falso";

export type EntradaEvento = {
	pagoId: number;
	creditoId?: number | null;
	numeroSifco?: string | null;
	evento: EventoPago;
	motivo?: string | null;
	usuario?: string | null;
	/** Cuándo pasó, del lado de cartera. Parte de la llave de idempotencia. */
	ocurridoEn: string;
};

export type ResultadoEvento = {
	/** true = se le escribió al cliente en esta pasada. */
	notificado: boolean;
	/**
	 * Por qué no se notificó, cuando no se notificó. **Ninguno es un error**:
	 * el endpoint siempre responde 200 (§6).
	 */
	motivo:
		| null
		| "PAGO_NO_ES_DEL_BOT"
		| "EVENTO_REPETIDO"
		| "FALTAN_PAGOS_POR_RESOLVER"
		| "SIN_TELEFONO"
		| "SOLO_ASESOR"
		| "ENVIO_FALLIDO";
};

/** Eventos que cierran el ciclo de un pago. `regresado_a_pendiente` lo reabre. */
const RESUELVEN = new Set<EventoPago>([
	"validado",
	"revertido",
	"marcado_falso",
]);

/**
 * Decide qué le toca a la boleta cuando ya no falta ningún pago por resolver.
 *
 * Es puro para poder probar la tabla de §6 sin base ni red, que es donde vive
 * la regla que de verdad importa: **basta un solo pago rechazado para que el
 * conjunto lo sea**. Decirle "acreditado" a alguien al que le revirtieron una
 * de sus tres cuotas es peor que no decirle nada.
 */
export function desenlaceDeLaBoleta(
	eventos: EventoPago[],
): "validado" | "rechazado" | "incompleto" {
	if (eventos.length === 0) return "incompleto";

	if (eventos.some((e) => e === "revertido" || e === "marcado_falso")) {
		return "rechazado";
	}

	return eventos.every((e) => e === "validado") ? "validado" : "incompleto";
}

/** El teléfono al que se le escribe: el mismo criterio del OTP. */
async function telefonoDeLaBoleta(boleta: {
	leadId: string | null;
	coDebtorId: string | null;
}): Promise<string | null> {
	if (boleta.coDebtorId) {
		const [codeudor] = await db
			.select({ phone: coDebtors.phone })
			.from(coDebtors)
			.where(eq(coDebtors.id, boleta.coDebtorId))
			.limit(1);

		return elegirTelefonoParaOtp(codeudor?.phone ?? null);
	}

	if (boleta.leadId) {
		const [lead] = await db
			.select({ phone: leads.phone })
			.from(leads)
			.where(eq(leads.id, boleta.leadId))
			.limit(1);

		return elegirTelefonoParaOtp(lead?.phone ?? null);
	}

	return null;
}

/**
 * Le avisa al asesor por el CRM.
 *
 * Va al `responsable_cobros` del caso de ese crédito. Si el crédito no tiene
 * caso —o el caso se borró—, la notificación **no se pierde**: queda asignada
 * al rol `cobros` para que la vea quien esté. Un aviso sin dueño es mejor que
 * un aviso que nadie escribió.
 */
export async function avisarAlAsesor(datos: {
	numeroSifco: string | null;
	titulo: string;
	descripcion: string;
}): Promise<void> {
	try {
		const usuarioSistema = await resolverUsuarioSistemaCobros();
		if (!usuarioSistema) {
			console.error(
				"[BotCobrosEventos] sin usuario sistema: no se pudo notificar al asesor",
			);
			return;
		}

		const [caso] = datos.numeroSifco
			? await db
					.select({
						id: casosCobros.id,
						responsable: casosCobros.responsableCobros,
					})
					.from(casosCobros)
					.where(eq(casosCobros.numeroCreditoSifco, datos.numeroSifco))
					.limit(1)
			: [];

		await db.insert(notifications).values({
			titulo: datos.titulo,
			descripcion: datos.descripcion,
			type: "action_required",
			status: "pending",
			createdBy: usuarioSistema,
			createdByRole: "cobros",
			assignedToRole: "cobros",
			// Sin caso, la notificación queda para el rol y no para nadie.
			assignedTo: caso?.responsable ?? null,
			...(caso
				? {
						relatedEntityType: "collection_case" as const,
						relatedEntityId: caso.id,
						redirectPage: "cobros_detail" as const,
					}
				: {}),
		});
	} catch (error) {
		// Igual que del lado de cartera: el aviso nunca rompe el flujo (D-28).
		console.error("[BotCobrosEventos] no se pudo notificar al asesor:", error);
	}
}

/** Manda el WhatsApp y devuelve si salió. Nunca tira. */
async function escribirleAlCliente(
	telefono: string,
	mensaje: string,
): Promise<boolean> {
	try {
		const envio = await sendWhatsappTemplate({
			phone: telefono,
			message: mensaje,
			logPrefix: "[BotCobrosEventos]",
		});

		return envio.success;
	} catch (error) {
		console.error("[BotCobrosEventos] envío de WhatsApp:", error);
		return false;
	}
}

/**
 * Procesa un evento de cartera. **Es idempotente y siempre responde.**
 *
 * El unique `(pago_id, evento, ocurrido_en)` es lo que evita el segundo
 * WhatsApp cuando el mismo aviso llega dos veces —el webhook y el job de
 * respaldo pueden cruzarse, y conta puede repetir una acción—.
 */
export async function procesarEventoPago(
	entrada: EntradaEvento,
): Promise<ResultadoEvento> {
	// 1 · ¿De quién es este pago? El unique global sobre `pago_id` es lo que
	// permite la pregunta.
	const [puente] = await db
		.select({
			boletaId: botCobrosBoletaPagos.boletaId,
			resueltoEn: botCobrosBoletaPagos.resueltoEn,
		})
		.from(botCobrosBoletaPagos)
		.where(eq(botCobrosBoletaPagos.pagoId, entrada.pagoId))
		.limit(1);

	// El 99% de los pagos del sistema no salen del bot. NO es un error: si esto
	// respondiera 4xx, los logs de contabilidad se llenarían de rojo por el
	// funcionamiento normal.
	if (!puente) return { notificado: false, motivo: "PAGO_NO_ES_DEL_BOT" };

	const [boleta] = await db
		.select()
		.from(botCobrosBoletas)
		.where(eq(botCobrosBoletas.id, puente.boletaId))
		.limit(1);

	if (!boleta) return { notificado: false, motivo: "PAGO_NO_ES_DEL_BOT" };

	// 2 · Se registra el evento. Si ya estaba, no se hace nada más.
	const guardado = await db
		.insert(botCobrosPagoEventos)
		.values({
			boletaId: boleta.id,
			pagoId: entrada.pagoId,
			evento: entrada.evento,
			ocurridoEn: new Date(entrada.ocurridoEn),
			payload: entrada,
		})
		.onConflictDoNothing()
		.returning({ id: botCobrosPagoEventos.id });

	if (guardado.length === 0) {
		return { notificado: false, motivo: "EVENTO_REPETIDO" };
	}

	// 3 · Se marca —o se desmarca— el pago.
	if (RESUELVEN.has(entrada.evento)) {
		await db
			.update(botCobrosBoletaPagos)
			.set({ resueltoEn: new Date(entrada.ocurridoEn) })
			.where(eq(botCobrosBoletaPagos.pagoId, entrada.pagoId));
	} else {
		// `regresado_a_pendiente` REABRE el ciclo, y son DOS campos.
		//
		// Sin limpiar el `resuelto_en`, el job de respaldo —que solo mira pagos
		// sin resolver— nunca vería la validación posterior, y el cliente se
		// quedaría con un "estamos revisando de nuevo" que no termina nunca.
		await db
			.update(botCobrosBoletaPagos)
			.set({ resueltoEn: null })
			.where(eq(botCobrosBoletaPagos.pagoId, entrada.pagoId));
	}

	return manejarDesenlace(boleta, entrada);
}

/**
 * Ya se registró el evento: ahora, ¿le toca mensaje al cliente?
 *
 * Acá vive la agrupación de §6. La pregunta no es "¿qué pasó con este pago?"
 * sino "¿qué pasó con **la boleta**?", y esa solo se puede contestar cuando no
 * falta ninguno de sus pagos.
 */
async function manejarDesenlace(
	boleta: typeof botCobrosBoletas.$inferSelect,
	entrada: EntradaEvento,
): Promise<ResultadoEvento> {
	const numeroSifco = boleta.numeroSifco ?? entrada.numeroSifco ?? null;
	const monto = boleta.monto ?? "0";

	// ── `marcado_falso`: al asesor y a nadie más ──────────────────────────────
	// `false-payment` NO restaura la mora —solo pone `pagado: false` y
	// `paymentFalse: true`—, así que el crédito queda con la mora que descontó
	// una boleta que se descartó. Eso es un problema contable que alguien tiene
	// que arreglar a mano, no una noticia para el cliente.
	if (entrada.evento === "marcado_falso") {
		await avisarAlAsesor({
			numeroSifco,
			titulo: `⚠️ Boleta del bot marcada como falsa · ${numeroSifco ?? "sin SIFCO"}`,
			descripcion:
				`El pago ${entrada.pagoId} (Q${monto}, subido por el cliente vía WhatsApp) se marcó como falso. ` +
				"Ojo: marcar falso NO devuelve la mora que el registro descontó, así que el crédito puede haber quedado con la mora de menos. Revisar y, si corresponde, revertir el pago.",
		});

		return { notificado: false, motivo: "SOLO_ASESOR" };
	}

	// ── `regresado_a_pendiente`: depende de qué se le dijo antes ──────────────
	if (entrada.evento === "regresado_a_pendiente") {
		await db
			.update(botCobrosBoletas)
			.set({ estado: "confirmada", updatedAt: new Date() })
			.where(eq(botCobrosBoletas.id, boleta.id));

		// Nunca se le dijo que estaba acreditado: para él no cambió nada, y
		// escribirle sería preocuparlo por un movimiento interno.
		if (!boleta.notificadoClienteAt) {
			await avisarAlAsesor({
				numeroSifco,
				titulo: `Pago del bot regresado a pendiente · ${numeroSifco ?? "sin SIFCO"}`,
				descripcion: `El pago ${entrada.pagoId} (Q${monto}) volvió a la cola de validación. Al cliente no se le había avisado nada, así que no se le escribió.`,
			});
			return { notificado: false, motivo: "SOLO_ASESOR" };
		}

		// Sí se le dijo. Callarse ahora lo deja creyendo algo que dejó de ser
		// cierto, así que se le escribe Y se reabre el ciclo de la boleta: el
		// `notificado_cliente_at` vuelve a null para que el desenlace siguiente
		// también le llegue.
		const telefono = await telefonoDeLaBoleta(boleta);
		await db
			.update(botCobrosBoletas)
			.set({ notificadoClienteAt: null, updatedAt: new Date() })
			.where(eq(botCobrosBoletas.id, boleta.id));

		await avisarAlAsesor({
			numeroSifco,
			titulo: `Pago del bot regresado a pendiente · ${numeroSifco ?? "sin SIFCO"}`,
			descripcion: `El pago ${entrada.pagoId} (Q${monto}) volvió a la cola de validación. Al cliente YA se le había dicho que estaba acreditado, así que se le avisó que vuelve a revisión.`,
		});

		if (!telefono) return { notificado: false, motivo: "SIN_TELEFONO" };

		const salio = await escribirleAlCliente(
			telefono,
			mensajesPagoEnRevision(monto).completo,
		);

		return {
			notificado: salio,
			motivo: salio ? null : "ENVIO_FALLIDO",
		};
	}

	// ── `validado` / `revertido`: hay que esperar a los hermanos ──────────────
	const pagos = await db
		.select({
			pagoId: botCobrosBoletaPagos.pagoId,
			numeroCuota: botCobrosBoletaPagos.numeroCuota,
			resueltoEn: botCobrosBoletaPagos.resueltoEn,
		})
		.from(botCobrosBoletaPagos)
		.where(eq(botCobrosBoletaPagos.boletaId, boleta.id));

	const pendientes = pagos.filter((p) => p.resueltoEn === null);
	if (pendientes.length > 0) {
		return { notificado: false, motivo: "FALTAN_PAGOS_POR_RESOLVER" };
	}

	// Todos resueltos: el desenlace sale del CONJUNTO, no de este evento.
	const ultimos = await ultimoEventoPorPago(boleta.id);
	const desenlace = desenlaceDeLaBoleta(ultimos);

	// Un solo mensaje por boleta, aunque hayan sido tres pagos.
	if (boleta.notificadoClienteAt) {
		return { notificado: false, motivo: "EVENTO_REPETIDO" };
	}

	if (desenlace === "incompleto") {
		// No debería pasar con todos resueltos, pero si pasa no se inventa un
		// mensaje: lo mira una persona.
		await avisarAlAsesor({
			numeroSifco,
			titulo: `Boleta del bot con desenlace mixto · ${numeroSifco ?? "sin SIFCO"}`,
			descripcion: `La boleta ${boleta.id} (Q${monto}) tiene ${ultimos.length} pago(s) con eventos que no arman un desenlace claro. Revisar a mano.`,
		});
		return { notificado: false, motivo: "SOLO_ASESOR" };
	}

	await db
		.update(botCobrosBoletas)
		.set({
			estado: desenlace === "validado" ? "confirmada" : "rechazada",
			updatedAt: new Date(),
		})
		.where(eq(botCobrosBoletas.id, boleta.id));

	if (desenlace === "rechazado") {
		await avisarAlAsesor({
			numeroSifco,
			titulo: `Boleta del bot rechazada · ${numeroSifco ?? "sin SIFCO"}`,
			descripcion:
				`Se revirtió el pago de Q${monto} que el cliente subió por WhatsApp` +
				`${entrada.usuario ? ` (por ${entrada.usuario})` : ""}` +
				`${entrada.motivo ? `. Motivo: ${entrada.motivo}` : ""}. ` +
				"Al cliente se le avisó que su asesor lo va a contactar.",
		});
	}

	const telefono = await telefonoDeLaBoleta(boleta);
	if (!telefono) {
		// El lead se borró y no hay a dónde escribir. El hecho NO se pierde: se
		// notifica al asesor en vez de dejarlo sin nadie.
		await avisarAlAsesor({
			numeroSifco,
			titulo: `Sin teléfono para avisarle al cliente · ${numeroSifco ?? "sin SIFCO"}`,
			descripcion: `La boleta ${boleta.id} (Q${monto}) quedó ${desenlace}, pero no se pudo resolver un teléfono del cliente. Avisarle por otro medio.`,
		});
		return { notificado: false, motivo: "SIN_TELEFONO" };
	}

	const cuotas = pagos
		.map((p) => p.numeroCuota)
		.filter((c): c is number => typeof c === "number")
		.sort((a, b) => a - b);

	const mensaje =
		desenlace === "validado"
			? mensajesPagoValidado({ monto, cuotas }).completo
			: mensajesPagoRechazado(monto).completo;

	const salio = await escribirleAlCliente(telefono, mensaje);

	// Solo se marca notificado si de verdad salió: si no, el job de respaldo lo
	// vuelve a intentar en la próxima corrida.
	if (salio) {
		await db
			.update(botCobrosBoletas)
			.set({ notificadoClienteAt: new Date(), updatedAt: new Date() })
			.where(eq(botCobrosBoletas.id, boleta.id));
	}

	return { notificado: salio, motivo: salio ? null : "ENVIO_FALLIDO" };
}

/**
 * El **último** evento de cada pago de la boleta, que es el que vale.
 *
 * Un pago se puede revertir y volver a validar, así que quedarse con todos los
 * eventos daría un desenlace "rechazado" para siempre por algo que ya se
 * arregló. Van ordenados por fecha y el último pisa al anterior.
 */
async function ultimoEventoPorPago(boletaId: string): Promise<EventoPago[]> {
	const filas = await db
		.select({
			pagoId: botCobrosPagoEventos.pagoId,
			evento: botCobrosPagoEventos.evento,
		})
		.from(botCobrosPagoEventos)
		.where(eq(botCobrosPagoEventos.boletaId, boletaId))
		.orderBy(botCobrosPagoEventos.ocurridoEn);

	const porPago = new Map<number, EventoPago>();
	for (const fila of filas) porPago.set(fila.pagoId, fila.evento as EventoPago);

	return [...porPago.values()];
}
