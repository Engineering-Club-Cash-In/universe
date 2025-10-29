import axios from 'axios';
import { ContractType } from './types/contract';

/**
 * Script de prueba para generar contratos de garantía mobiliaria
 * con soporte de género dinámico
 */

const API_URL = 'http://localhost:4000';

// Datos de prueba - CASO MASCULINO
const testDataMale = {
  contractType: ContractType.GARANTIA_MOBILIARIA,
  data: {
    // Fecha del contrato
    contract_day: '28',
    contract_month: 'octubre',
    contract_year: 'dos mil veinticinco',

    // Datos del deudor/deudor garante/depositario (misma persona)
    debtor_name: 'PEDRO RAMÍREZ GONZÁLEZ',
    debtor_age: 'cuarenta',
    andres_age: 'cuarenta y cinco',
    debtor_gender: 'male',
    debtor_marital_status: 'single',
    debtor_occupation: 'comerciante',
    debtor_nationality: 'guatemalteco',
    debtor_degree: 'Licenciado en Contaduría Pública',
    debtor_cui: '2345 67890 1234',
    debtor_address: '5ta Calle 10-25 Zona 1, Ciudad de Guatemala',
    debtor_email: 'pedro.ramirez@example.com',

    // Datos de la deuda original
    original_debt_date: 'quince de enero del año dos mil veinticinco',
    original_debt_amount_text: 'cincuenta mil quetzales',
    original_debt_amount_number: 'Q.50,000.00',

    // Datos de la garantía
    guarantee_duration_months: 'veinticuatro',
    guarantee_end_date_day: '28',
    guarantee_end_date_month: 'octubre',
    guarantee_end_date_year: 'veintisiete',
    guaranteed_amount_text: 'sesenta mil quetzales',
    guaranteed_amount_number: 'Q.60,000.00',

    // Datos del vehículo en garantía
    vehicle_type: 'Automóvil',
    vehicle_brand: 'Toyota',
    vehicle_line: 'Corolla GLI',
    vehicle_model: '2020',
    vehicle_color: 'Blanco',
    vehicle_plate: 'P-123ABC',
    vehicle_chassis: 'JTDKB20U567890123',
    vehicle_motor: '4GRFSE789456',
    vehicle_fuel: 'Gasolina',
    vehicle_cc: '1800',
    vehicle_cylinders: '4',
    vehicle_seats: '5',
    vehicle_doors: '4',
    vehicle_axles: '2',
    vehicle_use: 'Particular',
    vehicle_series: 'COROLLA-2020-WHT',
    vehicle_iscv: 'ISCV-2020-001234',
    vehicle_estimated_value_text: 'ochenta mil quetzales',
    vehicle_estimated_value_number: 'Q.80,000.00'
  },
  options: {
    generatePdf: true,
    filenamePrefix: 'garantia_pedro_ramirez'
  }
};

