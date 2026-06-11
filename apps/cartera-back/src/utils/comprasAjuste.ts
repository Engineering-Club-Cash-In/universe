import { db } from "../database/index";
import { compras_credito_inversionista } from "../database/db/schema";
import { and, eq, desc, gte, inArray, lt, sql } from "drizzle-orm";
import Big from "big.js";

/**
 * Fecha con la que se data económicamente una compra para decidir a qué mes
 * pertenece: se prioriza `fecha_completada` (instante real en que la compra
 * pasó a "completado") y, si está NULL (columna nueva, registros viejos que
 * aún no la tienen), cae a `updated_at`.
 *
 * Importante: NO usar `updated_at` solo, porque otros procesos lo pisan
 * (p. ej. el cierre de facturación en cofidi setea updated_at = fecha del pago
 * del cliente), lo que re-clasificaría la compra a un mes equivocado.
 */
const fechaEfectivaCompra = sql`COALESCE(${compras_credito_inversionista.fecha_completada}, ${compras_credito_inversionista.updated_at})`;

export interface AjusteCompras {
  /** Restar del espejo antes de comparar con histórico (compras post-historico). */
  montoRestarValidacion: Big;
  /** Restar de la base de cálculo de intereses (Casos 2 y 3). */
  montoRestarCalculo: Big;
}

/**
 * Calcula los ajustes de compras de cartera para un inversionista+crédito.
 *
 * montoRestarValidacion: compras cuyo created_at es POSTERIOR al último histórico;
 *   addInvestorToCredit ya actualizó el espejo pero el histórico aún no las refleja.
 *
 * montoRestarCalculo: Caso 2 (pendientes) y Caso 3 (completadas en el período o después);
 *   reducen la base sobre la que se calcula el interés.
 *   Si periodoMes/periodoAnio no se proveen, montoRestarCalculo queda en 0.
 */
export async function calcularAjusteCompras(
  credito_id: number,
  inversionista_id: number,
  lastHistoricoFecha: Date | null,
  periodoMes?: number,
  periodoAnio?: number,
): Promise<AjusteCompras> {
  const compras = await db
    .select({
      monto_aportado: compras_credito_inversionista.monto_aportado,
      status: compras_credito_inversionista.status,
      fecha_completada: compras_credito_inversionista.fecha_completada,
      updated_at: compras_credito_inversionista.updated_at,
      created_at: compras_credito_inversionista.created_at,
    })
    .from(compras_credito_inversionista)
    .where(
      and(
        eq(compras_credito_inversionista.credito_id, credito_id),
        eq(compras_credito_inversionista.inversionista_id, inversionista_id),
        inArray(compras_credito_inversionista.tipo_operacion, ["compra_cartera"]), // Hay que volver a ponerlo para que acepte reinversiones
      ),
    )
    .orderBy(desc(compras_credito_inversionista.updated_at));

  let montoRestarValidacion = new Big(0);
  let montoRestarCalculo = new Big(0);

  for (const compra of compras) {
    const montoCompra = new Big(compra.monto_aportado);
    if (montoCompra.eq(0)) continue;

    // Validación: compras creadas después del histórico ya actualizaron el espejo
    // pero el histórico no las refleja — restar para que la comparación sea justa.
    const createdAt = compra.created_at ? new Date(compra.created_at) : null;
    if (lastHistoricoFecha && createdAt && createdAt > lastHistoricoFecha) {
      montoRestarValidacion = montoRestarValidacion.plus(montoCompra);
    }

    if (periodoMes === undefined || periodoAnio === undefined) continue;

    const esPendiente =
      compra.status === "pendiente_revision" ||
      compra.status === "pendiente_compra_cartera" ||
      compra.status === "pendiente_reinversion";

    if (esPendiente) {
      // Caso 2: pendiente → restar de cálculo
      montoRestarCalculo = montoRestarCalculo.plus(montoCompra);
    } else if (
      compra.status === "completado" &&
      (compra.fecha_completada || compra.updated_at)
    ) {
      // Datar por fecha_completada y caer a updated_at solo si está NULL.
      const fechaEfectiva = new Date(
        (compra.fecha_completada ?? compra.updated_at) as Date,
      );
      const esDelPeriodoODespues =
        fechaEfectiva.getFullYear() > periodoAnio ||
        (fechaEfectiva.getFullYear() === periodoAnio &&
          fechaEfectiva.getMonth() >= periodoMes);

      if (esDelPeriodoODespues) {
        // Caso 3: completada en el período o después → restar de cálculo
        montoRestarCalculo = montoRestarCalculo.plus(montoCompra);
        // Caso 1: completada antes del período → cálculo usa monto completo (no restar)
      }
    }
  }

  return { montoRestarValidacion, montoRestarCalculo };
}

