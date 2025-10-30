import express, { Request, Response } from 'express';
import cors from 'cors';
import { contractGenerator } from './services/ContractGeneratorService';
import { ContractType, GenerateContractRequest } from './types/contract';

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ===== ENDPOINTS =====

/**
 * GET /health - Health check
 */
app.get('/health', async (req: Request, res: Response) => {
  const gotenbergHealth = await contractGenerator.checkGotenbergHealth();

  res.json({
    status: 'ok',
    service: 'Contract Generator API',
    timestamp: new Date().toISOString(),
    gotenberg: gotenbergHealth ? 'available' : 'unavailable'
  });
});

/**
 * GET /contracts/types - Lista todos los tipos de contratos disponibles
 */
app.get('/contracts/types', (req: Request, res: Response) => {
  const availableContracts = contractGenerator.listAvailableContracts();

  res.json({
    success: true,
    count: availableContracts.length,
    contracts: availableContracts
  });
});

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
app.post('/generatecontrato', async (req: Request, res: Response) => {
  try {
    const body: GenerateContractRequest = req.body;

    // Validar que se envió el tipo de contrato
    if (!body.contractType) {
      return res.status(400).json({
        success: false,
        error: 'El campo "contractType" es requerido',
        availableTypes: Object.values(ContractType)
      });
    }

    // Validar que el tipo de contrato existe
    if (!Object.values(ContractType).includes(body.contractType)) {
      return res.status(400).json({
        success: false,
        error: `Tipo de contrato inválido: ${body.contractType}`,
        availableTypes: Object.values(ContractType)
      });
    }

    // Validar que se enviaron datos
    if (!body.data || Object.keys(body.data).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'El campo "data" es requerido y no puede estar vacío'
      });
    }

    // Generar el contrato
    console.log(`\n🚀 Generando contrato tipo: ${body.contractType}`);
    const result = await contractGenerator.generateContract(
      body.contractType,
      body.data,
      body.options
    );

    // Responder según el resultado
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error: any) {
    console.error('Error en /generatecontrato:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      message: error.message
    });
  }
});

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
app.post('/contracts/batch', async (req: Request, res: Response) => {
  try {
    const { contracts } = req.body;

    // Validar que se envió el array de contratos
    if (!contracts || !Array.isArray(contracts)) {
      return res.status(400).json({
        success: false,
        error: 'El campo "contracts" es requerido y debe ser un array'
      });
    }

    // Validar que el array no esté vacío
    if (contracts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'El array "contracts" no puede estar vacío'
      });
    }

    // Validar cada contrato en el array
    for (let i = 0; i < contracts.length; i++) {
      const contract = contracts[i];
      
      if (!contract.contractType) {
        return res.status(400).json({
          success: false,
          error: `Contrato en posición ${i}: falta el campo "contractType"`,
          availableTypes: Object.values(ContractType)
        });
      }

      if (!Object.values(ContractType).includes(contract.contractType)) {
        return res.status(400).json({
          success: false,
          error: `Contrato en posición ${i}: tipo inválido "${contract.contractType}"`,
          availableTypes: Object.values(ContractType)
        });
      }

      if (!contract.data || Object.keys(contract.data).length === 0) {
        return res.status(400).json({
          success: false,
          error: `Contrato en posición ${i}: falta el campo "data" o está vacío`
        });
      }
    }

    console.log(`\n🚀 Generando batch de ${contracts.length} contratos...`);

    // Generar todos los contratos
    const result = await contractGenerator.generateContractsBatch(contracts);

    // Responder con los resultados
    res.status(200).json(result);

  } catch (error: any) {
    console.error('Error en /contracts/batch:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      message: error.message,
      results: []
    });
  }
});

/**
 * POST /contracts/:type - Endpoint alternativo por tipo específico
 * Ejemplo: POST /contracts/uso_carro_usado
 */
app.post('/contracts/:type', async (req: Request, res: Response) => {
  try {
    const contractType = req.params.type as ContractType;
    const { emails, gender, ...data } = req.body;

    // Construir opciones desde query params y body
    const options: any = {};
    if (req.query.pdf === 'false') {
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
      return res.status(400).json({
        success: false,
        error: `Tipo de contrato inválido: ${contractType}`,
        availableTypes: Object.values(ContractType)
      });
    }

    // Generar
    const result = await contractGenerator.generateContract(
      contractType,
      data,
      options
    );

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error: any) {
    console.error(`Error en /contracts/${req.params.type}:`, error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      message: error.message
    });
  }
});

/**
 * GET / - Documentación básica de la API
 */
app.get('/', (req: Request, res: Response) => {
  res.json({
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
  });
});

// Iniciar servidor
app.listen(PORT, () => {
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
});

export default app;
