/**
 * Lecturas para reconstruir qué pasó con un pago. Ninguna escribe nada.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PARA QUÉ: `insertPayment` NO ES TRANSACCIONAL.
 *
 * Si el request se corta —timeout, corte de red, el proceso se cae— quien lo
 * llamó no sabe si el pago se registró, si se registró a medias, o si no se
 * registró nada. Volver a llamar a `newPayment` "por si acaso" crearía un
 * SEGUNDO pago real, y el chequeo de duplicados de cartera no lo frena: solo
 * corre cuando vienen `numeroAutorizacion` y `banco_id` a la vez.
 *
 * Con estas consultas la pregunta se contesta en vez de adivinarse.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Contrato: docs/features/bot-whatsapp-cobros/04-validacion-de-boleta.md (§4.1)
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../database";
import {
  boletas,
  cuotas_credito,
  pagos_credito,
  pagos_intentos_boleta,
  pagos_reversiones,
} from "../database/db/schema";
import type { PaymentAdvisoryLockConnection } from "../utils/paymentAdvisoryLock";
import {
  PAYMENT_ADVISORY_LOCK_NAMESPACE,
  tryWithPaymentAdvisoryLock,
} from "../utils/paymentAdvisoryLock";

export type PagoDeBoleta = {
  pago_id: number;
  // Nullable en el schema, aunque en la práctica siempre venga: se respeta la
  // columna en vez de mentirle al tipo.
  credito_id: number | null;
  numero_cuota: number | null;
  monto_aplicado: string | null;
  monto_boleta: string | null;
  validation_status: string | null;
  pagado: boolean | null;
  payment_false: boolean | null;
};

export type ReversionDeBoleta = {
  reversion_id: number;
  pago_id: number;
  estado: string;
  usuario_email: string;
  motivo: string | null;
  revertido_en: string | null;
};

export type IntentoDeBoleta = {
  intento_id: number;
  estado: string;
  credito_id: number;
  creado_en: string | null;
};

export type ResultadoPagosPorBoleta = {
  /** Filas de `boletas` que siguen vivas con esa URL, con su pago. */
  pagos: PagoDeBoleta[];
  /**
   * Reversiones que mencionan esa URL en `urls_boletas`.
   *
   * Es lo que desambigua el "no encuentro nada": sin esto, una boleta borrada
   * por una reversión y una que nunca se registró se ven exactamente igual.
   */
  reversiones: ReversionDeBoleta[];
  /**
   * Hay un `insertPayment` **en vuelo** para ese crédito ahora mismo.
   *
   * `null` si no se preguntó (sin `credito_id`).
   *
   * Sin este dato, "no encontré nada" tampoco alcanza: que el cliente HTTP se
   * haya cansado de esperar no cancela nada del lado del servidor. Ver
   * `hayOtroBackendEnElLock`.
   */
  operacion_en_curso: boolean | null;
  /**
   * Actas de registro del bot que quedaron `iniciado` para esa URL.
   *
   * `insertPayment` escribe la mora y el convenio ANTES de la primera fila de
   * `pagos_credito`. Si revienta en esa ventana no queda pago, ni boleta, ni
   * reversión — solo el acta. Un `iniciado` sin completar es la prueba de que
   * un registro murió a medias, y esa boleta no se puede reabrir a ciegas.
   */
  intentos: IntentoDeBoleta[];
  /**
   * Pagos del bot en ese crédito que **no tienen ninguna boleta colgando**.
   *
   * `insertPayment` escribe la fila de `pagos_credito` primero y las de
   * `boletas` después. Si revienta en el medio, el pago existe pero la URL —el
   * único puente que tiene el bot para volver a encontrarlo— no se escribió
   * nunca. Buscar por `r2_key` devuelve vacío sobre un pago que SÍ está.
   *
   * Con esto, ese vacío deja de ser prueba de que no se registró nada.
   *
   * `[]` si no se preguntó (sin `credito_id`).
   */
  huerfanos: PagoDeBoleta[];
};

