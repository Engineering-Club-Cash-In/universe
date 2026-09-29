import { and, asc, eq, gt, inArray, like, or, sql } from "drizzle-orm";
import type { db } from "../database/index";
import { moras_historial } from "../database/db/schema";
import {
	MARCA_DECREMENTO_ANULADO,
	marcaPagoDelDecremento,
} from "../utils/motivoReversaMora";
import type { EstadoMoraTrasElPago } from "../utils/restitucionMoraDePago";

/**
 * ¿El cron ya repuso, por su cuenta, la mora que este pago había bajado?
 *
 * ⚠️ ES EL CAMINO DE RESERVA, no el principal. Desde que el `DECREMENTO` lleva
 * la marca de su pago (`marcaPagoDelDecremento`), la pregunta se contesta con
 * el DELTA REAL sobre ese evento —ver `estadoMoraTrasElPago` más abajo— y esta
 * función solo se usa para los decrementos VIEJOS, los escritos antes de que la
 * marca existiera. Se conserva TAL CUAL, sin endurecerla: es el comportamiento
 * ya medido contra el dump (crédito 980, pago 152172) y el único que no le
 * devuelve el doble a un crédito cuyo decremento no se puede ubicar. Esos
 * decrementos se agotan solos; los nuevos nacen todos marcados.
 *
 * ── Por qué la pregunta existe ──────────────────────────────────────────────
 * Registrar un pago baja la mora EN EL ACTO (`insertPayment` →
 * `procesarPagoMora` → `updateMora` DECREMENTO), pero el criterio de cobertura
 * del cron solo cuenta pagos `validated`/`no_required` (el EXISTS de
 * `hasPaidPayment` en `procesarMoras`). Un pago que amanece `pending` deja su
 * cuota contada como vencida y el cron vuelve a FIJAR la mora completa desde la
 * fórmula —REEMPLAZA el monto, no lo acumula—. Después de esa corrida la bajada
 * del pago ya está deshecha, y restituirla encima —al anular la boleta o al
 * revertir el pago— le cobra al cliente el doble.
 *
 * Solo cuentan `CREACION` y `RECALCULO`: son los dos eventos con los que el
 * cron fija el monto desde la fórmula. Una `DESACTIVACION` es lo contrario
 * —apagó la mora— y no repone nada.
 *
 * ── El ancla ────────────────────────────────────────────────────────────────
 * Es `pagos_credito.createdat`: el momento en que se escribió la fila y se
 * aplicó el DECREMENTO. NO `fecha_pago`, que es retrofechable y dejaría la
 * ventana en cualquier lado. Sin ancla (`desde` vacío) no se reconcilia nada y
 * el caller restituye como antes: el sobrecobro lo corrige el cron en su
 * próxima corrida, perderle la mora al crédito no lo corrige nadie.
 *
 * ── Por qué es un módulo aparte ─────────────────────────────────────────────
 * Los dos caminos que invalidan un pago —`anularPagoYRestituirMora` y
 * `reversePayment`— necesitan la MISMA respuesta. Con la consulta duplicada,
 * cambiarle el criterio a uno (agregar un `tipo_evento`, mover el ancla) dejaba
 * al otro con la regla vieja, y el que se quedara atrás volvería a sobrecobrar.
 * Acá hay una sola definición.
 *
 * `executor` es el `tx` del caller cuando lo hay: leer con OTRA conexión
 * mientras su transacción tiene filas candadas es pedir un bloqueo contra uno
 * mismo. Es una LECTURA sin candado, así que no participa del orden de candados
 * del módulo (`creditos` antes que `moras_credito`).
 */
export async function elCronYaRepusoLaMora(
  /**
   * `Pick<..., "select">` y no `typeof db`: el `tx` que entrega
   * `db.transaction` es un `PgTransaction` y no trae `$client`. Lo único que se
   * le pide acá es leer.
   */
  executor: Pick<typeof db, "select">,
  {
    credito_id,
    desde,
  }: { credito_id: number; desde: Date | null | undefined },
): Promise<boolean> {
  if (!desde) return false;

  const eventos = await executor
    .select({ historial_id: moras_historial.historial_id })
    .from(moras_historial)
    .where(
      and(
        eq(moras_historial.credito_id, credito_id),
        eq(moras_historial.origen, "PROCESO_AUTO"),
        inArray(moras_historial.tipo_evento, ["CREACION", "RECALCULO"]),
        gt(moras_historial.fecha, desde),
      ),
    )
    .limit(1);

  return eventos.length > 0;
}

