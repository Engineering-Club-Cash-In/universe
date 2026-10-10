import { db } from "../database/index";
import {
  creditos,
  creditos_caidos,
  cuotas_credito,
  pagos_credito,
  usuarios,
  asesores,
  rubros,
  StatusCredit,
} from "../database/db/schema";
import { and, eq, sql, ne, desc, gte, lte } from "drizzle-orm";
import { withPaymentAdvisoryLock } from "../utils/paymentAdvisoryLock";
import { contarPagosNexaCredito } from "./nexaDashboard";

/**
 * Borra los pagos del crédito (menos los de la cuota 0, si existe). Antes desvincula los eventos
 * de Nexa que apuntan a esos pagos: `nexa_payment_events.pago_id` referencia `pagos_credito` sin
 * ON DELETE, y sin esto el DELETE revienta y toda la transacción hace rollback. El evento queda
 * (con su status) como constancia de lo que Nexa aprobó, y guarda el pago borrado en
 * `pago_id_eliminado` para que un reintento de Nexa de la misma transferencia se conteste como ya
 * aplicado (ver classifyNexaClaim). Devuelve cuántos eventos se desvincularon.
 * También marca los eventos que NO apuntan al pago pero sí tienen filas registradas
 * (`pagos_credito.nexa_payment_event_id`): un evento processing/manual_review con pago_id NULL
 * porque el registro reventó después de insertPayment o el proceso murió. Sin la marca, tras borrar
 * las filas el reintento vería 0 filas y trataría como no registrado un pago que sí entró. Se usa
 * la menor fila borrada del evento, la misma convención que pago_id (el primero de la boleta).
 * Un evento `failed` nunca recibe la marca: Nexa rechazó esa transferencia y devolvió el dinero, y
 * con la marca el reintento se contestaría como aplicado (classifyNexaClaim). En el primer UPDATE
 * solo se le suelta el pago_id (lo exige la FK), sin marcarlo.
 * Mismo filtro en los UPDATE y en el DELETE.
 */
export async function borrarPagosDelCredito(
  tx: Pick<typeof db, "execute" | "delete">,
  creditoId: number,
  cuota0Id: number | undefined,
): Promise<number> {
  const filtroPagos = cuota0Id
    ? sql`credito_id = ${creditoId} AND cuota_id <> ${cuota0Id}`
    : sql`credito_id = ${creditoId}`;
  const desvinculados = await tx.execute(sql`
    UPDATE cartera.nexa_payment_events
       SET pago_id_eliminado = CASE WHEN status = 'failed' THEN pago_id_eliminado ELSE pago_id END,
           pago_id = NULL, updated_at = now()
    WHERE pago_id IN (SELECT pago_id FROM cartera.pagos_credito WHERE ${filtroPagos})`);
  const vinculados = await tx.execute(sql`
    UPDATE cartera.nexa_payment_events e
       SET pago_id_eliminado = v.primer_pago, updated_at = now()
      FROM (SELECT nexa_payment_event_id AS evento_id, MIN(pago_id) AS primer_pago
              FROM cartera.pagos_credito
             WHERE ${filtroPagos} AND nexa_payment_event_id IS NOT NULL
             GROUP BY nexa_payment_event_id) v
    WHERE e.id = v.evento_id AND e.pago_id IS NULL AND e.pago_id_eliminado IS NULL
      AND e.status <> 'failed'`);
  if (cuota0Id) {
    await tx
      .delete(pagos_credito)
      .where(and(eq(pagos_credito.credito_id, creditoId), ne(pagos_credito.cuota_id, cuota0Id)));
  } else {
    await tx.delete(pagos_credito).where(eq(pagos_credito.credito_id, creditoId));
  }
  return Number(desvinculados.rowCount ?? 0) + Number(vinculados.rowCount ?? 0);
}

