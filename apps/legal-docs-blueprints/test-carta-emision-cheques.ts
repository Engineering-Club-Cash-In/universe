import axios from 'axios';
import { ContractType } from './types/contract';

/**
 * Script de prueba para generar carta de emisión de cheques
 */

const API_URL = 'http://localhost:4000';

// Datos de prueba
const testData = {
  contractType: ContractType.CARTA_EMISION_CHEQUES,
  data: {
    // Fecha del documento
    document_day: '23',
    document_month: 'octubre',
    document_year: '25',

    // Fecha del contrato original
    original_contract_day: '15',
    original_contract_month: 'enero',
    original_contract_year: 'veinticinco',

    // Partes
    creditor_name: 'CREDITO CAPITALES IMMOBILIARIS, SOCIEDAD ANÓNIMA',
    debtor_name: 'JUAN RAMIRO MORALES PINEDA',
    debtor_dpi: '2345 67890 1234',

    // Montos y cuenta
    disbursement_amount_text: 'CIENTO CUARENTA Y SEIS MIL NOVECIENTOS SETENTA QUETZALES CON SESENTA CENTAVOS (Q.146,970.60)',
    disbursement_amount_number: '146,970.60',

    // Beneficiarios (tabla con múltiples filas)
    beneficiarios: [
      {
        account_or_beneficiary: '3001234567',
        amount: '146,970.60'
      }
    ]
  },
  options: {
    generatePdf: true,
    filenamePrefix: 'carta_cheques_juan_morales'
  }
};

async function testCartaEmisionCheques() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  🧪 Test: Carta de Emisión de Cheques                     ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  console.log('🧪 Iniciando prueba de generación de carta de emisión de cheques...\n');

  try {
    // 1. Verificar servidor
    console.log('1️⃣ Verificando servidor...');
    const healthCheck = await axios.get(`${API_URL}/health`);
    console.log('✓ Servidor activo:', JSON.stringify(healthCheck.data, null, 2));

    // 2. Generar carta
    console.log('\n3️⃣ Generando carta de emisión de cheques...\n');
    console.log('=' .repeat(70));
    console.log('  📄 CARTA EMISIÓN DE CHEQUES: Juan Ramiro Morales Pineda');
    console.log('='.repeat(70));

    console.log('Datos:', JSON.stringify(testData, null, 2));
    console.log();

    const generateResponse = await axios.post(`${API_URL}/generatecontrato`, testData);

    console.log('✅ RESULTADO:');
    console.log(JSON.stringify(generateResponse.data, null, 2));
    console.log('\n🎉 ¡Carta generada exitosamente!');
    console.log(`📄 DOCX: ${generateResponse.data.docx_path}`);
    console.log(`📄 PDF: ${generateResponse.data.pdf_path}`);

    console.log('\n' + '='.repeat(70));
    console.log('  RESUMEN DE PRUEBA');
    console.log('='.repeat(70));
    console.log('Resultado: ✅ ÉXITO');
    console.log('='.repeat(70));

  } catch (error: any) {
    console.error('\n❌ ERROR durante la prueba:');

    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('No se recibió respuesta del servidor');
      console.error('¿Está corriendo el servidor en', API_URL, '?');
    } else {
      console.error('Error:', error.message);
    }

    process.exit(1);
  }
}

// Ejecutar test
testCartaEmisionCheques()
  .then(() => {
    console.log('\n✅ Test completado exitosamente\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test falló:', error.message);
    process.exit(1);
  });
