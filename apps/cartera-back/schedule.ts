import schedule from 'node-schedule';
import { procesarMoras } from './src/controllers/latefee';
import { upsertEfectividadAsesores } from './src/controllers/paymentsByAdvisor';
import { expirarCompraCarteraVencidas } from './src/controllers/expirarCompraCartera';
import { generarCierreMensual } from './src/controllers/cierreMensual';
import {
  verificarFacturasSat,
  reportarFacturasFallidasSat,
} from './src/controllers/verificarFacturasSat';
import { asegurarSnapshotDiario } from './src/controllers/facturacionSnapshot';

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
    console.log('🕐 Ejecutando procesarMoras a las 11:59 PM Guatemala...');
    try {
      await procesarMoras();
      console.log('✅ procesarMoras ejecutado correctamente');
    } catch (error) {
      console.error('❌ Error al ejecutar procesarMoras:', error);
    }
  });

  // 📊 Efectividad asesores - 11:00 PM hora Guatemala
  schedule.scheduleJob({ rule: '0 23 * * *', tz: TZ_GUATEMALA }, async () => {
    const { dia, mes, anio } = getFechaGuatemala();
    console.log(`📊 Ejecutando upsertEfectividadAsesores para ${dia}/${mes}/${anio}...`);
    try {
      const result = await upsertEfectividadAsesores(dia, mes, anio);
      console.log('✅ upsertEfectividadAsesores:', result.ok ? 'OK' : result.error);
    } catch (error) {
      console.error('❌ Error al ejecutar upsertEfectividadAsesores:', error);
    }
  });

  // ⏰ Expira compras de cartera aceptadas vencidas - 00:00 hora Guatemala.
  //    Vigencia: 3 días hábiles desde aceptada_at. Cualquier row del espejo
  //    con status="pendiente_revision" cuya fecha de baja (expira + 1 hábil)
  //    sea <= hoy en GT se devuelve a CUBE.
  schedule.scheduleJob({ rule: '0 0 * * *', tz: TZ_GUATEMALA }, async () => {
    console.log('🕛 Ejecutando expirarCompraCarteraVencidas a las 00:00 Guatemala...');
    try {
      const res = await expirarCompraCarteraVencidas();
      console.log(
        `✅ expirarCompraCartera: escaneados=${res.escaneados}, vencidos=${res.vencidos}, creditosProcesados=${res.creditosProcesados}`,
      );
    } catch (error) {
      console.error('❌ Error al ejecutar expirarCompraCarteraVencidas:', error);
    }
  });

  // 📊 Cierre mensual de cartera - DIARIO a las 02:00 hora Guatemala (después de procesarMoras).
  //    Mantiene UN registro por mes (upsert): hasta el día 5 sigue cerrando el mes anterior
  //    (gracia para que asiente la data), del 6 en adelante refresca el mes actual.
  //    Genera conteo/capital por estado + el aging de mora (buckets por cuotas atrasadas).
  schedule.scheduleJob({ rule: '0 2 * * *', tz: TZ_GUATEMALA }, async () => {
    console.log('🗓️ Ejecutando generarCierreMensual (diario, 02:00 Guatemala)...');
    try {
      const res = await generarCierreMensual();
      console.log(`✅ cierreMensual: periodo=${res.periodo}, filas=${res.filas}`);
    } catch (error) {
      console.error('❌ Error al ejecutar generarCierreMensual:', error);
    }
  });

  // 🧾 Verificación de facturas en SAT - cada 15 min, 8:00–19:00 hora Guatemala.
  //    Revisa las facturas ACTIVA nuevas (desde el último cursor) y registra en
  //    cartera.facturas_fallidas_sat las que NO se encuentran en SAT.
  schedule.scheduleJob({ rule: '*/15 8-19 * * *', tz: TZ_GUATEMALA }, async () => {
    console.log('🧾 Ejecutando verificarFacturasSat...');
    try {
      const res = await verificarFacturasSat();
      console.log(`✅ verificarFacturasSat: revisadas=${res.revisadas}, fallidas=${res.fallidas}`);
    } catch (error) {
      console.error('❌ Error al ejecutar verificarFacturasSat:', error);
    }
  });

  // 📧 Reporte por correo de facturas fallidas - cada hora, 8:00–19:00 hora Guatemala.
  //    Envía todas las fallidas PENDIENTE; si no hay, no envía correo.
  schedule.scheduleJob({ rule: '0 8-19 * * *', tz: TZ_GUATEMALA }, async () => {
    console.log('📧 Ejecutando reportarFacturasFallidasSat...');
    try {
      const res = await reportarFacturasFallidasSat();
      console.log(`✅ reportarFacturasFallidasSat: enviadas=${res.enviadas}`);
    } catch (error) {
      console.error('❌ Error al ejecutar reportarFacturasFallidasSat:', error);
    }
  });

  // 📸 Snapshot diario de facturación - 01:00 hora Guatemala (respaldo).
  //    Genera el snapshot del DÍA ANTERIOR SOLO si no se guardó ya manualmente.
  schedule.scheduleJob({ rule: '0 1 * * *', tz: TZ_GUATEMALA }, async () => {
    const fecha = getFechaGuatemalaISO(-1); // ayer en GT
    console.log(`📸 Ejecutando asegurarSnapshotDiario para ${fecha} (01:00 Guatemala)...`);
    try {
      const res = await asegurarSnapshotDiario(fecha);
      console.log(
        `✅ snapshotDiario ${fecha}: ${res.created ? 'generado' : 'ya existía'}`,
      );
    } catch (error) {
      console.error('❌ Error al ejecutar asegurarSnapshotDiario:', error);
    }
  });

  console.log('✅ Tareas programadas iniciadas (horario Guatemala)');
}
