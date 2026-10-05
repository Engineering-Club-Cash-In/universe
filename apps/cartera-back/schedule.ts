import schedule from 'node-schedule';
import { procesarMoras } from './src/controllers/latefee';
import { procesarBucketsConvenio } from './src/controllers/bucketsConvenio';
import { upsertEfectividadAsesores } from './src/controllers/paymentsByAdvisor';
import { expirarCompraCarteraVencidas } from './src/controllers/expirarCompraCartera';
import { generarCierreMensual, periodoObjetivo } from './src/controllers/cierreMensual';
import {
  verificarFacturasSat,
  reportarFacturasFallidasSat,
} from './src/controllers/verificarFacturasSat';
import { generarSnapshotDiario } from './src/controllers/facturacionSnapshot';
import { verificarCuadreLiquidaciones } from './src/controllers/verificarCuadreLiquidaciones';
import {
  enviarResumenProvisionamiento,
  provisionarCuentasPortal,
} from './src/controllers/provisionarCuentasPortal';
import { reintentarBateriasPendientes } from './src/controllers/bateriasCrmPendientes';
import { runScheduledJob, runScheduledJobAttempts } from './scheduledJobRunner';

const TZ_GUATEMALA = 'America/Guatemala';

function getFechaGuatemala() {
  const now = new Date();
  const guate = new Date(now.toLocaleString('en-US', { timeZone: TZ_GUATEMALA }));
  return {
    dia: guate.getDate(),
    mes: guate.getMonth() + 1,
    anio: guate.getFullYear(),
  };
}

