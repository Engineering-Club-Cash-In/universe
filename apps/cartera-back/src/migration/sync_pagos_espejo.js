/**
 * ============================================================
 * SYNC PAGOS ESPEJO - Sincronizar pagos de inversionistas
 * ============================================================
 *
 * QUE HACE:
 *   Lee los Excels de liquidaciones de inversionistas (carpeta "Liquidaciones Marzo 2026")
 *   y compara los valores de cada crédito (abono_capital, abono_interes, abono_iva_12)
 *   contra los registros NO_LIQUIDADO en la tabla pagos_credito_inversionistas_espejo.
 *   Si hay diferencias, actualiza los valores en DB para que coincidan con el Excel.
 *
 * FLUJO:
 *   1. Recibe nombre de archivo Excel (o --all para todos)
 *   2. Extrae nombre del inversionista del nombre del archivo
 *   3. Busca el inversionista_id en la tabla cartera.inversionistas
 *   4. Lee la hoja "Febrero 2026" del Excel (última hoja si no existe)
 *   5. Extrae por cada crédito: cliente, amortización capital (col 9),
 *      interés inversor (col 6), IVA (col 7), ISR (col 8)
 *   6. Consulta en DB los pagos con estado_liquidacion = 'NO_LIQUIDADO'
 *      para ese inversionista
 *   7. Match por primeros 20 caracteres del nombre del cliente
 *   8. Si hay diferencia > 0.02, hace UPDATE en DB
 *   9. Al final verifica que los totales (suma) cuadren Excel vs DB
 *
 * USO:
 *   node src/migration/sync_pagos_espejo.js "NXGN INVESTMENTS.xlsx"
 *   node src/migration/sync_pagos_espejo.js "Ligia Haydee Fernandez.xlsx.xlsx"
 *   node src/migration/sync_pagos_espejo.js --all
 *
 * TABLAS QUE TOCA:
 *   - cartera.pagos_credito_inversionistas_espejo (UPDATE: abono_capital, abono_interes, abono_iva_12)
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

  // Buscar header dinámicamente y detectar índices de columnas
  let headerRow = 3;
  let colCliente = 1, colInteres = 6, colIva = 7, colIsr = 8, colCapital = 9;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    const rowStr = row.map(c => String(c || '').toLowerCase()).join(' ');
    if (rowStr.includes('capital') && rowStr.includes('cliente')) {
      headerRow = i;
      // Detectar columnas por nombre del header
      for (let j = 0; j < row.length; j++) {
        const h = String(row[j] || '').toLowerCase().trim();
        if (h === 'cliente') colCliente = j;
        else if (h.includes('interés inversor') || h === 'interés inversor') colInteres = j;
        else if (h === 'iva' || h === 'iva retenido') colIva = j;
        else if (h === 'isr' || h === 'isr retenido') colIsr = j;
        else if (h.includes('amortización capital') || h === 'amortización capital') colCapital = j;
      }
      break;
    }
  }

  // excelMap: key -> array of entries (para manejar duplicados en Excel)
  const excelMap = {};
  let totals = { cap: 0, int: 0, iva: 0, isr: 0, count: 0 };
  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[colCliente]) continue;
    const cliente = String(row[colCliente]).trim();
    if (cliente.toLowerCase().includes('total')) continue;
    const cap = Number(row[colCapital] || 0);
    const int = Number(row[colInteres] || 0);
    const iva = Number(row[colIva] || 0);
    const isr = Number(row[colIsr] || 0);
    if (isNaN(cap) || (cap === 0 && int === 0 && iva === 0)) continue;
    const k = normalizeKey(cliente);
    if (!excelMap[k]) excelMap[k] = [];
    excelMap[k].push({ capital: cap.toFixed(2), interes: int.toFixed(2), iva: iva.toFixed(2), isr: isr.toFixed(2), cliente });
    totals.cap += cap;
    totals.int += int;
    totals.iva += iva;
    totals.isr += isr;
    totals.count++;
  }
  return { hoja, excelMap, totals };
}

async function procesarInversionista(c, invId, archivo, nombre) {
  console.log('\n' + '='.repeat(70));
  console.log(`${nombre} (id=${invId}) - ${archivo}`);
  console.log('='.repeat(70));

  let excel;
  try {
    excel = leerExcel(archivo);
    console.log(`  Hoja: ${excel.hoja} | Créditos Excel: ${excel.totals.count}`);
  } catch (e) {
    console.log(`  ERROR leyendo Excel: ${e.message}`);
    return { ok: 0, updated: 0, noMatch: 0 };
  }

  const pagos = await c.query(
    "SELECT pe.id, pe.abono_capital, pe.abono_interes, pe.abono_iva_12, u.nombre as cliente " +
    "FROM cartera.pagos_credito_inversionistas_espejo pe " +
    "JOIN cartera.creditos cr ON cr.credito_id = pe.credito_id " +
    "JOIN cartera.usuarios u ON u.usuario_id = cr.usuario_id " +
    "WHERE pe.inversionista_id = $1 AND pe.estado_liquidacion = 'NO_LIQUIDADO' ORDER BY u.nombre",
    [invId]
  );
  console.log(`  Pagos NO_LIQUIDADO en DB: ${pagos.rows.length}`);

  let ok = 0, updated = 0, noMatch = 0;

  for (const db of pagos.rows) {
    const k = normalizeKey(db.cliente);
    let entries = excel.excelMap[k];

    // Fallback: si no hay match exacto, intentar con primeros 10 chars (maneja typos leves)
    if (!entries) {
      const kShort = db.cliente.normalize('NFD').replace(/[\u0300-\u036f]/g, '').substring(0, 10).toLowerCase();
      const fallback = Object.entries(excel.excelMap).find(([ek, _]) => ek.startsWith(kShort));
      if (fallback) entries = fallback[1];
    }

    if (!entries) {
      console.log(`  NO MATCH -> 0 | ${db.cliente}`);
      await c.query(
        'UPDATE cartera.pagos_credito_inversionistas_espejo SET abono_capital = 0, abono_interes = 0, abono_iva_12 = 0 WHERE id = $1',
        [db.id]
      );
      noMatch++;
      continue;
    }

    // Tomar el primer entry disponible (pop para que duplicados en DB tomen entradas distintas)
    const ex = entries.shift();
    if (entries.length === 0) delete excel.excelMap[k];

    const capOk = Math.abs(Number(db.abono_capital) - Number(ex.capital)) < 0.005;
    const intOk = Math.abs(Number(db.abono_interes) - Number(ex.interes)) < 0.005;
    const ivaOk = Math.abs(Number(db.abono_iva_12) - Number(ex.iva)) < 0.005;

    if (capOk && intOk && ivaOk) {
      console.log(`  OK   | ${db.cliente.substring(0, 35)}`);
      ok++;
    } else {
      await c.query(
        'UPDATE cartera.pagos_credito_inversionistas_espejo SET abono_capital = $1, abono_interes = $2, abono_iva_12 = $3 WHERE id = $4',
        [ex.capital, ex.interes, ex.iva, db.id]
      );
      console.log(`  UPDT | ${db.cliente.substring(0, 35).padEnd(37)} cap:${Number(db.abono_capital).toFixed(2).padStart(10)} -> ${ex.capital.padStart(10)} | int:${Number(db.abono_interes).toFixed(2).padStart(10)} -> ${ex.interes.padStart(10)} | iva:${Number(db.abono_iva_12).toFixed(2).padStart(8)} -> ${ex.iva.padStart(8)}`);
      updated++;
    }
  }

  // Verificar totales
  const r = await c.query(
    "SELECT COALESCE(SUM(abono_capital::numeric),0) as cap, COALESCE(SUM(abono_interes::numeric),0) as int, COALESCE(SUM(abono_iva_12::numeric),0) as iva " +
    "FROM cartera.pagos_credito_inversionistas_espejo WHERE inversionista_id = $1 AND estado_liquidacion = 'NO_LIQUIDADO'",
    [invId]
  );
  const diffCap = Math.abs(Number(r.rows[0].cap) - excel.totals.cap);
  const diffInt = Math.abs(Number(r.rows[0].int) - excel.totals.int);
  const totalsOk = diffCap < 0.05 && diffInt < 0.05;
  console.log(`  Totales: ${totalsOk ? 'OK' : 'DIFF'} (cap diff: ${diffCap.toFixed(2)}, int diff: ${diffInt.toFixed(2)})`);

  return { ok, updated, noMatch };
}

async function run() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Uso:');
    console.log('  node sync_pagos_espejo.js <nombre_archivo>          (busca inversionista por nombre del archivo)');
    console.log('  node sync_pagos_espejo.js --all                     (procesa todos los archivos de la carpeta)');
    console.log('\nEjemplos:');
    console.log('  node sync_pagos_espejo.js "NXGN INVESTMENTS.xlsx"');
    console.log('  node sync_pagos_espejo.js "Ligia Haydee Fernandez.xlsx.xlsx"');
    console.log('  node sync_pagos_espejo.js --all');
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
    // Extraer nombre del inversionista del archivo
    let nombreArchivo = archivo;
    while (nombreArchivo.toLowerCase().endsWith('.xlsx')) {
      nombreArchivo = nombreArchivo.slice(0, -5);
    }
    nombreArchivo = nombreArchivo.trim();

    // Buscar en DB por nombre exacto o parcial
    const nombreNorm = nombreArchivo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    let inv = invMap[nombreNorm];
    if (!inv) {
      // Buscar parcial
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
