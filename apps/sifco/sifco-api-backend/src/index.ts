import { config, validateConfig } from './config';
import { SIFCOAuthService } from './services/auth.service';
import { handleClientesRoute } from './routes/clientes.routes';
import { handleCreditosRoute } from './routes/creditos.routes';
import { errorHandler, AppError } from './middleware/error.middleware';
import { corsHeaders, handleCors } from './middleware/cors.middleware';
import { logRequest, logResponse } from './middleware/logger.middleware';

const PORT = config.server.port;

// ASCII Art Banner
console.log(`
╔═══════════════════════════════════════════╗
║       SIFCO API Backend Server            ║
║       Powered by Bun 🚀                   ║
╚═══════════════════════════════════════════╝
`);

// Validate configuration
if (!validateConfig()) {
  console.error('❌ Configuration validation failed. Please check your environment variables.');
  console.log('   Copy .env.example to .env and fill in your SIFCO credentials.');
  process.exit(1);
}

// Initialize authentication service
const authService = SIFCOAuthService.getInstance();

// Main server handler
const server = Bun.serve({
  port: PORT,
  async fetch(request: Request) {
    const startTime = Date.now();
    const logEntry = logRequest(request);

    try {
      // Handle CORS preflight
      const corsResponse = handleCors(request);
      if (corsResponse) {
        logResponse(logEntry, 204, startTime);
        return corsResponse;
      }

      const url = new URL(request.url);
      const path = url.pathname.split('/').filter(Boolean);

      // Health check endpoint
      if (path[0] === 'health') {
        const response = new Response(
          JSON.stringify({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            service: 'SIFCO API Backend',
            version: '1.0.0',
          }),
          {
            status: 200,
            headers: { 
              'Content-Type': 'application/json',
              ...corsHeaders(),
            },
          }
        );
        logResponse(logEntry, 200, startTime);
        return response;
      }

      // API documentation endpoint
      if (path[0] === 'api' && path.length === 1) {
        const apiDoc = {
          name: 'SIFCO API Backend',
          version: '1.0.0',
          description: 'Backend API for SIFCO banking core integration',
          endpoints: {
            health: {
              GET: '/health - Health check endpoint',
            },
            auth: {
              POST: '/api/auth/test - Test authentication with SIFCO',
            },
            clientes: {
              GET: [
                '/api/clientes - List all clients',
                '/api/clientes/:id - Get client by ID',
                '/api/clientes/:id/cuentas - Get client accounts',
                '/api/clientes/:id/historial-crediticio - Get credit history',
                '/api/clientes/:id/documentos - Get client documents',
              ],
              POST: [
                '/api/clientes - Create new client',
                '/api/clientes/buscar - Search clients',
                '/api/clientes/validar - Validate client exists',
                '/api/clientes/:id/documentos - Add document to client',
              ],
              PUT: '/api/clientes/:id - Update client',
            },
            creditos: {
              GET: [
                '/api/creditos - List all credits',
                '/api/creditos/:id - Get credit by ID',
                '/api/creditos/cliente/:clienteId - Get credits by client',
                '/api/creditos/:id/estado-cuenta - Get account statement',
                '/api/creditos/:id/amortizacion - Get amortization table',
                '/api/creditos/:id/pagos - Get payment history',
                '/api/creditos/:id/cuotas - Get loan installments with late fees',
                '/api/creditos/:id/mora - Calculate late fees',
                '/api/creditos/:id/garantias - Get guarantees',
              ],
              POST: [
                '/api/creditos/simular - Simulate credit',
                '/api/creditos/solicitud - Create credit application',
                '/api/creditos/pago - Register payment',
                '/api/creditos/:id/aprobar - Approve credit',
                '/api/creditos/:id/rechazar - Reject credit',
                '/api/creditos/:id/desembolsar - Disburse credit',
                '/api/creditos/:id/reestructurar - Restructure credit',
                '/api/creditos/:id/garantias - Add guarantee',
              ],
              PUT: '/api/creditos/:id - Update credit',
            },
          },
        };

        const response = new Response(JSON.stringify(apiDoc, null, 2), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders(),
          },
        });
        logResponse(logEntry, 200, startTime);
        return response;
      }

      // API routes must start with /api
      if (path[0] !== 'api') {
        throw new AppError('Not Found', 404);
      }

      // Test authentication endpoint
      if (path[1] === 'auth' && path[2] === 'test' && request.method === 'POST') {
        try {
          await authService.authenticate();
          const response = new Response(
            JSON.stringify({
              success: true,
              message: 'Authentication successful',
              timestamp: new Date().toISOString(),
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders(),
              },
            }
          );
          logResponse(logEntry, 200, startTime);
          return response;
        } catch (error) {
          const response = new Response(
            JSON.stringify({
              success: false,
              error: 'Authentication failed',
              message: error instanceof Error ? error.message : 'Unknown error',
            }),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders(),
              },
            }
          );
          logResponse(logEntry, 401, startTime);
          return response;
        }
      }

      // Route to appropriate handler
      let response: Response;

      if (path[1] === 'clientes') {
        response = await handleClientesRoute(request, path);
      } else if (path[1] === 'creditos') {
        response = await handleCreditosRoute(request, path);
      } else {
        throw new AppError(`Unknown API route: ${path[1]}`, 404);
      }

      // Add CORS headers to response
      const headers = new Headers(response.headers);
      Object.entries(corsHeaders()).forEach(([key, value]) => {
        headers.set(key, value);
      });

      const finalResponse = new Response(response.body, {
        status: response.status,
        headers,
      });

      logResponse(logEntry, response.status, startTime);
      return finalResponse;

    } catch (error) {
      logEntry.error = error instanceof Error ? error.message : 'Unknown error';
      const errorResponse = errorHandler(error as Error);
      
      // Add CORS headers to error response
      const headers = new Headers(errorResponse.headers);
      Object.entries(corsHeaders()).forEach(([key, value]) => {
        headers.set(key, value);
      });

      const finalErrorResponse = new Response(errorResponse.body, {
        status: errorResponse.status,
        headers,
      });

      logResponse(logEntry, errorResponse.status, startTime);
      return finalErrorResponse;
    }
  },
});

console.log(`
🚀 Server running at http://localhost:${PORT}
📚 API Documentation: http://localhost:${PORT}/api
🏥 Health Check: http://localhost:${PORT}/health

Environment: ${config.server.env}
SIFCO Base URL: ${config.sifco.baseURL}

Available endpoints:
- POST /api/auth/test - Test SIFCO authentication
- GET  /api/clientes - List clients
- POST /api/clientes/buscar - Search clients
- GET  /api/creditos - List credits
- POST /api/creditos/simular - Simulate credit

Press Ctrl+C to stop the server
`);