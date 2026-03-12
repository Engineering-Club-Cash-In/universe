/**
 * ============================================================
 * INSERT PAGOS ESPEJO FALTANTES
 * ============================================================
 *
 * QUE HACE:
 *   Detecta pagos que faltan en pagos_credito_inversionistas_espejo
 *   comparando los créditos del inversionista (creditos_inversionistas_espejo)
 *   con los pagos ya existentes para la liquidación. Los faltantes se insertan
 *   usando datos del Excel (abonos, % participación, cuota de mes) y buscando
 *   el pago_id correspondiente en pagos_credito.
 *
 * USO:
 *   node src/migration/insert_pagos_espejo_faltantes.js --mes "marzo 2026" "Aida Irene Dubois.xlsx.xlsx"
 *   node src/migration/insert_pagos_espejo_faltantes.js --mes "marzo 2026" "Aida Irene Dubois.xlsx.xlsx" --dry-run
 *   node src/migration/insert_pagos_espejo_faltantes.js --mes "marzo 2026" --all
 *   node src/migration/insert_pagos_espejo_faltantes.js --mes "marzo 2026" --all --dry-run
 *
 *   El --mes indica el mes de liquidación. El Excel usa la hoja del mes anterior.
 *   Ejemplo: --mes "marzo 2026" → busca liquidaciones de marzo, lee hoja "Febrero 2026" del Excel.
 *
 * TABLAS QUE TOCA:
 *   - cartera.pagos_credito_inversionistas_espejo (INSERT)
 *
 * TABLAS QUE LEE:
 *   - cartera.inversionistas
 *   - cartera.liquidaciones
 *   - cartera.creditos_inversionistas_espejo
 *   - cartera.creditos / cartera.usuarios (nombre del cliente)
 *   - cartera.pagos_credito (buscar pago_id por mes_pagado)
 *
 * ============================================================
 */

const XLSX = require('xlsx');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });
const CARPETA = path.join(__dirname, 'Liquidaciones Marzo 2026');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Mapeo de abreviaciones del Excel a mes_pagado en DB
const MES_MAP = {
  'ene': 'Enero', 'feb': 'Febrero', 'mar': 'Marzo', 'abr': 'Abril',
  'may': 'Mayo', 'jun': 'Junio', 'jul': 'Julio', 'ago': 'Agosto',
  'sep': 'Septiembre', 'oct': 'Octubre', 'nov': 'Noviembre', 'dic': 'Diciembre',
  'enero': 'Enero', 'febrero': 'Febrero', 'marzo': 'Marzo', 'abril': 'Abril',
  'mayo': 'Mayo', 'junio': 'Junio', 'julio': 'Julio', 'agosto': 'Agosto',
  'septiembre': 'Septiembre', 'octubre': 'Octubre', 'noviembre': 'Noviembre', 'diciembre': 'Diciembre',
};

function parseMesParam(mesStr) {
  // "marzo 2026" -> { mes: 2 (0-based), anio: 2026 }
  const parts = mesStr.toLowerCase().trim().split(/\s+/);
  const mesIdx = MESES.indexOf(parts[0]);
  if (mesIdx === -1) throw new Error(`Mes no válido: "${parts[0]}"`);
  const anio = parseInt(parts[1]);
  if (isNaN(anio)) throw new Error(`Año no válido: "${parts[1]}"`);
  return { mes: mesIdx, anio };
}

function getMesAnterior(mes, anio) {
  // Resta 1 mes para buscar la hoja del Excel
  if (mes === 0) return { mes: 11, anio: anio - 1 };
  return { mes: mes - 1, anio };
}

function getFechaRango(mes, anio) {
  // Rango de fechas para buscar liquidaciones
  const desde = `${anio}-${String(mes + 1).padStart(2, '0')}-01`;
  const mesNext = mes === 11 ? 0 : mes + 1;
  const anioNext = mes === 11 ? anio + 1 : anio;
  const hasta = `${anioNext}-${String(mesNext + 1).padStart(2, '0')}-01`;
  return { desde, hasta };
}

function normalizeKey(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').substring(0, 20).toLowerCase();
}

function parseCuotaMes(cuotaMes) {
  if (!cuotaMes) return null;
  const str = String(cuotaMes).toLowerCase().trim().replace('.', '');
  const parts = str.split(/\s+/);
  const mesKey = parts[0].replace('.', '');
  return MES_MAP[mesKey] || null;
}