/**
 * ── EL DECREMENTO DE UN PAGO, IDENTIFICADO POR SU MARCA ─────────────────────
 *
 * Todo lo de arriba —el ancla por fecha, el proxy "hubo algún evento del
 * cron"— existía porque el `DECREMENTO` de mora no estaba ligado a su pago.
 * Ahora sí lo está: `registerPayment` le estampa `[pago #N]` al `motivo` en
 * cuanto la fila del pago existe (ver `marcaPagoDelDecremento`). Con el evento
 * en la mano, las dos preguntas se contestan de verdad en vez de adivinarse:
 *
 *   * el ANCLA es el evento mismo —su `fecha` y su `historial_id`—, no el
 *     `createdat` de la fila del pago, que se escribe DESPUÉS y dejaba un hueco
 *     en el que una corrida del cron caía del lado equivocado;
 *   * lo repuesto es el DELTA REAL: cuánto volvió a subir la mora desde ese
 *     evento, no "¿hubo alguno?".
 *
 * Los dos caminos que invalidan un pago comparten estas funciones por la misma
 * razón que compartían las anteriores: si el criterio se duplicara, el que
 * quedara atrás volvería a cobrar de más o de menos.
 */
export type DecrementoDelPago = {
	historial_id: number;
	fecha: Date;
	/** Cuánto bajó la mora ese evento: `monto_anterior - monto_nuevo`. */
	bajado: number;
	/** ¿Ya lo marcamos como anulado en un intento anterior? */
	anulado: boolean;
};

/**
 * El `DECREMENTO` de mora que dejó ESTE pago, o `null` si no lleva marca.
 *
 * `null` NO significa "este pago no bajó mora": significa "no se puede
 * afirmar". Los decrementos anteriores al despliegue de la marca caen acá, y
 * el caller vuelve al criterio viejo (ver `EstadoMoraTrasElPago`).
 *
 * Se toma el MÁS RECIENTE por si un reintento llegara a estampar dos veces la
 * misma marca: el último es el que corresponde al estado actual de la mora.
 *
 * Es una LECTURA sin candado, así que no participa del orden de candados del
 * módulo (`creditos` antes que `moras_credito`). Va por el `tx` del caller
 * cuando lo hay: leer con otra conexión mientras su transacción tiene filas
 * candadas es pedir un bloqueo contra uno mismo.
 */
export async function buscarDecrementoDelPago(
	executor: Pick<typeof db, "select">,
	{ credito_id, pago_id }: { credito_id: number; pago_id: number | string },
): Promise<DecrementoDelPago | null> {
	const marca = marcaPagoDelDecremento(pago_id);
	const filas = await executor
		.select({
			historial_id: moras_historial.historial_id,
			fecha: moras_historial.fecha,
			monto_anterior: moras_historial.monto_anterior,
			monto_nuevo: moras_historial.monto_nuevo,
			motivo: moras_historial.motivo,
		})
		.from(moras_historial)
		.where(
			and(
				eq(moras_historial.credito_id, credito_id),
				eq(moras_historial.tipo_evento, "DECREMENTO"),
				// `%` a los dos lados: la marca se AGREGA al final de un motivo que
				// ya venía escrito, y un reintento podría dejar además la marca de
				// anulado después de ella.
				like(moras_historial.motivo, `%${marca}%`),
			),
		)
		.orderBy(sql`${moras_historial.fecha} DESC`, sql`${moras_historial.historial_id} DESC`)
		.limit(1);

	const fila = filas[0];
	if (!fila) return null;
	const bajado = Number(fila.monto_anterior) - Number(fila.monto_nuevo);
	return {
		historial_id: fila.historial_id,
		fecha: fila.fecha,
		bajado: Number.isFinite(bajado) && bajado > 0 ? bajado : 0,
		anulado: (fila.motivo ?? "").includes(MARCA_DECREMENTO_ANULADO),
	};
}

/**
 * Cuánto de lo que ese decremento bajó YA volvió a subir.
 *
 * Es la suma de las SUBIDAS (`monto_nuevo - monto_anterior` cuando es
 * positivo) de todos los eventos posteriores al decremento, topeada en lo que
 * el decremento había bajado. Reemplaza al "¿hubo algún CREACION/RECALCULO del
 * cron?", que era todo-o-nada y se equivocaba en los dos sentidos:
 *
 *   * una reposición PARCIAL (el cron recalculó a un monto menor porque el pago
 *     bajó el capital) contaba como reposición completa y la diferencia se
 *     perdía;
 *   * un `RECALCULO` que subió por OTRAS cuotas contaba como si hubiera
 *     repuesto esto, y la restitución legítima quedaba salteada.
 *
 * Solo se SUMAN las subidas; las bajadas posteriores NO se restan. Una bajada
 * posterior es otro pago cobrando la mora que el cron ya había repuesto: esa
 * deuda se saldó de verdad y devolverla acá se la cobraría dos veces al mismo
 * cliente.
 *
 * El corte es por `(fecha, historial_id)` y no solo por `fecha`: dos eventos
 * pueden caer en la misma marca de `clock_timestamp()`.
 */
