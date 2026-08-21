/**
 * Los borradores que quedaron colgados en `confirmando`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "NO ENCUENTRO EL PAGO" TENÍA DOS LECTURAS OPUESTAS.
 *
 * Cuando `/boleta/confirmar` llama a cartera y no recibe respuesta, el borrador
 * se queda en `confirmando` porque **no se sabe si el pago existe**. Volver a
 * llamar a `newPayment` crearía un segundo pago real; devolver el borrador a
 * `leida` dejaría que el cliente reconfirme un pago que quizás ya está.
 *
 * Este job va y pregunta. Y la respuesta ya no es ambigua gracias al registro de
 * reversiones (D-36): antes de borrar las boletas, cartera deja una fila con las
 * URLs que va a destruir.
 *
 *   Filas vivas en `boletas`        → se registró    → confirmada_a_verificar
 *   Nada vivo + reversión completada → lo rechazaron → rechazada
 *   Nada vivo + solo `iniciada`      → reversión a medias → revision_manual
 *   Nada de nada                     → no se registró → leida
 *
 * Son CUATRO respuestas y CUATRO transiciones, sin zona gris.
 *
 * ⚠️ **PERO LA CUARTA NO ES INCONDICIONAL.** Que el CRM se haya cansado de
 * esperar no cancela nada del lado de cartera: `insertPayment` toma un advisory
 * lock por crédito y puede quedarse minutos esperándolo si hay otro pago del
 * mismo crédito adelante. Todo ese tiempo el request original sigue vivo y va a
 * escribir cuando le toque. "No encontré filas" no prueba que no se vaya a
 * registrar — solo que **todavía** no se registró.
 *
 * Devolver el borrador a `leida` en esa duda es habilitar un segundo pago real,
 * que es exactamente lo que toda esta máquina existe para evitar. Por eso antes
 * de reabrir se le pregunta a cartera si hay una operación en vuelo para ese
 * crédito (`operacion_en_curso`, que mira `pg_locks`), y si la hay —o si no se
 * puede saber— el borrador se queda donde está y se reintenta en la próxima
 * corrida.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * **Por qué "a verificar" y no "lista".** `insertPayment` no es transaccional:
 * escribe las filas una por una. Si se cayó a mitad de repartir entre tres
 * cuotas, quedaron una o dos commiteadas y un 500 de vuelta. Encontrar filas con
 * esa `r2_key` prueba que **algo** se escribió, no que se escribió **todo** — y
 * por eso el job nunca reintenta el `newPayment` (duplicaría lo ya escrito) ni
 * le dice al cliente "pago recibido".
 *
 * Contrato: docs/features/bot-whatsapp-cobros/04-validacion-de-boleta.md (§4.1)
 */

import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import {
	botCobrosBoletaPagos,
	botCobrosBoletas,
	type EstadoBoletaBot,
} from "../db/schema/bot-cobros-boletas";
import { carteraBackClient } from "../services/cartera-back-client";
import type {
	EstadoPagoCartera,
	IntentoBoletaCartera,
	ReversionCartera,
} from "../types/cartera-back";

/**
 * Cuánto se le da a una confirmación antes de ir a preguntar.
 *
 * Corto y no larguísimo porque del otro lado hay un cliente esperando: si su
 * pago no se registró, mientras tanto no puede reintentar.
 */
const MINUTOS_COLGADO = 5;

/** Tope por corrida. Si hay más, se atienden en la siguiente. */
const MAXIMO_POR_CORRIDA = 50;

/**
 * A partir de acá, un borrador colgado deja de ser un problema técnico y pasa a
 * ser un problema de alguien.
 *
 * Un `confirmando` que no se resuelve en un día entero significa que cartera
 * lleva un día sin poder contestar, o que hay un pago trabado hace 24 horas:
 * las dos cosas necesitan un humano. Sin este tope, esos borradores se
 * reintentarían para siempre, en silencio, y nadie se enteraría —el cliente
 * menos que nadie, porque su pago quedó en el aire.
 */
const HORAS_PARA_REVISION_MANUAL = 24;