/**
 * Deja el texto listo para un `LIKE` sin que se le escapen comodines.
 *
 * La clave viene del request. Sin esto, `url=%` hace que el patrón calce con
 * TODA la tabla y el endpoint —que es de diagnóstico— devuelva los pagos de
 * todas las boletas del sistema. `_` es igual de malo en pequeño: calza con
 * cualquier carácter.
 *
 * Se escapa también la barra invertida, que es el carácter de escape: sin eso,
 * una clave terminada en `\\` dejaría el patrón mal formado.
 */
function comoLiteralEnLike(texto: string): string {
  return texto.replace(/([\\%_])/g, "\\$1");
}

/**
 * Los pagos vivos que cuelgan de esa URL.
 *
 * Se busca por **sufijo** además de por igualdad: quien registró el pago pudo
 * haber mandado la key pelada (`boleta-bot-123.jpg`) y cartera guarda la URL
 * completa, o al revés. Comparar solo por `=` haría que una boleta que SÍ existe
 * se reporte como inexistente — y eso, del lado del bot, se traduce en dejar
 * que el cliente confirme de nuevo un pago que ya está registrado.
 */
function leerPagosDeLaBoleta(clave: string) {
  return db
    .select({
      pago_id: pagos_credito.pago_id,
      credito_id: pagos_credito.credito_id,
      numero_cuota: cuotas_credito.numero_cuota,
      monto_aplicado: pagos_credito.monto_aplicado,
      monto_boleta: pagos_credito.monto_boleta,
      validation_status: pagos_credito.validationStatus,
      pagado: pagos_credito.pagado,
      payment_false: pagos_credito.paymentFalse,
    })
    .from(boletas)
    .innerJoin(pagos_credito, eq(pagos_credito.pago_id, boletas.pago_id))
    .leftJoin(
      cuotas_credito,
      eq(cuotas_credito.cuota_id, pagos_credito.cuota_id),
    )
    .where(
      sql`${boletas.url_boleta} = ${clave}
          OR ${boletas.url_boleta} LIKE ${`%${comoLiteralEnLike(clave)}`} ESCAPE '\\'`,
    );
}

function leerReversionesDeLaBoleta(clave: string) {
  return db
    .select({
      reversion_id: pagos_reversiones.reversion_id,
      pago_id: pagos_reversiones.pago_id,
      estado: pagos_reversiones.estado,
      usuario_email: pagos_reversiones.usuario_email,
      motivo: pagos_reversiones.motivo,
      revertido_en: pagos_reversiones.revertido_en,
    })
    .from(pagos_reversiones)
    .where(
      sql`EXISTS (
        SELECT 1 FROM unnest(${pagos_reversiones.urls_boletas}) u
        WHERE u = ${clave}
           OR u LIKE ${`%${comoLiteralEnLike(clave)}`} ESCAPE '\\'
      )`,
    )
    .orderBy(desc(pagos_reversiones.reversion_id));
}

/** Las actas de intento que mencionan esa URL y nadie completó. */
function leerIntentosDeLaBoleta(clave: string) {
  return db
    .select({
      intento_id: pagos_intentos_boleta.intento_id,
      estado: pagos_intentos_boleta.estado,
      credito_id: pagos_intentos_boleta.credito_id,
      creado_en: pagos_intentos_boleta.creado_en,
    })
    .from(pagos_intentos_boleta)
    .where(
      sql`${pagos_intentos_boleta.estado} = 'iniciado' AND EXISTS (
        SELECT 1 FROM unnest(${pagos_intentos_boleta.urls_boletas}) u
        WHERE u = ${clave}
           OR u LIKE ${`%${comoLiteralEnLike(clave)}`} ESCAPE '\\'
      )`,
    )
    .orderBy(desc(pagos_intentos_boleta.intento_id));
}

