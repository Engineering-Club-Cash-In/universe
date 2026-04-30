import schedule from 'node-schedule';
import { procesarMoras } from './src/controllers/latefee';
import { upsertEfectividadAsesores } from './src/controllers/paymentsByAdvisor';
import { expirarCompraCarteraVencidas } from './src/controllers/expirarCompraCartera';

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

  console.log('✅ Tareas programadas iniciadas (horario Guatemala)');
}
