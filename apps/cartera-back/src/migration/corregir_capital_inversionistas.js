const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, 'capital_vs_inversionistas.json');
const BASE_URL = 'http://localhost:9000/marcar-cuotas';
const DELAY_MS = 5000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ejecutar() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  const items = data.discrepancias.filter(d => d.inversionistas && d.capital_etl !== null);

  console.log(`Total a procesar: ${items.length}`);
  console.log('='.repeat(60));

  let exitosos = 0;
  let fallidos = 0;
  const errores = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    const body = {
      numero_credito_sifco: item.numero_credito_sifco,
    };

    // Capital: solo si ETL y DB difieren por entero
    if (Math.trunc(item.capital_etl) !== Math.trunc(item.capital_credito)) {
      body.updateCapital = Math.round(item.capital_etl * 100) / 100;
    }

    // Inversionistas: siempre
    body.inversionistas = item.inversionistas.map(inv => ({
      nombre: inv.inversionista,
      capital: Math.round(parseFloat(inv.capitalUltimoPago) * 100) / 100,
    }));

    console.log(`\n[${i + 1}/${items.length}] ${item.numero_credito_sifco} - ${item.nombre_cliente}`);
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
        errores.push({ sifco: item.numero_credito_sifco, payload: body, error: result.message || `HTTP ${res.status}` });
      }
    } catch (err) {
      console.log(`  ❌ Error de red: ${err.message}`);
      fallidos++;
      errores.push({ sifco: item.numero_credito_sifco, payload: body, error: err.message });
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
    const errorPath = path.join(__dirname, 'correccion_capital_errores.json');
    fs.writeFileSync(errorPath, JSON.stringify(errores, null, 2), 'utf-8');
    console.log(`  Errores guardados en: ${errorPath}`);
  }
}

ejecutar().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
