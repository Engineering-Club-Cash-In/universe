const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const sifco = '01010214121340';
  const nuevoMonto = '69289.08';

  // 1. Buscar el crédito
  const cred = await pool.query(
    'SELECT credito_id, numero_credito_sifco, capital FROM cartera.creditos WHERE numero_credito_sifco = $1',
    [sifco]
  );
  if (!cred.rows.length) {
    console.log('Crédito ' + sifco + ' NO EXISTE');
    process.exit(1);
  }
  const credId = cred.rows[0].credito_id;
  console.log('Crédito encontrado: id=' + credId + ', capital=' + cred.rows[0].capital);

  // 2. Ver inversionistas actuales
  const invs = await pool.query(
    `SELECT ci.id, ci.inversionista_id, ci.monto_aportado, i.nombre
     FROM cartera.creditos_inversionistas ci
     JOIN cartera.inversionistas i ON i.inversionista_id = ci.inversionista_id
     WHERE ci.credito_id = $1`,
    [credId]
  );
  console.log('\nInversionistas actuales:');
  for (const r of invs.rows) {
    console.log('  id=' + r.id + ' | inv_id=' + r.inversionista_id + ' | ' + r.nombre + ' | monto_aportado=' + r.monto_aportado);
  }

  // 3. Ver espejo actual
  const espejos = await pool.query(
    `SELECT ce.id, ce.inversionista_id, ce.monto_aportado, i.nombre
     FROM cartera.creditos_inversionistas_espejo ce
     JOIN cartera.inversionistas i ON i.inversionista_id = ce.inversionista_id
     WHERE ce.credito_id = $1`,
    [credId]
  );
  console.log('\nEspejo actual:');
  for (const r of espejos.rows) {
    console.log('  id=' + r.id + ' | inv_id=' + r.inversionista_id + ' | ' + r.nombre + ' | monto_aportado=' + r.monto_aportado);
  }

  // 4. Actualizar monto_aportado en ambas tablas
  const res1 = await pool.query(
    'UPDATE cartera.creditos_inversionistas SET monto_aportado = $1 WHERE credito_id = $2 RETURNING id, monto_aportado',
    [nuevoMonto, credId]
  );
  console.log('\nActualizado creditos_inversionistas:', res1.rows);

  const res2 = await pool.query(
    'UPDATE cartera.creditos_inversionistas_espejo SET monto_aportado = $1 WHERE credito_id = $2 RETURNING id, monto_aportado',
    [nuevoMonto, credId]
  );
  console.log('Actualizado creditos_inversionistas_espejo:', res2.rows);

  console.log('\nListo! monto_aportado actualizado a ' + nuevoMonto + ' para crédito ' + sifco);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
