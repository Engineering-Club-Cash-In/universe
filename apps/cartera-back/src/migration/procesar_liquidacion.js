/**
 * ============================================================
 * PROCESAR LIQUIDACION - Flujo completo para un inversionista
 * ============================================================
 *
 * FLUJO:
 *   1. Revertir liquidación existente
 *   2. Calcular pagos espejo (endpoint externo)
 *   3. Sync espejo desde Excel (abono_capital, abono_interes, abono_iva_12)
 *   4. Ajustar monto_aportado pre-liq (CAPITAL del Excel)
 *   5. Liquidar
 *   6. Ajustar monto_aportado post-liq (CAPITAL RESTANTE del Excel)
 *   7. Generar reporte PDF
 *
 * USO:
 *   node src/migration/procesar_liquidacion.js <liquidacion_id>
 *
 * EJEMPLO:
 *   node src/migration/procesar_liquidacion.js 104
 * ============================================================
 */

const XLSX = require('xlsx');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });
const CARPETA = path.join(__dirname, 'Liquidaciones Marzo 2026');
const API_LOCAL = 'http://localhost:7000';
const API_PAGOS = 'https://qk4sw4kc4c088c8csos400wc.s3.devteamatcci.site/calcularPagosEspejo';

function normalizeKey(str, len = 20) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').substring(0, len).toLowerCase();
}

function leerExcel(archivo) {
  const wb = XLSX.readFile(path.join(CARPETA, archivo));
  const hoja = wb.SheetNames.find(h => h.toLowerCase().includes('febrero 2026')) || wb.SheetNames[wb.SheetNames.length - 1];
  const ws = wb.Sheets[hoja];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  let headerRow = 3, colCliente = 1, colInteres = 6, colIva = 7, colIsr = 8, colCapital = 9, colCapitalTotal = 2, colCapitalRestante = 11;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    const rowStr = row.map(c => String(c || '').toLowerCase()).join(' ');
    if (rowStr.includes('capital') && rowStr.includes('cliente')) {
      headerRow = i;
      for (let j = 0; j < row.length; j++) {
        const h = String(row[j] || '').toLowerCase().trim();
        if (h === 'cliente') colCliente = j;
        else if (h.includes('interés inversor')) colInteres = j;
        else if (h === 'iva' || h === 'iva retenido') colIva = j;
        else if (h === 'isr' || h === 'isr retenido') colIsr = j;
        else if (h.includes('amortización capital')) colCapital = j;
        else if (h === 'capital') colCapitalTotal = j;
        else if (h.includes('capital restante')) colCapitalRestante = j;
      }
      break;
    }
  }

  const rows = [];
  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[colCliente]) continue;
    const cliente = String(row[colCliente]).trim();
    if (cliente.toLowerCase().includes('total') || cliente.toLowerCase().includes('monto')) continue;
    const cap = Number(row[colCapital] || 0);
    const int = Number(row[colInteres] || 0);
    const iva = Number(row[colIva] || 0);
    const isr = Number(row[colIsr] || 0);
    const capitalTotal = Number(row[colCapitalTotal] || 0);
    const capitalRestante = Number(row[colCapitalRestante] || 0);
    if (isNaN(cap) || (cap === 0 && int === 0 && iva === 0)) continue;
    rows.push({
      cliente,
      k: normalizeKey(cliente),
      capital: cap.toFixed(2),
      interes: int.toFixed(2),
      iva: iva.toFixed(2),
      isr: isr.toFixed(2),
      capitalTotal,
      capitalRestante,
    });
  }
  return { hoja, rows };
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}

