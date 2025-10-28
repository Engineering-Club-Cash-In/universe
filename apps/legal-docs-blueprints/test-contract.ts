import axios from 'axios';
import { ContractType } from './types/contract';

/**
 * Script de prueba para generar un contrato de uso de carro usado
 */

const API_URL = 'http://localhost:4000';

// Datos de prueba
const testData = {
  contractType: ContractType.USO_CARRO_USADO,
  data: {
    // Fecha del contrato
    contract_day: '28',
    contract_month: 'octubre',
    contract_year: 'veinticinco',

    // Datos del cliente
    client_name: 'JUAN CARLOS LÓPEZ GARCÍA',
    client_age: 'treinta y cinco',
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

async function testContractGeneration() {
  try {
    console.log('🧪 Iniciando prueba de generación de contrato...\n');

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

    // 3. Generar contrato
    console.log('3️⃣ Generando contrato de prueba...');
    console.log('Datos:', JSON.stringify(testData, null, 2));
    console.log();

    const generateResponse = await axios.post(
      `${API_URL}/generatecontrato`,
      testData
    );

    console.log('\n✅ RESULTADO:');
    console.log(JSON.stringify(generateResponse.data, null, 2));

    if (generateResponse.data.success) {
      console.log('\n🎉 ¡Contrato generado exitosamente!');
      console.log('📄 DOCX:', generateResponse.data.docx_path);
      console.log('📄 PDF:', generateResponse.data.pdf_path);
    } else {
      console.error('\n❌ Error:', generateResponse.data.error);
    }

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
console.log('║  🧪 Test: Generación de Contrato                         ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

testContractGeneration();
