/**
 * Cabecera de autorización para los endpoints `/api/portal/*` del CRM.
 *
 * Esas rutas son servicio-a-servicio: el CRM no valida al usuario final, valida
 * que quien llama sea este servicio. Por eso se envía el secreto compartido y
 * no el token de sesión del usuario, que el CRM no puede verificar (vive en
 * otra base de datos, con otro conjunto de roles).
 *
 * `CRM_PORTAL_SECRET` debe traer el mismo valor que `BETTER_SECRET_PORTAL_WEB`
 * en el CRM.
 */

import { env } from "../../config/env";

export const portalAuthHeaders = (): Record<string, string> => {
  if (!env.CRM_PORTAL_SECRET) {
    // No se lanza: se deja que el CRM responda 401 y que el aviso quede en el
    // log, para no convertir un fallo de configuración en un 500 opaco.
    console.error(
      "[ERROR] CRM_PORTAL_SECRET no está configurado; el CRM rechazará esta llamada.",
    );
    return {};
  }

  return { Authorization: `Bearer ${env.CRM_PORTAL_SECRET}` };
};
