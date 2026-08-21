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

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
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

/**
 * Cuánto vale un reclamo de aviso sin confirmarse.
 *
 * Tiene que ser más de lo que puede tardar un envío de WhatsApp y menos de lo
 * que el cliente tolera esperar. El job de respaldo corre cada hora, así que
 * este número solo decide cuán rápido se recupera de un proceso caído.
 */
const MINUTOS_DE_RECLAMO = 10;

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
	/**
	 * No repetir si ya salió una con este mismo título en las últimas N horas.
	 *
	 * Para las alertas que nacen de una CONDICIÓN y no de un hecho: mientras la
	 * condición siga ahí, el job la vuelve a ver en cada corrida. Sin esto, una
	 * reversión trabada le manda al asesor la misma notificación cada hora hasta
	 * que alguien la destrabe, que es la mejor forma de que deje de leerlas.
	 *
	 * El título tiene que identificar el caso —incluir el pago, no solo el
	 * crédito—, si no dos problemas distintos se tapan entre sí.
	 */
	noRepetirPorHoras?: number;
}): Promise<void> {
	try {
		if (datos.noRepetirPorHoras) {
			const [reciente] = await db
				.select({ id: notifications.id })
				.from(notifications)
				.where(
					and(
						eq(notifications.titulo, datos.titulo),
						sql`${notifications.createdAt} > now() - interval '${sql.raw(
							String(datos.noRepetirPorHoras),
						)} hours'`,
					),
				)
				.limit(1);

			if (reciente) return;
		}

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

	// ── `marcado_falso`: alerta al asesor SIEMPRE ────────────────────────────
	// `false-payment` NO restaura la mora —solo pone `pagado: false` y
	// `paymentFalse: true`—, así que el crédito queda con la mora que descontó
	// una boleta que se descartó. Es un problema contable que alguien tiene que
	// arreglar a mano.
	//
	// **Esto NO corta el flujo.** Antes retornaba acá, y el resultado dependía
	// del orden en que cartera mandara los eventos de una boleta con varios
	// pagos: si el `marcado_falso` llegaba último, al cliente no se le decía
	// nada; si llegaba antes que un `validado`, el conjunto se resolvía como
	// rechazado y sí recibía el mensaje. Mismo estado final, dos comunicaciones
	// distintas según qué webhook ganó la carrera.
	//
	// Ahora son dos cosas separadas: la alerta contable sale siempre que llegue
	// un `marcado_falso`, y lo que se le dice al cliente lo decide el CONJUNTO
	// más abajo, igual que para cualquier otro evento.
	const yaAvisoAlAsesor = entrada.evento === "marcado_falso";

	if (yaAvisoAlAsesor) {
		await avisarAlAsesor({
			numeroSifco,
			titulo: `⚠️ Boleta del bot marcada como falsa · ${numeroSifco ?? "sin SIFCO"}`,
			descripcion:
				`El pago ${entrada.pagoId} (Q${monto}, subido por el cliente vía WhatsApp) se marcó como falso. ` +
				"Ojo: marcar falso NO devuelve la mora que el registro descontó, así que el crédito puede haber quedado con la mora de menos. Revisar y, si corresponde, revertir el pago.",
		});
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
		// cierto.
		//
		// Este mensaje va por el MISMO reclamo que el del desenlace final, y no
		// suelto a un lado como estaba. Antes se limpiaban los dos campos de
		// notificación y después se mandaba: si el envío fallaba, el evento ya
		// figuraba procesado, la boleta ya no recordaba qué se le había contado y
		// no quedaba nada que lo reintentara —el respaldo ve un pago pendiente y no
		// emite evento; el webhook repetido choca contra el unique—. El cliente se
		// quedaba, para siempre, creyendo que su pago estaba acreditado.
		//
		// Contándolo como un desenlace más (`en_revision`), el reintento sale
		// gratis: mientras `desenlace_notificado` siga diciendo `validado` con la
		// boleta de vuelta en revisión, el job sabe que le debemos el mensaje.
		await avisarAlAsesor({
			numeroSifco,
			titulo: `Pago del bot regresado a pendiente · ${numeroSifco ?? "sin SIFCO"}`,
			descripcion: `El pago ${entrada.pagoId} (Q${monto}) volvió a la cola de validación. Al cliente YA se le había dicho que estaba acreditado, así que se le avisó que vuelve a revisión.`,
		});

		return avisarEnRevision(boleta);
	}

	// ── `validado` / `revertido`: hay que esperar a los hermanos ──────────────
	return avisarDesenlaceAlCliente(boleta, {
		usuario: entrada.usuario ?? null,
		motivo: entrada.motivo ?? null,
		numeroSifco,
		yaAvisoAlAsesor,
	});
}

/**
 * Lo último que se le contó al cliente sobre esta boleta.
 *
 * `en_revision` es un desenlace más y no un estado aparte a propósito: es lo
 * que permite que el mensaje de `regresado_a_pendiente` se reintente por el
 * mismo camino que los otros dos, en vez de perderse si el envío falla.
 */
export type DesenlaceContado = "validado" | "rechazado" | "en_revision";

/**
 * Reclamar → mandar → marcar. El único lugar que le escribe al cliente.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL DERECHO A MANDAR SE TOMA ANTES DE ENVIAR, Y ES UN ARRENDAMIENTO.
 *
 * Leer `boleta.notificadoClienteAt` no alcanzaba: cuando los eventos de los
 * últimos pagos hermanos entran a la vez, los dos handlers cargan la boleta con
 * el campo en `null`, los dos ven que no queda nadie pendiente y los dos pasan
 * el chequeo antes de que ninguno haya escrito. Dos WhatsApp iguales.
 *
 * El UPDATE condicional lo decide la base: gana quien lo corra primero y el
 * otro se lleva cero filas. Pero la marca que se toma es `aviso_reclamado_en` y
 * NO `notificado_cliente_at`, por dos razones:
 *
 *   · Un proceso que muere entre reclamar y enviar no ejecuta ningún `catch`,
 *     así que no suelta nada. Si la marca significara "entregado", esa boleta
 *     quedaba notificada para siempre sin que el cliente hubiera recibido nada.
 *     Esta caduca, y el job de respaldo la vuelve a tomar.
 *   · `notificado_cliente_at` tiene que seguir significando exactamente "esto
 *     se le entregó".
 *
 * Y se reclama **por desenlace**, no por boleta: un pago validado que conta
 * revierte después cambia lo que hay que decirle. Con la condición vieja —"¿ya
 * se le dijo algo?"— ese segundo mensaje no salía nunca.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function mandarAvisoAlCliente(
	boleta: typeof botCobrosBoletas.$inferSelect,
	queContar: DesenlaceContado,
	opciones: {
		/** Corre solo si el reclamo salió: así no se duplica con cada reintento. */
		antesDeEnviar?: () => Promise<void>;
		armarMensaje: () => string;
		/** Qué hacer cuando no hay a dónde escribir. */
		alNoHaberTelefono?: () => Promise<void>;
	},
): Promise<ResultadoEvento> {
	const reclamada = await db
		.update(botCobrosBoletas)
		.set({ avisoReclamadoEn: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(botCobrosBoletas.id, boleta.id),
				// Todavía no se le contó ESTO.
				or(
					isNull(botCobrosBoletas.notificadoClienteAt),
					sql`${botCobrosBoletas.desenlaceNotificado} IS DISTINCT FROM ${queContar}`,
				),
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

	const marcarContado = () =>
		db
			.update(botCobrosBoletas)
			.set({
				notificadoClienteAt: new Date(),
				desenlaceNotificado: queContar,
				avisoReclamadoEn: null,
				updatedAt: new Date(),
			})
			.where(eq(botCobrosBoletas.id, boleta.id));

	await opciones.antesDeEnviar?.();

	const telefono = await telefonoDeLaBoleta(boleta);
	if (!telefono) {
		// El lead se borró y no hay a dónde escribir. El ciclo se cierra igual
		// —se marca esto como contado— porque reintentarlo cada hora solo
		// repetiría la misma alerta: no hay teléfono nuevo que aparezca solo.
		await marcarContado();
		await opciones.alNoHaberTelefono?.();
		return { notificado: false, motivo: "SIN_TELEFONO" };
	}

	const salio = await escribirleAlCliente(telefono, opciones.armarMensaje());

	if (!salio) {
		// El envío se cayó (SimpleTech, red, timeout). Se suelta solo el reclamo:
		// `desenlace_notificado` se queda como estaba, que es lo que le dice al
		// job de respaldo que todavía le debemos este mensaje.
		await db
			.update(botCobrosBoletas)
			.set({ avisoReclamadoEn: null, updatedAt: new Date() })
			.where(eq(botCobrosBoletas.id, boleta.id));

		return { notificado: false, motivo: "ENVIO_FALLIDO" };
	}

	// Salió: recién ACÁ se escribe "entregado", con qué fue lo que se entregó.
	await marcarContado();
	return { notificado: true, motivo: null };
}

/** "Tu pago vuelve a revisión", con reintento si el envío falla. */
async function avisarEnRevision(
	boleta: typeof botCobrosBoletas.$inferSelect,
): Promise<ResultadoEvento> {
	return mandarAvisoAlCliente(boleta, "en_revision", {
		armarMensaje: () => mensajesPagoEnRevision(boleta.monto ?? "0").completo,
	});
}

/**
 * El mensaje final de una boleta: uno solo, y solo cuando ya no falta nada.
 *
 * Sale de acá tanto el camino del webhook como el reintento del job de
 * respaldo, y por eso vuelve a leer el estado en vez de confiar en lo que traía
 * el evento: entre que se registró y que se llegó hasta acá pudo pasar de todo.
 */
async function avisarDesenlaceAlCliente(
	boleta: typeof botCobrosBoletas.$inferSelect,
	contexto: {
		usuario: string | null;
		motivo: string | null;
		numeroSifco: string | null;
		/** Ya se le mandó una alerta al asesor en esta misma pasada. */
		yaAvisoAlAsesor: boolean;
	},
): Promise<ResultadoEvento> {
	const { numeroSifco } = contexto;
	const monto = boleta.monto ?? "0";

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
		// La boleta volvió a revisión y al cliente se le había dicho que estaba
		// acreditado: le debemos la corrección, aunque este evento no cierre nada.
		if (boleta.desenlaceNotificado === "validado") {
			return avisarEnRevision(boleta);
		}
		return { notificado: false, motivo: "FALTAN_PAGOS_POR_RESOLVER" };
	}

	// Todos resueltos: el desenlace sale del CONJUNTO, no de este evento.
	const ultimos = await ultimoEventoPorPago(boleta.id);
	const desenlace = desenlaceDeLaBoleta(ultimos);

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

	const cuotas = pagos
		.map((p) => p.numeroCuota)
		.filter((c): c is number => typeof c === "number")
		.sort((a, b) => a - b);

	return mandarAvisoAlCliente(boleta, desenlace, {
		antesDeEnviar: async () => {
			if (desenlace !== "rechazado" || contexto.yaAvisoAlAsesor) return;

			await avisarAlAsesor({
				numeroSifco,
				titulo: `Boleta del bot rechazada · ${numeroSifco ?? "sin SIFCO"}`,
				descripcion:
					`Se revirtió el pago de Q${monto} que el cliente subió por WhatsApp` +
					`${contexto.usuario ? ` (por ${contexto.usuario})` : ""}` +
					`${contexto.motivo ? `. Motivo: ${contexto.motivo}` : ""}. ` +
					"Al cliente se le avisó que su asesor lo va a contactar.",
			});
		},
		armarMensaje: () =>
			desenlace === "validado"
				? mensajesPagoValidado({ monto, cuotas }).completo
				: mensajesPagoRechazado(monto).completo,
		alNoHaberTelefono: async () => {
			// El lead se borró y no hay a dónde escribir. El hecho NO se pierde: se
			// notifica al asesor en vez de dejarlo sin nadie.
			await avisarAlAsesor({
				numeroSifco,
				titulo: `Sin teléfono para avisarle al cliente · ${numeroSifco ?? "sin SIFCO"}`,
				descripcion: `La boleta ${boleta.id} (Q${monto}) quedó ${desenlace}, pero no se pudo resolver un teléfono del cliente. Avisarle por otro medio.`,
			});
		},
	});
}

/**
 * El último evento registrado de cada pago, para el job de respaldo.
 *
 * Es el guardarraíl de preguntarle a cartera por pagos que YA se resolvieron:
 * sin él, un pago validado hace tres semanas se traduciría en un evento
 * `validado` nuevo en cada corrida —el `ocurrido_en` lo pone el job, así que el
 * unique no lo frena— y la tabla de eventos crecería una fila por hora y por
 * pago. Solo interesa lo que CAMBIÓ.
 */
export async function ultimoEventoDePagos(
	ids: number[],
): Promise<Map<number, EventoPago>> {
	if (ids.length === 0) return new Map();

	const filas = await db
		.select({
			pagoId: botCobrosPagoEventos.pagoId,
			evento: botCobrosPagoEventos.evento,
		})
		.from(botCobrosPagoEventos)
		.where(inArray(botCobrosPagoEventos.pagoId, ids))
		.orderBy(botCobrosPagoEventos.ocurridoEn);

	const porPago = new Map<number, EventoPago>();
	for (const fila of filas) porPago.set(fila.pagoId, fila.evento as EventoPago);
	return porPago;
}

/**
 * Reintento del aviso al cliente, para el job de respaldo.
 *
 * Una boleta con todos sus pagos resueltos y `notificado_cliente_at` en `null`
 * es una a la que le debemos el mensaje: o el envío falló, o el proceso se cayó
 * entre reclamarla y mandarlo.
 */
export async function reintentarAvisoAlCliente(
	boletaId: string,
): Promise<ResultadoEvento> {
	const [boleta] = await db
		.select()
		.from(botCobrosBoletas)
		.where(eq(botCobrosBoletas.id, boletaId))
		.limit(1);

	if (!boleta) return { notificado: false, motivo: "PAGO_NO_ES_DEL_BOT" };

	return avisarDesenlaceAlCliente(boleta, {
		usuario: null,
		motivo: null,
		numeroSifco: boleta.numeroSifco ?? null,
		// El asesor ya recibió lo suyo en la pasada que falló; acá solo se
		// reintenta el mensaje al cliente.
		yaAvisoAlAsesor: true,
	});
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