export type ResultadoReconciliacion = {
	revisados: number;
	confirmadasAVerificar: number;
	rechazadas: number;
	revisionManual: number;
	devueltasALeida: number;
	/** Se dejaron como estaban: cartera no contestó, o el pago sigue en vuelo. */
	sinResolver: number;
};

/**
 * Decide qué pasó, a partir de lo que cartera contestó.
 *
 * Está aparte de la escritura para poder probar la tabla de §4.1 sin base ni
 * red: es la única pieza con reglas de negocio de todo el archivo.
 */
export function decidirDestino(respuesta: {
	pagos: EstadoPagoCartera[];
	reversiones: ReversionCartera[];
	/** Pagos del bot en ese crédito sin ninguna boleta que los señale. */
	huerfanos?: EstadoPagoCartera[];
	/** Actas de registro del bot que quedaron `iniciado` para esta URL. */
	intentos?: IntentoBoletaCartera[];
}): { estado: EstadoBoletaBot; motivo: string } {
	// Las filas anuladas (`paymentFalse`) no son un pago vivo: existen para dejar
	// rastro de algo que se dio por no hecho.
	const vivos = respuesta.pagos.filter((p) => p.payment_false !== true);

	if (vivos.length > 0) {
		return {
			estado: "confirmada_a_verificar",
			motivo: `Se encontraron ${vivos.length} pago(s) en cartera tras una confirmación sin respuesta. Verificar que el monto haya quedado completo.`,
		};
	}

	// Basta UNA reversión terminada para cerrar la boleta como rechazada: los
	// intentos anteriores son historia (D-36).
	if (respuesta.reversiones.some((r) => r.estado === "completada")) {
		return {
			estado: "rechazada",
			motivo: "El pago se registró y contabilidad lo revirtió.",
		};
	}

	// ⚠️ `iniciada` NO es un rechazo. Es una reversión que quedó a medias en
	// cartera: la mora, el convenio o el inversionista pueden haberse movido sin
	// que el pago quedara revertido. No se le puede decir a un cliente que su
	// pago se rechazó cuando ni siquiera sabemos si se revirtió.
	if (respuesta.reversiones.some((r) => r.estado === "iniciada")) {
		return {
			estado: "revision_manual",
			motivo:
				"Hay una reversión a medias en cartera para esta boleta: nadie puede decidir esto solo.",
		};
	}

	// ─────────────────────────────────────────────────────────────────────────
	// UN ACTA `iniciado` SIN COMPLETAR = UN REGISTRO QUE MURIÓ A MEDIAS.
	//
	// `insertPayment` escribe la mora y el convenio ANTES de la primera fila
	// del pago. Si revienta en esa ventana no queda pago, ni boleta, ni
	// reversión que lo delate — solo el acta que cartera escribe antes de
	// mutar nada. Reabrir acá haría que el reintento aplique la boleta entera
	// sobre una mora ya descontada.
	// ─────────────────────────────────────────────────────────────────────────
	const intentosAMedias = (respuesta.intentos ?? []).filter(
		(i) => i.estado === "iniciado",
	);

	if (intentosAMedias.length > 0) {
		return {
			estado: "revision_manual",
			motivo:
				`Cartera tiene ${intentosAMedias.length} intento(s) de registro de esta boleta que empezaron a escribir y nadie completó ` +
				`(${intentosAMedias.map((i) => i.intento_id).join(", ")}). ` +
				"La mora o el convenio pueden haberse movido sin que el pago exista. Revisar el crédito antes de dejar reintentar.",
		};
	}

	// ─────────────────────────────────────────────────────────────────────────
	// NO HABER ENCONTRADO LA BOLETA NO ES LO MISMO QUE NO HABER PAGO.
	//
	// `insertPayment` escribe la fila de `pagos_credito` primero y la de
	// `boletas` después. Si revienta en el medio —el 500 que ahora se trata como
	// indeterminado—, el pago existe y su URL no se escribió nunca: buscar por
	// `r2_key` devuelve vacío sobre un pago que SÍ está, el borrador vuelve a
	// `leida` y el cliente confirma otra vez. Dos pagos reales.
	//
	// Un pago del bot en ese crédito sin ninguna boleta colgando es exactamente
	// esa firma. No se decide sola: se manda a revisión manual, porque tampoco
	// se puede asegurar que ese huérfano sea de ESTA boleta.
	// ─────────────────────────────────────────────────────────────────────────
	const huerfanos = (respuesta.huerfanos ?? []).filter(
		(p) => p.payment_false !== true,
	);

	if (huerfanos.length > 0) {
		return {
			estado: "revision_manual",
			motivo:
				`No se encontró la boleta en cartera, pero el crédito tiene ${huerfanos.length} pago(s) del bot ` +
				`sin boleta asociada (${huerfanos.map((p) => p.pago_id).join(", ")}). ` +
				"Puede ser este mismo pago, escrito antes de que fallara el registro de su boleta. Verificar antes de dejar que el cliente reintente.",
		};
	}

	return {
		estado: "leida",
		motivo: "",
	};
}

