import { db } from "../database";
import { sql } from "drizzle-orm";
import { writeFileSync } from "fs";
import { join } from "path";

async function main() {
  console.log("🚀 Iniciando extracción DEFINITIVA con lógica de pagos robusta...");

  try {
    const results = await db.execute(sql`
      SELECT 
          c.credito_id,
          c.numero_credito_sifco,
          u.nombre as nombre_cliente,
          c.capital,
          COALESCE((
              SELECT MAX(cu.numero_cuota) 
              FROM cartera.cuotas_credito cu 
              WHERE cu.credito_id = c.credito_id 
              AND (
                  cu.pagado = true 
                  OR (
                      EXISTS (SELECT 1 FROM cartera.pagos_credito p WHERE p.cuota_id = cu.cuota_id)
                      AND NOT EXISTS (SELECT 1 FROM cartera.pagos_credito p WHERE p.cuota_id = cu.cuota_id AND p.pagado = false)
                  )
              )
          ), 0) as ultima_cuota_pagada,
          c.plazo
      FROM cartera.creditos c
      JOIN cartera.usuarios u ON c.usuario_id = u.usuario_id
      WHERE c."statusCredit" IN ('ACTIVO', 'MOROSO', 'EN_CONVENIO')
    `);

    const data = results.rows.map(row => ({
        numero_credito_sifco: row.numero_credito_sifco,
        nombre_cliente: row.nombre_cliente,
        capital: parseFloat(row.capital),
        cuotas_pagadas: parseInt(row.ultima_cuota_pagada),
        plazo: parseInt(row.plazo)
    }));

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
