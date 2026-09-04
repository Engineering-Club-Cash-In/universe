import schedule from 'node-schedule';
import { procesarMoras } from './src/controllers/latefee';
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

export function iniciarTareasProgramadas() {
  // 🌙 procesarMoras - 11:59 PM hora Guatemala (sin importar dónde esté el server)
  schedule.scheduleJob({ rule: '59 23 * * *', tz: TZ_GUATEMALA }, async () => {
    await runScheduledJob('process_late_fees', () => procesarMoras());
  });

  // 📊 Efectividad asesores - 11:00 PM hora Guatemala
  schedule.scheduleJob({ rule: '0 23 * * *', tz: TZ_GUATEMALA }, async () => {
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
  schedule.scheduleJob({ rule: '0 0 * * *', tz: TZ_GUATEMALA }, async () => {
    await runScheduledJob(
      'expire_portfolio_purchases',
      () => expirarCompraCarteraVencidas(),
    );
  });

  // 📊 Cierre mensual de cartera - DIARIO a las 02:00 hora Guatemala (después de procesarMoras).
  //    Mantiene UN registro por mes (upsert): hasta el día 5 sigue cerrando el mes anterior
  //    (gracia para que asiente la data), del 6 en adelante refresca el mes actual.
  //    Genera conteo/capital por estado + el aging de mora (buckets por cuotas atrasadas).
  schedule.scheduleJob({ rule: '0 2 * * *', tz: TZ_GUATEMALA }, async () => {
    await runScheduledJob(
      'generate_monthly_close',
      () => generarCierreMensual(periodoObjetivo(new Date())),
    );
  });

  // 🧾 Verificación de facturas en SAT - cada 15 min, 8:00–19:00 hora Guatemala.
  //    Revisa las facturas ACTIVA nuevas (desde el último cursor) y registra en
  //    cartera.facturas_fallidas_sat las que NO se encuentran en SAT.
  schedule.scheduleJob({ rule: '*/15 8-19 * * *', tz: TZ_GUATEMALA }, async () => {
    await runScheduledJob('verify_sat_invoices', () => verificarFacturasSat());
  });

  // 📧 Reporte por correo de facturas fallidas - cada hora, 8:00–19:00 hora Guatemala.
  //    Envía todas las fallidas PENDIENTE; si no hay, no envía correo.
  schedule.scheduleJob({ rule: '0 8-19 * * *', tz: TZ_GUATEMALA }, async () => {
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
  schedule.scheduleJob({ rule: '0 1 * * *', tz: TZ_GUATEMALA }, async () => {
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
  schedule.scheduleJob({ rule: '0 8 11-13 * *', tz: TZ_GUATEMALA }, async () => {
    await runScheduledJob(
      'verify_liquidation_balance',
      () => verificarCuadreLiquidaciones(),
    );
  });

  // 🔑 Acceso al Portal del Inversionista - 07:00 hora Guatemala, todos los días.
  //    Recorre a todos los inversionistas y le crea la cuenta a quien deba
  //    tenerla y no la tenga. Es idempotente (la existencia del usuario es la
  //    llave), así que correrlo a diario no crea cuentas de más ni repite
  //    correos de bienvenida.
  //
  //    Es la red que recoge lo que el alta no pudo: si auth-google estaba caído
  //    cuando se creó el inversionista, el operador no tiene forma de
  //    reintentarlo —el segundo POST muere en el guard de duplicados— y sin
  //    este job esa persona se quedaba sin acceso para siempre.
  //
  //    Solo asegura cuentas: el aviso de "ahora representas a X" se manda
  //    únicamente en el alta, porque desde aquí se le repetiría a los mismos
  //    representantes todos los días.
  schedule.scheduleJob({ rule: '0 7 * * *', tz: TZ_GUATEMALA }, async () => {
    await runScheduledJob(
      'provision_portal_accounts',
      () => provisionarCuentasPortal({ enviarResumen: enviarResumenProvisionamiento }),
    );
  });
}
