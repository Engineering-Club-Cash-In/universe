import axios from 'axios';
import { ContractType } from './types/contract';

const API_URL = 'http://localhost:4000';

// ===== CASO 1: MASCULINO =====
const testDataMale = {
  contractType: ContractType.CARTA_CARRO_NUEVO,
  data: {
    // Fecha del documento
    date_day: '29',
    date_month: 'octubre',
    date_year_numbers: '25', // Formato corto: "25" para 2025

    // Datos del deudor (masculino)
    debtor_name: 'JUAN CARLOS RAMIREZ LOPEZ',
    debtor_dpi_letters: 'UN MIL OCHOCIENTOS NOVENTA Y DOS',
    debtor_dpi_numbers: '1892 34567 8901',
    gender_letter: 'o', // Masculino: identificado

    // Datos del vehículo nuevo
    vehicle_type: 'Automóvil',
    vehicle_brand: 'Honda',
    vehicle_color: 'Gris',
    vehicle_usage: 'Particular',
    vehicle_chassis: '1HGCM82633A123456',
    vehicle_fuel: 'Gasolina',
    vehicle_engine: 'K20C1-456789',
    vehicle_series: 'CIVIC-2025',
    vehicle_line: 'Civic EX',
    vehicle_model: '2025',
    vehicle_cc: '2000',
    vehicle_seats: '5',
    vehicle_cylinders: '4',
    vehicle_iscv: 'ISCV-2025-001234',

    // Datos de la empresa
    business_name: 'Cube Investments, S.A.'
  },
  options: {
    generatePdf: true,
    filenamePrefix: 'carta_carro_nuevo_juan_ramirez'
  }
};

// ===== CASO 2: FEMENINO =====
const testDataFemale = {
  contractType: ContractType.CARTA_CARRO_NUEVO,
  data: {
    // Fecha del documento
    date_day: '29',
    date_month: 'octubre',
    date_year_numbers: '25', // Formato corto: "25" para 2025

    // Datos de la deudora (femenino)
    debtor_name: 'ANA PATRICIA GONZALEZ MARTINEZ',
    debtor_dpi_letters: 'DOS MIL TRESCIENTOS CUARENTA Y CINCO',
    debtor_dpi_numbers: '2345 67890 1234',
    gender_letter: 'a', // Femenino: identificada

    // Datos del vehículo nuevo
    vehicle_type: 'SUV',
    vehicle_brand: 'Mazda',
    vehicle_color: 'Blanco',
    vehicle_usage: 'Particular',
    vehicle_chassis: 'JM3KFBDM5M0123456',
    vehicle_fuel: 'Híbrido',
    vehicle_engine: 'SKYACTIV-G789456',
    vehicle_series: 'CX-5-2025',
    vehicle_line: 'CX-5 Turbo',
    vehicle_model: '2025',
    vehicle_cc: '2500',
    vehicle_seats: '5',
    vehicle_cylinders: '4',
    vehicle_iscv: 'ISCV-2025-005678',

    // Datos de la empresa
    business_name: 'Cube Investments, S.A.'
  },
  options: {
    generatePdf: true,
    filenamePrefix: 'carta_carro_nuevo_ana_gonzalez'
  }
};

/**
 * Función de test principal
 */
async function testCartaCarroNuevo() {
  console.log('🧪 INICIANDO PRUEBAS: Carta Carro Nuevo\n');
  console.log('═'.repeat(60));

  try {
    // Verificar que el servidor esté activo
    console.log('⏳ Verificando servidor...');
    const healthCheck = await axios.get(`${API_URL}/health`);
    console.log('✓ Servidor activo\n');

    // ===== PRUEBA 1: MASCULINO =====
    console.log('📋 PRUEBA 1: Deudor Masculino (gender_letter: "o")');
    console.log('─'.repeat(60));
    console.log(`Deudor: ${testDataMale.data.debtor_name}`);
    console.log(`DPI: ${testDataMale.data.debtor_dpi_numbers}`);
    console.log(`Vehículo: ${testDataMale.data.vehicle_brand} ${testDataMale.data.vehicle_line}`);
    console.log(`Modelo: ${testDataMale.data.vehicle_model}`);
    console.log(`Empresa: ${testDataMale.data.business_name}\n`);

    const resultMale = await axios.post(
      `${API_URL}/generatecontrato`,
      testDataMale
    );

    console.log('✅ RESULTADO MASCULINO:');
    console.log(JSON.stringify(resultMale.data, null, 2));
    console.log('\n📄 Archivos generados:');
    console.log(`   DOCX: ${resultMale.data.docx_path}`);
    console.log(`   PDF:  ${resultMale.data.pdf_path}\n`);

    // ===== PRUEBA 2: FEMENINO =====
    console.log('═'.repeat(60));
    console.log('📋 PRUEBA 2: Deudora Femenina (gender_letter: "a")');
    console.log('─'.repeat(60));
    console.log(`Deudora: ${testDataFemale.data.debtor_name}`);
    console.log(`DPI: ${testDataFemale.data.debtor_dpi_numbers}`);
    console.log(`Vehículo: ${testDataFemale.data.vehicle_brand} ${testDataFemale.data.vehicle_line}`);
    console.log(`Modelo: ${testDataFemale.data.vehicle_model}`);
    console.log(`Empresa: ${testDataFemale.data.business_name}\n`);

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
    console.log(`   • 2 cartas generadas`);
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
testCartaCarroNuevo();
