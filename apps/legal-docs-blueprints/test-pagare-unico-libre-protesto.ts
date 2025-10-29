import axios from 'axios';
import { ContractType } from './types/contract';

/**
 * Script de prueba para generar pagaré único libre de protesto
 */

const API_URL = 'http://localhost:4000';

// Datos de prueba
const testData = {
  contractType: ContractType.PAGARE_UNICO_LIBRE_PROTESTO,
  data: {
    // Fecha del documento
    date_day: '28',
    date_month: 'octubre',
    date_year: '25',

    // Valor nominal
    nominal_value_letters: 'CINCUENTA MIL QUETZALES',
    nominal_value_numbers: 'Q.50,000.00',

    // Datos del deudor
    debtor_name: 'CARLOS EDUARDO RAMIREZ MONTENEGRO',
    debtor_age_letters: 'treinta y cinco',
    debtor_civil_status: 'soltero',
    debtor_occupation: 'comerciante',
    debtor_nationality: 'guatemalteco',
    debtors_dpi_letters: 'DOS TRES CUATRO CINCO SEIS SIETE OCHO NUEVE CERO UNO DOS TRES CUATRO',
    debtors_dpi_numbers: '2345 67890 1234',
    debtors_address: '5a Avenida 12-34 Zona 10, Ciudad de Guatemala',

    // Fecha de vencimiento
    due_date_day: '28',
    due_date_month: 'diciembre',
    due_date_year: 'dos mil veintiséis',

    // Pagos
    payment_value_letters: 'DOS MIL QUINIENTOS QUETZALES',
    payment_value_numbers: 'Q.2,500.00',
    payment_date_day: '15'
  },
  options: {
    generatePdf: true,
    filenamePrefix: 'pagare_carlos_ramirez'
  }
};

async function testPagareUnicoLibreProtesto() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  🧪 Test: Pagaré Único Libre de Protesto                  ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  console.log('🧪 Iniciando prueba de generación de pagaré único libre de protesto...\n');

  try {
    // 1. Verificar servidor
    console.log('1️⃣ Verificando servidor...');
    const healthCheck = await axios.get(`${API_URL}/health`);
    console.log('✓ Servidor activo:', JSON.stringify(healthCheck.data, null, 2));

    // 2. Generar pagaré
    console.log('\n2️⃣ Generando pagaré único libre de protesto...\n');
    console.log('=' .repeat(70));
    console.log('  📄 PAGARÉ: Carlos Eduardo Ramirez Montenegro');
    console.log('='.repeat(70));

    console.log('Datos:', JSON.stringify(testData, null, 2));
    console.log();

    const generateResponse = await axios.post(`${API_URL}/generatecontrato`, testData);

    console.log('✅ RESULTADO:');
    console.log(JSON.stringify(generateResponse.data, null, 2));
    console.log('\n🎉 ¡Pagaré generado exitosamente!');
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
testPagareUnicoLibreProtesto()
  .then(() => {
    console.log('\n✅ Test completado exitosamente\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test falló:', error.message);
    process.exit(1);
  });
