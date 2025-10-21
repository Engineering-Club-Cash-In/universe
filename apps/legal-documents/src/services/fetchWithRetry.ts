// fetchWithRetry.ts - Función helper para fetch con retry y timeout
import { NetworkError, ServerError, TimeoutError } from './errors';

interface FetchWithRetryOptions extends RequestInit {
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    timeout = 30000, // 30 segundos
    ...fetchOptions
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Crear AbortController para timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // No hacer retry si es error del cliente (4xx excepto 408, 429)
      if (response.status >= 400 && response.status < 500) {
        if (response.status !== 408 && response.status !== 429) {
          return response; // Dejar que el caller maneje el error 4xx
        }
      }

      // Hacer retry en errores del servidor (5xx) o rate limiting (429)
      if (response.status >= 500 || response.status === 429) {
        lastError = new ServerError(
          `Server error: ${response.status}`,
          response.status
        );

        if (attempt < maxRetries) {
          console.warn(
            `⚠️ Intento ${attempt + 1}/${maxRetries} falló. Reintentando en ${retryDelay}ms...`
          );
          await sleep(retryDelay * Math.pow(2, attempt)); // Exponential backoff
          continue;
        }
      }

      return response;

    } catch (error) {
      // Manejar AbortError (timeout)
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = new TimeoutError();

        if (attempt < maxRetries) {
          console.warn(`⚠️ Timeout. Reintentando... (${attempt + 1}/${maxRetries})`);
          await sleep(retryDelay);
          continue;
        }
      }

      // Manejar errores de red
      lastError = new NetworkError(
        'Error de conexión. Verifica tu internet.',
        error as Error
      );

      if (attempt < maxRetries) {
        console.warn(`⚠️ Error de red. Reintentando... (${attempt + 1}/${maxRetries})`);
        await sleep(retryDelay);
        continue;
      }
    }
  }

  // Si llegamos aquí, todos los intentos fallaron
  throw lastError || new NetworkError('Error desconocido en la solicitud');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
