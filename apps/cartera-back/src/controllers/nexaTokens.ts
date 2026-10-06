import { z } from "zod";

export const nexaTokenSchema = z
  .object({
    creditoId: z.number().int().positive().max(2_147_483_647),
    // El prefijo de Nexa tiene largo variable; el identificador siempre son 9 dígitos.
    token: z.string().regex(/^\d{10,32}$/),
    identifier: z.string().regex(/^\d{9}$/),
    nexaUserId: z.number().int().positive().max(2_147_483_647),
  })
  .strict()
  // El token de Nexa es prefijo + identificador. Si no termina en el
  // identificador, el formato no es el esperado y los pagos (que llegan como
  // prefijo + identificador) nunca coincidirían: mejor fallar aquí, a la vista.
  .refine((body) => body.token.endsWith(body.identifier), "token must end with identifier");

export type NexaTokenBody = z.infer<typeof nexaTokenSchema>;

export type NexaTokenUpsertResult =
  | "created"
  | "updated"
  | "unchanged"
  | "token_conflict"
  | "token_in_use"
  | "credit_not_found";

export type NexaTokenDependencies = {
  claimNonce: (nonce: string) => Promise<boolean>;
  creditExists: (creditoId: number) => Promise<boolean>;
  upsertToken: (body: NexaTokenBody) => Promise<NexaTokenUpsertResult>;
};

// El índice único parcial sobre nexa_token puede llevar dos nombres según qué
// migración lo creó: 0048 crea `uq_nexa_credit_bindings_token`, pero si ya
// existía el de la 0045 (stack de Daniel) la 0048 no crea el suyo y queda
// `nexa_credit_bindings_uq_token`. Ambos significan "token ya ligado a otro
// crédito". Cualquier otro 23505 NO es token en uso y debe propagarse.
export const NEXA_TOKEN_UNIQUE_CONSTRAINTS = [
  "uq_nexa_credit_bindings_token",
  "nexa_credit_bindings_uq_token",
] as const;

export const isNexaTokenInUseError = (error: unknown): boolean => {
  const pg = error as { code?: string; constraint?: string } | null;
  return (
    pg?.code === "23505" &&
    (NEXA_TOKEN_UNIQUE_CONSTRAINTS as readonly string[]).includes(pg.constraint ?? "")
  );
};

export class NexaTokenError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

export const processNexaTokenRegistration = async (
  body: NexaTokenBody,
  nonce: string,
  dependencies: NexaTokenDependencies,
): Promise<"created" | "updated" | "unchanged"> => {
  if (!(await dependencies.claimNonce(nonce))) {
    throw new NexaTokenError("replay", 409);
  }
  if (!(await dependencies.creditExists(body.creditoId))) {
    throw new NexaTokenError("credit_not_found", 404);
  }
  const result = await dependencies.upsertToken(body);
  if (result === "credit_not_found") {
    throw new NexaTokenError("credit_not_found", 404);
  }
  if (result === "token_conflict" || result === "token_in_use") {
    throw new NexaTokenError(result, 409);
  }
  return result;
};