/**
 * La válvula de escape: un borrador que lleva un día colgado necesita un humano.
 *
 * No decide nada sobre el pago —sigue sin saberse si existe—; solo saca la fila
 * de la rueda de reintentos silenciosos y la pone donde alguien la vea. Es la
 * diferencia entre un problema que nadie conoce y uno que está en una lista.
 */
async function marcarSiLlevaDemasiado(
	boletaId: string,
	horasColgado: number,
	resumen: ResultadoReconciliacion,
): Promise<void> {
	if (horasColgado < HORAS_PARA_REVISION_MANUAL) return;

	await db
		.update(botCobrosBoletas)
		.set({
			estado: "revision_manual",
			motivoFallo: `Lleva ${Math.floor(horasColgado)} h sin poder confirmarse contra cartera: no se sabe si el pago se registró.`,
			confirmandoDesde: null,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(botCobrosBoletas.id, boletaId),
				eq(botCobrosBoletas.estado, "confirmando"),
			),
		);

	resumen.revisionManual++;
	console.error(
		`[BotCobrosReconciliacion] la boleta ${boletaId} lleva ${Math.floor(horasColgado)} h colgada: va a revisión manual.`,
	);
}

/**
 * ¿Se puede devolver el borrador a `leida`?
 *
 * Solo si cartera dijo **explícitamente** que no hay ninguna operación en vuelo
 * para ese crédito. `null` y `undefined` —no se preguntó, o la instancia de
 * cartera todavía no tiene el campo— cuentan como "puede haberla".
 *
 * Es una línea, pero es la que separa "el cliente espera cinco minutos más" de
 * "el cliente paga dos veces", así que va con nombre y con prueba.
 */
export function sePuedeReabrir(
	operacionEnCurso: boolean | null | undefined,
): boolean {
	return operacionEnCurso === false;
}

