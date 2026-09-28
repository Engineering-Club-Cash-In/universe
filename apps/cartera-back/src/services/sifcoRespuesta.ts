import type { ServiceResponse } from "./sifco.interface";

/**
 * Corta si la pasarela contestó "no pude".
 *
 * ⚠️ Defensa en profundidad, NO el cierre de un fail-open activo. Hoy la
 * pasarela responde `status: result.success ? 200 : 400` en todas sus rutas
 * (`apps/sifco/sifco-api-backend/src/routes/clientes.routes.ts`), así que ante
 * un fallo axios ya lanza por el status y acá no se llega. Esto existe para el
 * día en que alguna ruta devuelva 200 con `success: false`: sin el guard,
 * `data.data` sería `undefined` —indistinguible de "este cliente no tiene
 * nada"— y quien lo usa para decidir si alguien está en mora leería la caída
 * como "sin créditos" y por lo tanto "sin mora".
 *
 * 🔴 Vive en su propio módulo, sin axios ni nada más que un tipo, por dos
 * razones: la decisión es una sola y no se duplica en cada consulta, y el test
 * puede importarla sin arrastrar `sifcoIntegrations.ts`. Metida allá, el test
 * moría con "Export named 'exigirRespuestaExitosa' not found" — el mismo
 * problema de ciclos de importación que ya rompe a otros módulos de este repo
 * cuando corre la suite entera.
 *
 * `contexto` es lo que se lee en el log.
 */
export function exigirRespuestaExitosa<T>(
  data: ServiceResponse<T>,
  contexto: string
): T | undefined {
  if (!data.success) {
    throw new Error(`${contexto}: ${data.error ?? "respuesta sin éxito"}`);
  }

  return data.data;
}