function leerExcel(archivo, hojaTarget) {
  const wb = XLSX.readFile(path.join(CARPETA, archivo));
  const hoja = wb.SheetNames.find(h => h.toLowerCase().includes(hojaTarget.toLowerCase())) || wb.SheetNames[wb.SheetNames.length - 1];
  const ws = wb.Sheets[hoja];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  let headerRow = 3;
  let colCliente = 1, colCapital = 9, colInteres = 6, colIva = 7, colPorcentaje = 4, colCuotaMes = 12;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    const rowStr = row.map(c => String(c || '').toLowerCase()).join(' ');
    if (rowStr.includes('capital') && rowStr.includes('cliente')) {
      headerRow = i;
      for (let j = 0; j < row.length; j++) {
        const h = String(row[j] || '').toLowerCase().trim();
        if (h === 'cliente') colCliente = j;
        else if (h.includes('amortización capital') || h.includes('amortizacion capital')) colCapital = j;
        else if (h.includes('interés inversor') || h === 'interés inversor') colInteres = j;
        else if (h === 'iva' || h === 'iva retenido') colIva = j;
        else if (h === '% inversor') colPorcentaje = j;
        else if (h === 'cuota de mes') colCuotaMes = j;
      }
      break;
    }
  }

  const excelMap = {};
  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[colCliente]) continue;
    const cliente = String(row[colCliente]).trim();
    if (cliente.toLowerCase().includes('total')) continue;
    const cap = Number(row[colCapital] || 0);
    const int = Number(row[colInteres] || 0);
    const iva = Number(row[colIva] || 0);
    if (isNaN(cap) || (cap === 0 && int === 0 && iva === 0)) continue;
    const porcentaje = Number(row[colPorcentaje] || 0) * 100; // Excel tiene 0.8 -> 80%
    const cuotaMes = String(row[colCuotaMes] || '').trim();
    const mesPagado = parseCuotaMes(cuotaMes);
    const k = normalizeKey(cliente);
    if (!excelMap[k]) excelMap[k] = [];
    excelMap[k].push({
      capital: cap, interes: int, iva: iva,
      porcentaje, cuotaMes, mesPagado, cliente
    });
  }
  return { hoja, excelMap };
}

