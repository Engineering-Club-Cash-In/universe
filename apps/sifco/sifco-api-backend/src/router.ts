import { SIFCOAuthService } from './services/auth.service';
import { handleClientesRoute } from './routes/clientes.routes';
import { handleCreditosRoute } from './routes/creditos.routes';
import { AppError } from './middleware/error.middleware';
import { corsHeaders } from './middleware/cors.middleware';

// Initialize authentication service
const authService = SIFCOAuthService.getInstance();

// API Documentation
export const apiDocumentation = {
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

// Helper function to create JSON response with CORS headers
export function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}

// Helper to add CORS headers to existing response
function addCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders()).forEach(([key, value]) => {
    headers.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

// Route type definition
type RouteHandler = (request: Request) => Promise<Response> | Response;

interface Route {
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
}

// Route definitions using regex patterns for flexibility
const routes: Route[] = [
  // Health check
  {
    method: 'GET',
    pattern: /^\/health$/,
    handler: async () => {
      return jsonResponse({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'SIFCO API Backend',
        version: '1.0.0',
      });
    },
  },

  // API documentation
  {
    method: 'GET',
    pattern: /^\/api$/,
    handler: async () => {
      return jsonResponse(apiDocumentation);
    },
  },

  // Authentication test
  {
    method: 'POST',
    pattern: /^\/api\/auth\/test$/,
    handler: async () => {
      try {
        await authService.authenticate();
        return jsonResponse({
          success: true,
          message: 'Authentication successful',
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        return jsonResponse({
          success: false,
          error: 'Authentication failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        }, 401);
      }
    },
  },

  // Client routes
  {
    method: 'ALL', // Handle all methods
    pattern: /^\/api\/clientes/,
    handler: async (request: Request) => {
      const url = new URL(request.url);
      const pathSegments = url.pathname.split('/').filter(Boolean);
      const response = await handleClientesRoute(request, pathSegments);
      return addCorsHeaders(response);
    },
  },

  // Credit routes
  {
    method: 'ALL', // Handle all methods
    pattern: /^\/api\/creditos/,
    handler: async (request: Request) => {
      const url = new URL(request.url);
      const pathSegments = url.pathname.split('/').filter(Boolean);
      const response = await handleCreditosRoute(request, pathSegments);
      return addCorsHeaders(response);
    },
  },
];

// Main router function
export async function router(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Find matching route
  for (const route of routes) {
    if (
      (route.method === method || route.method === 'ALL') &&
      route.pattern.test(path)
    ) {
      return route.handler(request);
    }
  }

  // No route matched - return 404
  throw new AppError(`Route not found: ${method} ${path}`, 404);
}

// Export individual handlers for testing
export const handlers = {
  health: routes[0].handler,
  apiDoc: routes[1].handler,
  authTest: routes[2].handler,
};