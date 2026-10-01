import { sql, type SQL } from "drizzle-orm";

/**
 * Días que un pago PENDIENTE de validación frena la mora de su cuota, contados
 * desde su `fecha_pago` (calendario de Guatemala).
 *
 * Por qué existe: contabilidad valida los pagos días después de que cobros los
 * registra (en septiembre el p99 fue de 142 horas) y, mientras tanto, el cron
 * le cobraba mora a clientes que pagaron a tiempo. Por qué hay tope: de los 88
 * pagos pendientes en prod, 84 son olvidados de más de 180 días; sin tope
 * frenarían la mora para siempre (~Q41.8k). Pasado el tope sin validar, la
 * cuota vuelve a generar mora como si el pago no existiera.
 *
 * Se mide por `fecha_pago` y no por `createdat`, que no es confiable.
 */
export const DIAS_PAGO_PENDIENTE_FRENA_MORA = 7;

/**
 * «Esta cuota ya tiene un pago que la cubre», con el criterio del cron.
 *
 * Vive en UN lugar porque de él cuelgan cosas que tienen que coincidir: las
 * cuotas que el cron `procesarMoras` cobra, el reconteo de `createMora` (si
 * difieren, rechaza con overdue_count_mismatch), el ritmo del listado y las
 * cuotas a las que el pago y la condonación le anotan lo abonado
 * (`cuotasParaPendienteDeCreditos`). Si divergieran, se anotaría en cuotas que
 * el cron ya no mira y el cron volvería a cobrar mora ya pagada.
 *
 * Cubre un pago validado (o que no requiere validación) o uno PENDIENTE de
 * hasta `DIAS_PAGO_PENDIENTE_FRENA_MORA` días. Si contabilidad anula el
 * pendiente (`paymentFalse = true`) deja de cubrir y el cron siguiente repone
 * la mora desde las fechas.
 *
 * `excluirPagoId`: el pago que se está registrando NO cuenta como cobertura de
 * su propia cuota. Al anotar la mora que cobró la boleta, su fila ya existe
 * (pendiente) y, sin excluirla, la cuota saldría del reparto: la mora pagada no
 * quedaría anotada en esa cuota y, pasados los 7 días sin validar, el cron se
 * la volvería a cobrar al cliente.
 *
 * La cuota de afuera va escrita con su tabla, a mano, y no como
 * `${cuotas_credito.cuota_id}`: en un select de UNA sola tabla (sin join)
 * Drizzle la renderiza como `"cuota_id"` a secas, que dentro de este
 * subquery se resuelve a `pc.cuota_id` — la condición queda
 * `pc.cuota_id = pc.cuota_id` y cualquier pago validado de la base marca
 * todas las cuotas como pagadas. Por lo mismo, en SQL crudo la tabla de
 * afuera NO puede llevar alias.
 */
export function hasPaidPaymentSql(
  opciones: { excluirPagoId?: number } = {},
): SQL<boolean> {
  const exclusion =
    opciones.excluirPagoId !== undefined
      ? sql` AND pc.pago_id <> ${opciones.excluirPagoId}`
      : sql``;
  return sql<boolean>`EXISTS (
    SELECT 1
    FROM cartera.pagos_credito pc
    WHERE pc.cuota_id = "cartera"."cuotas_credito"."cuota_id"
      AND pc."paymentFalse" = false
      AND pc.pagado = true
      AND COALESCE(pc.monto_aplicado, 0) > 0
      AND (
        pc.validation_status IN ('validated', 'no_required')
        OR (
          pc.validation_status = 'pending'
          AND pc.fecha_pago::date >= ((now() AT TIME ZONE 'America/Guatemala')::date - ${sql.raw(String(DIAS_PAGO_PENDIENTE_FRENA_MORA))})
          -- Tope de arriba: una fecha futura (reloj del proveedor en Nexa, o una
          -- edición) frenaría la mora hasta 7 días DESPUÉS de esa fecha. Se
          -- admite mañana porque hay filas guardadas en UTC: un pago de la
          -- noche de Guatemala cae en el día siguiente. Peor caso: 8 días.
          AND pc.fecha_pago::date <= ((now() AT TIME ZONE 'America/Guatemala')::date + 1)
        )
      )${exclusion}
  )`;
}

/**
 * Lo mismo que `hasPaidPaymentSql`, pero SIN evaluar la ventana del pendiente
 * contra hoy: devuelve por separado «la cubre un pago validado» y las
 * `fecha_pago` de sus pagos pendientes (separadas por coma, '' si no hay).
 *
 * Por qué existe: la proyección de mora del mes tiene que contestar «¿este
 * pendiente todavía frena la cuota el día 20?», y `hasPaidPaymentSql` solo
 * sabe contestarlo para `now()`. La ventana (`DIAS_PAGO_PENDIENTE_FRENA_MORA`
 * hacia atrás, mañana hacia adelante) la aplica `proyectarMoraDelMes` día por
 * día. Qué fila de pago cuenta —no anulada, `pagado`, con plata aplicada— es
 * el MISMO filtro de arriba y tiene que seguir siéndolo: si divergen, la
 * proyección de hoy deja de coincidir con lo que el cron cobra esta noche.
 */
export function coberturaDeCuotaSql(): { validado: SQL<boolean>; fechasPendiente: SQL<string> } {
  const pagoQueCuenta = sql`
    FROM cartera.pagos_credito pc
    WHERE pc.cuota_id = "cartera"."cuotas_credito"."cuota_id"
      AND pc."paymentFalse" = false
      AND pc.pagado = true
      AND COALESCE(pc.monto_aplicado, 0) > 0`;
  return {
    validado: sql<boolean>`EXISTS (SELECT 1 ${pagoQueCuenta}
      AND pc.validation_status IN ('validated', 'no_required'))`,
    fechasPendiente: sql<string>`COALESCE((SELECT string_agg(to_char(pc.fecha_pago::date, 'YYYY-MM-DD'), ',') ${pagoQueCuenta}
      AND pc.validation_status = 'pending'), '')`,
  };
}