async function run() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Uso: node procesar_liquidacion.js <liquidacion_id>');
    process.exit(0);
  }

  const liquidacion_id = parseInt(args[0]);
  if (isNaN(liquidacion_id)) {
    console.error('liquidacion_id debe ser un número');
    process.exit(1);
  }

  const c = await pool.connect();

  try {
    // ── Obtener info de la liquidación ──────────────────────────────────
    const liqRow = await c.query(
      'SELECT l.liquidacion_id, l.inversionista_id, i.nombre FROM cartera.liquidaciones l JOIN cartera.inversionistas i ON i.inversionista_id = l.inversionista_id WHERE l.liquidacion_id = $1',
      [liquidacion_id]
    );
    if (liqRow.rows.length === 0) {
      console.error(`No se encontró la liquidación ${liquidacion_id}`);
      process.exit(1);
    }
    const { inversionista_id, nombre } = liqRow.rows[0];
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Inversionista: ${nombre} (id=${inversionista_id})`);
    console.log(`Liquidación:   ${liquidacion_id}`);
    console.log('='.repeat(70));

    // ── Buscar archivo Excel ─────────────────────────────────────────────
    const archivos = fs.readdirSync(CARPETA).filter(f => f.endsWith('.xlsx') && !f.startsWith('~'));
    let archivo = null;
    const nombreNorm = normalizeKey(nombre, 999);
    for (const f of archivos) {
      let fn = f;
      while (fn.toLowerCase().endsWith('.xlsx')) fn = fn.slice(0, -5);
      if (normalizeKey(fn, 999).includes(nombreNorm.substring(0, 15)) || nombreNorm.includes(normalizeKey(fn, 999).substring(0, 15))) {
        archivo = f;
        break;
      }
    }
    if (!archivo) {
      console.error(`No se encontró archivo Excel para: ${nombre}`);
      process.exit(1);
    }
    console.log(`Excel: ${archivo}`);

    // ── PASO 1: Revertir liquidación ─────────────────────────────────────
    console.log(`\n[1/7] Revirtiendo liquidación ${liquidacion_id}...`);

    // Guardar boleta antes del revert (el revert la elimina)
    let boletaGuardada = null;
    const liqInfo = await c.query(
      'SELECT boleta_id FROM cartera.liquidaciones WHERE liquidacion_id = $1',
      [liquidacion_id]
    );
    if (liqInfo.rows[0]?.boleta_id) {
      const boletaRow = await c.query(
        'SELECT boleta_url, monto_boleta, notas, subido_por FROM cartera.boletas_pago_inversionista WHERE boleta_id = $1',
        [liqInfo.rows[0].boleta_id]
      );
      if (boletaRow.rows.length > 0) {
        boletaGuardada = boletaRow.rows[0];
        console.log(`  💾 Boleta guardada: ${boletaGuardada.boleta_url?.substring(0, 60)}...`);
      }
    }

    const revert = await post(`${API_LOCAL}/investor/revertir-liquidacion`, { liquidacion_id });
    if (!revert.ok) {
      console.error('  ERROR al revertir:', revert.data);
      process.exit(1);
    }
    console.log(`  ✅ Revertida`);

    // Re-insertar boleta como PENDIENTE para que el liquidate la tome
    if (boletaGuardada) {
      const ahora = new Date();
      await c.query(
        `INSERT INTO cartera.boletas_pago_inversionista (inversionista_id, boleta_url, monto_boleta, notas, subido_por, estado, fecha_subida)
         VALUES ($1, $2, $3, $4, $5, 'PENDIENTE', $6)`,
        [inversionista_id, boletaGuardada.boleta_url, boletaGuardada.monto_boleta, boletaGuardada.notas, boletaGuardada.subido_por, ahora]
      );
      console.log(`  ✅ Boleta re-insertada como PENDIENTE`);
    } else {
      console.log(`  ⚠️  Sin boleta asociada, se liquidará sin boleta`);
    }

    // ── PASO 2: Calcular pagos espejo ────────────────────────────────────
    console.log(`\n[2/7] Calculando pagos espejo...`);
    const pagos = await post(API_PAGOS, { inversionistaId: inversionista_id });
    if (!pagos.ok) {
      console.error('  ERROR al calcular pagos:', pagos.data);
      process.exit(1);
    }
    console.log(`  ✅ Pagos generados`);

    // ── PASO 3: Sync espejo desde Excel ──────────────────────────────────
    console.log(`\n[3/7] Sincronizando espejo con Excel...`);
    const excel = leerExcel(archivo);
    console.log(`  Hoja: ${excel.hoja} | Créditos: ${excel.rows.length}`);

    const pagosDB = await c.query(
      `SELECT pe.id, pe.abono_capital, pe.abono_interes, pe.abono_iva_12, u.nombre as cliente
       FROM cartera.pagos_credito_inversionistas_espejo pe
       JOIN cartera.creditos cr ON cr.credito_id = pe.credito_id
       JOIN cartera.usuarios u ON u.usuario_id = cr.usuario_id
       WHERE pe.inversionista_id = $1 AND pe.estado_liquidacion = 'NO_LIQUIDADO'
       ORDER BY u.nombre`,
      [inversionista_id]
    );
    console.log(`  Pagos NO_LIQUIDADO en DB: ${pagosDB.rows.length}`);

    const excelMap = {};
    for (const row of excel.rows) {
      if (!excelMap[row.k]) excelMap[row.k] = [];
      excelMap[row.k].push(row);
    }

    let synced = 0, noMatch = 0;
    // Calcular suma real para ajuste de IVA al centavo
    const ivaRawSum = excel.rows.reduce((s, r) => s + parseFloat(r.iva), 0);
    const ivaTarget = Math.round(ivaRawSum * 100) / 100;
    let ivaAcum = 0;
    const syncUpdates = [];

    for (const db of pagosDB.rows) {
      const k = normalizeKey(db.cliente);
      let entries = excelMap[k];
      if (!entries) {
        const kShort = db.cliente.normalize('NFD').replace(/[\u0300-\u036f]/g, '').substring(0, 10).toLowerCase();
        const fallback = Object.entries(excelMap).find(([ek]) => ek.startsWith(kShort));
        if (fallback) entries = fallback[1];
      }
      if (!entries) {
        console.log(`  NO MATCH -> 0 | ${db.cliente}`);
        await c.query(
          'UPDATE cartera.pagos_credito_inversionistas_espejo SET abono_capital=0, abono_interes=0, abono_iva_12=0 WHERE id=$1',
          [db.id]
        );
        noMatch++;
        continue;
      }
      const ex = entries.shift();
      if (entries.length === 0) delete excelMap[k];
      ivaAcum += parseFloat(ex.iva);
      syncUpdates.push({ db, ex });
    }

    // Ajuste de centavo en IVA (asignar al mayor abono)
    const ivaDiff = Math.round((ivaTarget - ivaAcum) * 100) / 100;
    if (Math.abs(ivaDiff) >= 0.01 && syncUpdates.length > 0) {
      const maxRow = syncUpdates.reduce((a, b) => parseFloat(a.ex.iva) > parseFloat(b.ex.iva) ? a : b);
      maxRow.ex.iva = (parseFloat(maxRow.ex.iva) + ivaDiff).toFixed(2);
      console.log(`  IVA ajustado en ${maxRow.db.cliente.substring(0, 30)}: ${ivaDiff > 0 ? '+' : ''}${ivaDiff}`);
    }

    for (const { db, ex } of syncUpdates) {
      const capOk = Math.abs(Number(db.abono_capital) - Number(ex.capital)) < 0.005;
      const intOk = Math.abs(Number(db.abono_interes) - Number(ex.interes)) < 0.005;
      const ivaOk = Math.abs(Number(db.abono_iva_12) - Number(ex.iva)) < 0.005;
      if (!capOk || !intOk || !ivaOk) {
        await c.query(
          'UPDATE cartera.pagos_credito_inversionistas_espejo SET abono_capital=$1, abono_interes=$2, abono_iva_12=$3 WHERE id=$4',
          [ex.capital, ex.interes, ex.iva, db.id]
        );
        synced++;
      }
    }
    console.log(`  ✅ Sync OK (${syncUpdates.length - synced} sin cambios, ${synced} actualizados, ${noMatch} sin match)`);

    // Verificar totales
    const tot = await c.query(
      `SELECT ROUND(SUM(abono_capital::numeric),2) cap, ROUND(SUM(abono_interes::numeric),2) int, ROUND(SUM(abono_iva_12::numeric),2) iva
       FROM cartera.pagos_credito_inversionistas_espejo WHERE inversionista_id=$1 AND estado_liquidacion='NO_LIQUIDADO'`,
      [inversionista_id]
    );
    const exTotCap = excel.rows.reduce((s, r) => s + Number(r.capital), 0);
    const exTotInt = excel.rows.reduce((s, r) => s + Number(r.interes), 0);
    console.log(`  Totales DB  — cap: ${tot.rows[0].cap}  int: ${tot.rows[0].int}  iva: ${tot.rows[0].iva}`);
    console.log(`  Totales XLS — cap: ${exTotCap.toFixed(2)}  int: ${exTotInt.toFixed(2)}  iva: ${ivaTarget.toFixed(2)}`);

    // ── PASO 4: Ajustar monto_aportado pre-liq (CAPITAL del Excel) ───────
    console.log(`\n[4/7] Ajustando monto_aportado pre-liq (CAPITAL Excel)...`);
    const cieRows = await c.query(
      `SELECT cie.id, cie.monto_aportado, u.nombre
       FROM cartera.creditos_inversionistas_espejo cie
       JOIN cartera.creditos cr ON cr.credito_id = cie.credito_id
       JOIN cartera.usuarios u ON u.usuario_id = cr.usuario_id
       WHERE cie.inversionista_id = $1`,
      [inversionista_id]
    );

    let cieUpdated = 0;
    for (const cie of cieRows.rows) {
      const k = normalizeKey(cie.nombre);
      const ex = excel.rows.find(r => r.k === k);
      if (!ex) continue;
      const target = ex.capitalTotal.toFixed(2);
      if (Math.abs(parseFloat(cie.monto_aportado) - ex.capitalTotal) > 0.005) {
        await c.query('UPDATE cartera.creditos_inversionistas_espejo SET monto_aportado=$1 WHERE id=$2', [target, cie.id]);
        console.log(`  UPDT ${cie.nombre.substring(0, 35).padEnd(37)} ${parseFloat(cie.monto_aportado).toFixed(2)} -> ${target}`);
        cieUpdated++;
      }
    }
    console.log(`  ✅ ${cieUpdated} monto_aportado actualizados`);

    // ── PASO 5: Liquidar ─────────────────────────────────────────────────
    console.log(`\n[5/7] Liquidando inversionista ${inversionista_id}...`);
    const liq = await post(`${API_LOCAL}/liquidate-inversionista-pagos`, { inversionista_id });
    if (!liq.ok) {
      console.error('  ERROR al liquidar:', liq.data);
      process.exit(1);
    }
    const nuevaLiqId = liq.data?.liquidaciones_creadas ? liq.data : null;
    console.log(`  ✅ Liquidado:`, JSON.stringify(liq.data).substring(0, 120));

    // ── PASO 6: Ajustar monto_aportado post-liq (CAPITAL RESTANTE) ───────
    console.log(`\n[6/7] Ajustando monto_aportado post-liq (CAPITAL RESTANTE Excel)...`);
    const cieRows2 = await c.query(
      `SELECT cie.id, cie.monto_aportado, u.nombre
       FROM cartera.creditos_inversionistas_espejo cie
       JOIN cartera.creditos cr ON cr.credito_id = cie.credito_id
       JOIN cartera.usuarios u ON u.usuario_id = cr.usuario_id
       WHERE cie.inversionista_id = $1`,
      [inversionista_id]
    );

    let cieUpdated2 = 0;
    for (const cie of cieRows2.rows) {
      const k = normalizeKey(cie.nombre);
      const ex = excel.rows.find(r => r.k === k);
      if (!ex) continue;
      const target = ex.capitalRestante.toFixed(2);
      if (Math.abs(parseFloat(cie.monto_aportado) - ex.capitalRestante) > 0.005) {
        await c.query('UPDATE cartera.creditos_inversionistas_espejo SET monto_aportado=$1 WHERE id=$2', [target, cie.id]);
        console.log(`  UPDT ${cie.nombre.substring(0, 35).padEnd(37)} ${parseFloat(cie.monto_aportado).toFixed(2)} -> ${target}`);
        cieUpdated2++;
      }
    }
    console.log(`  ✅ ${cieUpdated2} monto_aportado post-liq actualizados`);

    // ── PASO 7: Generar reporte ──────────────────────────────────────────
    console.log(`\n[7/7] Generando reporte PDF...`);
    const hoy = new Date().toISOString().slice(0, 10);
    const reporte = await post(`${API_LOCAL}/investor/reporte-liquidados`, { id: inversionista_id, fecha_liquidacion: hoy });
    if (!reporte.ok) {
      console.error('  ERROR al generar reporte:', reporte.data);
    } else {
      const url = reporte.data?.url || reporte.data?.pdf_url || JSON.stringify(reporte.data).substring(0, 100);
      console.log(`  ✅ PDF: ${url}`);
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`✅ COMPLETADO: ${nombre}`);
    console.log('='.repeat(70));

  } finally {
    c.release();
    await pool.end();
  }
}

run().catch(e => { console.error('ERROR:', e.message); pool.end(); process.exit(1); });
