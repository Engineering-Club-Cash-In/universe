/**
 * ============================================================
 * SYNC PAGOS LIQUIDADOS ESPEJO
 * ============================================================
 *
 * QUE HACE:
 *   Recibe un liquidacion_id, busca el inversionista y la hoja Excel correspondiente,
 *   y compara los pagos LIQUIDADO de esa liquidación contra el Excel.
 *   Si hay diferencias de centavos, actualiza abono_capital, abono_interes, abono_iva_12.
 *   NO setea a 0 los que no tienen match (ya están liquidados).
 *
 * USO:
 *   node src/migration/sync_pagos_liquidados_espejo.js --liquidacion 223
 *   node src/migration/sync_pagos_liquidados_espejo.js --liquidacion 223 --hoja "Enero 2026"
 *
 *   Si no se pasa --hoja, usa la última hoja del Excel.
 *
 * TABLAS QUE TOCA:
 *   - cartera.pagos_credito_inversionistas_espejo (UPDATE: abono_capital, abono_interes, abono_iva_12)
 *
 * TABLAS QUE LEE:
 *   - cartera.inversionistas
 *   - cartera.liquidaciones
 *   - cartera.creditos / cartera.usuarios (nombre del cliente)
 *
 * ============================================================
 */

const XLSX = require('xlsx');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });
const CARPETA = path.join(__dirname, 'Liquidaciones Marzo 2026');

function normalizeKey(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').substring(0, 20).toLowerCase();
}

function leerExcel(archivo, hojaTarget) {
  const wb = XLSX.readFile(path.join(CARPETA, archivo));
  let hoja;
  if (hojaTarget) {
    hoja = wb.SheetNames.find(h => h.toLowerCase().includes(hojaTarget.toLowerCase())) || wb.SheetNames[wb.SheetNames.length - 1];
  } else {
    hoja = wb.SheetNames[wb.SheetNames.length - 1];
  }
  const ws = wb.Sheets[hoja];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  let headerRow = 3;
  let colCliente = 1, colInteres = 6, colIva = 7, colIsr = 8, colCapital = 9;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    const rowStr = row.map(c => String(c || '').toLowerCase()).join(' ');
    if (rowStr.includes('capital') && rowStr.includes('cliente')) {
      headerRow = i;
      for (let j = 0; j < row.length; j++) {
        const h = String(row[j] || '').toLowerCase().trim();
        if (h === 'cliente') colCliente = j;
        else if (h.includes('interés inversor') || h === 'interés inversor' || h.includes('interes inversor')) colInteres = j;
        else if (h === 'iva' || h === 'iva retenido') colIva = j;
        else if (h === 'isr' || h === 'isr retenido') colIsr = j;
        else if (h.includes('amortización capital') || h.includes('amortizacion capital')) colCapital = j;
      }
      break;
    }
  }

  const excelMap = {};
  let totals = { cap: 0, int: 0, iva: 0, count: 0 };
  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[colCliente]) continue;
    const cliente = String(row[colCliente]).trim();
    if (cliente.toLowerCase().includes('total')) continue;
    const cap = Number(row[colCapital] || 0);
    const int = Number(row[colInteres] || 0);
    const iva = Number(row[colIva] || 0);
    if (isNaN(cap) || (cap === 0 && int === 0 && iva === 0)) continue;
    const k = normalizeKey(cliente);
    if (!excelMap[k]) excelMap[k] = [];
    excelMap[k].push({ capital: cap.toFixed(10), interes: int.toFixed(10), iva: iva.toFixed(10), cliente });
    totals.cap += cap;
    totals.int += int;
    totals.iva += iva;
    totals.count++;
  }
  return { hoja, excelMap, totals };
}

