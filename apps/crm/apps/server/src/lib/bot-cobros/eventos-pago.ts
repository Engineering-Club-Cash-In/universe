/**
 * El único mensaje del circuito de vuelta: el rechazo explícito (D-39).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA INTENCIÓN SE DECLARA, NO SE ADIVINA.
 *
 * Acá no se escucha `reversePayment`, ni `false-payment`, ni ningún movimiento
 * contable: en este sistema el reverso es una herramienta de reparación
 * interna (cuadres de pools, renumeraciones, reaplicaciones) y no dice nada
 * sobre la boleta del cliente. El único evento que dispara un WhatsApp es el
 * botón "Pago no válido" de conta, que declara la intención con motivo y
 * usuario.
 *
 * El aviso de "pago validado" NO es de este feature: lo construye otra
 * persona del equipo, y acá no se emite nada al validar.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Contrato: docs/features/bot-whatsapp-cobros/04-validacion-de-boleta.md (§6)
 */

import { and, eq, isNull, or, sql } from "drizzle-orm";
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
import { mensajesPagoRechazado } from "./mensajes-boleta";

/**
 * Cuánto vale un reclamo de aviso sin confirmarse.
 *
 * El derecho a mandar el WhatsApp se toma ANTES de enviarlo (para que dos
 * llamadas simultáneas no manden dos mensajes), pero con una marca que VENCE:
 * un proceso que muere entre reclamar y enviar no ejecuta ningún catch, y si
 * la marca no caducara esa boleta quedaría "notificada" para siempre sin que
 * el cliente hubiera recibido nada.
 */
const MINUTOS_DE_RECLAMO = 10;

export type EntradaRechazo = {
	pagoId: number;
	creditoId?: number | null;
	numeroSifco?: string | null;
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
		| "SIN_TELEFONO"
		| "ENVIO_FALLIDO";
};

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
 * Le avisa al asesor por el CRM. Va al `responsable_cobros` del caso de ese
 * crédito; sin caso, la notificación queda para el rol. Nunca rompe el flujo
 * (D-28).
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
 * Procesa el rechazo que declaró conta. **Es idempotente y siempre responde.**
 *
 * El unique `(pago_id, evento, ocurrido_en)` registra el evento una sola vez,
 * y el reclamo sobre la boleta garantiza UN WhatsApp aunque el aviso llegue
 * repetido o el botón se apriete dos veces.
 */
export async function procesarRechazoPago(
	entrada: EntradaRechazo,
): Promise<ResultadoEvento> {
	// 1 · ¿De quién es este pago? El unique global sobre `pago_id` del puente
	// es lo que permite la pregunta.
	const [puente] = await db
		.select({ boletaId: botCobrosBoletaPagos.boletaId })
		.from(botCobrosBoletaPagos)
		.where(eq(botCobrosBoletaPagos.pagoId, entrada.pagoId))
		.limit(1);

	// No es un error: el guard de cartera ya corta los pagos que no son del
	// bot, pero un puente puede faltar si la confirmación quedó a medias.
	if (!puente) return { notificado: false, motivo: "PAGO_NO_ES_DEL_BOT" };

	const [boleta] = await db
		.select()
		.from(botCobrosBoletas)
		.where(eq(botCobrosBoletas.id, puente.boletaId))
		.limit(1);

	if (!boleta) return { notificado: false, motivo: "PAGO_NO_ES_DEL_BOT" };

	// 2 · Se registra el evento (auditoría). Si ya estaba, no se re-registra,
	// pero SÍ se sigue: el reclamo de abajo decide si el mensaje ya salió — un
	// evento repetido con un envío que falló debe poder reintentar el envío.
	const guardado = await db
		.insert(botCobrosPagoEventos)
		.values({
			boletaId: boleta.id,
			pagoId: entrada.pagoId,
			evento: "rechazado",
			ocurridoEn: new Date(entrada.ocurridoEn),
			payload: entrada,
		})
		.onConflictDoNothing()
		.returning({ id: botCobrosPagoEventos.id });

	// 3 · La boleta queda rechazada. Es idempotente y no depende del envío.
	await db
		.update(botCobrosBoletas)
		.set({ estado: "rechazada", updatedAt: new Date() })
		.where(eq(botCobrosBoletas.id, boleta.id));

	// 4 · La alerta al asesor va atada al EVENTO NUEVO, no al reclamo: si
	// estuviera dentro del camino del mensaje, cada reintento tras un envío
	// fallido le repetiría al asesor la misma notificación.
	if (guardado.length > 0) {
		const monto = boleta.monto ?? "0";
		const numeroSifco = boleta.numeroSifco ?? null;

		await avisarAlAsesor({
			numeroSifco,
			titulo: `Boleta del bot rechazada por conta · ${numeroSifco ?? "sin SIFCO"}`,
			descripcion:
				`Contabilidad marcó como NO VÁLIDO el pago de Q${monto} que el cliente subió por WhatsApp` +
				`${entrada.usuario ? ` (${entrada.usuario})` : ""}` +
				`${entrada.motivo ? `. Motivo: ${entrada.motivo}` : ""}. ` +
				"Al cliente se le avisa que su asesor lo va a contactar.",
		});
	}

	return avisarRechazoAlCliente(boleta.id);
}

