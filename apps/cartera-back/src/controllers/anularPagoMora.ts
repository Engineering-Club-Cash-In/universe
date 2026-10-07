import { and, eq } from "drizzle-orm";
import type { db } from "../database/index";
import { creditos, pagos_credito } from "../database/db/schema";
import { updateMora } from "./latefee";
import { resetAjusteFechaIdealSiPagoInvalidado } from "./ajusteFechaIdealPago";
import { restitucionMoraDePago } from "../utils/restitucionMoraDePago";
import { revertirMoraPagadaDePago } from "../utils/anotarMoraPagada";
// ── `./rubros` ENTRA COMO TIPO, Y COMO VALOR SOLO DENTRO DE LA FÁBRICA ─────
// `./rubros` arrastra `../database/index`, o sea la conexión real. Importarlo
// como VALOR en la cabecera de este módulo lo mete en cualquier archivo de la
// suite que lo cargue —incluso en los que mockean `./latefee` justamente para
// no arrastrar la base—, y eso cambia qué módulos ve el resto de la corrida.
// Es el mismo cuidado que ya se tomó con `../database/index` y
// `../utils/paymentAdvisoryLock` en esta rebanada. Adentro de `DEPS_REALES`
// solo se resuelve cuando alguien corre esto de verdad contra la base.
import type { revertirRubrosDelPago } from "./rubros";
import type { anularCondonacionesNexaPorPagoPendiente } from "./condonacionNexaPagoPendiente";
import {
  buildPendingReturnAuthorizationWarning,
  PendingReturnAuthorizationError,
} from "../utils/pendingReturnGuard";
import type { withPaymentAdvisoryLock } from "../utils/paymentAdvisoryLock";
import {
  desligarFilaDeEventoNexaFallido,
  NexaPaymentNotReversibleError,
  pagoNexaBloqueaAnular,
} from "./nexaPagoNoReversibleError";
import {
  estadoMoraTrasElPago,
  marcarDecrementoAnulado,
} from "./moraDecrementoDePago";

/**
 * El cuerpo de `falsePayment`: marcar la boleta como falsa, devolverle a los
 * rubros lo que esa boleta les cobró Y devolverle al crédito la mora que había
 * cobrado, DENTRO DE UNA SOLA TRANSACCIÓN.
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
  revertirRubros: typeof revertirRubrosDelPago;
  /**
   * Anula las condonaciones Nexa que se sostenían en este pago si estaba
   * pendiente (drizzle/0052). Opcional: quien no la pasa no la corre.
   */
  anularCondonacionesPorPagoPendiente?: typeof anularCondonacionesNexaPorPagoPendiente;
};

