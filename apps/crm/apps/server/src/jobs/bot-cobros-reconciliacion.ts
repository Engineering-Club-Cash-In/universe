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

import { and, asc, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import {
	botCobrosBoletaPagos,
	botCobrosBoletas,
	type EstadoBoletaBot,
} from "../db/schema/bot-cobros-boletas";
import { carteraBackClient } from "../services/cartera-back-client";
import type { EstadoPagoCartera } from "../types/cartera-back";

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
	revisionManual: number;
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
	/** Pagos del bot en ese crédito sin ninguna boleta que los señale. */
	huerfanos?: EstadoPagoCartera[];
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

	// ─────────────────────────────────────────────────────────────────────────
	// NO HABER ENCONTRADO LA BOLETA NO ES LO MISMO QUE NO HABER PAGO.
	//
	// `insertPayment` escribe la fila de `pagos_credito` primero y la de
	// `boletas` después. Si revienta en el medio, el pago existe y su URL no se
	// escribió nunca: buscar por `r2_key` devuelve vacío sobre un pago que SÍ
	// está. Un pago del bot sin boleta colgando es exactamente esa firma.
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

	// ─────────────────────────────────────────────────────────────────────────
	// "NADA DE NADA" TAMPOCO SE REABRE SOLO: LO MIRA UNA PERSONA.
	//
	// Cartera se toca únicamente con endpoints nuevos de lectura (D-38), así
	// que no hay acta de reversiones ni de intentos que desambigüe este vacío.
	// Sin esa evidencia, "no encuentro nada" tiene tres lecturas posibles y dos
	// son peligrosas:
	//
	//   · no se registró nada            → reabrir sería correcto;
	//   · se registró y una reversión    → reabrir = SEGUNDO pago real;
	//     interna borró las filas
	//   · la mora/convenio se movió y el → reabrir = boleta entera sobre una
	//     500 llegó antes del pago         mora ya descontada.
	//
	// Un borrador de más en revisión manual cuesta minutos de una persona; una
	// reapertura equivocada cuesta plata del cliente. La asimetría decide.
	// ─────────────────────────────────────────────────────────────────────────
	return {
		estado: "revision_manual",
		motivo:
			"La confirmación no obtuvo respuesta y cartera no muestra ningún pago para esta boleta. Verificar en cartera antes de dejar que el cliente reintente.",
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
 * Decide entre ESPERAR y DECIDIR: con un pago en vuelo (o la duda), la boleta
 * se deja para la corrida siguiente en vez de mandarla a revisión manual por
 * un vacío que está a segundos de dejar de serlo. Es una línea, pero va con
 * nombre y con prueba.
 */
export function carteraDescartaOperacionEnVuelo(
	operacionEnCurso: boolean | null | undefined,
): boolean {
	return operacionEnCurso === false;
}

/** Manda la boleta al final de la fila de la próxima corrida (rotación). */
async function marcarIntento(boletaId: string): Promise<void> {
	await db
		.update(botCobrosBoletas)
		.set({ updatedAt: new Date() })
		.where(eq(botCobrosBoletas.id, boletaId));
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
		// La menos tocada primero. Cada intento —resuelva o no— actualiza
		// `updated_at`, así que las que cartera no puede contestar se van al
		// final de la fila en vez de monopolizar el tope de cada corrida y
		// dejar a las demás esperando su turno para siempre.
		.orderBy(asc(botCobrosBoletas.updatedAt))
		.limit(MAXIMO_POR_CORRIDA);

	const resumen: ResultadoReconciliacion = {
		revisados: colgadas.length,
		confirmadasAVerificar: 0,
		revisionManual: 0,
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
			await marcarIntento(boleta.id);
			resumen.sinResolver++;
			continue;
		}

		const destino = decidirDestino({
			pagos: respuesta.pagos ?? [],
			huerfanos: respuesta.huerfanos ?? [],
		});

		// ⚠️ Con un pago en vuelo, se espera.
		//
		// "Nada de nada" con un `insertPayment` esperando el advisory lock no es
		// un caso para una persona: es un pago que está por escribirse. Mandarlo
		// a revisión manual ahora sería darle trabajo al asesor por una boleta
		// que en la corrida siguiente va a tener sus pagos a la vista.
		//
		// `undefined` —cartera vieja, o no se preguntó— cuenta como "puede estar
		// en curso": con la duda también se espera.
		if (
			destino.estado === "revision_manual" &&
			(respuesta.pagos ?? []).length === 0 &&
			!carteraDescartaOperacionEnVuelo(respuesta.operacion_en_curso)
		) {
			await marcarSiLlevaDemasiado(boleta.id, horasColgado, resumen);
			await marcarIntento(boleta.id);
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

		const estadoFinal: EstadoBoletaBot = destino.estado;

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
		else resumen.revisionManual++;
	}

	if (resumen.revisados > 0) {
		console.log(
			`[BotCobrosReconciliacion] ${resumen.revisados} borrador(es) colgado(s): ` +
				`${resumen.confirmadasAVerificar} a verificar, ` +
				`${resumen.revisionManual} a revisión manual, ${resumen.sinResolver} sin resolver.`,
		);
	}

	return resumen;
}