/**
 * Eventos Nexa del crédito cuya factura puede estar emitiéndose o ya emitida sin confirmar. La
 * facturación diferida corre FUERA del candado del crédito (nexaBilling.ts), así que borrar el pago
 * en ese momento deja una factura sin pago y el evento en billing_unknown. El FOR UPDATE frena a
 * startNexaBilling/completeNexaBilling sobre esas filas hasta que cierre la transacción.
 *
 * Devuelve solo billing_running/billing_unknown, que son los que bloquean. billing_pending se
 * BLOQUEA pero no se devuelve: todavía no emitió nada y, con NEXA_AUTOMATIC_INVOICING_ENABLED
 * apagado (el default), todo pago Nexa aceptado se queda ahí para siempre, así que bloquear por él
 * impediría marcar CAIDO sin salida. Es seguro dejarlo pasar porque el candado obliga a un
 * startNexaBilling concurrente a esperar el commit, y después ve pago_id NULL (borrarPagosDelCredito)
 * y no arranca: devuelve "payment_deleted", runNexaBilling contesta pending/billing_payment_deleted
 * y el evento se queda en billing_pending con pago_id NULL y pago_id_eliminado puesto (el reintento
 * de Nexa se contesta como aplicado). billing_failed se trata igual que billing_pending (se bloquea
 * y no se devuelve): startNexaBilling también lo deja pasar a billing_running, así que un reintento
 * de facturación concurrente espera el commit, ve pago_id NULL y devuelve "payment_deleted".
 */
export async function eventosNexaFacturando(
  tx: Pick<typeof db, "execute">,
  creditoId: number,
): Promise<Array<{ id: number; status: string }>> {
  const result = await tx.execute(sql`
    SELECT id, status FROM cartera.nexa_payment_events
    WHERE credito_id = ${creditoId}
      AND status IN ('billing_pending', 'billing_failed', 'billing_running', 'billing_unknown')
    FOR UPDATE`);
  return (result.rows as Array<{ id: number | string; status: string }>)
    .filter((r) => r.status !== "billing_pending" && r.status !== "billing_failed")
    .map((r) => ({ id: Number(r.id), status: r.status }));
}

/**
 * Marca un crédito como CAIDO:
 * 1. Cambia el status a CAIDO
 * 2. Elimina cuotas (excepto cuota 0)
 * 3. Elimina pagos (excepto los de cuota 0)
 * 4. Registra el motivo en creditos_caidos
 *
 * 🛡️ Se NIEGA si el crédito tiene cobros adicionales con deuda viva. Ver el
 * bloque de adentro.
 */
