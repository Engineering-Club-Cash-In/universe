import { formatTokenIdentifierForPrefix } from "./identifier";

export interface TokenUserCreationRepository {
  nextIdentifierSequence(): Promise<number>;
  /**
   * Identificador reservado del crédito (lo crea si no existe). `reused` dice
   * si la reserva venía de un intento anterior; `nexaUserId`/`token` traen la
   * respuesta de Nexa si ese intento la alcanzó a guardar.
   */
  reserveIdentifier(creditoId: number, nextIdentifier: () => Promise<string>): Promise<{
    identifier: string;
    reused?: boolean;
    nexaUserId?: number | null;
    token?: string | null;
  }>;
  /** Guarda la respuesta de Nexa en la reserva antes del token user. */
  saveReservationResponse?(creditoId: number, response: { nexaUserId: number; token: string }): Promise<void>;
  createTokenUser(user: {
    paymentTokenId: number;
    creditoId: number;
    identifier: string;
    description: string;
    nationalId: string;
    nexaUserId: number;
    token: string;
  }): Promise<unknown>;
}

type StoredTokenUser = {
  paymentTokenId?: number;
  creditoId?: number;
  identifier?: string;
  description?: string;
  nationalId?: string;
  nexaUserId?: number;
  token?: string;
};

interface TokenUserCreationNexaClient {
  createTokenUsers(payload: {
    tokenId: number;
    users: Array<{ identifier: number; description: string; nationalId: number }>;
  }): Promise<{
    users: Array<{ id: number; token: string }>;
    errorUsers: Array<{ identifier: string | number; reason: string }>;
  }>;
}

// Misma forma que el resto del repo (`************5010`).
function maskToken(token: string) {
  return token.length <= 4 ? "*".repeat(token.length) : "*".repeat(token.length - 4) + token.slice(-4);
}

/**
 * El identificador reservado ya se usó en un intento anterior cuya respuesta
 * no se alcanzó a guardar, y Nexa lo rechaza ahora (repetido). La API de Nexa
 * no permite consultar el usuario existente, así que hay que conciliarlo a
 * mano; no se crea otro usuario.
 */
export class TokenUserReconciliationRequiredError extends Error {
  constructor(readonly identifier: string, readonly reason: string) {
    super(`Token user ${identifier} requires manual reconciliation: ${reason}`);
  }
}

export async function createTokenUserForCredit(options: {
  creditoId: number;
  description: string;
  nationalId: string;
  paymentToken: { id: number; nexaTokenId: number; prefix: string };
  repository: TokenUserCreationRepository;
  nexa: TokenUserCreationNexaClient;
}) {
  // Reserva durable ANTES de la llamada a Nexa: si Nexa crea el usuario y el
  // guardado de abajo falla, el reintento manda este mismo identificador y
  // Nexa lo rechaza como repetido en vez de crear un segundo usuario huérfano.
  const reservation = await options.repository.reserveIdentifier(options.creditoId, async () =>
    formatTokenIdentifierForPrefix({
      prefix: options.paymentToken.prefix,
      sequence: await options.repository.nextIdentifierSequence(),
    }),
  );
  const { identifier } = reservation;

  let created: { id: number; token: string };
  if (reservation.nexaUserId != null && reservation.token) {
    // Un intento anterior ya tenía la respuesta de Nexa y falló al guardar el
    // token user: se termina desde la reserva, sin volver a llamar a Nexa.
    created = { id: reservation.nexaUserId, token: reservation.token };
  } else {
    const response = await options.nexa.createTokenUsers({
      tokenId: options.paymentToken.nexaTokenId,
      users: [{ identifier: Number(identifier), description: options.description, nationalId: Number(options.nationalId) }],
    });

    const error = response.errorUsers.find((user) => String(user.identifier) === identifier);
    if (error) {
      if (reservation.reused) throw new TokenUserReconciliationRequiredError(identifier, error.reason);
      throw new Error(`Nexa rejected token user ${identifier}: ${error.reason}`);
    }

    const [first] = response.users;
    if (!first) {
      throw new Error(`Nexa did not return created token user ${identifier}`);
    }
    created = first;
    // Primero la reserva (escritura chica): si lo de abajo falla, el
    // reintento no vuelve a pedirle el usuario a Nexa.
    await options.repository.saveReservationResponse?.(options.creditoId, { nexaUserId: created.id, token: created.token });
  }

  // cartera guarda el token y lo compara con prefijo + identificador de cada
  // pago: se registra siempre esa forma, no la que devuelva Nexa.
  const token = `${options.paymentToken.prefix}${identifier}`;
  if (created.token !== token) {
    // Nunca el token completo en los logs: solo los últimos 4 dígitos.
    console.error(
      `Nexa token mismatch for credito ${options.creditoId}, identifier ${identifier}: Nexa returned ${maskToken(created.token)}, registering ${maskToken(token)}`,
    );
  }

  const tokenUser = {
    paymentTokenId: options.paymentToken.id,
    creditoId: options.creditoId,
    identifier,
    description: options.description,
    nationalId: options.nationalId,
    nexaUserId: created.id,
    token,
  };

  const stored = (await options.repository.createTokenUser(tokenUser)) as StoredTokenUser | null | undefined;
  // El repositorio devuelve el token ya guardado si otro proceso se adelantó
  // para este crédito: ese es el vigente (el recién creado en Nexa queda sin
  // usar, pero el crédito no termina con dos tokens activos).
  if (
    stored?.creditoId === tokenUser.creditoId &&
    stored.token &&
    stored.token !== tokenUser.token &&
    stored.identifier &&
    stored.nexaUserId !== undefined
  ) {
    return {
      paymentTokenId: stored.paymentTokenId ?? tokenUser.paymentTokenId,
      creditoId: tokenUser.creditoId,
      identifier: stored.identifier,
      description: stored.description ?? tokenUser.description,
      nationalId: stored.nationalId ?? tokenUser.nationalId,
      nexaUserId: stored.nexaUserId,
      token: stored.token,
    };
  }
  return tokenUser;
}