export async function moraRepuestaDesdeElDecremento(
	executor: Pick<typeof db, "select">,
	{
		credito_id,
		decremento,
	}: { credito_id: number; decremento: DecrementoDelPago },
): Promise<number> {
	if (!(decremento.bajado > 0)) return 0;

	const eventos = await executor
		.select({
			monto_anterior: moras_historial.monto_anterior,
			monto_nuevo: moras_historial.monto_nuevo,
		})
		.from(moras_historial)
		.where(
			and(
				eq(moras_historial.credito_id, credito_id),
				or(
					gt(moras_historial.fecha, decremento.fecha),
					and(
						eq(moras_historial.fecha, decremento.fecha),
						gt(moras_historial.historial_id, decremento.historial_id),
					),
				),
			),
		)
		.orderBy(asc(moras_historial.fecha), asc(moras_historial.historial_id));

	let repuesto = 0;
	for (const evento of eventos) {
		const subida = Number(evento.monto_nuevo) - Number(evento.monto_anterior);
		if (Number.isFinite(subida) && subida > 0) repuesto += subida;
		if (repuesto >= decremento.bajado) return decremento.bajado;
	}
	return repuesto;
}

/**
 * Deja escrito que ese `DECREMENTO` ya no vale: el pago que lo causó se anuló
 * o se revirtió.
 *
 * Es lo ÚNICO que arregla el tercer defecto, y es independiente del monto: aun
 * cuando la reconciliación decide —con razón— que no hay nada que restituir
 * porque el cron ya repuso, el reporte de recuperación seguía viendo la bajada
 * sin contrapartida y contaba la reposición del cron como mora NUEVA (Q100 de
 * foto terminaban en Q200 de esperado). No hacía falta un monto: hacía falta
 * que el HECHO quedara anotado. Lo lee `moraRecuperacion.ts`.
 *
 * El UPDATE es idempotente (`NOT LIKE` sobre la propia marca): un reintento no
 * deja la marca dos veces.
 *
 * Escribe por el `tx` del caller a propósito: la marca y la restitución son el
 * mismo hecho y tienen que vivir o morir juntas. No toca `creditos` ni
 * `moras_credito`, así que no participa del orden de candados del módulo.
 */
export async function marcarDecrementoAnulado(
	executor: Pick<typeof db, "update">,
	historial_id: number,
): Promise<void> {
	await executor
		.update(moras_historial)
		.set({
			motivo: sql`COALESCE(${moras_historial.motivo}, '') || ${MARCA_DECREMENTO_ANULADO}`,
		})
		.where(
			and(
				eq(moras_historial.historial_id, historial_id),
				sql`COALESCE(${moras_historial.motivo}, '') NOT LIKE ${`%${MARCA_DECREMENTO_ANULADO}%`}`,
			),
		);
}

/**
 * El estado con el que la regla de restitución decide, resuelto de una sola
 * vez para los dos caminos que invalidan un pago.
 *
 * Primero intenta el camino EXACTO (la marca). Si el decremento no lleva marca
 * —decremento viejo, anterior al despliegue— cae al criterio de antes, el
 * proxy anclado en `createdat`. Nunca al revés: identificar es siempre mejor
 * que adivinar.
 *
 * Devuelve también el decremento encontrado, porque el caller tiene que
 * MARCARLO como anulado aunque no restituya nada (ver `marcarDecrementoAnulado`).
 */
export async function estadoMoraTrasElPago(
	executor: Pick<typeof db, "select">,
	{
		credito_id,
		pago_id,
		createdAt,
	}: {
		credito_id: number;
		pago_id: number | string;
		createdAt: Date | null | undefined;
	},
): Promise<{
	estado: EstadoMoraTrasElPago;
	decremento: DecrementoDelPago | null;
}> {
	const decremento = await buscarDecrementoDelPago(executor, {
		credito_id,
		pago_id,
	});

	if (decremento && decremento.bajado > 0) {
		// Un decremento que YA estaba marcado como anulado quiere decir que una
		// invalidación anterior ya le devolvió su mora al crédito. Restituir
		// encima la cobraría dos veces, igual que con una boleta ya falsa.
		const yaRepuesto = decremento.anulado
			? decremento.bajado
			: await moraRepuestaDesdeElDecremento(executor, {
					credito_id,
					decremento,
				});
		return {
			estado: {
				decrementoIdentificado: true,
				bajadoPorElPago: decremento.bajado,
				yaRepuesto,
			},
			decremento,
		};
	}

	return {
		estado: {
			moraRepuestaPorElCron: await elCronYaRepusoLaMora(executor, {
				credito_id,
				desde: createdAt,
			}),
		},
		decremento,
	};
}