// "YYYY-MM-DD" en hora Guatemala, con offset de días (ej. -1 = ayer).
function getFechaGuatemalaISO(offsetDays = 0) {
  const now = new Date();
  const guate = new Date(now.toLocaleString('en-US', { timeZone: TZ_GUATEMALA }));
  guate.setDate(guate.getDate() + offsetDays);
  const y = guate.getFullYear();
  const m = String(guate.getMonth() + 1).padStart(2, '0');
  const d = String(guate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Qué tareas registrar. Se pasa desde `index.ts` para poder prender un
 * subconjunto: en la fase de pruebas de COBROS-02 solo corren las dos que
 * alimentan el módulo de cobros (mora y buckets de convenio), y las que
 * escriben histórico, le pegan a SAT o mandan correos se quedan fuera.
 * Sin argumento corren TODAS (comportamiento de producción).
 */
export type TareaProgramada =
	| 'moras'
	| 'buckets_convenio'
	| 'efectividad_asesores'
	| 'expirar_compras'
	| 'cierre_mensual'
	| 'facturas_sat'
	| 'reporte_facturas_fallidas'
	| 'snapshot_facturacion'
	| 'cuadre_liquidaciones'
	| 'cuentas_portal'
	| 'baterias_crm';

export const TODAS_LAS_TAREAS: TareaProgramada[] = [
  'moras',
  'buckets_convenio',
  'efectividad_asesores',
  'expirar_compras',
  'cierre_mensual',
  'facturas_sat',
  'reporte_facturas_fallidas',
  'snapshot_facturacion',
  'cuadre_liquidaciones',
  'cuentas_portal',
  'baterias_crm',
];

export function iniciarTareasProgramadas(
  tareas: TareaProgramada[] = TODAS_LAS_TAREAS,
) {
  const activa = (t: TareaProgramada) => tareas.includes(t);

  // 🌙 procesarMoras - 00:05 hora Guatemala (sin importar dónde esté el server).
  //    Corría a las 23:59, y eso dejaba la mora un día por detrás: la cuota que
  //    vencía el día D recién recibía su primer día de atraso a las 23:59 del
  //    D+1, así que quien pagaba durante todo el D+1 no pagaba mora. Con la mora
  //    proporcional eso además volvía mentiroso el aviso del CRM ("si no pagas
  //    hoy, mañana se agrega el recargo"): el recargo aparecía 24 h después.
  //    Al correr apenas pasada la medianoche, la mora del día anterior ya está
  //    escrita cuando amanece. Sigue antes del cierre mensual de las 02:00, que
  //    depende de que procesarMoras haya corrido.
  if (activa('moras')) schedule.scheduleJob({ rule: '5 0 * * *', tz: TZ_GUATEMALA }, async () => {
    await runScheduledJob('process_late_fees', () => procesarMoras());
  });

  // 🧊 Vigilante de convenios - 00:30 hora Guatemala (después de procesarMoras 00:05).
  //    El motor de mora EXCLUYE EN_CONVENIO. Desde la Fase 2 este job NO mueve
  //    buckets: el convenio los congela al firmarse. Acá quedan la red de
  //    seguridad (congelar a los que no tengan fila de su régimen) y la medición
  //    del atraso para el log. No pisa a procesarMoras (otro advisory lock).
  if (activa('buckets_convenio')) schedule.scheduleJob({ rule: '30 0 * * *', tz: TZ_GUATEMALA }, async () => {
    console.log('🧊 Ejecutando el vigilante de convenios a las 00:30 Guatemala...');
    try {
      const res = await procesarBucketsConvenio();
      console.log(
        `✅ bucketsConvenio: creditos=${res.creditos}, congelados=${res.congelados}, con atraso=${res.atrasados}`,
      );
    } catch (error) {
      console.error('❌ Error al ejecutar procesarBucketsConvenio:', error);
    }
  });

  // 📊 Efectividad asesores - 11:00 PM hora Guatemala
  if (activa('efectividad_asesores')) schedule.scheduleJob({ rule: '0 23 * * *', tz: TZ_GUATEMALA }, async () => {
    const { dia, mes, anio } = getFechaGuatemala();
    await runScheduledJob(
      'upsert_advisor_effectiveness',
      async () => {
        const result = await upsertEfectividadAsesores(dia, mes, anio);
        if (!result.ok) throw new Error("scheduled job reported failure");
      },
    );
  });

  // ⏰ Expira compras de cartera aceptadas vencidas - 00:00 hora Guatemala.
  //    Vigencia: 3 días hábiles desde aceptada_at. Cualquier row del espejo
  //    con status="pendiente_revision" cuya fecha de baja (expira + 1 hábil)
  //    sea <= hoy en GT se devuelve a CUBE.
  if (activa('expirar_compras')) schedule.scheduleJob({ rule: '0 0 * * *', tz: TZ_GUATEMALA }, async () => {
    await runScheduledJob(
      'expire_portfolio_purchases',
      () => expirarCompraCarteraVencidas(),
    );
  });

  // 📊 Cierre mensual de cartera - DIARIO a las 02:00 hora Guatemala (después de procesarMoras).
  //    Mantiene UN registro por mes (upsert): hasta el día 5 sigue cerrando el mes anterior
  //    (gracia para que asiente la data), del 6 en adelante refresca el mes actual.
  //    Genera conteo/capital por estado + el aging de mora (buckets por cuotas atrasadas).
  if (activa('cierre_mensual')) schedule.scheduleJob({ rule: '0 2 * * *', tz: TZ_GUATEMALA }, async () => {
    await runScheduledJob(
      'generate_monthly_close',
      () => generarCierreMensual(periodoObjetivo(new Date())),
    );
  });

  // 🧾 Verificación de facturas en SAT - cada 15 min, 8:00–19:00 hora Guatemala.
  //    Revisa las facturas ACTIVA nuevas (desde el último cursor) y registra en
  //    cartera.facturas_fallidas_sat las que NO se encuentran en SAT.
  if (activa('facturas_sat')) schedule.scheduleJob({ rule: '*/15 8-19 * * *', tz: TZ_GUATEMALA }, async () => {
    await runScheduledJob('verify_sat_invoices', () => verificarFacturasSat());
  });

  // 💳 El barrido de facturas Págalo huérfanas se quitó (2026-09-01, Daniel):
  //    un pago aplicado ya queda con `pagos_credito.factura_status = 'PENDIENTE'`
  //    (marcarFacturacionPendiente, en aplicarPagoAlCredito), que es justo lo que
  //    lista la bandeja de conta — la falta de factura YA se ve sin barrer nada.
  //    Y el cliente no depende de eso: se le notifica al validar el pago, no al
  //    facturar. Facturar o no es problema nuestro, no suyo.
  //
  //    `reintentarFacturacionPagaloPendiente` sigue existiendo y se puede llamar
  //    a mano si algún día hace falta; lo que se quitó es que corra cada 10 min.
  //    Con eso también se dejó de reintentar solo el recibo de WhatsApp del pago:
  //    hoy sale best-effort al aplicar (enviarRecibosPagoDeCreditoBestEffort) y,
  //    si ese envío falla, nadie lo reintenta.

  // 📧 Reporte por correo de facturas fallidas - cada hora, 8:00–19:00 hora Guatemala.
  //    Envía todas las fallidas PENDIENTE; si no hay, no envía correo.
  if (activa('reporte_facturas_fallidas')) schedule.scheduleJob({ rule: '0 8-19 * * *', tz: TZ_GUATEMALA }, async () => {
    await runScheduledJob(
      'report_failed_sat_invoices',
      () => reportarFacturasFallidasSat(),
    );
  });

  // 📸 Snapshot diario de facturación - 01:00 hora Guatemala.
  //    REGENERA (force) los últimos 3 días, NO "solo si falta": así captura
  //    facturación que entró con fecha atrasada y refresca filas pre-creadas
  //    (p. ej. del import del Excel hasta 2026-12-31) que de otro modo
  //    quedarían congeladas en su valor viejo/0.
  if (activa('snapshot_facturacion')) schedule.scheduleJob({ rule: '0 1 * * *', tz: TZ_GUATEMALA }, async () => {
    function* snapshotAttempts() {
      for (const offset of [-1, -2, -3]) {
        const fecha = getFechaGuatemalaISO(offset); // ayer, antier, trasantier (GT)
        yield async () => generarSnapshotDiario(fecha);
      }
    }
    await runScheduledJobAttempts('generate_daily_invoice_snapshot', snapshotAttempts());
  });

  // 🔍 Cuadre de las liquidaciones del mes - 11, 12 y 13 a las 08:00 hora Guatemala.
  //    El 10 queda fuera a propósito: ese día se está liquidando y todo estaría
  //    a medio camino. Verifica que el monto aportado del espejo, descontadas
  //    las compras que la liquidación no absorbió, sea igual al histórico que
  //    dejó esa liquidación más su reinversión. Solo notifica por correo; no
  //    corrige nada. De cada liquidación se avisa UNA sola vez: el 12 y el 13
  //    sirven para cerrar las que ya cuadraron solas y para agarrar las que
  //    aparecieron después, no para repetir el mismo correo.
  if (activa('cuadre_liquidaciones')) schedule.scheduleJob({ rule: '0 8 11-13 * *', tz: TZ_GUATEMALA }, async () => {
    await runScheduledJob(
      'verify_liquidation_balance',
      () => verificarCuadreLiquidaciones(),
    );
  });

  // 🔑 Acceso al Portal del Inversionista - 07:00 hora Guatemala, todos los días.
  //    DETECTA, no ejecuta. Recorre a todos los inversionistas, PREGUNTA quién
  //    debería tener cuenta y no la tiene, y lo manda en el resumen. No crea
  //    nada y no manda ninguna contraseña: sale de aquí en solo lectura.
  //
  //    Es la red que recoge lo que el alta no pudo: si auth-google estaba caído
  //    cuando se creó el inversionista, el operador no tiene forma de
  //    reintentarlo —el segundo POST muere en el guard de duplicados— y sin
  //    este job esa persona se quedaba sin acceso para siempre. Eso se sigue
  //    detectando y reportando solo; lo que cambió es que abrir la cuenta lo
  //    dispara una persona desde POST /investor/portal-access.
  //
  //    Por qué no la abre él: su universo es la tabla entera y no puede saber
  //    quién escribió cada fila —`cartera.inversionistas` se escribe desde
  //    caminos que no prueban identidad—, así que "esta fila debería tener
  //    cuenta" no puede significar "mandale la contraseña a ese correo".
  //    Ver el encabezado de provisionarCuentasPortal.ts.
  if (activa('cuentas_portal')) schedule.scheduleJob({ rule: '0 7 * * *', tz: TZ_GUATEMALA }, async () => {
    await runScheduledJob(
      'provision_portal_accounts',
      () => provisionarCuentasPortal({ enviarResumen: enviarResumenProvisionamiento }),
    );
  });

  // 📨 Avisos de compra aceptada que el CRM no recibió - cada 10 minutos.
  //    Si el CRM no contestó al aceptar la compra, jurídico se quedaba sin su
  //    batería de contratos para siempre. Ver bateriasCrmPendientes.ts.
  if (activa('baterias_crm')) schedule.scheduleJob({ rule: '*/10 * * * *', tz: TZ_GUATEMALA }, async () => {
    await runScheduledJob(
      'retry_crm_contract_batches',
      async () => {
        await reintentarBateriasPendientes();
      },
    );
  });
}
