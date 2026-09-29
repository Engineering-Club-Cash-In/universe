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

    return await db.transaction(async (tx) => {
      // 1. Eliminar pagos (excepto los de cuota 0)
      if (cuota0Id) {
        await tx
          .delete(pagos_credito)
          .where(
            and(
              eq(pagos_credito.credito_id, credito_id),
              ne(pagos_credito.cuota_id, cuota0Id)
            )
          );
      } else {
        // Si no hay cuota 0, eliminar todos los pagos
        await tx
          .delete(pagos_credito)
          .where(eq(pagos_credito.credito_id, credito_id));
      }

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