/**
 * Reclamar → mandar → marcar. El único lugar que le escribe al cliente.
 *
 * El UPDATE condicional lo decide la base: gana quien lo corra primero y el
 * otro se lleva cero filas. La marca del reclamo (`aviso_reclamado_en`) VENCE,
 * y `notificado_cliente_at` significa exactamente "esto se le entregó" — se
 * escribe recién después de que el envío salió.
 */
export async function avisarRechazoAlCliente(
	boletaId: string,
): Promise<ResultadoEvento> {
	const [boleta] = await db
		.select()
		.from(botCobrosBoletas)
		.where(eq(botCobrosBoletas.id, boletaId))
		.limit(1);

	if (!boleta) return { notificado: false, motivo: "PAGO_NO_ES_DEL_BOT" };

	const reclamada = await db
		.update(botCobrosBoletas)
		.set({ avisoReclamadoEn: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(botCobrosBoletas.id, boleta.id),
				// Todavía no se le contó.
				isNull(botCobrosBoletas.notificadoClienteAt),
				// Y nadie más lo está mandando ahora mismo.
				or(
					isNull(botCobrosBoletas.avisoReclamadoEn),
					sql`${botCobrosBoletas.avisoReclamadoEn} < now() - interval '${sql.raw(
						String(MINUTOS_DE_RECLAMO),
					)} minutes'`,
				),
			),
		)
		.returning({ id: botCobrosBoletas.id });

	if (reclamada.length === 0) {
		return { notificado: false, motivo: "EVENTO_REPETIDO" };
	}

	const monto = boleta.monto ?? "0";

	const telefono = await telefonoDeLaBoleta(boleta);
	if (!telefono) {
		// No hay a dónde escribir. El ciclo se cierra igual —reintentarlo cada
		// hora solo repetiría la alerta— y el hecho no se pierde: el asesor ya
		// tiene la suya y le toca avisar por otro medio.
		await db
			.update(botCobrosBoletas)
			.set({
				notificadoClienteAt: new Date(),
				avisoReclamadoEn: null,
				updatedAt: new Date(),
			})
			.where(eq(botCobrosBoletas.id, boleta.id));
		return { notificado: false, motivo: "SIN_TELEFONO" };
	}

	const salio = await escribirleAlCliente(
		telefono,
		mensajesPagoRechazado(monto).completo,
	);

	if (!salio) {
		// El envío se cayó. Se suelta el reclamo: el job de respaldo lo vuelve a
		// intentar cada hora mientras la boleta siga rechazada y sin notificar.
		await db
			.update(botCobrosBoletas)
			.set({ avisoReclamadoEn: null, updatedAt: new Date() })
			.where(eq(botCobrosBoletas.id, boleta.id));
		return { notificado: false, motivo: "ENVIO_FALLIDO" };
	}

	// Salió: recién ACÁ se escribe "entregado".
	await db
		.update(botCobrosBoletas)
		.set({
			notificadoClienteAt: new Date(),
			avisoReclamadoEn: null,
			updatedAt: new Date(),
		})
		.where(eq(botCobrosBoletas.id, boleta.id));

	return { notificado: true, motivo: null };
}