/**
 * ¿Hay OTRO backend en el lock de este crédito, además de nosotros?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUE EL CLIENTE HTTP SE HAYA CANSADO DE ESPERAR NO CANCELA NADA ACÁ.
 *
 * `insertPayment` toma un advisory lock por crédito **como primera cosa** y lo
 * suelta en el `finally`. Puede quedarse minutos esperándolo si hay otro pago
 * del mismo crédito adelante, y todo ese tiempo el request original sigue vivo
 * y va a escribir cuando le toque el turno.
 *
 * Entonces "busqué la boleta y no encontré filas" **no prueba** que el pago no
 * se vaya a registrar: puede que todavía no le haya tocado. Quien reconcilie a
 * ciegas y habilite un segundo intento termina con dos pagos reales.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `pg_advisory_lock(a, b)` con dos enteros se ve en `pg_locks` como
 * `classid = a`, `objid = b`, `objsubid = 2`. Se miran también los NO
 * concedidos: un backend encolado esperando el lock es exactamente una
 * operación en vuelo — todavía no escribió nada, pero lo va a hacer en cuanto
 * lo soltemos.
 *
 * Se pregunta desde la conexión que sostiene el lock, así que hay que descontar
 * el propio `pid`: si no, la respuesta sería siempre `true`.
 */
async function hayOtroBackendEnElLock(
  creditoId: number,
  lockConn: PaymentAdvisoryLockConnection,
): Promise<boolean> {
  const res = (await lockConn.query(
    `SELECT EXISTS (
       SELECT 1 FROM pg_locks
       WHERE locktype = 'advisory'
         AND classid = $1
         AND objid = $2
         AND objsubid = 2
         AND pid <> pg_backend_pid()
     ) AS en_curso`,
    [PAYMENT_ADVISORY_LOCK_NAMESPACE, creditoId],
  )) as { rows?: { en_curso?: boolean }[] };

  return Boolean(res?.rows?.[0]?.en_curso);
}

/**
 * Con quién registra sus pagos el bot de cobros.
 *
 * Va copiado del CRM (`REGISTRADO_POR` en `lib/bot-cobros/confirmar-boleta.ts`)
 * y no se puede cambiar de un solo lado: es lo que permite reconocer un pago
 * del bot cuando el puente de la URL se perdió.
 */
const REGISTRADO_POR_EL_BOT = "bot-cobros@clubcashin.com";

/**
 * Cuánto para atrás se buscan huérfanos.
 *
 * El hueco entre escribir el pago y escribir su boleta son milisegundos, así
 * que un huérfano nuevo aparece enseguida. El tope existe para que una anomalía
 * vieja del mismo crédito no bloquee para siempre a un cliente que quiere
 * reintentar. Coincide a propósito con las 24 h a las que el bot manda el
 * borrador a revisión manual: pasado ese punto ya lo mira una persona.
 */
const HORAS_DE_BUSQUEDA_DE_HUERFANOS = 24;

/**
 * Pagos del bot en este crédito que quedaron sin boleta que los señale.
 *
 * Se descartan los que tienen una reversión: `reversePayment` borra las filas
 * de `boletas`, así que un pago revertido se ve exactamente igual que uno que
 * nunca llegó a escribir la suya. Contarlo como huérfano dejaría el crédito
 * bloqueado por un rechazo normal.
 */
function leerHuerfanosDelBot(creditoId: number) {
  return db
    .select({
      pago_id: pagos_credito.pago_id,
      credito_id: pagos_credito.credito_id,
      numero_cuota: cuotas_credito.numero_cuota,
      monto_aplicado: pagos_credito.monto_aplicado,
      monto_boleta: pagos_credito.monto_boleta,
      validation_status: pagos_credito.validationStatus,
      pagado: pagos_credito.pagado,
      payment_false: pagos_credito.paymentFalse,
    })
    .from(pagos_credito)
    .leftJoin(
      cuotas_credito,
      eq(cuotas_credito.cuota_id, pagos_credito.cuota_id),
    )
    .where(
      and(
        eq(pagos_credito.credito_id, creditoId),
        eq(pagos_credito.registerBy, REGISTRADO_POR_EL_BOT),
        sql`${pagos_credito.createdAt} > now() - interval '${sql.raw(
          String(HORAS_DE_BUSQUEDA_DE_HUERFANOS),
        )} hours'`,
        sql`NOT EXISTS (
          SELECT 1 FROM ${boletas} b WHERE b.pago_id = ${pagos_credito.pago_id}
        )`,
        sql`NOT EXISTS (
          SELECT 1 FROM ${pagos_reversiones} r
          WHERE r.pago_id = ${pagos_credito.pago_id}
        )`,
      ),
    );
}

