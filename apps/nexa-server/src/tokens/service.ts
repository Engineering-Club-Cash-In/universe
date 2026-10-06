import { formatTokenIdentifierForPrefix } from "./identifier";

export interface TokenUserCreationRepository {
  nextIdentifierSequence(): Promise<number>;
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

export async function createTokenUserForCredit(options: {
  creditoId: number;
  description: string;
  nationalId: string;
  paymentToken: { id: number; nexaTokenId: number; prefix: string };
  repository: TokenUserCreationRepository;
  nexa: TokenUserCreationNexaClient;
}) {
  const identifier = formatTokenIdentifierForPrefix({
    prefix: options.paymentToken.prefix,
    sequence: await options.repository.nextIdentifierSequence(),
  });
  const response = await options.nexa.createTokenUsers({
    tokenId: options.paymentToken.nexaTokenId,
    users: [{ identifier: Number(identifier), description: options.description, nationalId: Number(options.nationalId) }],
  });

  const error = response.errorUsers.find((user) => String(user.identifier) === identifier);
  if (error) {
    throw new Error(`Nexa rejected token user ${identifier}: ${error.reason}`);
  }

  const [created] = response.users;
  if (!created) {
    throw new Error(`Nexa did not return created token user ${identifier}`);
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
