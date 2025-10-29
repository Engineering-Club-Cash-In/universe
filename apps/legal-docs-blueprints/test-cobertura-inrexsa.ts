import axios from 'axios';
import { ContractType } from './types/contract';

/**
 * Script de prueba para generar carta de cobertura INREXSA
 */

const API_URL = 'http://localhost:4000';

// Datos de prueba
const testData = {
  contractType: ContractType.COBERTURA_INREXSA,
  data: {
    debtor_name: 'MARIA FERNANDA LOPEZ GARCIA',
    full_date: 'Guatemala 28 de octubre de dos mil veinticinco'
  },
  options: {
    generatePdf: true,
    filenamePrefix: 'cobertura_maria_lopez'
  }
};

async function testCoberturaInrexsa() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  🧪 Test: Carta de Cobertura INREXSA                      ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  console.log('🧪 Iniciando prueba de generación de carta de cobertura INREXSA...\n');

  try {
    // 1. Verificar servidor
    console.log('1️⃣ Verificando servidor...');
    const healthCheck = await axios.get(`${API_URL}/health`);
    console.log('✓ Servidor activo:', JSON.stringify(healthCheck.data, null, 2));

    // 2. Generar carta
    console.log('\n2️⃣ Generando carta de cobertura INREXSA...\n');
    console.log('=' .repeat(70));
    console.log('  📄 COBERTURA INREXSA: Maria Fernanda Lopez Garcia');
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
testCoberturaInrexsa()
  .then(() => {
    console.log('\n✅ Test completado exitosamente\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test falló:', error.message);
    process.exit(1);
  });