/**
 * Suma los monto_aportado de las compras de cartera (tipo_operacion = 'compra_cartera',
 * status = 'completado') que el inversionista hizo sobre el crédito durante el
 * MES ANTERIOR a `fechaPeriodo`, filtradas por `updated_at`.
 *
 * Excluye reinversiones y compras pendientes — solo cuentan las compras nuevas
 * de cartera ya completadas que se sumaron al monto_aportado del espejo durante
 * ese mes. Sirve para separar la parte "vieja" del monto (interés mensual completo)
 * de la parte aportada por estas compras (interés proporcional).
 */
export async function obtenerSumaComprasMesAnterior(
  credito_id: number,
  inversionista_id: number,
  fechaPeriodo: Date,
): Promise<Big> {
  const mes = fechaPeriodo.getMonth();
  const anio = fechaPeriodo.getFullYear();
  const mesAnterior = mes === 0 ? 11 : mes - 1;
  const anioMesAnterior = mes === 0 ? anio - 1 : anio;

  const inicioMesAnterior = new Date(anioMesAnterior, mesAnterior, 1);
  const inicioMesActual = new Date(anio, mes, 1);

  const compras = await db
    .select({ monto_aportado: compras_credito_inversionista.monto_aportado })
    .from(compras_credito_inversionista)
    .where(
      and(
        eq(compras_credito_inversionista.credito_id, credito_id),
        eq(compras_credito_inversionista.inversionista_id, inversionista_id),
        eq(compras_credito_inversionista.tipo_operacion, "compra_cartera"),
        eq(compras_credito_inversionista.status, "completado"),
        gte(fechaEfectivaCompra, inicioMesAnterior),
        lt(fechaEfectivaCompra, inicioMesActual),
      ),
    );

  return compras.reduce(
    (acc, c) => acc.plus(new Big(c.monto_aportado ?? 0)),
    new Big(0),
  );
}

/**
 * Suma los monto_aportado de las compras de cartera (tipo_operacion = 'compra_cartera',
 * status = 'completado') confirmadas durante el MES ACTUAL de `fechaPeriodo`
 * (filtradas por `updated_at`).
 *
 * El cálculo de pagos corre a mitad de mes (≈ el 10). Toda compra confirmada del
 * mes en curso —del día 1 hasta el momento del cálculo— todavía NO debe generar
 * interés este período: igual que las pendientes, se excluye de la base y empieza
 * a producir (proporcional) el mes siguiente. Sirve para calcular el "monto viejo"
 * (monto_aportado − pendientes − compras_completadas_mes_actual) y así decidir si
 * el crédito tiene saldo previo que liquidar este período o es una participación
 * genuinamente nueva.
 */
export async function obtenerSumaComprasCompletadasMesActual(
  credito_id: number,
  inversionista_id: number,
  fechaPeriodo: Date,
): Promise<Big> {
  const mes = fechaPeriodo.getMonth();
  const anio = fechaPeriodo.getFullYear();

  const inicioMesActual = new Date(anio, mes, 1);
  const inicioMesSiguiente = new Date(anio, mes + 1, 1);

  const compras = await db
    .select({ monto_aportado: compras_credito_inversionista.monto_aportado })
    .from(compras_credito_inversionista)
    .where(
      and(
        eq(compras_credito_inversionista.credito_id, credito_id),
        eq(compras_credito_inversionista.inversionista_id, inversionista_id),
        eq(compras_credito_inversionista.tipo_operacion, "compra_cartera"),
        eq(compras_credito_inversionista.status, "completado"),
        gte(fechaEfectivaCompra, inicioMesActual),
        lt(fechaEfectivaCompra, inicioMesSiguiente),
      ),
    );

  return compras.reduce(
    (acc, c) => acc.plus(new Big(c.monto_aportado ?? 0)),
    new Big(0),
  );
}

/**
 * Suma los monto_aportado de las compras de cartera que están PENDIENTES
 * (status pendiente_*) para el inversionista+crédito.
 *
 * Una compra pendiente ya ensució el monto_aportado del espejo, pero todavía
 * no es parte "real" del crédito: no debe generar interés (ni completo ni
 * proporcional) hasta completarse. Se usa para restarla de la base del
 * cálculo proporcional, de modo que el monto viejo cobre mes completo y la
 * pendiente aporte 0.
 */
export async function obtenerSumaComprasPendientes(
  credito_id: number,
  inversionista_id: number,
): Promise<Big> {
  const compras = await db
    .select({ monto_aportado: compras_credito_inversionista.monto_aportado })
    .from(compras_credito_inversionista)
    .where(
      and(
        eq(compras_credito_inversionista.credito_id, credito_id),
        eq(compras_credito_inversionista.inversionista_id, inversionista_id),
        eq(compras_credito_inversionista.tipo_operacion, "compra_cartera"),
        inArray(compras_credito_inversionista.status, [
          "pendiente_revision",
          "pendiente_compra_cartera",
          "pendiente_reinversion",
        ]),
      ),
    );

  return compras.reduce(
    (acc, c) => acc.plus(new Big(c.monto_aportado ?? 0)),
    new Big(0),
  );
}
