import schedule from 'node-schedule'; 
import { procesarMoras } from './src/controllers/latefee';

export function iniciarTareasProgramadas() {
  // 🌙 Ejecutar a las 11:59 PM Guatemala = 5:59 AM UTC
  // (23:59 Guatemala + 6 horas = 05:59 UTC del día siguiente)
  schedule.scheduleJob('59 5 * * *', async () => {
    console.log('🕐 Ejecutando procesarMoras a las 11:59 PM Guatemala (5:59 AM UTC)...');
    try {
      await procesarMoras();
      console.log('✅ procesarMoras ejecutado correctamente');
    } catch (error) {
      console.error('❌ Error al ejecutar procesarMoras:', error);
    }
  });

  console.log('✅ Tareas programadas iniciadas (horario ajustado a UTC)');
}