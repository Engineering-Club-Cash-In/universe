import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { contractGenerator } from './services/ContractGeneratorService';
import { ContractType, GenerateContractRequest } from './types/contract';

const PORT = Number(process.env.PORT) || 4000;

// ===== ENDPOINTS =====

const app = new Elysia()
  .use(cors())

  /**
   * GET /health - Health check
   */
  .get('/health', async () => {
  const gotenbergHealth = await contractGenerator.checkGotenbergHealth();

    return {
      status: 'ok',
      service: 'Contract Generator API',
      timestamp: new Date().toISOString(),
      gotenberg: gotenbergHealth ? 'available' : 'unavailable'
    };
  })

  /**
   * GET /contracts/types - Lista todos los tipos de contratos disponibles
   */
  .get('/contracts/types', () => {
    const availableContracts = contractGenerator.listAvailableContracts();

    return {
      success: true,
      count: availableContracts.length,
      contracts: availableContracts
    };
  })

  /**
   * POST /generatecontrato - Genera un contrato según el tipo especificado
   *
   * Body:
   * {
   *   "contractType": "uso_carro_usado",
   *   "data": { ...campos del contrato... },
   *   "options": { "generatePdf": true, "filenamePrefix": "contrato_juan" }
   * }
   */
  .post('/generatecontrato', async ({ body, set }) => {
  try {
    const requestBody = body as GenerateContractRequest;

    // Validar que se envió el tipo de contrato
    if (!requestBody.contractType) {
      set.status = 400;
      return {
        success: false,
        error: 'El campo "contractType" es requerido',
        availableTypes: Object.values(ContractType)
      };
    }

    // Validar que el tipo de contrato existe
    if (!Object.values(ContractType).includes(requestBody.contractType)) {
      set.status = 400;
      return {
        success: false,
        error: `Tipo de contrato inválido: ${requestBody.contractType}`,
        availableTypes: Object.values(ContractType)
      };
    }

    // Validar que se enviaron datos
    if (!requestBody.data || Object.keys(requestBody.data).length === 0) {
      set.status = 400;
      return {
        success: false,
        error: 'El campo "data" es requerido y no puede estar vacío'
      };
    }

    // Generar el contrato
    console.log(`\n🚀 Generando contrato tipo: ${requestBody.contractType}`);
    const result = await contractGenerator.generateContract(
      requestBody.contractType,
      requestBody.data,
      requestBody.options
    );

    // Responder según el resultado
    if (result.success) {
      set.status = 200;
      return result;
    } else {
      set.status = 400;
      return result;
    }

  } catch (error: any) {
    console.error('Error en /generatecontrato:', error);
    set.status = 500;
    return {
      success: false,
      error: 'Error interno del servidor',
      message: error.message
    };
  }
})

  /**
   * POST /contracts/batch - Genera múltiples contratos de manera secuencial
 *
 * Body:
 * {
 *   "contracts": [
 *     {
 *       "contractType": "reconocimiento_deuda",
 *       "data": { ...campos... },
 *       "emails": ["cliente@ejemplo.com", "cci@ejemplo.com"],
 *       "options": { "generatePdf": true, "filenamePrefix": "cliente_001", "gender": "male" }
 *     },
 *     {
 *       "contractType": "garantia_mobiliaria",
 *       "data": { ...campos... },
 *       "emails": ["cliente@ejemplo.com"],
 *       "options": { "generatePdf": true, "gender": "female" }
 *     }
 *   ]
 * }
 */
  .post('/contracts/batch', async ({ body, set }) => {
  try {
    const { contracts } = body as { contracts: any[] };

    // Validar que se envió el array de contratos
    if (!contracts || !Array.isArray(contracts)) {
      set.status = 400;
      return {
        success: false,
        error: 'El campo "contracts" es requerido y debe ser un array'
      };
    }

    // Validar que el array no esté vacío
    if (contracts.length === 0) {
      set.status = 400;
      return {
        success: false,
        error: 'El array "contracts" no puede estar vacío'
      };
    }

    // Validar cada contrato en el array
    for (let i = 0; i < contracts.length; i++) {
      const contract = contracts[i];

      if (!contract.contractType) {
        set.status = 400;
        return {
          success: false,
          error: `Contrato en posición ${i}: falta el campo "contractType"`,
          availableTypes: Object.values(ContractType)
        };
      }

      if (!Object.values(ContractType).includes(contract.contractType)) {
        set.status = 400;
        return {
          success: false,
          error: `Contrato en posición ${i}: tipo inválido "${contract.contractType}"`,
          availableTypes: Object.values(ContractType)
        };
      }

      if (!contract.data || Object.keys(contract.data).length === 0) {
        set.status = 400;
        return {
          success: false,
          error: `Contrato en posición ${i}: falta el campo "data" o está vacío`
        };
      }
    }

    console.log(`\n🚀 Generando batch de ${contracts.length} contratos...`);

    // Generar todos los contratos
    const result = await contractGenerator.generateContractsBatch(contracts);

    // Responder con los resultados
    set.status = 200;
    return result;

  } catch (error: any) {
    console.error('Error en /contracts/batch:', error);
    set.status = 500;
    return {
      success: false,
      error: 'Error interno del servidor',
      message: error.message,
      results: []
    };
  }
})

  /**
   * POST /contracts/:type - Endpoint alternativo por tipo específico
   * Ejemplo: POST /contracts/uso_carro_usado
   */
  .post('/contracts/:type', async ({ params, body, query, set }) => {
  try {
    const contractType = params.type as ContractType;
    const { emails, gender, ...data } = body as any;

    // Construir opciones desde query params y body
    const options: any = {};
    if (query.pdf === 'false') {
      options.generatePdf = false;
    }
    if (emails && Array.isArray(emails)) {
      options.emails = emails;
    }
    if (gender) {
      options.gender = gender;
    }

    // Validar tipo
    if (!Object.values(ContractType).includes(contractType)) {
      set.status = 400;
      return {
        success: false,
        error: `Tipo de contrato inválido: ${contractType}`,
        availableTypes: Object.values(ContractType)
      };
    }

    // Generar
    const result = await contractGenerator.generateContract(
      contractType,
      data,
      options
    );

    if (result.success) {
      set.status = 200;
      return result;
    } else {
      set.status = 400;
      return result;
    }

  } catch (error: any) {
    console.error(`Error en /contracts/${params.type}:`, error);
    set.status = 500;
    return {
      success: false,
      error: 'Error interno del servidor',
      message: error.message
    };
  }
})

  /**
   * GET / - Documentación básica de la API
   */
  .get('/', () => {
  return {
    service: 'Contract Generator API',
    version: '1.0.0',
    description: 'API para generación de contratos legales desde templates DOCX',
    endpoints: {
      health: 'GET /health',
      listContracts: 'GET /contracts/types',
      generateContract: 'POST /generatecontrato',
      generateBatch: 'POST /contracts/batch',
      generateByType: 'POST /contracts/:type'
    },
    examples: {
      generateContract: {
        url: 'POST /generatecontrato',
        body: {
          contractType: 'uso_carro_usado',
          data: {
            contract_day: '15',
            contract_month: 'octubre',
            contract_year: 'veinticinco',
            client_name: 'Juan Pérez',
            // ... más campos
          },
          options: {
            generatePdf: true,
            filenamePrefix: 'contrato_juan'
          }
        }
      },
      generateByType: {
        url: 'POST /contracts/uso_carro_usado',
        body: {
          contract_day: '15',
          contract_month: 'octubre',
          // ... campos del contrato
        }
      }
    }
  };
})
  .listen({
    port: PORT,
    hostname: '0.0.0.0'
  });

console.log(`
╔═══════════════════════════════════════════════════════════╗
║  📄 Contract Generator API                                ║
║  🚀 Server running on http://localhost:${PORT}              ║
║                                                           ║
║  Endpoints:                                               ║
║  • GET  /health                - Health check             ║
║  • GET  /contracts/types       - Lista contratos          ║
║  • POST /generatecontrato      - Genera contrato          ║
║  • POST /contracts/batch       - Genera múltiples         ║
║  • POST /contracts/:type       - Genera por tipo          ║
╚═══════════════════════════════════════════════════════════╝
`);

// Verificar Gotenberg
contractGenerator.checkGotenbergHealth().then(healthy => {
  if (healthy) {
    console.log('✓ Gotenberg está disponible y listo');
  } else {
    console.warn('⚠ Gotenberg no está disponible. Solo se generarán archivos DOCX.');
    console.warn('  Ejecuta: docker-compose up -d');
  }
});
