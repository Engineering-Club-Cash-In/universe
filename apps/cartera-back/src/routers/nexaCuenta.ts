import { Elysia, t } from "elysia";
import {
  cuentaNexaDeps,
  marcarCuentaNexaNotificada,
  solicitarCuentaNexa,
} from "../controllers/nexaCuentaCliente";
import { authMiddleware } from "./midleware";

/**
 * Cuenta Nexa del cliente (token de pago por crédito). La usa el CRM al cerrar
 * el crédito al 90% para incluirla en la bienvenida.
 */
export const nexaCuentaRouter = new Elysia()
  .use(authMiddleware)
  /**
   * POST /creditos/cuenta-nexa
   * Body: { numero_credito_sifco, dpi? }
   * Devuelve la cuenta del crédito, creándola en nexa-server si no existe.
   * Idempotente: llamarla de nuevo devuelve el mismo token.
   *
   * Responde 200 también cuando la cuenta queda pendiente (nexa-server caído o
   * Nexa rechazó): `estado: "pendiente"` le dice al CRM que mande la
   * bienvenida sin la cuenta; el barrido de reintentos la crea y avisa aparte.
   */
  .post(
    "/creditos/cuenta-nexa",
    async ({ body, set }) => {
      const resultado = await solicitarCuentaNexa(
        { numeroSifco: body.numero_credito_sifco, dpi: body.dpi ?? null },
        cuentaNexaDeps,
      );
      if (resultado.estado === "credito_no_encontrado") set.status = 404;
      if (resultado.estado === "dpi_invalido") set.status = 400;
      return resultado;
    },
    {
      body: t.Object({
        numero_credito_sifco: t.String({ minLength: 1 }),
        dpi: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  /**
   * POST /creditos/cuenta-nexa/notificada
   * Body: { numero_credito_sifco }
   * El CRM avisa que la bienvenida con la cuenta ya salió, para que el
   * barrido no le mande al cliente el mensaje aparte.
   */
  .post(
    "/creditos/cuenta-nexa/notificada",
    async ({ body, set }) => {
      const marcada = await marcarCuentaNexaNotificada(body.numero_credito_sifco);
      if (!marcada) set.status = 404;
      return { marcada };
    },
    { body: t.Object({ numero_credito_sifco: t.String({ minLength: 1 }) }) },
  );