function armarResultado(
  pagos: PagoDeBoleta[],
  reversiones: Awaited<ReturnType<typeof leerReversionesDeLaBoleta>>,
  enCurso: boolean | null,
  huerfanos: PagoDeBoleta[] = [],
  intentos: Awaited<ReturnType<typeof leerIntentosDeLaBoleta>> = [],
): ResultadoPagosPorBoleta {
  return {
    pagos,
    reversiones: reversiones.map((r) => ({
      ...r,
      revertido_en: r.revertido_en ? new Date(r.revertido_en).toISOString() : null,
    })),
    operacion_en_curso: enCurso,
    huerfanos,
    intentos: intentos.map((i) => ({
      ...i,
      creado_en: i.creado_en ? new Date(i.creado_en).toISOString() : null,
    })),
  };
}

/**
 * Todo lo que se sabe de una boleta, buscando por su URL.
 *
 * La URL es la key de R2 y es única, así que sirve de puente cuando el `pago_id`
 * se perdió con la respuesta.
 */
export async function buscarPagosPorBoleta(
  url: string,
  creditoId?: number,
): Promise<ResultadoPagosPorBoleta> {
  const clave = url.trim();

  // Sin crédito no hay lock con qué sincronizar. Se contesta lo que se pueda y
  // `operacion_en_curso: null` avisa que la prueba positiva no está: quien
  // reconcilie con esta respuesta no puede reabrir nada.
  if (creditoId === undefined) {
    const [pagos, reversiones, intentos] = await Promise.all([
      leerPagosDeLaBoleta(clave),
      leerReversionesDeLaBoleta(clave),
      leerIntentosDeLaBoleta(clave),
    ]);
    return armarResultado(pagos, reversiones, null, [], intentos);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Las dos observaciones van BAJO EL LOCK, y no es una precaución de más.
  //
  // Sueltas, se pueden intercalar así:
  //
  //   1. La consulta de la boleta toma su snapshot        → no hay filas
  //   2. El `insertPayment` original escribe y comitea
  //   3. Suelta el lock
  //   4. `operacionDePagoEnCurso` mira `pg_locks`         → no hay nadie
  //
  // Las dos respuestas son ciertas por separado, y juntas dicen "no se
  // registró nada y no hay nada corriendo" sobre un pago que SÍ existe. El
  // bot reabre el borrador y el cliente paga dos veces.
  //
  // Con el lock en la mano eso no puede pasar: nadie termina en el medio,
  // porque para llegar a escribir tienen que pasar por acá primero.
  // ───────────────────────────────────────────────────────────────────────
  const observado = await tryWithPaymentAdvisoryLock(
    creditoId,
    async (lockConn) => {
      const [pagos, reversiones, huerfanos, intentos] = await Promise.all([
        leerPagosDeLaBoleta(clave),
        leerReversionesDeLaBoleta(clave),
        leerHuerfanosDelBot(creditoId),
        leerIntentosDeLaBoleta(clave),
      ]);

      return armarResultado(
        pagos,
        reversiones,
        await hayOtroBackendEnElLock(creditoId, lockConn),
        huerfanos,
        intentos,
      );
    },
  );

  if (observado.obtenido) return observado.valor;

  // No se pudo tomar: hay un `insertPayment` adentro AHORA MISMO. No hace falta
  // sincronizar nada más, la respuesta ya es la que frena la reconciliación.
  // Las filas van igual, para que el log del bot muestre lo que había.
  const [pagos, reversiones, huerfanos, intentos] = await Promise.all([
    leerPagosDeLaBoleta(clave),
    leerReversionesDeLaBoleta(clave),
    leerHuerfanosDelBot(creditoId),
    leerIntentosDeLaBoleta(clave),
  ]);

  return armarResultado(pagos, reversiones, true, huerfanos, intentos);
}

/** Un pago con lo que se sepa de su reversión, si la hubo. */
export type EstadoDePago = PagoDeBoleta & {
  /**
   * La reversión que manda para ese pago, o `null`.
   *
   * Manda la `completada` si existe; si no, la `iniciada` más reciente — que
   * **no es un rechazo** sino una reversión a medias (D-36).
   */
  reversion: ReversionDeBoleta | null;
};

/**
 * En qué estado están estos pagos ahora mismo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO ALCANZA CON `validation_status`, Y ESA ES LA RAZÓN DE ESTE ENDPOINT.
 *
 * `reversePayment` deja el pago reseteado en `no_required`, que es un estado
 * "aplicado". Quien mire solo esa columna leería un pago revertido como
 * validado — y le diría al cliente "tu pago fue acreditado" justo después de
 * que se lo rechazaron. Por eso cada fila viaja con su reversión al lado.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Un pago que ya no existe simplemente no viene en la respuesta: quien pregunta
 * tiene que poder distinguir "sigue pendiente" de "desapareció", y devolver una
 * fila inventada con estado nulo confundiría las dos cosas.
 */
export async function estadoDePagos(ids: number[]): Promise<EstadoDePago[]> {
  if (ids.length === 0) return [];

  const [filas, reversiones] = await Promise.all([
    db
      .select({
        pago_id: pagos_credito.pago_id,
        credito_id: pagos_credito.credito_id,
        numero_cuota: cuotas_credito.numero_cuota,
        monto_aplicado: pagos_credito.monto_aplicado,
        monto_boleta: pagos_credito.monto_boleta,
        validation_status: pagos_credito.validationStatus,
        pagado: pagos_credito.pagado,
        payment_false: pagos_credito.paymentFalse,
      })
      .from(pagos_credito)
      .leftJoin(
        cuotas_credito,
        eq(cuotas_credito.cuota_id, pagos_credito.cuota_id),
      )
      .where(inArray(pagos_credito.pago_id, ids)),

    // Se consulta por los ids pedidos, NO por los que aparecieron arriba: un
    // pago borrado por su reversión no está en `pagos_credito` y es justamente
    // del que más urge saber.
    db
      .select({
        reversion_id: pagos_reversiones.reversion_id,
        pago_id: pagos_reversiones.pago_id,
        estado: pagos_reversiones.estado,
        usuario_email: pagos_reversiones.usuario_email,
        motivo: pagos_reversiones.motivo,
        revertido_en: pagos_reversiones.revertido_en,
      })
      .from(pagos_reversiones)
      .where(inArray(pagos_reversiones.pago_id, ids))
      .orderBy(desc(pagos_reversiones.reversion_id)),
  ]);

  const porPago = new Map<number, ReversionDeBoleta>();
  for (const r of reversiones) {
    const normalizada: ReversionDeBoleta = {
      ...r,
      revertido_en: r.revertido_en
        ? new Date(r.revertido_en).toISOString()
        : null,
    };

    const previa = porPago.get(r.pago_id);
    // Una `completada` desplaza a cualquier otra: la reversión terminó y los
    // intentos anteriores son historia.
    if (!previa || normalizada.estado === "completada") {
      if (previa?.estado === "completada") continue;
      porPago.set(r.pago_id, normalizada);
    }
  }

  return filas.map((f) => ({
    ...f,
    reversion: porPago.get(f.pago_id) ?? null,
  }));
}
