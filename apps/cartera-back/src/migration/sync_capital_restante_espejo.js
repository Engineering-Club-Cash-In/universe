/**
 * ============================================================
 * SYNC CAPITAL RESTANTE ESPEJO
 * ============================================================
 *
 * QUE HACE:
 *   Lee los Excels de liquidaciones de inversionistas (carpeta "Liquidaciones Marzo 2026")
 *   y compara la columna "CAPITAL RESTANTE" del Excel contra el campo "monto_aportado"
 *   en la tabla creditos_inversionistas_espejo. Si hay diferencias, actualiza los valores
 *   en DB para que coincidan con el Excel.
 *
 * USO:
 *   node src/migration/sync_capital_restante_espejo.js "AVINSA.xlsx.xlsx"
 *   node src/migration/sync_capital_restante_espejo.js "Javier Arzu Perez.xlsx.xlsx"
 *   node src/migration/sync_capital_restante_espejo.js --all
 *
 * TABLAS QUE TOCA:
 *   - cartera.creditos_inversionistas_espejo (UPDATE: monto_aportado)
 *
 * TABLAS QUE LEE:
 *   - cartera.inversionistas (buscar inversionista_id)
 *   - cartera.creditos (JOIN para obtener cliente)
 *   - cartera.usuarios (nombre del cliente)
 *
 * ============================================================
 */

const XLSX = require('xlsx');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });
const CARPETA = path.join(__dirname, 'Liquidaciones Marzo 2026');

function normalizeKey(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').substring(0, 20).toLowerCase();
}

function leerExcel(archivo) {
  const wb = XLSX.readFile(path.join(CARPETA, archivo));
  const hoja = wb.SheetNames.find(h => h.toLowerCase().includes('febrero 2026')) || wb.SheetNames[wb.SheetNames.length - 1];
  const ws = wb.Sheets[hoja];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  let headerRow = 3;
  let colCliente = 1, colCapRestante = -1, colCapital = 9, colInteres = 6, colIva = 7;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    const rowStr = row.map(c => String(c || '').toLowerCase()).join(' ');
    if (rowStr.includes('capital') && rowStr.includes('cliente')) {
      headerRow = i;
      for (let j = 0; j < row.length; j++) {
        const h = String(row[j] || '').toLowerCase().trim();
        if (h === 'cliente') colCliente = j;
        else if (h === 'capital restante') colCapRestante = j;
        else if (h.includes('amortización capital') || h.includes('amortizacion capital')) colCapital = j;
        else if (h.includes('interés inversor') || h === 'interés inversor') colInteres = j;
        else if (h === 'iva' || h === 'iva retenido') colIva = j;
      }
      break;
    }
  }

  if (colCapRestante === -1) {
    throw new Error('No se encontró columna CAPITAL RESTANTE en el Excel');
  }

  const excelMap = {};
  let totalCapRestante = 0;
  let count = 0;
  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[colCliente]) continue;
    const cliente = String(row[colCliente]).trim();
    if (cliente.toLowerCase().includes('total')) continue;
    const cap = Number(row[colCapital] || 0);
    const int = Number(row[colInteres] || 0);
    const iva = Number(row[colIva] || 0);
    if (isNaN(cap) || (cap === 0 && int === 0 && iva === 0)) continue;
    const capRestante = Number(row[colCapRestante] || 0);
    const k = normalizeKey(cliente);
    if (!excelMap[k]) excelMap[k] = [];
    excelMap[k].push({ capRestante, cliente });
    totalCapRestante += capRestante;
    count++;
  }
  return { hoja, excelMap, totalCapRestante, count };
}

