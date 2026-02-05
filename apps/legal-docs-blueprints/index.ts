import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { contractGenerator } from './services/ContractGeneratorService';
import { ContractType, GenerateContractRequest } from './types/contract';
import { WeeTrustService } from './services/WeeTrustService';

// Inicializar WeeTrust
const weeTrustService = new WeeTrustService();

const PORT = Number(process.env.PORT) || 4000;

// ===== ENDPOINTS =====

const app = new Elysia()
  .use(cors())

  /**
   * GET /health - Health check
   */
  .get('/health', async () => {
    // Health check con timeout independiente para no bloquear si Gotenberg está colgado
    const gotenbergHealthPromise = contractGenerator.checkGotenbergHealth();
    const timeoutPromise = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000));

    const gotenbergHealth = await Promise.race([gotenbergHealthPromise, timeoutPromise]);

    // Verificar memoria disponible (en MB)
    const memoryUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(memoryUsage.rss / 1024 / 1024);

    return {
      status: 'ok',
      service: 'Contract Generator API',
      timestamp: new Date().toISOString(),
      gotenberg: gotenbergHealth ? 'available' : 'unavailable',
      memory: {
        heapUsedMB,
        heapTotalMB,
        rssMB
      }
    };
  })

  /**
   * GET /metrics - Endpoint de métricas detalladas para diagnóstico
   */
  .get('/metrics', async () => {
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();

    // Verificar Gotenberg con timeout
    const gotenbergStart = Date.now();
    const gotenbergHealthPromise = contractGenerator.checkGotenbergHealth();
    const timeoutPromise = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000));
    const gotenbergHealth = await Promise.race([gotenbergHealthPromise, timeoutPromise]);
    const gotenbergLatency = Date.now() - gotenbergStart;

    return {
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: Math.round(uptime),
        formatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.round(uptime % 60)}s`
      },
      memory: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024),
        unit: 'MB'
      },
      gotenberg: {
        status: gotenbergHealth ? 'healthy' : 'unhealthy',
        latencyMs: gotenbergLatency,
        timedOut: gotenbergLatency >= 5000
      },
      process: {
        pid: process.pid,
        nodeVersion: process.version
      }
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
      generateByType: 'POST /contracts/:type',
      webhooks: {
        receive: 'POST /webhooks/weetrust/:secret',
        status: 'GET /webhooks/weetrust/status',
        register: 'POST /webhooks/weetrust/register'
      }
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

  // ===== WEBHOOKS =====

  /**
   * POST /webhooks/weetrust/:secret - Recibe notificaciones de WeeTrust
   *
   * Tipos de eventos:
   * - sendDocument: Documento enviado a firma
   * - signDocument: Un firmante firmó
   * - completedDocument: Todos los firmantes completaron
   *
   * Security: Secret token validated via URL path parameter
   * Register webhook with: https://your-domain.com/webhooks/weetrust/{WEETRUST_WEBHOOK_SECRET}
   */
  .post('/webhooks/weetrust/:secret', async ({ params, body, set }) => {
    try {
      // Validate webhook secret from URL
      const expectedSecret = process.env.WEETRUST_WEBHOOK_SECRET;

      if (!expectedSecret) {
        console.error('[WeeTrust Webhook] WEETRUST_WEBHOOK_SECRET not configured');
        set.status = 500;
        return { success: false, error: 'Webhook not configured' };
      }

      if (params.secret !== expectedSecret) {
        console.warn('[WeeTrust Webhook] Invalid webhook secret');
        set.status = 401;
        return { success: false, error: 'Unauthorized' };
      }

      const payload = body as {
        event?: string;
        type?: string;
        documentID?: string;
        document?: {
          documentID: string;
          status: string;
        };
        signatory?: {
          emailID: string;
          name: string;
          isSigned: number;
        };
        timestamp?: string;
      };

      // Log event without sensitive data
      console.log(`\n📥 [WeeTrust Webhook] Event: ${payload.event || payload.type}, DocumentID: ${payload.documentID || payload.document?.documentID}`);

      // Determinar tipo de evento
      const eventType = payload.event || payload.type || 'unknown';
      const documentId = payload.documentID || payload.document?.documentID;

      if (!documentId) {
        console.warn('[WeeTrust Webhook] Payload sin documentID');
        set.status = 400;
        return { success: false, error: 'Missing documentID' };
      }

      // Procesar según tipo de evento
      switch (eventType) {
        case 'sendDocument':
          console.log(`[WeeTrust Webhook] Documento ${documentId} enviado a firma`);
          break;

        case 'signDocument':
          console.log(`[WeeTrust Webhook] Documento ${documentId} - Firmante firmó:`, payload.signatory?.emailID);
          // TODO: Notificar a CRM que un firmante firmó
          break;

        case 'completedDocument':
          console.log(`[WeeTrust Webhook] Documento ${documentId} - COMPLETADO (todos firmaron)`);
          // TODO: Notificar a CRM que el documento está completo
          // await notifyCrmDocumentCompleted(documentId);
          break;

        default:
          console.log(`[WeeTrust Webhook] Evento desconocido: ${eventType}`);
      }

      // Responder éxito a WeeTrust
      set.status = 200;
      return {
        success: true,
        message: 'Webhook received',
        event: eventType,
        documentId
      };

    } catch (error: any) {
      console.error('[WeeTrust Webhook] Error:', error);
      set.status = 500;
      return { success: false, error: error.message };
    }
  })

  /**
   * GET /webhooks/weetrust/status - Ver webhooks registrados
   */
  .get('/webhooks/weetrust/status', async ({ set }) => {
    try {
      const webhooks = await weeTrustService.listWebhooks();
      return {
        success: true,
        count: webhooks.length,
        webhooks
      };
    } catch (error: any) {
      set.status = 500;
      return { success: false, error: error.message };
    }
  })

  /**
   * POST /webhooks/weetrust/register - Registrar webhook en WeeTrust
   * Body: { url: string, type: 'sendDocument' | 'signDocument' | 'completedDocument' }
   */
  .post('/webhooks/weetrust/register', async ({ body, set }) => {
    try {
      const { url, type } = body as { url: string; type: string };

      if (!url || !type) {
        set.status = 400;
        return { success: false, error: 'Missing url or type' };
      }

      const validTypes = ['sendDocument', 'signDocument', 'completedDocument'];
      if (!validTypes.includes(type)) {
        set.status = 400;
        return {
          success: false,
          error: `Invalid type. Valid types: ${validTypes.join(', ')}`
        };
      }

      const result = await weeTrustService.addWebhook(
        url,
        type as 'sendDocument' | 'signDocument' | 'completedDocument'
      );

      return {
        success: true,
        message: 'Webhook registered',
        webhook: result
      };
    } catch (error: any) {
      set.status = 500;
      return { success: false, error: error.message };
    }
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
║                                                           ║
║  Webhooks:                                                ║
║  • POST /webhooks/weetrust/:secret  - Recibe eventos      ║
║  • GET  /webhooks/weetrust/status   - Ver registrados     ║
║  • POST /webhooks/weetrust/register - Registrar webhook   ║
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