export async function reconciliarBoletasColgadas(): Promise<ResultadoReconciliacion> {
	const colgadas = await db
		.select({
			id: botCobrosBoletas.id,
			r2Key: botCobrosBoletas.r2Key,
			creditoId: botCobrosBoletas.creditoId,
			expiraEn: botCobrosBoletas.expiraEn,
			confirmandoDesde: botCobrosBoletas.confirmandoDesde,
		})
		.from(botCobrosBoletas)
		.where(
			and(
				eq(botCobrosBoletas.estado, "confirmando"),
				isNotNull(botCobrosBoletas.r2Key),
				lt(
					botCobrosBoletas.confirmandoDesde,
					sql`now() - interval '${sql.raw(String(MINUTOS_COLGADO))} minutes'`,
				),
			),
		)
		.limit(MAXIMO_POR_CORRIDA);

	const resumen: ResultadoReconciliacion = {
		revisados: colgadas.length,
		confirmadasAVerificar: 0,
		rechazadas: 0,
		revisionManual: 0,
		devueltasALeida: 0,
		sinResolver: 0,
	};

	for (const boleta of colgadas) {
		if (!boleta.r2Key) continue;

		const respuesta = await carteraBackClient.getPagosPorBoleta(
			boleta.r2Key,
			boleta.creditoId ?? undefined,
		);

		// Cuánto lleva colgado. Sirve para la válvula de escape de más abajo.
		const horasColgado = boleta.confirmandoDesde
			? (Date.now() - boleta.confirmandoDesde.getTime()) / 3_600_000
			: 0;

		// Cartera sigue sin contestar. Se deja como está: un borrador colgado un
		// rato más es infinitamente mejor que decidir a ciegas.
		if (!respuesta) {
			await marcarSiLlevaDemasiado(boleta.id, horasColgado, resumen);
			resumen.sinResolver++;
			continue;
		}

		const destino = decidirDestino({
			pagos: respuesta.pagos ?? [],
			reversiones: respuesta.reversiones ?? [],
			huerfanos: respuesta.huerfanos ?? [],
			// Con un insertPayment en vuelo, su acta está `iniciado` legítimamente:
			// se espera a que suelte el lock antes de leerla como evidencia.
			intentos: sePuedeReabrir(respuesta.operacion_en_curso)
				? (respuesta.intentos ?? [])
				: [],
		});

		// ⚠️ Antes de reabrir, la prueba positiva.
		//
		// Solo la cuarta transición —"no se registró"— necesita esto: las otras
		// tres se apoyan en algo que ya existe (filas vivas, una reversión), y un
		// pago en vuelo no las contradice. Reabrir, en cambio, habilita un
		// segundo `newPayment`, y si el primero todavía está esperando el
		// advisory lock terminan siendo dos pagos reales.
		//
		// `undefined` —cartera vieja, o no se preguntó— cuenta como "puede estar
		// en curso". Con la duda no se reabre: el costo de esperar otros cinco
		// minutos es que el cliente espera; el de equivocarse es que paga dos
		// veces.
		if (
			destino.estado === "leida" &&
			!sePuedeReabrir(respuesta.operacion_en_curso)
		) {
			console.warn(
				`[BotCobrosReconciliacion] la boleta ${boleta.id} no tiene pagos, pero hay una operación en vuelo (o no se pudo saber): no se reabre.`,
			);
			await marcarSiLlevaDemasiado(boleta.id, horasColgado, resumen);
			resumen.sinResolver++;
			continue;
		}

		// Los pagos que sí se escribieron se amarran igual: son los que van a
		// llegar en los eventos de contabilidad, y sin la fila puente el CRM no
		// sabría de quién son.
		const vivos = (respuesta.pagos ?? []).filter(
			(p) => p.payment_false !== true,
		);
		if (vivos.length > 0) {
			await db
				.insert(botCobrosBoletaPagos)
				.values(
					vivos.map((p) => ({
						boletaId: boleta.id,
						pagoId: p.pago_id,
						numeroCuota: p.numero_cuota,
					})),
				)
				.onConflictDoNothing();
		}

		// Una boleta que vuelve a `leida` con el borrador ya vencido no le sirve
		// a nadie —el cliente no podría confirmarla— y quedaría bloqueando su
		// propia foto por hash. Se marca descartada, que es lo que de verdad es.
		const venció = boleta.expiraEn.getTime() <= Date.now();
		const estadoFinal: EstadoBoletaBot =
			destino.estado === "leida" && venció ? "descartada" : destino.estado;

		await db
			.update(botCobrosBoletas)
			.set({
				estado: estadoFinal,
				motivoFallo: destino.motivo || null,
				confirmandoDesde: null,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(botCobrosBoletas.id, boleta.id),
					// Condicionado: si en el medio la petición original despertó y
					// terminó bien, este UPDATE no la pisa.
					eq(botCobrosBoletas.estado, "confirmando"),
				),
			);

		if (estadoFinal === "confirmada_a_verificar")
			resumen.confirmadasAVerificar++;
		else if (estadoFinal === "rechazada") resumen.rechazadas++;
		else if (estadoFinal === "revision_manual") resumen.revisionManual++;
		else resumen.devueltasALeida++;
	}

	if (resumen.revisados > 0) {
		console.log(
			`[BotCobrosReconciliacion] ${resumen.revisados} borrador(es) colgado(s): ` +
				`${resumen.confirmadasAVerificar} a verificar, ${resumen.rechazadas} rechazada(s), ` +
				`${resumen.revisionManual} a revisión manual, ${resumen.devueltasALeida} devuelta(s), ` +
				`${resumen.sinResolver} sin resolver.`,
		);
	}

	return resumen;
}
