import axios from 'axios';
import { ContractType } from './types/contract';

/**
 * Script de prueba para generar un contrato de uso de carro usado
 */

const API_URL = 'http://localhost:4000';

// Datos de prueba - CASO MASCULINO
const testDataMale = {
  contractType: ContractType.USO_CARRO_USADO,
  data: {
    // Fecha del contrato
    contract_day: '28',
    contract_month: 'octubre',
    contract_year: 'veinticinco',

    // Datos del cliente
    client_name: 'JUAN CARLOS LÓPEZ GARCÍA',
    client_age: 'treinta y cinco',
    client_gender: 'male',
    client_marital_status: 'single',
    client_occupation: 'comerciante',
    client_nationality: 'guatemalteco',
    client_degree: 'Licenciado en Administración de Empresas', // Opcional
    client_cui: '2345 67890 1234',

    // Datos del vehículo
    vehicle_type: 'Automóvil',
    vehicle_brand: 'Toyota',
    vehicle_model: '2020',
    vehicle_color: 'Blanco',
    vehicle_use: 'Particular',
    vehicle_chassis: 'JTDKB20U567890123',
    vehicle_fuel: 'Gasolina',
    vehicle_motor: '4GRFSE789456',
    vehicle_series: 'COROLLA-2020-WHT',
    vehicle_line: 'Corolla GLI',
    vehicle_cc: '1800',
    vehicle_seats: '5',
    vehicle_cylinders: '4',
    vehicle_iscv: 'ISCV-2020-001234',

    // Plazo de uso
    user_name: 'JUAN CARLOS LÓPEZ GARCÍA',
    contract_duration_months: 'veinticuatro',
    contract_start_date: 'primero de noviembre del año dos mil veinticinco',
    contract_end_day: '31',
    contract_end_month: 'octubre',
    contract_end_year: 'veintisiete',

    // Nombres repetidos en cláusulas
    user_name_clause_a: 'JUAN CARLOS LÓPEZ GARCÍA',
    user_name_clause_a2: 'JUAN CARLOS LÓPEZ GARCÍA',
    user_name_clause_b: 'JUAN CARLOS LÓPEZ GARCÍA',
    user_name_clause_d: 'JUAN CARLOS LÓPEZ GARCÍA',
    user_name_final: 'JUAN CARLOS LÓPEZ GARCÍA',

    // Dirección
    client_address: '15 Avenida 10-25 Zona 10, Ciudad de Guatemala'
  },
  options: {
    generatePdf: true,
    filenamePrefix: 'contrato_juan_lopez'
  }
};

// Datos de prueba - CASO FEMENINO
const testDataFemale = {
  contractType: ContractType.USO_CARRO_USADO,
  data: {
    // Fecha del contrato
    contract_day: '15',
    contract_month: 'noviembre',
    contract_year: 'veinticinco',

    // Datos del cliente
    client_name: 'MARÍA FERNANDA GARCÍA PÉREZ',
    client_age: 'cuarenta y dos',
    client_gender: 'female',
    client_marital_status: 'married',
    client_occupation: 'ingeniera',
    client_nationality: 'guatemalteca',
    client_degree: 'Ingeniera Civil', // Opcional
    client_cui: '3456 78901 2345',

    // Datos del vehículo
    vehicle_type: 'SUV',
    vehicle_brand: 'Honda',
    vehicle_model: '2021',
    vehicle_color: 'Gris',
    vehicle_use: 'Particular',
    vehicle_chassis: 'JHLRE38H8YC123456',
    vehicle_fuel: 'Gasolina',
    vehicle_motor: 'K24A789012',
    vehicle_series: 'CRV-2021-GRY',
    vehicle_line: 'CR-V EX',
    vehicle_cc: '2400',
    vehicle_seats: '5',
    vehicle_cylinders: '4',
    vehicle_iscv: 'ISCV-2021-005678',

    // Plazo de uso
    user_name: 'MARÍA FERNANDA GARCÍA PÉREZ',
    contract_duration_months: 'treinta y seis',
    contract_start_date: 'primero de diciembre del año dos mil veinticinco',
    contract_end_day: '30',
    contract_end_month: 'noviembre',
    contract_end_year: 'veintiocho',

    // Nombres repetidos en cláusulas
    user_name_clause_a: 'MARÍA FERNANDA GARCÍA PÉREZ',
    user_name_clause_a2: 'MARÍA FERNANDA GARCÍA PÉREZ',
    user_name_clause_b: 'MARÍA FERNANDA GARCÍA PÉREZ',
    user_name_clause_d: 'MARÍA FERNANDA GARCÍA PÉREZ',
    user_name_final: 'MARÍA FERNANDA GARCÍA PÉREZ',

    // Dirección
    client_address: '7a Avenida 12-34 Zona 14, Ciudad de Guatemala'
  },
  options: {
    generatePdf: true,
    filenamePrefix: 'contrato_maria_garcia'
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
    console.log('🧪 Iniciando prueba de generación de contratos con género dinámico...\n');

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
    const maleSuccess = await testSingleContract(testDataMale, '👨 CASO MASCULINO: Juan Carlos López García');

    // 4. Probar contrato femenino
    console.log('\n4️⃣ Generando contrato FEMENINO...');
    const femaleSuccess = await testSingleContract(testDataFemale, '👩 CASO FEMENINO: María Fernanda García Pérez');

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
console.log('║  🧪 Test: Generación de Contratos con Género Dinámico    ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

testContractGeneration();
