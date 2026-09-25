import { and, eq } from "drizzle-orm";
import type { db } from "../database/index";
import { creditos, pagos_credito } from "../database/db/schema";
import { updateMora } from "./latefee";
import { resetAjusteFechaIdealSiPagoInvalidado } from "./ajusteFechaIdealPago";
import { restitucionMoraDePago } from "../utils/restitucionMoraDePago";
import {
  buildPendingReturnAuthorizationWarning,
  PendingReturnAuthorizationError,
} from "../utils/pendingReturnGuard";
import type { withPaymentAdvisoryLock } from "../utils/paymentAdvisoryLock";
import {
  estadoMoraTrasElPago,
  marcarDecrementoAnulado,
} from "./moraDecrementoDePago";

/**
 * El cuerpo de `falsePayment`: marcar la boleta como falsa Y devolverle al
 * crédito la mora que esa boleta había cobrado, DENTRO DE UNA SOLA
 * TRANSACCIÓN.
 *
 * ── Por qué es un módulo aparte ─────────────────────────────────────────────
 * Vive fuera de `payments.ts` para poder EJERCERSE en una prueba: varios tests
 * de la suite registran un `mock.module("./payments")` global y el módulo real
 * deja de existir en la corrida completa. Las dependencias que también están
 * mockeadas en otros archivos (`./latefee`) entran por `deps` para que la
 * prueba las inyecte y no dependa de cuál mock gane la corrida.
 *
 * ── Por qué una sola transacción ────────────────────────────────────────────
 * Antes eran dos pasos con dos commits: el UPDATE que dejaba
 * `paymentFalse = true` y DESPUÉS la restitución. Si la restitución fallaba
 * —error transitorio, o mora inexistente— la anulación ya estaba firme y
 * lanzar no la deshacía. Y el reintento era peor que inútil: leía
 * `paymentFalse = true`, la regla devolvía `null` y la restitución quedaba
 * saltada PARA SIEMPRE. Boleta anulada, crédito sin la mora que su cliente
 * volvió a deber.
 *
 * Se eligió la transacción y no "marcar falso y reintentar la mora aparte"
 * porque el estado que decide si hay que restituir (`paymentFalse`) es el
 * MISMO que el primer paso pisa: cualquier esquema reintentable necesitaría un
 * marcador durable adicional solo para recordar si la mora ya se devolvió,
 * mientras que la transacción hace que ese estado no pueda avanzar sin ella.
 * Lo que lo impedía era que `updateMora` abría su propia transacción; ahora
 * acepta la del caller.
 *
 * Devuelve cuántas filas de pago se marcaron (siempre 1; el 0 tira).
 */
export type AnularPagoMoraDeps = {
  updateMora: typeof updateMora;
  resetAjusteFechaIdeal: typeof resetAjusteFechaIdealSiPagoInvalidado;
};

const DEPS_REALES = (): AnularPagoMoraDeps => ({
  updateMora,
  resetAjusteFechaIdeal: resetAjusteFechaIdealSiPagoInvalidado,
});

