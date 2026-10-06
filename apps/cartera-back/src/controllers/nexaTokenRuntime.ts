import { client } from "../database";
import { createNexaTokenHandler } from "./nexaTokenHandler";
import { isNexaTokenInUseError, type NexaTokenDependencies } from "./nexaTokens";

export const nexaTokenDependencies: NexaTokenDependencies = {
  claimNonce: async (nonce) => {
    const result = await client.query(
      `INSERT INTO cartera.nexa_payment_nonces (nonce) VALUES ($1)
       ON CONFLICT DO NOTHING RETURNING nonce`,
      [nonce],
    );
    return result.rows.length > 0;
  },
  creditExists: async (creditoId) => {
    const result = await client.query(
      `SELECT 1 FROM cartera.creditos WHERE credito_id = $1 LIMIT 1`,
      [creditoId],
    );
    return result.rows.length > 0;
  },
  upsertToken: async (body) => {
    try {
      const result = await client.query(
        `WITH previo AS (
           SELECT nexa_token FROM cartera.nexa_credit_bindings WHERE credito_id = $1
         ), escrito AS (
           INSERT INTO cartera.nexa_credit_bindings
             (credito_id, activo, nexa_token, nexa_identifier, nexa_user_id, token_registrado_at)
           VALUES ($1, true, $2, $3, $4, NOW())
           ON CONFLICT (credito_id) DO UPDATE
             SET nexa_token = EXCLUDED.nexa_token,
                 nexa_identifier = EXCLUDED.nexa_identifier,
                 nexa_user_id = EXCLUDED.nexa_user_id,
                 token_registrado_at = COALESCE(cartera.nexa_credit_bindings.token_registrado_at, NOW())
             -- Mismo token con otro identificador o usuario de Nexa no es el
             -- mismo registro: se trata como conflicto, no se pisa en silencio.
             WHERE cartera.nexa_credit_bindings.nexa_token IS NULL
                OR (cartera.nexa_credit_bindings.nexa_token = EXCLUDED.nexa_token
                    AND cartera.nexa_credit_bindings.nexa_identifier IS NOT DISTINCT FROM EXCLUDED.nexa_identifier
                    AND cartera.nexa_credit_bindings.nexa_user_id IS NOT DISTINCT FROM EXCLUDED.nexa_user_id)
           RETURNING credito_id
         )
         SELECT
           (SELECT COUNT(*) FROM escrito)::int AS escritos,
           EXISTS (SELECT 1 FROM previo) AS existia,
           (SELECT nexa_token FROM previo) AS token_previo`,
        [body.creditoId, body.token, body.identifier, body.nexaUserId],
      );
      const row = result.rows[0] as { escritos: number; existia: boolean; token_previo: string | null };
      if (row.escritos === 0) return "token_conflict";
      if (!row.existia) return "created";
      if (row.token_previo === null) return "updated";
      return "unchanged";
    } catch (error) {
      const pgError = error as { code?: string };
      if (isNexaTokenInUseError(error)) return "token_in_use";
      if (pgError.code === "23503") return "credit_not_found";
      throw error;
    }
  },
};

export const nexaTokenHandler = createNexaTokenHandler({
  secret: process.env.NEXA_INTERNAL_API_SECRET ?? "",
  windowSeconds: Number(process.env.NEXA_HMAC_WINDOW_SECONDS ?? 300),
  dependencies: nexaTokenDependencies,
});