const DEPS_REALES = (): AnularPagoMoraDeps => ({
  updateMora,
  resetAjusteFechaIdeal: resetAjusteFechaIdealSiPagoInvalidado,
  revertirRubros: (async (pago_id, ejecutor) => {
    const { revertirRubrosDelPago } = await import("./rubros");
    return revertirRubrosDelPago(pago_id, ejecutor);
  }) as typeof revertirRubrosDelPago,
  // Por `import()` y no arriba: arrastra `./latefee` y la base, que varios
  // archivos de la suite mockean (mismo cuidado que con `revertirRubros`).
  anularCondonacionesPorPagoPendiente: (async (params) => {
    const { anularCondonacionesNexaPorPagoPendiente } = await import("./condonacionNexaPagoPendiente");
    return anularCondonacionesNexaPorPagoPendiente(params);
  }) as typeof anularCondonacionesNexaPorPagoPendiente,
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
  // rechazaba, la boleta ya estaba marcada falsa, los rubros devueltos y la
  // mora restituida —commiteadas— y lo único que veía el operador era un 422.
  // Se reintentaba, volvía a salir 422, y el pago seguía anulado desde el
  // primer intento con su espejo de inversionistas sin escribir.
  //
  // Acá la pregunta se hace sobre la fila que ESTA transacción ya tiene
  // candada con `FOR UPDATE`, y el throw aborta la transacción entera: no se
  // marca la boleta, no se devuelven rubros, no se restituye mora, y el 422
  // dice la verdad. El candado es el del crédito, que es el primero del orden
  // del módulo de mora (`creditos` antes que `moras_credito`, ver
  // `latefee.ts`), así que no agrega ninguna arista nueva al orden.
  //
  // Es una DUPLICACIÓN deliberada del `withPendingReturnCreditLocks` que
  // `falsePayment` sigue teniendo para los espejos: ése abre su propia
  // conexión y toma `FOR NO KEY UPDATE` sobre esta misma fila, así que no se
  // puede envolver esta transacción con él sin bloquearse contra uno mismo.
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
  // capital, interés e IVA).
  //
  // Va con FOR UPDATE porque estos dos datos tienen que leerse ANTES del UPDATE
  // y seguir valiendo después: sin candado, dos anulaciones simultáneas leían
  // las dos la misma `mora` y calculaban las dos la misma restitución.
  //
  // `paymentFalse` se sigue trayendo, pero YA NO es lo que corta la repetición
  // —eso lo hace el `paymentFalse = false` del WHERE del UPDATE, que es
  // atómico—: queda como dato de entrada de `restitucionMoraDePago`, que es una
  // regla pura compartida con la reversa.
  const [pagoPrevio] = await tx
    .select({
      mora: pagos_credito.mora,
      paymentFalse: pagos_credito.paymentFalse,
      validationStatus: pagos_credito.validationStatus,
      created_at: pagos_credito.createdAt,
      nexaPaymentEventId: pagos_credito.nexaPaymentEventId,
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

  // Un pago que entró por Nexa no se anula. `falsePayment` ya lo mira antes,
  // pero suelto: un callback Nexa en vuelo pudo tomar la fila después. Acá
  // decide sobre la fila candada, antes de escribir nada (la ruta da 409).
  if (await pagoNexaBloqueaAnular(tx, pagoPrevio?.nexaPaymentEventId)) {
    throw new NexaPaymentNotReversibleError();
  }

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

  // Actualizar el estado del pago a falso.
  //
  // El `paymentFalse = false` del WHERE es EL guard de idempotencia —no el
  // `SELECT … FOR UPDATE` de arriba—: es atómico y no depende de que nadie se
  // acuerde de mirar lo que leyó. Sin él, dos llamadas solapadas sobre el mismo
  // pago actualizaban las dos, y como `revertirRubrosDelPago` relee el saldo YA
  // restituido y le vuelve a sumar `monto_aplicado`, el rubro terminaba por
  // encima de su monto original (Q1,000 con Q400 cobrados: 600 → 1000 → 1400) y
  // la siguiente boleta le cobraba al cliente una diferencia que nunca debió.
  //
  // El `FOR UPDATE` de arriba SIGUE siendo necesario, pero por otro motivo: hay
  // que leer `mora` y `createdAt` ANTES de que este UPDATE los deje inservibles
  // para decidir la restitución.
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
        eq(pagos_credito.paymentFalse, false),
      ),
    );

  // 🚨 Si no se actualizó ningún registro, lanza error controlado. Va ANTES de
  // tocar los rubros y la mora: sin fila actualizada no hay boleta de este
  // crédito que invalidar —o ya estaba invalidada—, y devolverle los rubros o
  // la mora a un pago que no le pertenece sería peor que no hacer nada.
  if (!actualizado.rowCount || actualizado.rowCount === 0) {
    throw new Error("No payment found to mark as false with the given criteria");
  }

  // Fila de un evento Nexa `failed` (Nexa devolvió el dinero): se desliga para que un reintento
  // de esa transferencia registre limpio en vez de reaplicar esta fila anulada.
  await desligarFilaDeEventoNexaFallido(tx, pago_id, pagoPrevio?.nexaPaymentEventId);

  // 🧾 RUBROS: declarar falsa una boleta la invalida, así que lo que cobró de
  // los rubros tiene que irse con ella. Un reclamo SIN APLICAR se soltaba solo
  // (el neteo de `reclamosVivosDeRubros` filtra `paymentFalse = false`), pero
  // uno YA APLICADO dejaba el saldo descontado: si el abono había dejado el
  // rubro en cero, quedaba `completado` y `activo = false` —la deuda
  // desaparecía por una boleta declarada falsa— y no había ninguna ruta que la
  // devolviera.
  //
  // `revertirRubrosDelPago` y no `desaplicarRubrosDelPago`: acá el pago NO
  // vuelve a estar pendiente, se INVALIDA. Es la misma operación que hace
  // `reversePayment`, y borra el reclamo, que es a la vez el guard de doble
  // reversa (una segunda pasada no encuentra filas).
  //
  // Va acá, entre el UPDATE y la mora, y no al final: es el punto donde
  // `develop` ya lo validó, y la mora se deja de última a propósito porque su
  // fallo es el que tiene que abortar todo lo demás.
  await deps.revertirRubros(
    pago_id,
    tx as unknown as Parameters<typeof revertirRubrosDelPago>[1],
  );

  // ── DESHACER LO QUE EL PAGO HABÍA ANOTADO EN `mora_pagada_cuota` ──────────
  // Anular una boleta significa que el cliente NO pagó: lo que esa boleta había
  // anotado como "pagado" en el histórico de mora tiene que deshacerse con una
  // fila compensatoria. Es distinto de restituir: restituir es devolverle al
  // crédito la mora que se calculó sobre sus vencimientos; esto es descartar lo
  // que esa boleta particular había contribuido al histórico.
  await revertirMoraPagadaDePago(
    { pago_id, tipo: "ANULACION" },
    tx,
  );

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
  // Ya NO se vuelve a preguntar por `paymentFalse`, y no por descuido: el
  // `paymentFalse = false` del WHERE del UPDATE hace que una boleta que ya
  // estaba falsa no llegue nunca hasta acá —su `rowCount` es 0 y el guard de
  // arriba tira—. Esa condición quedó inalcanzable, y dejarla escrita sugeriría
  // que existe un camino en que sí se llega con la boleta ya anulada.
  if (decremento) {
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

  // Un pendiente que sostenía una condonación Nexa a tiempo (el crédito quedaba
  // al día gracias a él) se anuló sin validarse: la condonación se cae con él,
  // en esta misma transacción. Un pago ya validado no: la condonación quedó firme.
  if (pagoPrevio?.validationStatus === "pending") {
    await deps.anularCondonacionesPorPagoPendiente?.({
      credito_id,
      pago_id,
      accion: "anulo",
      dbClient: tx,
    });
  }

  // Si este pago era el que cobró un ajuste por fecha ideal de pago, resetearlo
  // a pendiente — la boleta resultó falsa, el dinero nunca entró de verdad y el
  // ajuste tiene que quedar disponible para un pago futuro.
  //
  // DENTRO de la transacción, igual que en `reversePayment` y en la anulación
  // por incobrable de `credits.ts`. Afuera —donde estaba— no era atómico: si
  // esta consulta fallaba, el `paymentFalse = true` ya estaba commiteado y el
  // ajuste se quedaba marcado como cobrado sin nadie que lo soltara. Acá
  // adentro, o se invalida la boleta y se suelta el ajuste, o no pasa ninguna
  // de las dos. (`falsePayment` conserva igual una red de seguridad fuera de
  // transacción, en su salida temprana, para las filas que el bug ya ensució.)
  //
  // No estrena una inversión de orden de candados, que es el riesgo real de
  // meter una tabla más adentro de una transacción. Va ÚLTIMA, después de
  // `creditos`, `pagos_credito`, los rubros y `moras_credito`, y las otras dos
  // rutas que resetean el ajuste dentro de su transacción —la caída a
  // incobrable y la anulación de `credits.ts`— también tocan `pagos_credito`
  // ANTES. O sea: nadie toma este par al revés. El índice único por
  // `credito_id` garantiza que sea a lo sumo una fila.
  await deps.resetAjusteFechaIdeal(pago_id, tx);

  return actualizado.rowCount ?? 0;
}


/**
 * ── LAS DOS RUTAS QUE DESHACEN UN PAGO COMPARTEN COLA ──────────────────────
 *
 * Hay dos maneras de deshacer un pago y las dos restituyen la MISMA mora Y
 * devuelven los MISMOS rubros: revertirlo (`reversePayment`) y anular su boleta
 * (esto). Sin un candado compartido, corriendo a la vez sobre el mismo pago la
 * reversa leía su fila SIN candado, calculaba la restitución completa, la
 * anulación restituía y commiteaba, y la reversa seguía adelante con su lectura
 * vieja y restituía OTRA VEZ: Q100 de mora se volvían Q200 a cargo del cliente.
 * Lo mismo con el saldo del rubro, que `revertirRubrosDelPago` relee y vuelve a
 * sumar (Q1,000 con Q400 cobrados: 600 → 1000 → 1400).
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
 * `insertPayment`, `reversePayment` y `revertPaymentToPending` hacen fila ahí—,
 * de modo que esto no inventa un mecanismo nuevo: mete a la anulación en la
 * fila donde siempre debió estar. El costo es que serializa por CRÉDITO y no
 * por pago, más grueso de lo estrictamente necesario; son operaciones manuales
 * de un operador, no hay volumen que lo note.
 *
 * El lock se suelta al commitear la transacción, que es lo que hace que la
 * segunda ruta lea el estado YA deshecho (`paymentFalse`, el reclamo de rubro
 * borrado, o los montos del pago en cero) y no encuentre nada que restituir.
 *
 * ── EL CANDADO SE TOMA ACÁ Y EN NINGÚN OTRO LADO ───────────────────────────
 * `falsePayment` NO lo vuelve a tomar: llama a esta función y nada más. La
 * versión de `develop` lo tomaba allá, envolviendo la transacción de rubros;
 * al fundirse las dos, la composición se quedó de este lado —que es el único
 * que una prueba puede ejercer de verdad— y allá quedó solo la llamada. Es el
 * MISMO helper y la MISMA llave (`credito_id`): no cambia el comportamiento,
 * solo dónde se compone. Anidarlo sería tomar dos veces el mismo advisory lock
 * en la misma conexión lógica; `anularPagoMoraCarrera.test.ts` vigila que no
 * pase.
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
// se resuelven cuando alguien corre esto de verdad contra la base. Es la misma
// razón por la que `revertirRubros` entra así en `DEPS_REALES`.
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
