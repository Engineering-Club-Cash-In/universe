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

interface TokenUserCreationNexaClient {
  createTokenUsers(payload: {
    tokenId: number;
    users: Array<{ identifier: number; description: string; nationalId: number }>;
  }): Promise<{
    users: Array<{ id: number; token: string }>;
    errorUsers: Array<{ identifier: string | number; reason: string }>;
  }>;
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

  const tokenUser = {
    paymentTokenId: options.paymentToken.id,
    creditoId: options.creditoId,
    identifier,
    description: options.description,
    nationalId: options.nationalId,
    nexaUserId: created.id,
    token: created.token,
  };

  await options.repository.createTokenUser(tokenUser);
  return tokenUser;
}
