import { documensoService } from './services/DocumensoService';

/**
 * Script para verificar el estado de firma de un documento en Documenso
 * Uso: bun run test-check-signing-status.ts
 */

async function main() {
  try {
    console.log('🚀 Verificando estado de firma en Documenso...\n');

    // Token extraído de: https://documenso.s2.devteamatcci.site/sign/akyMR7PGgJuzddsu0dHsq
    const signingToken = 'akyMR7PGgJuzddsu0dHsq';

    console.log(`🔗 URL completa: https://documenso.s2.devteamatcci.site/sign/${signingToken}\n`);

    // Verificar el estado de firma
    const status = await documensoService.checkSigningStatus(signingToken);

    console.log('\n📊 RESULTADO:');
    console.log('════════════════════════════════════════════════════════════');
    console.log(`Estado:           ${status.status}`);
    console.log(`Firmado:          ${status.isSigned ? '✅ SÍ' : '❌ NO'}`);
    console.log(`Mensaje:          ${status.message}`);
    
    if (status.recipientEmail) {
      console.log(`Email:            ${status.recipientEmail}`);
    }
    
    if (status.recipientName) {
      console.log(`Nombre:           ${status.recipientName}`);
    }
    
    if (status.documentTitle) {
      console.log(`Documento:        ${status.documentTitle}`);
    }
    
    if (status.signedAt) {
      console.log(`Fecha de firma:   ${status.signedAt}`);
    }
    
    console.log('════════════════════════════════════════════════════════════\n');

    if (status.isSigned) {
      console.log('✅ El documento ya ha sido firmado');
    } else {
      console.log('⏳ El documento está pendiente de firma');
    }

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('\n📋 Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Ejecutar el script
main();