export async function marcarCreditoComoCaido({
  credito_id,
  motivo,
  observaciones,
}: {
  credito_id: number;
  motivo: string;
  observaciones?: string;
}) {
  /**
   * 🔒 El advisory lock del crédito va POR ENCIMA de la transacción, y eso no es
   * estilo: es el deadlock de pool.
   *
   * `withPaymentAdvisoryLock` espera el lock en el pool DEDICADO, y eso es lo
   * que mantiene la espera fuera del pool de trabajo. Pero una transacción
   * alrededor lo anula: mientras se espera el lock, la transacción sigue
   * RETENIENDO su conexión del pool de trabajo, y suficientes waiters así dejan
   * sin conexión al dueño del lock —que necesita una para correr su propio
   * `db.transaction`—. Nadie avanza. Es el mismo mecanismo que describe
   * `revalidatePayment.ts`: "cada waiter retenía una conexión del pool de
   * trabajo mientras esperaba, y suficientes waiters dejaban sin conexión al
   * dueño del lock".
   *
   * Adentro del candado va todo: el chequeo de rubros, las lecturas que deciden
   * y el borrado. Las lecturas no pueden quedar afuera porque DECIDEN — el
   * `statusCredit` lo escribe el cron de moras, y la cuota 0 define cuáles pagos
   * se preservan. Leerlas antes de cerrar es decidir sobre una foto que puede
   * haber cambiado mientras la llamada esperaba su turno.
   *
   * Orden del módulo, igual que en el resto: advisory afuera, filas adentro.
   */
  return await withPaymentAdvisoryLock(credito_id, async () => {
    // Verificar que el crédito existe
    const [credito] = await db
      .select()
      .from(creditos)
      .where(eq(creditos.credito_id, credito_id))
      .limit(1);

    if (!credito) {
      return { success: false, message: "Crédito no encontrado." };
    }

    if (credito.statusCredit === StatusCredit.CAIDO) {
      return { success: false, message: "El crédito ya está marcado como CAIDO." };
    }

    // Un crédito CANCELADO nunca cambia de estado: marcarlo CAIDO además
    // borraría sus pagos.
    if (credito.statusCredit === StatusCredit.CANCELADO) {
      return { success: false, message: "El crédito está CANCELADO y no puede marcarse como CAIDO." };
    }

    /**
     * 🛡️ Un crédito con deuda viva por cobros adicionales no se marca CAIDO en
     * silencio.
     *
     * El borrado se lleva TODOS los pagos del crédito, y la FK
     * `rubros_pagos.pago_id` es `ON DELETE CASCADE`: los reclamos se van con
     * ellos. El rubro en cambio SOBREVIVE —acá no se borra el crédito—, y queda
     * con el `saldo_pendiente` descontado por plata cuyo registro ya no existe.
     * Nadie puede reconstruir desde los reclamos qué se le cobró; si había
     * llegado a cero, queda `completado = true` sin nada que lo respalde.
     *
     * Se BLOQUEA en vez de devolverle el saldo al rubro. Restaurarlo sería
     * volver a cobrarle al cliente plata que pagó de verdad: los pagos se
     * borran por el castigo del plan, no porque el dinero no haya entrado. Así
     * que la decisión la toma el operador y queda registrada: anula el rubro
     * —que deja su propia traza en `rubros_historial`— y después marca el
     * crédito.
     *
     * La condición mira `completado`, NO sólo `anulado`, y la diferencia
     * importa: un rubro totalmente PAGADO queda `completado = true` con
     * `anulado = false`, y `puedeAnularRubro` rechaza anularlo con un 409 ("no
     * hay nada que anular"). Bloqueando por `anulado` solo, cualquier crédito
     * que alguna vez terminara de pagar un rubro quedaría imposible de marcar
     * para siempre, y el mensaje le pediría al operador justo lo que el sistema
     * le va a negar. Es el mismo criterio que el guard de
     * `recalculateFromJson`, y ahí llegó por este mismo error.
     */
    const rubrosConDeuda = await db
      .select({
        rubro_id: rubros.rubro_id,
        descripcion: rubros.descripcion,
      })
      .from(rubros)
      .where(
        and(
          eq(rubros.credito_id, credito_id),
          eq(rubros.anulado, false),
          eq(rubros.completado, false)
        )
      );

    if (rubrosConDeuda.length > 0) {
      /**
       * Se NOMBRAN los rubros: un rechazo que no dice cuáles deja al operador
       * adivinando qué lo está frenando.
       *
       * Y el mensaje tiene que ser exacto en tres cosas que al principio no lo
       * eran, porque un rechazo que manda a hacer algo imposible es peor que no
       * explicar nada:
       *
       *   * **quién** puede anular. `POST /fallen-credits` no pide rol, pero
       *     `POST /rubros/:id/anular` es ADMIN. Sin decirlo, un usuario no-ADMIN
       *     recibía este 400 y al seguir la instrucción se comía un 403.
       *   * **que puede llevar dos pasos**. `anularRubro` rechaza con 409 si el
       *     rubro tiene un reclamo vivo —boleta registrada y sin aplicar—, así
       *     que primero hay que resolver esa boleta.
       *   * **que la plata es condicional**. El guard bloquea por deuda viva
       *     aunque el rubro no tenga ni un abono; afirmar que se pierde "lo que
       *     ya se le cobró" sería mentirle sobre plata que nunca entró.
       */
      const lista = rubrosConDeuda.map((r) => r.descripcion).join(", ");
      const esUno = rubrosConDeuda.length === 1;
      return {
        success: false,
        message:
          `El crédito tiene ${rubrosConDeuda.length} cobro${esUno ? "" : "s"} adicional${esUno ? "" : "es"} ` +
          `con deuda pendiente (${lista}). Marcarlo como CAIDO borra todos los pagos del crédito, y con ellos ` +
          `el registro de lo que se le haya cobrado a ${esUno ? "ese cobro" : "esos cobros"}: ` +
          `quedaría${esUno ? "" : "n"} con el saldo descontado y sin respaldo. ` +
          `Un ADMIN tiene que anular ${esUno ? "el rubro" : "los rubros"} primero; si alguno tiene una boleta ` +
          `registrada sin aplicar, hay que resolver esa boleta antes de poder anularlo.`,
      };
    }

    // Obtener la cuota 0 para excluirla
    const [cuota0] = await db
      .select({ cuota_id: cuotas_credito.cuota_id })
      .from(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, credito_id),
          eq(cuotas_credito.numero_cuota, 0)
        )
      )
      .limit(1);

    const cuota0Id = cuota0?.cuota_id;

    // Nexa ya aprobó esas transferencias y no se deshacen allá: queda constancia de cuántas se borran.
    // Solo cuenta para el log; una falla de la consulta no frena la operación.
    let pagosNexa: Awaited<ReturnType<typeof contarPagosNexaCredito>> | null = null;
    try {
      pagosNexa = await contarPagosNexaCredito(credito_id);
    } catch (error) {
      console.error("No se pudo contar los pagos Nexa antes de marcar CAIDO:", error);
    }

    let eventosDesvinculados = 0;
    const resultado = await db.transaction(async (tx) => {
      // 0. Ningún pago Nexa con la factura en curso o sin confirmar: se niega sin escribir nada.
      const facturando = await eventosNexaFacturando(tx, credito_id);
      if (facturando.length > 0) {
        const ids = facturando.map((e) => `${e.id} ${e.status}`).join(", ");
        return {
          success: false,
          message:
            `El crédito tiene ${facturando.length} pago(s) Nexa con facturación en curso o sin confirmar ` +
            `(eventos ${ids}). Esperá a que termine o resolvé la factura en revisión manual antes de marcarlo CAIDO.`,
        };
      }

      // 1. Eliminar pagos (excepto los de cuota 0), desvinculando antes los eventos Nexa
      eventosDesvinculados = await borrarPagosDelCredito(tx, credito_id, cuota0Id);

      // 2. Eliminar cuotas (excepto cuota 0)
      await tx
        .delete(cuotas_credito)
        .where(
          and(
            eq(cuotas_credito.credito_id, credito_id),
            ne(cuotas_credito.numero_cuota, 0)
          )
        );

      // 3. Cambiar status a CAIDO
      await tx
        .update(creditos)
        .set({ statusCredit: StatusCredit.CAIDO })
        .where(eq(creditos.credito_id, credito_id));

      // 4. Registrar en creditos_caidos
      const [registro] = await tx
        .insert(creditos_caidos)
        .values({
          credit_id: credito_id,
          motivo,
          observaciones: observaciones || null,
        })
        .returning();

      return {
        success: true,
        message: "Crédito marcado como CAIDO exitosamente.",
        data: registro,
      };
    });

    if (resultado.success && (eventosDesvinculados > 0 || (pagosNexa?.cantidad ?? 0) > 0)) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "credito.caido.pagos_nexa_borrados",
          credito_id,
          pagos_nexa: pagosNexa?.cantidad ?? null,
          monto_total: pagosNexa?.montoTotal ?? null,
          eventos_desvinculados: eventosDesvinculados,
        }),
      );
    }
    return resultado;
  });
}