export async function anularPagoYRestituirMora(
  tx: typeof db,
  { pago_id, credito_id }: { pago_id: number; credito_id: number },
  deps: AnularPagoMoraDeps = DEPS_REALES(),
): Promise<number> {
  // 🔒 ORDEN DE CANDADOS: `creditos` PRIMERO, `moras_credito` después (ver el
  // bloque al inicio de `latefee.ts`). Esta transacción toca las dos filas —la
  // segunda adentro de `updateMora`—, así que toma la del crédito acá arriba,
  // antes que ninguna otra. `updateMora` la vuelve a pedir con su propio FOR
  // UPDATE: sobre una fila que esta misma transacción ya candó no espera a
  // nadie.
  const [creditoCandado] = await tx
    .select({
      credito_id: creditos.credito_id,
      // Se leen EN LA MISMA consulta que toma el candado —no en otra— porque
      // de eso depende que el guard de abajo decida sobre el estado candado y
      // no sobre una foto que alguien más pueda estar cambiando.
      numero_credito_sifco: creditos.numero_credito_sifco,
      estado_devolucion: creditos.estado_devolucion,
    })
    .from(creditos)
    .where(eq(creditos.credito_id, credito_id))
    .limit(1)
    .for("update");

  if (!creditoCandado) {
    throw new Error("No payment found to mark as false with the given criteria");
  }

  // ── EL BLOQUEO SE DECIDE ANTES DE TOCAR NADA ──────────────────────────────
  // Un crédito en PENDIENTE_AUTORIZACION no puede anular boletas mientras su
  // devolución a CUBE siga sin resolver. Ese guard ya existía en
  // `falsePayment`, pero corría DESPUÉS de esta transacción: para cuando
  // rechazaba, la boleta ya estaba marcada falsa y la mora ya estaba
  // restituida —commiteadas— y lo único que veía el operador era un 422. Se
  // reintentaba, volvía a salir 422, y el pago seguía anulado desde el primer
  // intento con su espejo de inversionistas sin escribir.
  //
  // Acá la pregunta se hace sobre la fila que ESTA transacción ya tiene
  // candada con `FOR UPDATE`, y el throw aborta la transacción entera: no se
  // marca la boleta, no se restituye mora, y el 422 dice la verdad. El candado
  // es el del crédito, que es el primero del orden del módulo de mora
  // (`creditos` antes que `moras_credito`, ver `latefee.ts`), así que no
  // agrega ninguna arista nueva al orden.
  const bloqueo = buildPendingReturnAuthorizationWarning([
    {
      creditoId: creditoCandado.credito_id,
      numeroCreditoSifco: creditoCandado.numero_credito_sifco,
      estadoDevolucion: creditoCandado.estado_devolucion,
    },
  ]);
  if (bloqueo) {
    throw new PendingReturnAuthorizationError(bloqueo);
  }

  // La mora que ESTE pago había cubierto, leída ANTES de marcarlo falso: es lo
  // único que hay que restituir (no el monto de la boleta, que también trae
  // capital, interés e IVA). `paymentFalse` se lee en la misma consulta para no
  // restituir dos veces si la boleta ya estaba anulada: el UPDATE de abajo pasa
  // igual sobre una fila ya falsa y su `rowCount` no distingue los dos casos.
  // Va con FOR UPDATE porque sin candado dos anulaciones simultáneas leían las
  // dos `paymentFalse = false` y restituían las dos.
  const [pagoPrevio] = await tx
    .select({
      mora: pagos_credito.mora,
      paymentFalse: pagos_credito.paymentFalse,
      created_at: pagos_credito.createdAt,
    })
    .from(pagos_credito)
    .where(
      and(
        eq(pagos_credito.pago_id, pago_id),
        eq(pagos_credito.credito_id, credito_id),
      ),
    )
    .limit(1)
    .for("update");

  // ¿Qué queda por restituir de la mora que este pago bajó? La pregunta —y su
  // ancla— viven en `moraDecrementoDePago.ts`, compartidas con la reversa de
  // pagos: si el criterio se duplicara, el camino que quedara atrás volvería a
  // cobrar de más (o de menos). Ancla en el EVENTO del decremento cuando lleva
  // su marca; si no la lleva —decremento viejo— cae al proxy por `createdat`.
  const { estado: estadoMora, decremento } = await estadoMoraTrasElPago(tx, {
    credito_id,
    pago_id,
    createdAt: pagoPrevio?.created_at,
  });

  // Actualizar el estado del pago a falso
  const actualizado = await tx
    .update(pagos_credito)
    .set({
      pagado: false,
      paymentFalse: true,
    })
    .where(
      and(
        eq(pagos_credito.pago_id, pago_id),
        eq(pagos_credito.credito_id, credito_id),
      ),
    );

  // 🚨 Si no se actualizó ningún registro, lanza error controlado
  if (!actualizado.rowCount || actualizado.rowCount === 0) {
    throw new Error("No payment found to mark as false with the given criteria");
  }

  // ── RESTITUIR LA MORA QUE LA BOLETA FALSA HABÍA COBRADO ───────────────────
  // Anular un pago significa que el cliente NO pagó: la mora que esa boleta
  // cubrió le vuelve a deberse. Sin esto el crédito se quedaba sin esa mora y,
  // peor, el `DECREMENTO` del pago quedaba huérfano en `moras_historial`: el
  // reporte de recuperación veía una bajada sin contrapartida y contaba la
  // reposición del cron de la mañana siguiente como mora NUEVA. Mismo patrón
  // que `reversePayment`, con su propio prefijo de motivo —anular no es
  // revertir— para que el historial no confunda los dos hechos.
  const restitucionMora = restitucionMoraDePago(
    pagoPrevio,
    pago_id,
    "ANULACION",
    estadoMora,
  );

  // La MARCA va aunque no haya nada que restituir, y por eso no vive adentro
  // del `if` de abajo: si el cron ya repuso la mora el monto es 0, pero el
  // hecho —este decremento ya no vale— tiene que quedar escrito igual. Sin
  // ella el reporte de recuperación seguía viendo la bajada sin contrapartida
  // y contaba la reposición del cron como mora NUEVA. Va DENTRO de la misma
  // transacción que marca la boleta falsa: son el mismo hecho.
  //
  // Una boleta que ya estaba falsa no llega acá con nada que restituir, pero
  // la marca es idempotente, así que tampoco hace daño.
  if (decremento && !pagoPrevio?.paymentFalse) {
    await marcarDecrementoAnulado(tx, decremento.historial_id);
  }

  if (restitucionMora) {
    const resultadoMora = await deps.updateMora({
      credito_id,
      tipo: "INCREMENTO",
      activa: true,
      dbClient: tx,
      ...restitucionMora,
    });

    // El fallo TIENE que tirar: es lo que aborta la transacción y deja el pago
    // SIN marcar, para que el reintento vuelva a intentar las dos cosas.
    if (!resultadoMora.success) {
      throw new Error(
        "Error al restituir la mora del pago anulado: " + resultadoMora.message,
      );
    }
  }

  // Si este pago era el que cobró un ajuste por fecha ideal de pago, resetearlo
  // a pendiente — la boleta resultó falsa, el dinero nunca entró de verdad.
  await deps.resetAjusteFechaIdeal(pago_id, tx);

  return actualizado.rowCount ?? 0;
}

