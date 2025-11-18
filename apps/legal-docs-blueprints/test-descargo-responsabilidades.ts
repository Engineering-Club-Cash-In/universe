import axios from 'axios';
import { ContractType } from './types/contract';

/**
 * Script de prueba para generar descargo de responsabilidades
 */

const API_URL = 'http://localhost:4000';

// Datos de prueba
const testData = {
  contractType: ContractType.DESCARGO_RESPONSABILIDADES,
  data: {
    // Fecha del documento
    date_day: '28',
    date_month: 'octubre',
    date_year: 'veinticinco', // Solo la parte después de "dos mil"

    // Datos del deudor
    debtor_name: 'CARLOS ALBERTO MENDEZ LOPEZ',
    debtor_dpi_letters: 'DOS MIL QUINIENTOS CUARENTA Y CINCO',
    debtor_dpi_number: '2545 67890 1234',

    // Datos del vehículo
    vehicle_type: 'Automóvil',
    vehicle_brand: 'Honda',
    vehicle_color: 'Gris',
    vehicle_use: 'Particular',
    vehicle_chassis: 'JHMCM56557C404453',
    vehicle_fuel: 'Gasolina',
    vehicle_engine: 'K20A4-1234567',
    vehicle_series: 'CIVIC-2022-GRY',
    vehicle_line: 'Civic LX',
    vehicle_model: '2022',
    vehicle_cc: '2000',
    vehicle_seats: '5',
    vehicle_cylinders: '4',
    vehicle_iscv: 'ISCV-2022-004567'
  },
  options: {
    generatePdf: true,
    filenamePrefix: 'descargo_carlos_mendez'
  }
};

async function testDescargoResponsabilidades() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  🧪 Test: Descargo de Responsabilidades                   ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  console.log('🧪 Iniciando prueba de generación de descargo de responsabilidades...\n');

  try {
    // 1. Verificar servidor
    console.log('1️⃣ Verificando servidor...');
    const healthCheck = await axios.get(`${API_URL}/health`);
    console.log('✓ Servidor activo:', JSON.stringify(healthCheck.data, null, 2));

    // 2. Generar descargo
    console.log('\n2️⃣ Generando descargo de responsabilidades...\n');
    console.log('=' .repeat(70));
    console.log('  📄 DESCARGO RESPONSABILIDADES: Carlos Alberto Mendez Lopez');
    console.log('='.repeat(70));

    console.log('Datos:', JSON.stringify(testData, null, 2));
    console.log();

    const generateResponse = await axios.post(`${API_URL}/generatecontrato`, testData);

    console.log('✅ RESULTADO:');
    console.log(JSON.stringify(generateResponse.data, null, 2));
    console.log('\n🎉 ¡Descargo generado exitosamente!');
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
testDescargoResponsabilidades()
  .then(() => {
    console.log('\n✅ Test completado exitosamente\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test falló:', error.message);
    process.exit(1);
  });
