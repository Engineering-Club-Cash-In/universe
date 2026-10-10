/**
 * COBROS-02 W4 · El abono inicial sostiene al convenio que lo usó. Mientras ese
 * convenio esté pendiente, vigente o completado, el pago no se puede reversar,
 * pasar a pendiente ni anular como falso. Un convenio anulado (o deshecho) libera
 * el abono; el rechazo borra la fila.
 *
 * También frena la edición del pago (`editarPago`, `aplicarMontoAPago`): sus montos,
 * fecha y estado son lo que se validó al crear el convenio.
 *
 * Lo comparten las tres rutas que invalidan un pago (`reversePayment`,
 * `revertPaymentToPending` y `anularPagoYRestituirMora`, la de `falsePayment`):
 * todas lo llaman dentro de su transacción y bajo el candado del crédito, antes
 * de escribir nada.
 */

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { db } from "../database/index";
import { convenios_pago } from "../database/db/schema";
import { RechazoAbonoInicial, rechazoReversaAbonoInicial } from "../lib/convenio-abono-inicial";

/** Rechazo si un convenio pendiente, vigente o completado usa este pago como abono inicial; null si está libre. */
export async function rechazoPorAbonoInicial(tx: typeof db, pago_id: number): Promise<RechazoAbonoInicial | null> {
  const [convenioDelAbono] = await tx
    .select({
      convenio_id: convenios_pago.convenio_id,
      activo: convenios_pago.activo,
      completado: convenios_pago.completado,
    })
    .from(convenios_pago)
    .where(and(eq(convenios_pago.abono_inicial_pago_id, pago_id), isNull(convenios_pago.anulado_at)))
    .limit(1);
  return convenioDelAbono ? rechazoReversaAbonoInicial(convenioDelAbono) : null;
}

export async function asegurarAbonoInicialLibre(tx: typeof db, pago_id: number): Promise<void> {
  const rechazo = await rechazoPorAbonoInicial(tx, pago_id);
  if (rechazo) throw rechazo;
}

/**
 * Los pagos de `pagoIds` que sostienen un convenio pendiente, vigente o completado (una
 * consulta para todo el lote). Para las rutas que reescriben pagos en lote: el Excel de
 * conta y la migración de cuotas de SIFCO.
 */
export async function pagosConAbonoInicialVivo(tx: typeof db, pagoIds: number[]): Promise<Set<number>> {
  if (pagoIds.length === 0) return new Set();
  const filas = await tx
    .select({ pago_id: convenios_pago.abono_inicial_pago_id })
    .from(convenios_pago)
    .where(
      and(
        inArray(convenios_pago.abono_inicial_pago_id, pagoIds),
        isNotNull(convenios_pago.abono_inicial_pago_id),
        isNull(convenios_pago.anulado_at),
      ),
    );
  return new Set(filas.map((f) => f.pago_id as number));
}

/** Rechazo (409) del lote que tocaría pagos que sostienen convenios vivos. */
export function rechazoLoteAbonoInicial(pagoIds: Iterable<number>): RechazoAbonoInicial {
  return new RechazoAbonoInicial(
    409,
    `[ABONO_INICIAL_DE_CONVENIO] El pago ${[...pagoIds].join(", ")} es el abono inicial de un convenio pendiente, vigente o completado: no se reescribe en lote. Anule ese convenio primero.`,
  );
}

/** Rechazo (409) del lote que no pudo tomar el candado de pagos de algún crédito: reintentar. */
export function rechazoLoteCreditosOcupados(creditoIds: number[]): RechazoAbonoInicial {
  return new RechazoAbonoInicial(
    409,
    `[CREDITO_OCUPADO] Hay un pago o un convenio en curso en los créditos ${creditoIds.join(", ")}. No se escribió nada: reintente en unos segundos.`,
  );
}

/**
 * Convenio pendiente, vigente o completado de este crédito que usa un pago suyo como abono
 * inicial (null si no hay). Para las operaciones que borran TODOS los pagos del crédito
 * (marcarlo CAIDO): con la FK en `ON DELETE SET NULL` el borrado pasaría y el vínculo de
 * auditoría se perdería con el convenio todavía vivo.
 */
export async function convenioVivoConAbonoDelCredito(tx: typeof db, credito_id: number): Promise<number | null> {
  const [fila] = await tx
    .select({ convenio_id: convenios_pago.convenio_id })
    .from(convenios_pago)
    .where(
      and(
        eq(convenios_pago.credito_id, credito_id),
        isNotNull(convenios_pago.abono_inicial_pago_id),
        isNull(convenios_pago.anulado_at),
      ),
    )
    .limit(1);
  return fila?.convenio_id ?? null;
}