/**
 * Le estampa al `DECREMENTO` de mora el pago que lo causó.
 *
 * ── Por qué DESPUÉS y no al escribirlo ──────────────────────────────────────
 * Cuando `procesarPagoMora` baja la mora, la fila del pago TODAVÍA NO EXISTE:
 * el descuento corre al principio de `registerPayment` y el INSERT ocurre casi
 * mil líneas más abajo. Esa es, además, la causa de que `pagos_credito.createdat`
 * sea POSTERIOR al decremento y de que el ancla por fecha dejara un hueco.
 *
 * Se descartaron las otras dos salidas:
 *
 *   * RESERVAR el id de antemano (`nextval` de la secuencia del serial) y
 *     usarlo en el INSERT. No sirve: la mora no siempre aterriza en una fila
 *     nueva. La rama de "cierre sobre fila desechable" de `registerPayment`
 *     escribe la mora con un UPDATE sobre una fila que YA existía —con su id ya
 *     asignado— y el id reservado sería el de otra fila, o de ninguna.
 *   * MOVER el descuento de mora a después del INSERT. El orden de
 *     `registerPayment` es lo que decide cuánto queda disponible para cuotas
 *     —`disponible` sale del resultado de la mora y de ahí cuelgan los tres
 *     returns tempranos y todo el reparto—, así que moverlo cambia el reparto,
 *     no solo el momento de un write.
 *
 * Estampar después es lo único que no le cambia la semántica a nadie: el
 * decremento ya está escrito y esto solo lo hace identificable. Si el proceso
 * se cae en el medio, el decremento queda SIN marca y la reconciliación vuelve
 * al criterio viejo — el mismo camino de los decrementos históricos.
 *
 * No lanza: una marca que no se pudo escribir degrada la precisión de una
 * reconciliación futura, pero el pago ya está registrado y tumbarlo por esto
 * sería peor.
 */
export async function estamparPagoEnDecremento(
	executor: Pick<typeof db, "update">,
	{
		historial_id,
		pago_id,
	}: { historial_id: number | null | undefined; pago_id: number | null | undefined },
): Promise<boolean> {
	if (!historial_id || !pago_id) return false;
	const marca = marcaPagoDelDecremento(pago_id);
	try {
		await executor
			.update(moras_historial)
			.set({
				motivo: sql`COALESCE(${moras_historial.motivo}, '') || ${marca}`,
			})
			.where(
				and(
					eq(moras_historial.historial_id, historial_id),
					// Idempotente: un reintento no deja la marca dos veces.
					sql`COALESCE(${moras_historial.motivo}, '') NOT LIKE ${`%${marca}%`}`,
				),
			);
		return true;
	} catch {
		return false;
	}
}

/**
 * Estampador de UN SOLO USO para el decremento de mora de este pago.
 *
 * `registerPayment` escribe la fila del pago en varias ramas distintas —el
 * recibo de sólo mora, el parcial que corta el flujo, la cuota del loop, el
 * pago especial— y la mora viaja en UNA sola de ellas, la primera que escriba.
 * En vez de repetir el `if` en cada rama (y olvidarlo en la que se agregue
 * mañana), cada rama llama a este estampador con el `pago_id` que acaba de
 * escribir y el estampador decide: marca la PRIMERA vez que lo llaman con un
 * id de verdad y después no hace nada. Es el mismo patrón que ya usan
 * `estamparOtros` y `estamparPagoConvenio` en ese archivo.
 *
 * Sin `historial_id` —no hubo decremento— el estampador es un no-op, así que
 * las ramas pueden llamarlo sin preguntar.
 */
export function crearEstampadorDecrementoMora(
	historial_id: number | null | undefined,
	executor: Pick<typeof db, "update">,
): (pago_id: number | null | undefined) => Promise<void> {
	let pendiente = Boolean(historial_id);
	return async (pago_id) => {
		if (!pendiente || !pago_id) return;
		pendiente = false;
		await estamparPagoEnDecremento(executor, { historial_id, pago_id });
	};
}
