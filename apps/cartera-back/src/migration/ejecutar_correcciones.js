const fs = require('fs');
const path = require('path');

const REPORTE_PATH = path.join(__dirname, 'discrepancias_reporte.json');
const COMENTARIOS_PATH = path.join(__dirname, 'reporteCreditos_comentarios.json');
const BASE_URL = 'http://localhost:9000/payments/marcar-cuotas';
const DELAY_MS = 5000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ejecutar() {
  const data = JSON.parse(fs.readFileSync(REPORTE_PATH, 'utf-8'));
  const comentarios = JSON.parse(fs.readFileSync(COMENTARIOS_PATH, 'utf-8'));
  const comentariosSifco = new Set(comentarios.map(c => c.numeroPrestamo));

  const allItems = data.discrepancias_cuotas || [];
  const ignorados = allItems.filter(item => comentariosSifco.has(item.sifco_base));
  const items = allItems.filter(item => !comentariosSifco.has(item.sifco_base));

  console.log(`Total discrepancias: ${allItems.length}`);
  console.log(`Ignorados (en comentarios): ${ignorados.length}`);
  console.log(`A procesar: ${items.length}`);
  console.log('='.repeat(60));

  // Guardar ignorados
  if (ignorados.length > 0) {
    const ignoradosPath = path.join(__dirname, 'correcciones_ignorados.json');
    fs.writeFileSync(ignoradosPath, JSON.stringify(ignorados, null, 2), 'utf-8');
    console.log(`Ignorados guardados en: ${ignoradosPath}`);
  }

  let exitosos = 0;
  let fallidos = 0;
  const errores = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const sifco = item.sifco_base;

    const body = {
      numero_credito_sifco: sifco,
    };

    // Cuota: solo si no coinciden, mandar la del ETL
    if (!item.cuotas_coinciden) {
      body.hasta_cuota = item.cuota_etl;
    }

    // Capital: solo si no coincide en entero
    if (!item.capital_coincide) {
      body.updateCapital = Math.round(item.capital_total_etl * 100) / 100;
    }

    // Inversionistas: siempre mandar con capitalUltimoPago redondeado a 2 decimales
    if (item.inversionistas && item.inversionistas.length > 0) {
      body.inversionistas = item.inversionistas.map(inv => ({
        nombre: inv.inversionista,
        capital: Math.round(parseFloat(inv.capitalUltimoPago) * 100) / 100,
      }));
    }

    console.log(`\n[${i + 1}/${items.length}] ${sifco} - ${item.nombre_etl}`);
    console.log(`  Body:`, JSON.stringify(body));

    try {
      const res = await fetch(BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await res.json();

      if (res.ok && result.success) {
        console.log(`  ✅ OK`);
        exitosos++;
      } else {
        console.log(`  ❌ Error: ${result.message || res.status}`);
        fallidos++;
        errores.push({ sifco, payload: body, error: result.message || `HTTP ${res.status}` });
      }
    } catch (err) {
      console.log(`  ❌ Error de red: ${err.message}`);
      fallidos++;
      errores.push({ sifco, payload: body, error: err.message });
    }

    if (i < items.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Resumen:`);
  console.log(`  Exitosos: ${exitosos}`);
  console.log(`  Fallidos: ${fallidos}`);

  if (errores.length > 0) {
    const errorPath = path.join(__dirname, 'correcciones_errores.json');
    fs.writeFileSync(errorPath, JSON.stringify(errores, null, 2), 'utf-8');
    console.log(`  Errores guardados en: ${errorPath}`);
  }
}

ejecutar().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