async function procesarInversionista(c, invId, archivo, nombre, fechaDesde, fechaHasta, hojaTarget, dryRun) {
  console.log('\n' + '='.repeat(70));
  console.log(`${nombre} (id=${invId}) - ${archivo}${dryRun ? ' [DRY-RUN]' : ''}`);
  console.log('='.repeat(70));

  // 1. Obtener liquidación del inversionista en el rango
  const liqResult = await c.query(
    `SELECT liquidacion_id, fecha_liquidacion FROM cartera.liquidaciones
     WHERE inversionista_id = $1
     AND fecha_liquidacion >= $2 AND fecha_liquidacion < $3
     ORDER BY fecha_liquidacion DESC LIMIT 1`,
    [invId, fechaDesde, fechaHasta]
  );
  if (!liqResult.rows.length) {
    console.log(`  No tiene liquidación en el rango ${fechaDesde} - ${fechaHasta} - saltando`);
    return { inserted: 0, skipped: 0, errors: 0 };
  }
  const liquidacionId = liqResult.rows[0].liquidacion_id;
  const fechaLiquidacion = liqResult.rows[0].fecha_liquidacion;
  console.log(`  Liquidación: ${liquidacionId} | Fecha: ${fechaLiquidacion}`);

  // 2. Leer Excel (hoja del mes anterior)
  let excel;
  try {
    excel = leerExcel(archivo, hojaTarget);
    console.log(`  Hoja Excel: ${excel.hoja}`);
  } catch (e) {
    console.log(`  ERROR leyendo Excel: ${e.message}`);
    return { inserted: 0, skipped: 0, errors: 0 };
  }

  // 3. Obtener créditos del inversionista en espejo
  const creditosEspejo = await c.query(
    `SELECT cie.credito_id, u.nombre as cliente
     FROM cartera.creditos_inversionistas_espejo cie
     JOIN cartera.creditos cr ON cr.credito_id = cie.credito_id
     JOIN cartera.usuarios u ON u.usuario_id = cr.usuario_id
     WHERE cie.inversionista_id = $1`,
    [invId]
  );

  // 4. Obtener pagos ya existentes en esta liquidación
  const pagosExistentes = await c.query(
    `SELECT credito_id FROM cartera.pagos_credito_inversionistas_espejo
     WHERE inversionista_id = $1 AND liquidacion_id = $2`,
    [invId, liquidacionId]
  );
  const existentes = new Set(pagosExistentes.rows.map(r => r.credito_id));

  // 5. Encontrar créditos faltantes
  const faltantes = creditosEspejo.rows.filter(r => !existentes.has(r.credito_id));
  console.log(`  Créditos total: ${creditosEspejo.rows.length} | Ya existen: ${existentes.size} | Faltantes: ${faltantes.length}`);

  if (faltantes.length === 0) {
    console.log('  No hay pagos faltantes');
    return { inserted: 0, skipped: 0, errors: 0 };
  }

  let inserted = 0, skipped = 0, errors = 0;

  for (const faltante of faltantes) {
    const k = normalizeKey(faltante.cliente);
    let entries = excel.excelMap[k];

    // Fallback con primeros 10 chars
    if (!entries) {
      const kShort = faltante.cliente.normalize('NFD').replace(/[\u0300-\u036f]/g, '').substring(0, 10).toLowerCase();
      const fallback = Object.entries(excel.excelMap).find(([ek]) => ek.startsWith(kShort));
      if (fallback) entries = fallback[1];
    }

    if (!entries || entries.length === 0) {
      console.log(`  SKIP | ${faltante.cliente.substring(0, 45)} | No encontrado en Excel`);
      skipped++;
      continue;
    }

    const ex = entries.shift();
    if (entries.length === 0) delete excel.excelMap[k];

    if (!ex.mesPagado) {
      console.log(`  ERROR | ${faltante.cliente.substring(0, 45)} | No se pudo parsear cuota de mes: "${ex.cuotaMes}"`);
      errors++;
      continue;
    }

    // 6. Buscar pago_id: primero via cuotas_credito (como hace reconcileEspejo), fallback a mes_pagado
    const mesNum = MESES.indexOf(ex.mesPagado.toLowerCase()) + 1;
    const anioStr = ex.cuotaMes.match(/\d{2,4}/)?.[0];
    const anioCuota = anioStr ? (anioStr.length === 2 ? 2000 + parseInt(anioStr) : parseInt(anioStr)) : null;

    let pagoId = null;

    if (mesNum > 0 && anioCuota) {
      // Buscar cuota del crédito en ese mes/año
      const fechaInicio = `${anioCuota}-${String(mesNum).padStart(2, '0')}-01`;
      const ultimoDia = new Date(anioCuota, mesNum, 0).getDate();
      const fechaFin = `${anioCuota}-${String(mesNum).padStart(2, '0')}-${ultimoDia}`;

      const cuotaResult = await c.query(
        `SELECT cuota_id FROM cartera.cuotas_credito
         WHERE credito_id = $1 AND fecha_vencimiento >= $2 AND fecha_vencimiento <= $3
         LIMIT 1`,
        [faltante.credito_id, fechaInicio, fechaFin]
      );

      if (cuotaResult.rows.length) {
        const pagoResult = await c.query(
          `SELECT pago_id FROM cartera.pagos_credito
           WHERE credito_id = $1 AND cuota_id = $2
           LIMIT 1`,
          [faltante.credito_id, cuotaResult.rows[0].cuota_id]
        );
        if (pagoResult.rows.length) pagoId = pagoResult.rows[0].pago_id;
      }
    }

    // Fallback: buscar por mes_pagado
    if (!pagoId) {
      const pagoResult = await c.query(
        `SELECT pago_id FROM cartera.pagos_credito
         WHERE credito_id = $1 AND mes_pagado = $2
         ORDER BY fecha_pago DESC LIMIT 1`,
        [faltante.credito_id, ex.mesPagado]
      );
      if (pagoResult.rows.length) pagoId = pagoResult.rows[0].pago_id;
    }

    if (!pagoId) {
      console.log(`  ERROR | ${faltante.cliente.substring(0, 45)} | No se encontró pago para mes "${ex.mesPagado}" (credito_id=${faltante.credito_id})`);
      errors++;
      continue;
    }
    const cuota = (ex.capital + ex.interes + ex.iva);

    if (dryRun) {
      console.log(`  INSERT (dry) | ${faltante.cliente.substring(0, 40).padEnd(42)} | pago_id: ${pagoId} | cap: ${ex.capital.toFixed(2)} | int: ${ex.interes.toFixed(2)} | iva: ${ex.iva.toFixed(2)} | %: ${ex.porcentaje.toFixed(0)} | mes: ${ex.mesPagado}`);
    } else {
      try {
        await c.query(
          `INSERT INTO cartera.pagos_credito_inversionistas_espejo
           (pago_id, inversionista_id, credito_id, abono_capital, abono_interes, abono_iva_12, porcentaje_participacion, fecha_pago, estado_liquidacion, cuota, liquidacion_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'LIQUIDADO', $9, $10)`,
          [pagoId, invId, faltante.credito_id, ex.capital.toFixed(10), ex.interes.toFixed(10), ex.iva.toFixed(10), ex.porcentaje.toFixed(2), fechaLiquidacion, cuota.toFixed(10), liquidacionId]
        );
        console.log(`  INSERT | ${faltante.cliente.substring(0, 40).padEnd(42)} | pago_id: ${pagoId} | cap: ${ex.capital.toFixed(2)} | int: ${ex.interes.toFixed(2)} | iva: ${ex.iva.toFixed(2)} | mes: ${ex.mesPagado}`);
      } catch (e) {
        if (e.code === '23505') {
          console.log(`  DUP   | ${faltante.cliente.substring(0, 40).padEnd(42)} | pago_id: ${pagoId} ya existe - saltando`);
          skipped++;
          continue;
        }
        throw e;
      }
    }
    inserted++;
  }

  // Verificar conteo final
  const countFinal = await c.query(
    `SELECT COUNT(*) as cnt FROM cartera.pagos_credito_inversionistas_espejo WHERE inversionista_id = $1 AND liquidacion_id = $2`,
    [invId, liquidacionId]
  );
  const totalLiq = await c.query(
    `SELECT total_pagos_liquidados FROM cartera.liquidaciones WHERE liquidacion_id = $1`,
    [liquidacionId]
  );
  console.log(`\n  Pagos espejo ahora: ${countFinal.rows[0].cnt} | Total liquidación: ${totalLiq.rows[0].total_pagos_liquidados} | ${countFinal.rows[0].cnt == totalLiq.rows[0].total_pagos_liquidados ? 'OK' : 'DIFF'}`);

  return { inserted, skipped, errors };
}