async function procesarInversionista(c, invId, archivo, nombre) {
  console.log('\n' + '='.repeat(70));
  console.log(`${nombre} (id=${invId}) - ${archivo}`);
  console.log('='.repeat(70));

  let excel;
  try {
    excel = leerExcel(archivo);
    console.log(`  Hoja: ${excel.hoja} | Créditos Excel: ${excel.count}`);
  } catch (e) {
    console.log(`  ERROR leyendo Excel: ${e.message}`);
    return { ok: 0, updated: 0, noMatch: 0 };
  }

  const rows = await c.query(
    `SELECT cie.id, cie.monto_aportado, u.nombre as cliente
     FROM cartera.creditos_inversionistas_espejo cie
     JOIN cartera.creditos cr ON cr.credito_id = cie.credito_id
     JOIN cartera.usuarios u ON u.usuario_id = cr.usuario_id
     WHERE cie.inversionista_id = $1
     ORDER BY u.nombre`,
    [invId]
  );
  console.log(`  Registros en DB: ${rows.rows.length}`);

  let ok = 0, updated = 0, noMatch = 0;

  for (const db of rows.rows) {
    const k = normalizeKey(db.cliente);
    let entries = excel.excelMap[k];

    // Fallback: si no hay match exacto, intentar con primeros 10 chars
    if (!entries) {
      const kShort = db.cliente.normalize('NFD').replace(/[\u0300-\u036f]/g, '').substring(0, 10).toLowerCase();
      const fallback = Object.entries(excel.excelMap).find(([ek]) => ek.startsWith(kShort));
      if (fallback) entries = fallback[1];
    }

    if (!entries || entries.length === 0) {
      console.log(`  NO MATCH | ${db.cliente} | DB: ${Number(db.monto_aportado).toFixed(2)}`);
      noMatch++;
      continue;
    }

    const ex = entries.shift();
    if (entries.length === 0) delete excel.excelMap[k];

    const monto = Number(db.monto_aportado);
    const diff = Math.abs(monto - ex.capRestante);

    if (diff > 0.005) {
      await c.query(
        'UPDATE cartera.creditos_inversionistas_espejo SET monto_aportado = $1 WHERE id = $2',
        [ex.capRestante.toFixed(10), db.id]
      );
      console.log(`  UPDT | ${db.cliente.substring(0, 45).padEnd(47)} | ${monto.toFixed(2).padStart(12)} -> ${ex.capRestante.toFixed(2).padStart(12)}`);
      updated++;
    } else {
      ok++;
    }
  }

  // Verificar totales
  const t = await c.query(
    'SELECT COALESCE(SUM(monto_aportado::numeric),0) as total FROM cartera.creditos_inversionistas_espejo WHERE inversionista_id = $1',
    [invId]
  );
  const dbTotal = Number(t.rows[0].total);
  const diffTotal = Math.abs(dbTotal - excel.totalCapRestante);
  const totalsOk = diffTotal < 0.05;
  console.log(`  Totales: ${totalsOk ? 'OK' : 'DIFF'} (DB: ${dbTotal.toFixed(2)} | Excel: ${excel.totalCapRestante.toFixed(2)} | diff: ${diffTotal.toFixed(2)})`);

  return { ok, updated, noMatch };
}

async function run() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Uso:');
    console.log('  node sync_capital_restante_espejo.js <nombre_archivo>');
    console.log('  node sync_capital_restante_espejo.js --all');
    console.log('\nEjemplos:');
    console.log('  node sync_capital_restante_espejo.js "AVINSA.xlsx.xlsx"');
    console.log('  node sync_capital_restante_espejo.js "Javier Arzu Perez.xlsx.xlsx"');
    console.log('  node sync_capital_restante_espejo.js --all');
    process.exit(0);
  }

  const c = await pool.connect();
  let grandOk = 0, grandUpdated = 0, grandNoMatch = 0, grandProcessed = 0;

  // Obtener todos los inversionistas de DB
  const invDb = await c.query("SELECT inversionista_id, nombre FROM cartera.inversionistas");
  const invMap = {};
  for (const row of invDb.rows) {
    invMap[row.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()] = row;
  }

  let archivos;
  if (args[0] === '--all') {
    const fs = require('fs');
    archivos = fs.readdirSync(CARPETA).filter(f => f.endsWith('.xlsx') && !f.startsWith('~'));
  } else {
    archivos = [args[0]];
  }

  for (const archivo of archivos) {
    let nombreArchivo = archivo;
    while (nombreArchivo.toLowerCase().endsWith('.xlsx')) {
      nombreArchivo = nombreArchivo.slice(0, -5);
    }
    nombreArchivo = nombreArchivo.trim();

    const nombreNorm = nombreArchivo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    let inv = invMap[nombreNorm];
    if (!inv) {
      for (const [key, val] of Object.entries(invMap)) {
        if (key.includes(nombreNorm) || nombreNorm.includes(key)) {
          inv = val;
          break;
        }
      }
    }

    if (!inv) {
      console.log(`\nNo se encontró inversionista para: "${nombreArchivo}" - saltando`);
      continue;
    }

    const result = await procesarInversionista(c, inv.inversionista_id, archivo, inv.nombre);
    grandOk += result.ok;
    grandUpdated += result.updated;
    grandNoMatch += result.noMatch;
    grandProcessed++;
  }

  console.log('\n' + '='.repeat(70));
  console.log('RESUMEN FINAL');
  console.log('='.repeat(70));
  console.log(`Inversionistas procesados: ${grandProcessed}`);
  console.log(`OK (sin cambios):          ${grandOk}`);
  console.log(`Actualizados:              ${grandUpdated}`);
  console.log(`No match:                  ${grandNoMatch}`);

  c.release();
  await pool.end();
}

run().catch(e => { console.error(e); pool.end(); });
