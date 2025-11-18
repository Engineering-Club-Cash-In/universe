import axios from 'axios';
import { ContractType } from './types/contract';

const API_URL = 'http://localhost:4000';

// ===== CASO 1: VENDEDOR MASCULINO =====
const testDataMale = {
  contractType: ContractType.DECLARACION_DE_VENDEDOR,
  data: {
    // Fecha del documento
    date_day: '29',
    date_month: 'octubre',
    date_year_letters: 'veinticinco',

    // Datos del vendedor (masculino)
    debtor_name: 'CARLOS ALBERTO MENDEZ LOPEZ',
    debtor_dpi_letters: 'DOS MIL QUINIENTOS CUARENTA Y CINCO',
    debtor_dpi_numbers: '2545 67890 1234',
    gender_letter: 'o', // Masculino: identificado, legítimo, único, dueño, propietario

    // Datos del vehículo
    vehicle_type: 'Automóvil',
    vehicle_brand: 'Toyota',
    vehicle_color: 'Blanco',
    vehicle_usage: 'Particular',
    vehicle_chassis: 'JTDKB20U567890123',
    vehicle_fuel: 'Gasolina',
    vehicle_engine: '4GRFSE789456',
    vehicle_series: 'COROLLA-2020',
    vehicle_line: 'Corolla GLI',
    vehicle_model: '2020',
    vehicle_cc: '1800',
    vehicle_seats: '5',
    vehicle_cylinders: '4',
    vehicle_iscv: 'ISCV-2020-001234'
  },
  options: {
    generatePdf: true,
    filenamePrefix: 'declaracion_vendedor_carlos_mendez'
  }
};

// ===== CASO 2: VENDEDORA FEMENINA =====
const testDataFemale = {
  contractType: ContractType.DECLARACION_DE_VENDEDOR,
  data: {
    // Fecha del documento
    date_day: '29',
    date_month: 'octubre',
    date_year_letters: 'veinticinco',

    // Datos de la vendedora (femenino)
    debtor_name: 'MARIA FERNANDA RAMIREZ GONZALEZ',
    debtor_dpi_letters: 'TRES MIL DOSCIENTOS OCHENTA Y NUEVE',
    debtor_dpi_numbers: '3289 45678 9012',
    gender_letter: 'a', // Femenino: identificada, legítima, única, dueña, propietaria

    // Datos del vehículo
    vehicle_type: 'Pickup',
    vehicle_brand: 'Nissan',
    vehicle_color: 'Rojo',
    vehicle_usage: 'Comercial',
    vehicle_chassis: 'JN1TANT31Z0123456',
    vehicle_fuel: 'Diésel',
    vehicle_engine: 'YD25DDTi456789',
    vehicle_series: 'FRONTIER-2021',
    vehicle_line: 'Frontier SE',
    vehicle_model: '2021',
    vehicle_cc: '2500',
    vehicle_seats: '5',
    vehicle_cylinders: '4',
    vehicle_iscv: 'ISCV-2021-005678'
  },
  options: {
    generatePdf: true,
    filenamePrefix: 'declaracion_vendedor_maria_ramirez'
  }
};

/**
 * Función de test principal
 */
async function testDeclaracionVendedor() {
  console.log('🧪 INICIANDO PRUEBAS: Declaración de Vendedor\n');
  console.log('═'.repeat(60));

  try {
    // Verificar que el servidor esté activo
    console.log('⏳ Verificando servidor...');
    const healthCheck = await axios.get(`${API_URL}/health`);
    console.log('✓ Servidor activo\n');

    // ===== PRUEBA 1: VENDEDOR MASCULINO =====
    console.log('📋 PRUEBA 1: Vendedor Masculino (gender_letter: "o")');
    console.log('─'.repeat(60));
    console.log(`Vendedor: ${testDataMale.data.debtor_name}`);
    console.log(`DPI: ${testDataMale.data.debtor_dpi_numbers}`);
    console.log(`Vehículo: ${testDataMale.data.vehicle_brand} ${testDataMale.data.vehicle_line}`);
    console.log(`Modelo: ${testDataMale.data.vehicle_model}\n`);

    const resultMale = await axios.post(
      `${API_URL}/generatecontrato`,
      testDataMale
    );

    console.log('✅ RESULTADO MASCULINO:');
    console.log(JSON.stringify(resultMale.data, null, 2));
    console.log('\n📄 Archivos generados:');
    console.log(`   DOCX: ${resultMale.data.docx_path}`);
    console.log(`   PDF:  ${resultMale.data.pdf_path}\n`);

    // ===== PRUEBA 2: VENDEDORA FEMENINA =====
    console.log('═'.repeat(60));
    console.log('📋 PRUEBA 2: Vendedora Femenina (gender_letter: "a")');
    console.log('─'.repeat(60));
    console.log(`Vendedora: ${testDataFemale.data.debtor_name}`);
    console.log(`DPI: ${testDataFemale.data.debtor_dpi_numbers}`);
    console.log(`Vehículo: ${testDataFemale.data.vehicle_brand} ${testDataFemale.data.vehicle_line}`);
    console.log(`Modelo: ${testDataFemale.data.vehicle_model}\n`);

    const resultFemale = await axios.post(
      `${API_URL}/generatecontrato`,
      testDataFemale
    );

    console.log('✅ RESULTADO FEMENINO:');
    console.log(JSON.stringify(resultFemale.data, null, 2));
    console.log('\n📄 Archivos generados:');
    console.log(`   DOCX: ${resultFemale.data.docx_path}`);
    console.log(`   PDF:  ${resultFemale.data.pdf_path}\n`);

    // ===== RESUMEN FINAL =====
    console.log('═'.repeat(60));
    console.log('✅ TODAS LAS PRUEBAS COMPLETADAS EXITOSAMENTE');
    console.log('═'.repeat(60));
    console.log('📊 Resumen:');
    console.log(`   • 2 declaraciones generadas`);
    console.log(`   • Caso masculino: ✓`);
    console.log(`   • Caso femenino: ✓`);
    console.log('');

  } catch (error: any) {
    console.error('\n❌ ERROR EN LA PRUEBA:');
    console.error('═'.repeat(60));

    if (error.response) {
      console.error('Código de estado:', error.response.status);
      console.error('Respuesta del servidor:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('No se recibió respuesta del servidor');
      console.error('¿Está el servidor corriendo en', API_URL, '?');
    } else {
      console.error('Error:', error.message);
    }

    console.error('\n🔍 Stack trace:');
    console.error(error.stack);
  }
}

// Ejecutar las pruebas
testDeclaracionVendedor();
