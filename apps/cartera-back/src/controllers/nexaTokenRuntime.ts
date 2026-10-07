import { client } from "../database";
import { withPaymentAdvisoryLock } from "../utils/paymentAdvisoryLock";
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
  creditCancelled: async (creditoId) => {
    const result = await client.query(
      `SELECT 1 FROM cartera.creditos WHERE credito_id = $1 AND "statusCredit" = 'CANCELADO' LIMIT 1`,
      [creditoId],
    );
    return result.rows.length > 0;
  },
  // Bajo el candado canónico de pagos del crédito, el mismo que toman el pago
  // Nexa y las cancelaciones, y en el mismo orden (advisory primero, filas
  // después). Sin él, el FOR SHARE de abajo cerraba un ciclo invisible para
  // Postgres: el pago sostiene el binding en la conexión del candado, el
  // registro toma FOR SHARE del crédito y espera ese binding, y el trabajo del
  // pago (otra conexión) espera el FOR SHARE para escribir `creditos`; la
  // conexión del candado espera al trabajo en la aplicación. Con el candado, el
  // registro espera a que el pago termine y no sostiene nada mientras espera.
  upsertToken: (body) => withPaymentAdvisoryLock(body.creditoId, async () => {
    try {
      const result = await client.query(
        `WITH previo AS (
           SELECT nexa_token FROM cartera.nexa_credit_bindings WHERE credito_id = $1
         ), escrito AS (
           INSERT INTO cartera.nexa_credit_bindings
             (credito_id, activo, nexa_token, nexa_identifier, nexa_user_id, token_registrado_at)
           -- Nace activo salvo que el crédito esté CANCELADO: un cancelado nunca
           -- se reactiva. FOR SHARE toma candado de fila sobre el crédito, que
           -- conflictúa con el UPDATE de la cancelación (la FK sola toma FOR KEY
           -- SHARE, que no lo bloquea). Si la cancelación va primero, este
           -- statement espera su commit y relee el crédito ya CANCELADO. Si va
           -- primero el registro, el UPDATE de la cancelación espera, y el
           -- statement posterior de desactivarNexaPorCancelacion ve el binding.
           SELECT c.credito_id, c."statusCredit" <> 'CANCELADO', $2, $3, $4, NOW()
             FROM cartera.creditos c WHERE c.credito_id = $1
             FOR SHARE OF c
           -- Registrar o re-registrar el token NUNCA toca activo: un binding
           -- inactivo (crédito cancelado) sigue inactivo.
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
           -- activo sale del propio INSERT/UPDATE: el SELECT exterior vería la foto
           -- del inicio del statement, no la fila que esta escritura acaba de crear.
           RETURNING credito_id, activo
         )
         SELECT
           (SELECT COUNT(*) FROM escrito)::int AS escritos,
           (SELECT activo FROM escrito LIMIT 1) AS activo_escrito,
           EXISTS (SELECT 1 FROM previo) AS existia,
           EXISTS (SELECT 1 FROM cartera.creditos WHERE credito_id = $1) AS credito_existe,
           (SELECT nexa_token FROM previo) AS token_previo`,
        [body.creditoId, body.token, body.identifier, body.nexaUserId],
      );
      const row = result.rows[0] as {
        escritos: number;
        activo_escrito: boolean | null;
        existia: boolean;
        credito_existe: boolean;
        token_previo: string | null;
      };
      if (!row.credito_existe) return "credit_not_found";
      if (row.escritos === 0) return "token_conflict";
      // El binding nació (o ya estaba) inactivo: el crédito se canceló en la carrera.
      if (row.activo_escrito === false) return "credit_cancelled";
      if (!row.existia) return "created";
      if (row.token_previo === null) return "updated";
      return "unchanged";
    } catch (error) {
      const pgError = error as { code?: string };
      if (isNexaTokenInUseError(error)) return "token_in_use";
      if (pgError.code === "23503") return "credit_not_found";
      throw error;
    }
  }),
};

export const nexaTokenHandler = createNexaTokenHandler({
  secret: process.env.NEXA_INTERNAL_API_SECRET ?? "",
  windowSeconds: Number(process.env.NEXA_HMAC_WINDOW_SECONDS ?? 300),
  dependencies: nexaTokenDependencies,
});
