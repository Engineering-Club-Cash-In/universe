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
 * Devuelve el origen canónico si el valor crudo es UNA sola URL canónica, y
 * `null` si es cualquier otra cosa.
 *
 * Existe porque no todas las variables de origen valen para lo mismo. Una lista
 * está bien donde se usa como permiso (`CORS_ORIGIN`), y está mal donde se usa
 * como BASE de una URL: `FRONTEND_URL` cae por default a `CORS_ORIGIN`, así que
 * un despliegue en dos dominios que solo declare `CORS_ORIGIN` copia la lista
 * entera en el enlace del correo de recuperación de contraseña y produce
 * `https://a,https://b/reset-password?token=…`, que el navegador no rechaza:
 * lo resuelve a un host inexistente y el clic muere en DNS.
 *
 * Mira el valor CRUDO y no la lista ya partida por comas, que es donde estaba
 * el hueco: partir primero hace desaparecer las entradas vacías y los
 * repetidos, así que `https://portal.example,` y
 * `https://portal.example,https://portal.example` daban "un solo origen" y
 * dejaban pasar la coma al enlace. Por eso la coma descalifica el valor sin
 * más: nunca forma parte de un origen canónico, pero `new URL` sí se la traga
 * dentro del host.
 *
 * Se canoniza en vez de devolver un booleano para que quien llama guarde la
 * forma limpia: el enlace se arma concatenando, y una barra final en la
 * variable salía como `https://portal.example//reset-password`.
 *
 * Lo que SÍ acepta, porque no hay ninguna duda de a dónde va la gente y sale
 * canonizado: espacios alrededor, barra final y el host en mayúsculas. Lo que
 * NO acepta, aunque `new URL` lo parsee: una ruta, query o fragmento. Quedarse
 * con el origen y tirar el resto es justo el fallo silencioso que la variable
 * quiere evitar.
 */
export function origenUnicoCanonico(
  valor: string | null | undefined,
): string | null {
  if (typeof valor !== "string") {
    return null;
  }

  const bruto = valor.trim();

  if (!bruto || bruto.includes(",")) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(bruto);
  } catch {
    return null;
  }

  // `origin` es el literal "null" en los esquemas que no tienen uno (`data:`,
  // `file:` y cualquier esquema no estándar).
  if (url.origin === "null") {
    return null;
  }

  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    return null;
  }

  return url.origin;
}
