import { Elysia, t } from "elysia";
import { findSessionUser } from "../controllers/auth";
import {
  cuentaNexaDeps,
  marcarCuentaNexaNotificada,
  solicitarCuentaNexa,
} from "../controllers/nexaCuentaCliente";
import { authMiddleware } from "./midleware";

// `authMiddleware` solo valida la firma del JWT, no el rol: sin esto un token
// de inversionista del portal podría crear o leer el token de pago de
// cualquier crédito. El CRM entra con su cuenta de servicio (ADMIN).
const ROLES_CUENTA_NEXA = ["ADMIN", "CONTA"];
const NO_AUTORIZADO = { error: "No autorizado (requiere ADMIN o CONTA)." };
const SESION_NO_VALIDA = { error: "Tu sesión no es válida. Vuelve a iniciar sesión." };
const rolPermitido = (role: unknown) => ROLES_CUENTA_NEXA.includes(String(role ?? ""));

/**
 * El rol del token primero (403 sin tocar la base) y después la fila VIGENTE de
 * platform_users: un ADMIN o CONTA desactivado (401) o al que le quitaron el
 * rol (403) no sigue pidiendo tokens de pago con un JWT todavía vivo. Si la
 * base falla, lanza y la ruta responde 500: falla cerrado.
 */
async function rechazoCuentaNexa(user: unknown, set: { status?: number | string }) {
  const sesion = user as { id?: unknown; role?: unknown } | undefined;
  if (!rolPermitido(sesion?.role)) {
    set.status = 403;
    return NO_AUTORIZADO;
  }
  const vigente = await findSessionUser(sesion?.id);
  if (!vigente || !vigente.is_active) {
    set.status = 401;
    return SESION_NO_VALIDA;
  }
  if (!rolPermitido(vigente.role)) {
    set.status = 403;
    return NO_AUTORIZADO;
  }
  return null;
}

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
    async ({ body, set, user }) => {
      const rechazo = await rechazoCuentaNexa(user, set);
      if (rechazo) return rechazo;
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
    async ({ body, set, user }) => {
      const rechazo = await rechazoCuentaNexa(user, set);
      if (rechazo) return rechazo;
      const marcada = await marcarCuentaNexaNotificada(body.numero_credito_sifco);
      if (!marcada) set.status = 404;
      return { marcada };
    },
    { body: t.Object({ numero_credito_sifco: t.String({ minLength: 1 }) }) },
  );
