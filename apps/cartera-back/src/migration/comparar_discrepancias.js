/**
 * ============================================================
 * COMPARAR DISCREPANCIAS - ETL vs DB
 * ============================================================
 *
 * QUE HACE:
 *   Compara resultado_ultimos_pagos.json (ETL) contra cartera_actual_v2.json (DB snapshot).
 *   - Cuotas: si difieren, consulta la BD para verificar el estado de las cuotas faltantes
 *   - Capital: compara solo por enteros (Math.trunc)
 *   - Agrupa por crédito (sifco_base) e incluye array de inversionistas con nombre y capital
 *
 * USO:
 *   node src/migration/comparar_discrepancias.js
 *
 * TABLAS QUE LEE:
 *   - cartera.creditos (credito_id por numero_credito_sifco)
 *   - cartera.cuotas_credito (estado de cuotas)
 *   - cartera.pagos_credito (pagos asociados a cuotas)
 *
 * ============================================================
 */

const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

const DIR = __dirname;
const ETL_FILE = path.join(DIR, 'resultado_ultimos_pagos.json');
const DB_FILE = path.join(DIR, 'cartera_actual_v2.json');
const REPORTE_FILE = path.join(DIR, 'discrepancias_reporte.json');

function normalizarNombre(nombre) {
  if (!nombre) return '';
  nombre = String(nombre).split('/')[0];
  return nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function parseCuota(raw) {
  const match = String(raw || '0').match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

async function consultarCuotasEnDB(client, sifco, cuotasAVerificar) {
  const creditoRes = await client.query(
    `SELECT credito_id FROM cartera.creditos WHERE numero_credito_sifco = $1 LIMIT 1`,
    [sifco]
  );

  if (creditoRes.rows.length === 0) return null;

  const creditoId = creditoRes.rows[0].credito_id;

  const cuotasRes = await client.query(
    `SELECT
       cc.cuota_id,
       cc.numero_cuota,
       cc.pagado AS cuota_pagada,
       cc.fecha_vencimiento,
       pc.pago_id,
       pc.pagado AS pago_pagado,
       pc.validation_status,
       pc.fecha_pago,
       pc.cuota AS cuota_pago,
       pc.monto_boleta,
       pc.monto_boleta_cuota
     FROM cartera.cuotas_credito cc
     LEFT JOIN cartera.pagos_credito pc ON pc.cuota_id = cc.cuota_id
     WHERE cc.credito_id = $1
       AND cc.numero_cuota = ANY($2)
     ORDER BY cc.numero_cuota, pc.fecha_pago`,
    [creditoId, cuotasAVerificar]
  );

  const resultado = {};
  for (const row of cuotasRes.rows) {
    const numCuota = row.numero_cuota;
    if (!resultado[numCuota]) {
      resultado[numCuota] = {
        numero_cuota: numCuota,
        cuota_pagada: row.cuota_pagada,
        fecha_vencimiento: row.fecha_vencimiento,
        pagos: []
      };
    }
    if (row.pago_id) {
      resultado[numCuota].pagos.push({
        pago_id: row.pago_id,
        pago_pagado: row.pago_pagado,
        validation_status: row.validation_status,
        fecha_pago: row.fecha_pago,
        cuota_pago: row.cuota_pago,
        monto_boleta: row.monto_boleta,
        monto_boleta_cuota: row.monto_boleta_cuota
      });
    }
  }

  return resultado;
}

async function comparar() {
  if (!fs.existsSync(ETL_FILE)) {
    console.log(`No se encuentra: ${ETL_FILE}`);
    return;
  }
  if (!fs.existsSync(DB_FILE)) {
    console.log(`No se encuentra: ${DB_FILE}`);
    return;
  }

  const etlRaw = JSON.parse(fs.readFileSync(ETL_FILE, 'utf-8'));
  const dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));

  // Indexar DB snapshot por SIFCO y por nombre
  const dbBySifco = {};
  const dbByName = {};
  for (const item of dbData) {
    dbBySifco[item.numero_credito_sifco] = item;
    const norm = normalizarNombre(item.nombre_cliente);
    if (norm) {
      if (!dbByName[norm]) dbByName[norm] = [];
      dbByName[norm].push(item);
    }
  }

  // Pre-procesar ETL: agrupar por sifco_base
  const gruposPorSifco = {};
  for (const grupo of etlRaw) {
    const nombreGrupo = grupo.nombreCliente;
    const inversionistasActuales = (grupo.inversionistasActuales || []).map(inv => ({
      numeroCredito: inv.numeroCredito,
      inversionista: inv.inversionista,
      capital: inv.capital
    }));

    for (const credito of (grupo.creditos || [])) {
      const sifcoBase = (credito.numeroCredito || '').split('_')[0];
      if (!gruposPorSifco[sifcoBase]) {
        gruposPorSifco[sifcoBase] = {
          sifcoBase,
          nombreCliente: credito.nombreCliente || nombreGrupo,
          cuotaEtl: parseCuota(credito.numeroCuota),
          capitalTotal: 0,
          inversionistas: inversionistasActuales
        };
      }
      gruposPorSifco[sifcoBase].capitalTotal += parseFloat(credito.capitalRestante || 0);
    }
  }

  const client = await pool.connect();
  const discrepancias = [];
  let encontradosSifco = 0, encontradosNombre = 0, noEncontrados = 0;
  let cuotasIguales = 0, cuotasDiferentes = 0;
  let capitalIgual = 0, capitalDiferente = 0;

  try {
    for (const sifcoBase of Object.keys(gruposPorSifco)) {
      const grupo = gruposPorSifco[sifcoBase];

      // Buscar match
      let match = null;
      let matchType = null;

      if (dbBySifco[sifcoBase]) {
        match = dbBySifco[sifcoBase];
        matchType = 'sifco';
        encontradosSifco++;
      } else {
        const normName = normalizarNombre(grupo.nombreCliente);
        if (dbByName[normName]) {
          const matches = dbByName[normName];
          match = matches.find(m => Math.abs(parseFloat(m.capital || 0) - grupo.capitalTotal) < 50) || matches[0];
          matchType = 'nombre';
          encontradosNombre++;
        }
      }

      if (!match) {
        noEncontrados++;
        continue;
      }

      const capDb = parseFloat(match.capital || 0);
      const cuotaDb = parseInt(match.cuotas_pagadas || 0, 10);

      // Comparar capital por enteros
      const capitalEtlEntero = Math.trunc(grupo.capitalTotal);
      const capitalDbEntero = Math.trunc(capDb);
      const capitalCoincide = capitalEtlEntero === capitalDbEntero;

      if (capitalCoincide) capitalIgual++;
      else capitalDiferente++;

      // Comparar cuotas
      const cuotasCoinciden = grupo.cuotaEtl === cuotaDb;
      if (cuotasCoinciden) cuotasIguales++;
      else cuotasDiferentes++;

      const entrada = {
        sifco_base: sifcoBase,
        nombre_etl: grupo.nombreCliente,
        nombre_db: match.nombre_cliente,
        match_type: matchType,
        cuota_etl: grupo.cuotaEtl,
        cuota_db: cuotaDb,
        cuotas_coinciden: cuotasCoinciden,
        capital_total_etl: grupo.capitalTotal,
        capital_total_etl_entero: capitalEtlEntero,
        capital_db: capDb,
        capital_db_entero: capitalDbEntero,
        capital_coincide: capitalCoincide,
        inversionistas: grupo.inversionistas,
        verificacion_cuotas_db: null
      };

      // Solo consultar DB si las cuotas NO coinciden
      if (!cuotasCoinciden && grupo.cuotaEtl > cuotaDb) {
        const cuotasAVerificar = [];
        for (let i = cuotaDb + 1; i <= grupo.cuotaEtl; i++) {
          cuotasAVerificar.push(i);
        }

        const verificacion = await consultarCuotasEnDB(client, sifcoBase, cuotasAVerificar);

        if (verificacion) {
          const detalle = [];
          for (const numCuota of cuotasAVerificar) {
            const info = verificacion[numCuota];
            if (!info) {
              detalle.push({
                numero_cuota: numCuota,
                estado: 'NO_ENCONTRADA_EN_DB',
                pagos: []
              });
              continue;
            }

            const tienePagos = info.pagos.length > 0;
            const esMarzo = (fecha) => {
              if (!fecha) return false;
              const d = new Date(fecha);
              return d.getFullYear() === 2026 && d.getMonth() === 2;
            };
            const algunPagoPending = info.pagos.some(p => p.validation_status === 'pending');
            const algunPagoEnMarzo = info.pagos.some(p => esMarzo(p.fecha_pago));
            const algunPagado = info.pagos.some(p => p.pago_pagado === true);

            let estado;
            if (tienePagos && algunPagoPending && algunPagoEnMarzo) {
              estado = 'PAGADA_PENDING_MARZO';
            } else if (tienePagos && algunPagado) {
              estado = 'PAGADA_NO_MARZO';
            } else if (tienePagos && !algunPagado) {
              estado = 'TIENE_PAGO_NO_PAGADA';
            } else {
              estado = 'SIN_PAGOS';
            }

            // Filtrar: no incluir las de marzo
            if (estado === 'PAGADA_PENDING_MARZO') continue;

            detalle.push({
              numero_cuota: numCuota,
              estado,
              fecha_pago: info.pagos.length > 0 ? info.pagos[info.pagos.length - 1].fecha_pago : null,
              pagos: info.pagos.map(p => ({
                pago_id: p.pago_id,
                pagado: p.pago_pagado,
                validation_status: p.validation_status,
                fecha_pago: p.fecha_pago,
                cuota_pago: p.cuota_pago,
                monto_boleta: p.monto_boleta,
                monto_boleta_cuota: p.monto_boleta_cuota
              }))
            });
          }
          entrada.verificacion_cuotas_db = detalle;
        } else {
          entrada.verificacion_cuotas_db = 'CREDITO_NO_ENCONTRADO_EN_DB';
        }
      } else if (!cuotasCoinciden && grupo.cuotaEtl < cuotaDb) {
        entrada.verificacion_cuotas_db = `DB_TIENE_MAS_CUOTAS (DB: ${cuotaDb}, ETL: ${grupo.cuotaEtl})`;
      }

      discrepancias.push(entrada);
    }
  } finally {
    client.release();
    await pool.end();
  }

  // Solo discrepancias de cuotas (marzo ya fue filtrado arriba)
  const discCuotas = discrepancias
    .filter(d => !d.cuotas_coinciden && Array.isArray(d.verificacion_cuotas_db) && d.verificacion_cuotas_db.length > 0);

  // Contar por estado
  const conteoPorEstado = {};
  let totalCuotasDisc = 0;
  for (const d of discCuotas) {
    for (const c of d.verificacion_cuotas_db) {
      conteoPorEstado[c.estado] = (conteoPorEstado[c.estado] || 0) + 1;
      totalCuotasDisc++;
    }
  }

  const reporte = {
    resumen: {
      total_creditos_etl: Object.keys(gruposPorSifco).length,
      total_creditos_con_discrepancia: discCuotas.length,
      total_cuotas_discrepantes: totalCuotasDisc,
      por_estado: conteoPorEstado
    },
    discrepancias: discCuotas
  };

  fs.writeFileSync(REPORTE_FILE, JSON.stringify(reporte, null, 2), 'utf-8');

  console.log('Comparacion finalizada.');
  console.log('Resumen:');
  console.log(`  Total creditos ETL:        ${Object.keys(gruposPorSifco).length}`);
  console.log(`  Match por SIFCO:           ${encontradosSifco}`);
  console.log(`  Match por Nombre:          ${encontradosNombre}`);
  console.log(`  No encontrados:            ${noEncontrados}`);
  console.log(`  ---`);
  console.log(`  Cuotas iguales:            ${cuotasIguales}`);
  console.log(`  Cuotas diferentes:         ${cuotasDiferentes}`);
  console.log(`  Capital igual (entero):    ${capitalIgual}`);
  console.log(`  Capital dif (entero):      ${capitalDiferente}`);
  console.log(`  ---`);
  console.log(`  Creditos con discrepancia: ${discCuotas.length}`);
  console.log(`  Cuotas discrepantes:       ${totalCuotasDisc}`);
  console.log(`  Por estado:`);
  for (const [estado, count] of Object.entries(conteoPorEstado)) {
    console.log(`    ${estado}: ${count}`);
  }
  console.log(`Reporte: ${REPORTE_FILE}`);
}

comparar().catch(e => { console.error(e); pool.end(); });
