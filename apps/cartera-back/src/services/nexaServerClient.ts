/**
 * Cliente de nexa-server para crear la cuenta Nexa (token user) de un crédito.
 *
 * nexa-server expone la creación en su API admin (`POST /admin/token-users`,
 * Bearer `NEXA_ADMIN_API_KEY`). La ruta es idempotente por crédito: si el
 * crédito ya tiene token, lo devuelve con 200 en vez de pedirle otro a Nexa,
 * así que cartera puede reintentar sin miedo a duplicar.
 */

export type TokenUserNexa = {
  creditoId: number;
  identifier: string;
  nexaUserId: number;
  token: string;
};

export class NexaServerError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;

export async function crearTokenUserNexa(
  params: { creditoId: number; description: string; nationalId: string },
  opts: { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch },
): Promise<TokenUserNexa> {
  if (!opts.baseUrl || !opts.apiKey) {
    throw new NexaServerError("nexa-server no está configurado (NEXA_SERVER_URL / NEXA_ADMIN_API_KEY)", null);
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${opts.baseUrl}/admin/token-users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new NexaServerError(`nexa-server no respondió: ${message}`, null);
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const detalle =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : text.slice(0, 300);
    throw new NexaServerError(`nexa-server respondió ${response.status}: ${detalle}`, response.status);
  }

  const user = body as Partial<TokenUserNexa> | null;
  if (
    !user ||
    typeof user.token !== "string" ||
    !/^\d+$/.test(user.token) ||
    typeof user.identifier !== "string" ||
    typeof user.nexaUserId !== "number" ||
    user.creditoId !== params.creditoId
  ) {
    throw new NexaServerError("nexa-server devolvió una respuesta inesperada", response.status);
  }
  return {
    creditoId: user.creditoId,
    identifier: user.identifier,
    nexaUserId: user.nexaUserId,
    token: user.token,
  };
}
