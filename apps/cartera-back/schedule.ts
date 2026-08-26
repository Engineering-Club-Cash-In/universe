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
      () => upsertEfectividadAsesores(dia, mes, anio),
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
}
