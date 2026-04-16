import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

// ============================================
// 🔧 CONFIGURACIÓN - Créditos a procesar
// ============================================
// Pago IDs específicos (1 por crédito, sin duplicados)
const PAGO_IDS = [
  60959,   // Diego Padilla - Q906.79
  113720,  // José Cumez - Q786.10
];

// 1. Buscar pagos por ID
const abonos = await pool.query(`
  SELECT
    p.pago_id,
    p.credito_id,
    p.abono_capital,
    p.fecha_pago,
    p.validation_status,
    c.numero_credito_sifco,
    u.nombre AS nombre_usuario
  FROM cartera.pagos_credito p
  INNER JOIN cartera.creditos c ON c.credito_id = p.credito_id
  INNER JOIN cartera.usuarios u ON u.usuario_id = c.usuario_id
  WHERE p.pago_id = ANY($1)
  ORDER BY p.fecha_pago
`, [PAGO_IDS]);

console.log(`Found ${abonos.rowCount} pagos con abono a capital (marzo 2026)\n`);

let totalInserted = 0;
let sinEspejo = 0;
let yaExiste = 0;

for (const abono of abonos.rows) {
  const invs = await pool.query(`
    SELECT
      cie.inversionista_id,
      cie.monto_aportado,
      i.nombre
    FROM cartera.creditos_inversionistas_espejo cie
    INNER JOIN cartera.inversionistas i ON i.inversionista_id = cie.inversionista_id
    WHERE cie.credito_id = $1
  `, [abono.credito_id]);

  if (invs.rowCount === 0) {
    console.log(`⚠️ Crédito ${abono.credito_id} (${abono.nombre_usuario}) - SIN espejo, saltando`);
    sinEspejo++;
    continue;
  }

  // Suma de montos aportados
  let sumMontos = 0;
  for (const inv of invs.rows) {
    sumMontos += parseFloat(inv.monto_aportado);
  }

  if (sumMontos <= 0) {
    console.log(`⚠️ Crédito ${abono.credito_id} (${abono.nombre_usuario}) - SUM aportado = 0, saltando`);
    continue;
  }

  console.log(`💰 Pago ${abono.pago_id} | ${abono.nombre_usuario} | Crédito ${abono.credito_id} | Capital: Q${abono.abono_capital} | SUM aportado: ${sumMontos.toFixed(2)}`);

  for (const inv of invs.rows) {
    const montoAportado = parseFloat(inv.monto_aportado);
    const porcentajeGeneral = montoAportado / sumMontos;
    const montoInv = (parseFloat(abono.abono_capital) * porcentajeGeneral).toFixed(6);

    // Verificar si ya existe uno no liquidado para este credito + inversionista
    const existente = await pool.query(`
      SELECT abono_id, monto FROM cartera.abonos_capital
      WHERE credito_id = $1 AND inversionista_id = $2 AND liquidado = false
      LIMIT 1
    `, [abono.credito_id, inv.inversionista_id]);

    if (existente.rowCount && existente.rowCount > 0) {
      // Sumar al existente
      const nuevoMonto = (parseFloat(existente.rows[0].monto) + parseFloat(montoInv)).toFixed(6);
      await pool.query(`
        UPDATE cartera.abonos_capital SET monto = $1, updated_at = NOW()
        WHERE abono_id = $2
      `, [nuevoMonto, existente.rows[0].abono_id]);

      console.log(`   👤 ${inv.nombre} (${(porcentajeGeneral * 100).toFixed(4)}%) → Q${montoInv} [SUMADO a existente, total: Q${nuevoMonto}]`);
      yaExiste++;
    } else {
      // Insertar nuevo
      await pool.query(`
        INSERT INTO cartera.abonos_capital (credito_id, inversionista_id, monto, tipo, liquidado, created_at)
        VALUES ($1, $2, $3, 'CAPITAL', false, $4)
      `, [abono.credito_id, inv.inversionista_id, montoInv, abono.fecha_pago]);

      console.log(`   👤 ${inv.nombre} (${(porcentajeGeneral * 100).toFixed(4)}%) → Q${montoInv} [NUEVO]`);
    }

    totalInserted++;
  }
}

console.log(`\n✅ Total procesados: ${totalInserted}`);
console.log(`🔄 Sumados a existentes: ${yaExiste}`);
console.log(`⚠️ Sin espejo: ${sinEspejo}`);

// Verificar totales
const check = await pool.query(`
  SELECT tipo, COUNT(*) as registros, SUM(CAST(monto AS NUMERIC)) as total_monto
  FROM cartera.abonos_capital
  GROUP BY tipo
`);
console.log(`\n📋 Resumen tabla abonos_capital:`);
console.table(check.rows);

await pool.end();