async function run() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  // Parsear --mes
  const mesIdx = args.indexOf('--mes');
  if (mesIdx === -1 || !args[mesIdx + 1]) {
    console.log('Uso:');
    console.log('  node insert_pagos_espejo_faltantes.js --mes "marzo 2026" <nombre_archivo>');
    console.log('  node insert_pagos_espejo_faltantes.js --mes "marzo 2026" <nombre_archivo> --dry-run');
    console.log('  node insert_pagos_espejo_faltantes.js --mes "marzo 2026" --all');
    console.log('  node insert_pagos_espejo_faltantes.js --mes "marzo 2026" --all --dry-run');
    console.log('\n  --mes: mes de liquidación (busca hoja Excel del mes anterior)');
    console.log('  Ejemplo: --mes "marzo 2026" → liquidaciones de marzo, hoja Excel "Febrero 2026"');
    process.exit(0);
  }

  const mesParam = args[mesIdx + 1];
  const { mes, anio } = parseMesParam(mesParam);
  const { mes: mesAnt, anio: anioAnt } = getMesAnterior(mes, anio);
  const { desde, hasta } = getFechaRango(mes, anio);
  const mesAnteriorNombre = MESES[mesAnt].charAt(0).toUpperCase() + MESES[mesAnt].slice(1);
  const hojaTarget = `${mesAnteriorNombre} ${anioAnt}`;

  console.log(`Mes liquidación: ${MESES[mes]} ${anio} (rango: ${desde} a ${hasta})`);
  console.log(`Hoja Excel a buscar: "${hojaTarget}"`);

  // Parsear --skip (ids separados por coma)
  const skipIdx = args.indexOf('--skip');
  const skipIds = new Set();
  if (skipIdx !== -1 && args[skipIdx + 1]) {
    args[skipIdx + 1].split(',').forEach(id => skipIds.add(parseInt(id.trim())));
  }

  const filteredArgs = args.filter((a, i) => a !== '--dry-run' && a !== '--mes' && i !== mesIdx + 1 && a !== '--skip' && i !== skipIdx + 1);

  if (filteredArgs.length === 0) {
    console.log('ERROR: falta nombre de archivo o --all');
    process.exit(1);
  }

  const c = await pool.connect();
  let grandInserted = 0, grandSkipped = 0, grandErrors = 0, grandProcessed = 0;

  const invDb = await c.query("SELECT inversionista_id, nombre FROM cartera.inversionistas");
  const invMap = {};
  for (const row of invDb.rows) {
    invMap[row.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()] = row;
  }

  let archivos;
  if (filteredArgs[0] === '--all') {
    const fs = require('fs');
    archivos = fs.readdirSync(CARPETA).filter(f => f.endsWith('.xlsx') && !f.startsWith('~'));
  } else {
    archivos = [filteredArgs[0]];
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

    if (skipIds.has(inv.inversionista_id)) {
      console.log(`\nSaltando ${inv.nombre} (id=${inv.inversionista_id}) por --skip`);
      continue;
    }

    const result = await procesarInversionista(c, inv.inversionista_id, archivo, inv.nombre, desde, hasta, hojaTarget, dryRun);
    grandInserted += result.inserted;
    grandSkipped += result.skipped;
    grandErrors += result.errors;
    grandProcessed++;
  }

  console.log('\n' + '='.repeat(70));
  console.log(`RESUMEN FINAL${dryRun ? ' [DRY-RUN]' : ''}`);
  console.log('='.repeat(70));
  console.log(`Inversionistas procesados: ${grandProcessed}`);
  console.log(`Insertados:                ${grandInserted}`);
  console.log(`Skipped (sin Excel):       ${grandSkipped}`);
  console.log(`Errores:                   ${grandErrors}`);

  c.release();
  await pool.end();
}

run().catch(e => { console.error(e); pool.end(); });
