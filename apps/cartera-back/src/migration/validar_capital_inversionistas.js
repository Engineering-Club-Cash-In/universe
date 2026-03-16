const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function validar() {
  const res = await pool.query(`
    SELECT
      c.credito_id,
      c.numero_credito_sifco,
      u.nombre AS nombre_cliente,
      c.capital AS capital_credito,
      COALESCE(SUM(ci.monto_aportado), 0) AS suma_inversionistas,
      COUNT(ci.id) AS num_inversionistas
    FROM cartera.creditos c
    LEFT JOIN cartera.usuarios u ON u.usuario_id = c.usuario_id
    LEFT JOIN cartera.creditos_inversionistas ci ON ci.credito_id = c.credito_id
    GROUP BY c.credito_id, c.numero_credito_sifco, u.nombre, c.capital
    HAVING FLOOR(c.capital) > FLOOR(COALESCE(SUM(ci.monto_aportado), 0))
    ORDER BY (COALESCE(SUM(ci.monto_aportado), 0) - c.capital) DESC
  `);

  console.log(`Creditos donde capital > suma inversionistas: ${res.rows.length}`);
  console.log('='.repeat(80));

  for (const row of res.rows) {
    const diff = parseFloat(row.suma_inversionistas) - parseFloat(row.capital_credito);
    console.log(`${row.numero_credito_sifco} | ${row.nombre_cliente}`);
    console.log(`  Capital: ${row.capital_credito} | Suma inv: ${parseFloat(row.suma_inversionistas).toFixed(2)} | Dif: ${diff.toFixed(2)} | Inv: ${row.num_inversionistas}`);
  }

  const reporte = res.rows.map(row => ({
    numero_credito_sifco: row.numero_credito_sifco,
    nombre_cliente: row.nombre_cliente,
    capital_credito: parseFloat(row.capital_credito),
    suma_inversionistas: parseFloat(parseFloat(row.suma_inversionistas).toFixed(2)),
    diferencia: parseFloat((parseFloat(row.suma_inversionistas) - parseFloat(row.capital_credito)).toFixed(2)),
    num_inversionistas: parseInt(row.num_inversionistas)
  }));

  fs.writeFileSync(
    path.join(__dirname, 'capital_vs_inversionistas.json'),
    JSON.stringify({ resumen: { total: reporte.length }, discrepancias: reporte }, null, 2),
    'utf-8'
  );

  console.log(`\nReporte guardado en capital_vs_inversionistas.json`);
  await pool.end();
}

validar().catch(e => { console.error(e); pool.end(); });