/**
 * Obtener créditos caídos con filtros opcionales
 */
export async function getCreditosCaidos({
  page = 1,
  perPage = 10,
  numero_credito_sifco,
  fecha_desde,
  fecha_hasta,
}: {
  page?: number;
  perPage?: number;
  numero_credito_sifco?: string;
  fecha_desde?: string;
  fecha_hasta?: string;
}) {
  const offset = (page - 1) * perPage;
  const conditions: any[] = [eq(creditos.statusCredit, StatusCredit.CAIDO)];

  if (numero_credito_sifco && numero_credito_sifco.trim().length > 0) {
    conditions.push(eq(creditos.numero_credito_sifco, numero_credito_sifco.trim()));
  }

  if (fecha_desde) {
    conditions.push(gte(creditos_caidos.fecha_caida, new Date(fecha_desde)));
  }

  if (fecha_hasta) {
    // Agregar un día para incluir todo el día final
    const hasta = new Date(fecha_hasta);
    hasta.setDate(hasta.getDate() + 1);
    conditions.push(lte(creditos_caidos.fecha_caida, hasta));
  }

  const data = await db
    .select({
      credito: creditos,
      usuario: usuarios,
      asesor: asesores,
      caido: creditos_caidos,
    })
    .from(creditos_caidos)
    .innerJoin(creditos, eq(creditos_caidos.credit_id, creditos.credito_id))
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
    .where(and(...conditions))
    .orderBy(desc(creditos_caidos.fecha_caida))
    .limit(perPage)
    .offset(offset);

  // Count
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(creditos_caidos)
    .innerJoin(creditos, eq(creditos_caidos.credit_id, creditos.credito_id))
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
    .where(and(...conditions));

  return {
    data,
    page,
    perPage,
    totalCount: count,
    totalPages: Math.ceil(count / perPage),
  };
}