// Datos de prueba - CASO FEMENINO
const testDataFemale = {
  contractType: ContractType.GARANTIA_MOBILIARIA,
  data: {
    // Fecha del contrato
    contract_day: '15',
    contract_month: 'noviembre',
    contract_year: 'dos mil veinticinco',

    // Datos del deudor/deudor garante/depositario (misma persona)
    debtor_name: 'ANA MARÍA GONZÁLEZ LÓPEZ',
    debtor_age: 'treinta y ocho',
    andres_age: 'cuarenta y cinco',
    debtor_gender: 'female',
    debtor_marital_status: 'married',
    debtor_occupation: 'ingeniera',
    debtor_nationality: 'guatemalteca',
    debtor_degree: 'Ingeniera Civil',
    debtor_cui: '3456 78901 2345',
    debtor_address: '7a Avenida 12-34 Zona 14, Ciudad de Guatemala',
    debtor_email: 'ana.gonzalez@example.com',

    // Datos de la deuda original
    original_debt_date: 'primero de febrero del año dos mil veinticinco',
    original_debt_amount_text: 'setenta y cinco mil quetzales',
    original_debt_amount_number: 'Q.75,000.00',

    // Datos de la garantía
    guarantee_duration_months: 'treinta y seis',
    guarantee_end_date_day: '15',
    guarantee_end_date_month: 'noviembre',
    guarantee_end_date_year: 'veintiocho',
    guaranteed_amount_text: 'noventa mil quetzales',
    guaranteed_amount_number: 'Q.90,000.00',

    // Datos del vehículo en garantía
    vehicle_type: 'SUV',
    vehicle_brand: 'Honda',
    vehicle_line: 'CR-V EX',
    vehicle_model: '2021',
    vehicle_color: 'Gris',
    vehicle_plate: 'P-456DEF',
    vehicle_chassis: 'JHLRE38H8YC123456',
    vehicle_motor: 'K24A789012',
    vehicle_fuel: 'Gasolina',
    vehicle_cc: '2400',
    vehicle_cylinders: '4',
    vehicle_seats: '5',
    vehicle_doors: '5',
    vehicle_axles: '2',
    vehicle_use: 'Particular',
    vehicle_series: 'CRV-2021-GRY',
    vehicle_iscv: 'ISCV-2021-005678',
    vehicle_estimated_value_text: 'ciento veinte mil quetzales',
    vehicle_estimated_value_number: 'Q.120,000.00'
  },
  options: {
    generatePdf: true,
    filenamePrefix: 'garantia_ana_gonzalez'
  }
};

async function testSingleContract(testData: any, testName: string) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${testName}`);
  console.log('='.repeat(70));

  console.log('Datos:', JSON.stringify(testData, null, 2));
  console.log();

  const generateResponse = await axios.post(
    `${API_URL}/generatecontrato`,
    testData
  );

  console.log('✅ RESULTADO:');
  console.log(JSON.stringify(generateResponse.data, null, 2));

  if (generateResponse.data.success) {
    console.log('\n🎉 ¡Contrato generado exitosamente!');
    console.log('📄 DOCX:', generateResponse.data.docx_path);
    console.log('📄 PDF:', generateResponse.data.pdf_path);
    return true;
  } else {
    console.error('\n❌ Error:', generateResponse.data.error);
    return false;
  }
}

async function testContractGeneration() {
  try {
    console.log('🧪 Iniciando prueba de generación de contratos de garantía mobiliaria...\n');

    // 1. Verificar que el servidor esté activo
    console.log('1️⃣ Verificando servidor...');
    const healthResponse = await axios.get(`${API_URL}/health`);
    console.log('✓ Servidor activo:', healthResponse.data);
    console.log();

    // 2. Listar contratos disponibles
    console.log('2️⃣ Listando tipos de contratos disponibles...');
    const typesResponse = await axios.get(`${API_URL}/contracts/types`);
    console.log('✓ Contratos disponibles:', typesResponse.data);
    console.log();

    // 3. Probar contrato masculino
    console.log('3️⃣ Generando contrato MASCULINO...');
    const maleSuccess = await testSingleContract(testDataMale, '👨 CASO MASCULINO: Pedro Ramírez González');

    // 4. Probar contrato femenino
    console.log('\n4️⃣ Generando contrato FEMENINO...');
    const femaleSuccess = await testSingleContract(testDataFemale, '👩 CASO FEMENINO: Ana María González López');

    // Resumen
    console.log('\n' + '='.repeat(70));
    console.log('  RESUMEN DE PRUEBAS');
    console.log('='.repeat(70));
    console.log(`Caso Masculino: ${maleSuccess ? '✅ ÉXITO' : '❌ FALLO'}`);
    console.log(`Caso Femenino:  ${femaleSuccess ? '✅ ÉXITO' : '❌ FALLO'}`);
    console.log('='.repeat(70));

  } catch (error: any) {
    console.error('\n❌ Error en la prueba:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error(error.message);
    }

    if (error.code === 'ECONNREFUSED') {
      console.error('\n⚠️  El servidor no está corriendo. Ejecuta: bun run dev');
    }
  }
}

// Ejecutar prueba
console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║  🧪 Test: Garantía Mobiliaria con Género Dinámico        ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

testContractGeneration();
