/**
 * Un único lugar que sepa partir, canonizar y comparar orígenes.
 *
 * Antes cada capa interpretaba `CORS_ORIGIN` a su manera: el middleware
 * anti-CSRF partía por comas, el CORS global devolvía la cadena entera y Better
 * Auth la comparaba por igualdad exacta. Con una sola variable de un solo
 * dominio las tres coincidían por casualidad; en cuanto alguien declarara dos,
 * el navegador recibía `Access-Control-Allow-Origin: https://a,https://b` —que
 * no acepta ningún navegador— y Better Auth no reconocía ninguno de los dos.
 *
 * Estas funciones son puras a propósito: no leen `env`, así que `config/env.ts`
 * puede usarlas para construir la lista sin ciclo de importación.
 */

/**
 * Reduce un origen a su forma canónica (`esquema://host[:puerto]`) para poder
 * compararlo. Devuelve `null` para lo que no sea un origen real: ausente,
 * vacío o el literal `"null"` que mandan los iframes en sandbox y los
 * documentos `data:`.
 */
export function normalizeOrigin(
  origin: string | null | undefined,
): string | null {
  if (typeof origin !== "string") {
    return null;
  }

  const trimmed = origin.trim();

  if (!trimmed || trimmed === "null") {
    return null;
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

export interface ListaOrigenes {
  /** Orígenes canónicos, en el orden declarado y sin repetir. */
  origenes: string[];
  /** Entradas que no son un origen; quien llama decide si son un error. */
  invalidos: string[];
}

/**
 * Interpreta una variable de entorno que puede traer varios orígenes separados
 * por comas. Los inválidos se devuelven aparte en vez de descartarse en
 * silencio: un `CORS_ORIGIN` sin esquema es un error de despliegue que debe
 * doler al arrancar, no manifestarse como un CORS roto en el navegador.
 */
export function parseOriginList(valor: string | null | undefined): ListaOrigenes {
  const origenes: string[] = [];
  const invalidos: string[] = [];

  for (const bruto of (valor ?? "").split(",")) {
    const entrada = bruto.trim();

    if (!entrada) {
      continue;
    }

    const normalizado = normalizeOrigin(entrada);

    if (!normalizado) {
      invalidos.push(entrada);
    } else if (!origenes.includes(normalizado)) {
      origenes.push(normalizado);
    }
  }

  return { origenes, invalidos };
}

/**
 * Qué poner en `Access-Control-Allow-Origin`: el origen de ESTA petición si
 * está en la lista, o `null` para que Hono omita la cabecera (fail closed).
 * La cabecera admite un origen único o `*`, jamás una lista.
 */
export function resolveCorsOrigin(params: {
  origin: string | null | undefined;
  trustedOrigins: readonly string[];
  /** Solo en desarrollo, para no declarar cada puerto de Vite ni cada túnel. */
  allowAnyOrigin?: boolean;
}): string | null {
  const { origin, trustedOrigins, allowAnyOrigin } = params;

  if (allowAnyOrigin) {
    return origin || "*";
  }

  const solicitado = normalizeOrigin(origin);

  return solicitado && trustedOrigins.includes(solicitado) ? solicitado : null;
}

/**
 * ¿La variable declara MÁS DE UN origen?
 *
 * Existe porque no todas las variables de origen valen para lo mismo. Una lista
 * está bien donde se usa como permiso (`CORS_ORIGIN`), y está mal donde se usa
 * como BASE de una URL: `FRONTEND_URL` cae por default a `CORS_ORIGIN`, así que
 * un despliegue en dos dominios que solo declare `CORS_ORIGIN` copia la lista
 * entera en el enlace del correo de recuperación de contraseña y produce
 * `https://a,https://b/reset-password?token=…`, que el navegador no rechaza:
 * lo resuelve a un host inexistente y el clic muere en DNS.
 *
 * Se apoya en `parseOriginList`, así que una coma suelta o un dominio repetido
 * no cuentan, y las entradas inválidas tampoco: ese error tiene su propia
 * comprobación, con su propio mensaje.
 */
export function declaraVariosOrigenes(valor: string | null | undefined): boolean {
  return parseOriginList(valor).origenes.length > 1;
}
