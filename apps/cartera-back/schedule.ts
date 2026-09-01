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
 * escriben histórico o le pegan a SAT se quedan fuera.
 */
export type TareaProgramada =
	| 'moras'
	| 'buckets_convenio'
	| 'efectividad_asesores'
	| 'expirar_compras'
	| 'cierre_mensual'
	| 'facturas_sat'
	| 'reporte_facturas_fallidas'
	| 'snapshot_facturacion';

export const TODAS_LAS_TAREAS: TareaProgramada[] = [
  'moras',
  'buckets_convenio',
  'efectividad_asesores',
  'expirar_compras',
  'cierre_mensual',
  'facturas_sat',
  'reporte_facturas_fallidas',
  'snapshot_facturacion',
];

export function iniciarTareasProgramadas(
  tareas: TareaProgramada[] = TODAS_LAS_TAREAS,
) {
  const activa = (t: TareaProgramada) => tareas.includes(t);

  // 🌙 procesarMoras - 11:59 PM hora Guatemala (sin importar dónde esté el server)
  if (activa('moras')) schedule.scheduleJob({ rule: '59 23 * * *', tz: TZ_GUATEMALA }, async () => {
    await runScheduledJob('process_late_fees', () => procesarMoras());
  });

  // 🤝 Buckets de CONVENIO - 00:30 hora Guatemala (después de procesarMoras 23:59).
  //    El motor de mora EXCLUYE EN_CONVENIO; este job es el dueño de sus
  //    transiciones de bucket (mide cuotas_credito atrasadas EXCLUYENDO las que el
  //    convenio reestructuró). 1ª corrida auto-siembra INICIAL de todos los
  //    EN_CONVENIO. No pisa a procesarMoras (otros créditos, otro advisory lock).
  if (activa('buckets_convenio')) schedule.scheduleJob({ rule: '30 0 * * *', tz: TZ_GUATEMALA }, async () => {
    console.log('🤝 Ejecutando procesarBucketsConvenio a las 00:30 Guatemala...');
    try {
      const res = await procesarBucketsConvenio();
      console.log(
        `✅ bucketsConvenio: creditos=${res.creditos}, iniciales=${res.iniciales}, subidas=${res.subidas}, bajadas=${res.bajadas}, reasignados=${res.reasignados}`,
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
}
