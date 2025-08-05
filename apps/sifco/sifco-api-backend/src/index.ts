import { config, validateConfig } from './config';
import { router, jsonResponse } from './router';
import { handleCors } from './middleware/cors.middleware';
import { logRequest, logResponse } from './middleware/logger.middleware';
import { errorHandler } from './middleware/error.middleware';

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


// Main server using Bun's recommended pattern
const server = Bun.serve({
  port: PORT,
  
  async fetch(request: Request): Promise<Response> {
    const startTime = Date.now();
    const logEntry = logRequest(request);
    const method = request.method;

    // Handle CORS preflight requests
    if (method === 'OPTIONS') {
      const corsResponse = handleCors(request);
      if (corsResponse) {
        logResponse(logEntry, 204, startTime);
        return corsResponse;
      }
    }

    try {
      // Use the centralized router
      const response = await router(request);
      logResponse(logEntry, response.status, startTime);
      return response;
    } catch (error) {
      logEntry.error = error instanceof Error ? error.message : 'Unknown error';
      const errorResponse = errorHandler(error as Error);
      logResponse(logEntry, errorResponse.status, startTime);
      return errorResponse;
    }
  },

  // Error handler for server errors
  error(error: Error): Response {
    console.error('Server error:', error);
    return jsonResponse({
      success: false,
      error: 'Internal server error',
      message: error.message,
    }, 500);
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
- POST /api/creditos/pago - Register payment

Press Ctrl+C to stop the server
`);

export default server;