/**
 * ── LAS DOS RUTAS QUE DESHACEN UN PAGO COMPARTEN COLA ──────────────────────
 *
 * Hay dos maneras de deshacer un pago y las dos restituyen la MISMA mora:
 * revertirlo (`reversePayment`) y anular su boleta (esto). Hasta acá no
 * compartían ningún candado: la reversa tomaba el advisory lock por crédito
 * (`withPaymentAdvisoryLock`, el mismo que usa `insertPayment`) y la anulación
 * solo candaba filas. Corriendo a la vez sobre el mismo pago, la reversa leía
 * su fila SIN candado, calculaba la restitución completa, la anulación
 * restituía y commiteaba, y la reversa seguía adelante con su lectura vieja y
 * restituía OTRA VEZ: Q100 de mora se volvían Q200 a cargo del cliente.
 *
 * ── POR QUÉ EL ADVISORY LOCK Y NO UN `SELECT … FOR UPDATE` DEL PAGO ────────
 *
 * La otra opción era candar la fila de `pagos_credito` en las dos rutas. No se
 * eligió porque INVIERTE UN ORDEN DE CANDADOS y abre un abrazo mortal: esta
 * anulación toma `creditos` y después `pagos_credito`; la reversa lee el pago
 * en su paso 2️⃣ y recién toca `creditos` en el 7️⃣, así que candar ahí su fila
 * la dejaría tomando `pagos_credito` → `creditos`, justo al revés. Dos
 * operaciones simultáneas sobre el mismo crédito se esperarían mutuamente.
 *
 * El advisory lock no tiene ese problema: se toma ANTES de cualquier candado
 * de fila, sobre una conexión aparte, así que no agrega ninguna arista al
 * grafo de candados de filas. Y ya es la cola canónica del crédito —
 * `insertPayment` y `reversePayment` hacen fila ahí—, de modo que esto no
 * inventa un mecanismo nuevo: mete a la anulación en la fila donde siempre
 * debió estar. El costo es que serializa por CRÉDITO y no por pago, más grueso
 * de lo estrictamente necesario; son operaciones manuales de un operador, no
 * hay volumen que lo note.
 *
 * El lock se suelta al commitear la transacción, que es lo que hace que la
 * segunda ruta lea el estado YA deshecho (`paymentFalse`, o los montos del
 * pago en cero) y no encuentre nada que restituir.
 */
export type AnularPagoSerializadoDeps = {
  withCreditLock: typeof withPaymentAdvisoryLock;
  runTransaction: (typeof db)["transaction"];
  anular: typeof anularPagoYRestituirMora;
};

// ── LAS DOS DEPENDENCIAS REALES ENTRAN POR `import()`, NO ARRIBA ───────────
// Tanto `../database/index` como `../utils/paymentAdvisoryLock` (que abre el
// `lockPool`) traen consigo la conexión real. Importarlos como VALOR en la
// cabecera de este módulo los mete en cualquier archivo de la suite que lo
// cargue —incluso en los que mockean `./latefee` justamente para no arrastrar
// la base—, y eso cambia qué módulos ve el resto de la corrida. Medido: la
// suite pasaba de 1732 a 1717 pruebas ejecutadas. Adentro de la fábrica solo
// se resuelven cuando alguien corre esto de verdad contra la base.
const DEPS_SERIALIZADO_REALES = (): AnularPagoSerializadoDeps => ({
  withCreditLock: (async (credito_id: number, fn: any) => {
    const { withPaymentAdvisoryLock } = await import("../utils/paymentAdvisoryLock");
    return withPaymentAdvisoryLock(credito_id, fn);
  }) as typeof withPaymentAdvisoryLock,
  runTransaction: (async (fn: any) => {
    const { db: dbReal } = await import("../database/index");
    return dbReal.transaction(fn);
  }) as (typeof db)["transaction"],
  anular: anularPagoYRestituirMora,
});

export async function anularPagoYRestituirMoraSerializado(
  { pago_id, credito_id }: { pago_id: number; credito_id: number },
  deps: AnularPagoSerializadoDeps = DEPS_SERIALIZADO_REALES(),
): Promise<number> {
  return deps.withCreditLock(credito_id, () =>
    deps.runTransaction((tx) =>
      deps.anular(tx as unknown as typeof db, { pago_id, credito_id }),
    ),
  );
}