async function run() {
  const args = process.argv.slice(2);

  const liqIdx = args.indexOf('--liquidacion');
  if (liqIdx === -1 || !args[liqIdx + 1]) {
    console.log('Uso:');
    console.log('  node sync_pagos_liquidados_espejo.js --liquidacion <id>');
    console.log('  node sync_pagos_liquidados_espejo.js --liquidacion <id> --hoja "Enero 2026"');
    process.exit(0);
  }
  const liquidacionId = parseInt(args[liqIdx + 1]);

  const hojaIdx = args.indexOf('--hoja');
  const hojaTarget = (hojaIdx !== -1 && args[hojaIdx + 1]) ? args[hojaIdx + 1] : null;

  const c = await pool.connect();

  // Obtener info de la liquidación
  const liqResult = await c.query(
    "SELECT l.liquidacion_id, l.inversionista_id, l.fecha_liquidacion, i.nombre FROM cartera.liquidaciones l JOIN cartera.inversionistas i ON i.inversionista_id = l.inversionista_id WHERE l.liquidacion_id = $1",
    [liquidacionId]
  );
  if (liqResult.rows.length === 0) {
    console.log('No se encontró liquidación con id ' + liquidacionId);
    c.release(); await pool.end(); return;
  }
  const liq = liqResult.rows[0];
  const invId = liq.inversionista_id;
  const nombre = liq.nombre;

  // Buscar archivo Excel del inversionista
  const archivos = fs.readdirSync(CARPETA).filter(f => f.endsWith('.xlsx') && !f.startsWith('~'));
  const nombreNorm = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  let archivo = null;
  for (const f of archivos) {
    let fName = f;
    while (fName.toLowerCase().endsWith('.xlsx')) fName = fName.slice(0, -5);
    fName = fName.trim();
    const fNorm = fName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (fNorm === nombreNorm || fNorm.includes(nombreNorm) || nombreNorm.includes(fNorm)) {
      archivo = f;
      break;
    }
  }

  if (!archivo) {
    console.log('No se encontró archivo Excel para: ' + nombre);
    c.release(); await pool.end(); return;
  }

  console.log('='.repeat(70));
  console.log(`${nombre} (id=${invId}) - Liquidación: ${liquidacionId}`);
  console.log(`Archivo: ${archivo}`);
  console.log('='.repeat(70));

  let excel;
  try {
    excel = leerExcel(archivo, hojaTarget);
    console.log(`  Hoja: ${excel.hoja} | Créditos Excel: ${excel.totals.count}`);
  } catch (e) {
    console.log(`  ERROR leyendo Excel: ${e.message}`);
    c.release(); await pool.end(); return;
  }

  // Obtener pagos LIQUIDADO de esta liquidación
  const pagos = await c.query(
    "SELECT pe.id, pe.abono_capital, pe.abono_interes, pe.abono_iva_12, u.nombre as cliente " +
    "FROM cartera.pagos_credito_inversionistas_espejo pe " +
    "JOIN cartera.creditos cr ON cr.credito_id = pe.credito_id " +
    "JOIN cartera.usuarios u ON u.usuario_id = cr.usuario_id " +
    "WHERE pe.inversionista_id = $1 AND pe.liquidacion_id = $2 AND pe.estado_liquidacion = 'LIQUIDADO' ORDER BY u.nombre",
    [invId, liquidacionId]
  );
  console.log(`  Pagos LIQUIDADO en DB: ${pagos.rows.length}`);

  let ok = 0, updated = 0, noMatch = 0;

  for (const db of pagos.rows) {
    const k = normalizeKey(db.cliente);
    let entries = excel.excelMap[k];

    if (!entries) {
      const kShort = db.cliente.normalize('NFD').replace(/[\u0300-\u036f]/g, '').substring(0, 10).toLowerCase();
      const fallback = Object.entries(excel.excelMap).find(([ek]) => ek.startsWith(kShort));
      if (fallback) entries = fallback[1];
    }

    if (!entries) {
      console.log(`  NO MATCH | ${db.cliente.substring(0, 45)} | cap: ${Number(db.abono_capital).toFixed(2)}`);
      noMatch++;
      continue;
    }

    const ex = entries.shift();
    if (entries.length === 0) delete excel.excelMap[k];

    const capOk = Math.abs(Number(db.abono_capital) - Number(ex.capital)) < 0.000001;
    const intOk = Math.abs(Number(db.abono_interes) - Number(ex.interes)) < 0.000001;
    const ivaOk = Math.abs(Number(db.abono_iva_12) - Number(ex.iva)) < 0.000001;

    if (capOk && intOk && ivaOk) {
      ok++;
    } else {
      await c.query(
        'UPDATE cartera.pagos_credito_inversionistas_espejo SET abono_capital = $1, abono_interes = $2, abono_iva_12 = $3 WHERE id = $4',
        [ex.capital, ex.interes, ex.iva, db.id]
      );
      console.log(`  UPDT | ${db.cliente.substring(0, 35).padEnd(37)} cap:${Number(db.abono_capital).toFixed(2).padStart(10)} -> ${Number(ex.capital).toFixed(2).padStart(10)} | int:${Number(db.abono_interes).toFixed(2).padStart(10)} -> ${Number(ex.interes).toFixed(2).padStart(10)} | iva:${Number(db.abono_iva_12).toFixed(2).padStart(8)} -> ${Number(ex.iva).toFixed(2).padStart(8)}`);
      updated++;
    }
  }

  // Verificar totales
  const r = await c.query(
    "SELECT COALESCE(SUM(abono_capital::numeric),0) as cap, COALESCE(SUM(abono_interes::numeric),0) as int, COALESCE(SUM(abono_iva_12::numeric),0) as iva " +
    "FROM cartera.pagos_credito_inversionistas_espejo WHERE inversionista_id = $1 AND liquidacion_id = $2 AND estado_liquidacion = 'LIQUIDADO'",
    [invId, liquidacionId]
  );
  const diffCap = Math.abs(Number(r.rows[0].cap) - excel.totals.cap);
  const diffInt = Math.abs(Number(r.rows[0].int) - excel.totals.int);
  const totalsOk = diffCap < 0.05 && diffInt < 0.05;
  console.log(`  Totales: ${totalsOk ? 'OK' : 'DIFF'} (cap diff: ${diffCap.toFixed(2)}, int diff: ${diffInt.toFixed(2)})`);

  console.log('\n' + '='.repeat(70));
  console.log('RESUMEN');
  console.log('='.repeat(70));
  console.log(`OK (sin cambios):  ${ok}`);
  console.log(`Actualizados:      ${updated}`);
  console.log(`No match:          ${noMatch}`);

  c.release();
  await pool.end();
}

run().catch(e => { console.error(e); pool.end(); });
