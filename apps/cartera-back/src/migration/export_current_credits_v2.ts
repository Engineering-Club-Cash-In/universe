import { db } from "../database";
import { sql } from "drizzle-orm";
import { writeFileSync } from "fs";
import { join } from "path";

async function main() {
  console.log("🚀 Iniciando extracción DETALLADA (Optimizada) con validación de cuotas y pagos...");

  try {
    // 1. Obtener todos los créditos relevantes
    const creditsResult = await db.execute(sql`
      SELECT 
          c.credito_id,
          c.numero_credito_sifco,
          u.nombre as nombre_cliente,
          c.capital,
          c.plazo
      FROM cartera.creditos c
      JOIN cartera.usuarios u ON c.usuario_id = u.usuario_id
      WHERE c."statusCredit" IN ('ACTIVO', 'MOROSO', 'EN_CONVENIO')
    `);

    const credits = creditsResult.rows;
    const creditIds = credits.map(c => c.credito_id);

    if (creditIds.length === 0) {
      console.log("⚠️ No se encontraron créditos para procesar.");
      process.exit(0);
    }

    console.log(`📊 Procesando ${credits.length} créditos en lote...`);

    // 2. Obtener TODAS las cuotas para estos créditos
    console.log("📥 Descargando cuotas...");
    const cuotasResult = await db.execute(sql`
      SELECT 
          cuota_id,
          credito_id,
          numero_cuota,
          pagado,
          fecha_vencimiento
      FROM cartera.cuotas_credito
      WHERE credito_id IN ${creditIds}
      ORDER BY numero_cuota DESC
    `);
    const allCuotas = cuotasResult.rows;

    // 3. Obtener TODOS los pagos para estos créditos
    console.log("📥 Descargando pagos...");
    const pagosResult = await db.execute(sql`
      SELECT 
          pago_id,
          cuota_id,
          credito_id,
          pagado,
          fecha_pago,
          monto_boleta,
          cuota as cuota_monto
      FROM cartera.pagos_credito
      WHERE credito_id IN ${creditIds}
    `);
    const allPagos = pagosResult.rows;

    // 4. Organizar datos en memoria
    console.log("🧠 Organizando datos...");
    const cuotasByCredit = new Map();
    for (const cuota of allCuotas) {
      if (!cuotasByCredit.has(cuota.credito_id)) {
        cuotasByCredit.set(cuota.credito_id, []);
      }
      cuotasByCredit.get(cuota.credito_id).push(cuota);
    }

    const pagosByCuota = new Map();
    for (const pago of allPagos) {
      if (!pagosByCuota.has(pago.cuota_id)) {
        pagosByCuota.set(pago.cuota_id, []);
      }
      pagosByCuota.get(pago.cuota_id).push(pago);
    }

    const data = [];

    for (const credit of credits) {
      const credito_id = credit.credito_id;
      const cuotas = cuotasByCredit.get(credito_id) || [];

      // Logic:
      // a. El primer número de cuota que salga true (de abajo para arriba) es cuotas_pagadas
      let cuotas_pagadas = 0;
      const firstPaidCuota = cuotas.find(c => c.pagado === true);
      if (firstPaidCuota) {
        cuotas_pagadas = parseInt(firstPaidCuota.numero_cuota as string);
      }

      // b. Buscar cuotas en false que tengan pagos (Y que sean menores a la última cuota pagada)
      const cuotasPendientesQueSiTienenPagos = [];

      for (const cuota of cuotas) {
        const numero_cuota_num = parseInt(cuota.numero_cuota as string);
        if (cuota.pagado === false && numero_cuota_num < cuotas_pagadas) {
          const pagos = pagosByCuota.get(cuota.cuota_id) || [];
          if (pagos.length > 0) {
            cuotasPendientesQueSiTienenPagos.push({
              idcuota: cuota.cuota_id,
              fechaVencimeinto: cuota.fecha_vencimiento,
              NumeroCuota: cuota.numero_cuota,
              pagos: pagos.map(p => ({
                idPago: p.pago_id,
                validationStatus: p.pagado ? "pagado" : "pendiente",
                pagado: p.pagado,
                fechaPagado: p.fecha_pago,
                cuota: p.cuota_monto
              }))
            });
          }
        }
      }

      data.push({
        numero_credito_sifco: credit.numero_credito_sifco,
        nombre_cliente: credit.nombre_cliente,
        capital: parseFloat(credit.capital as string),
        cuotas_pagadas: cuotas_pagadas,
        cuotasPendientesQueSiTienenPagos: cuotasPendientesQueSiTienenPagos,
        plazo: parseInt(credit.plazo as string)
      });
    }

    const outputPath = join(__dirname, "cartera_actual_v2.json");
    writeFileSync(outputPath, JSON.stringify(data, null, 2));
    
    console.log(`✅ Extracción completada. Se exportaron ${data.length} créditos.`);
    console.log(`📄 Archivo generado en: ${outputPath}`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Error durante la extracción:", error);
    process.exit(1);
  }
}

main();
