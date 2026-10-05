/**
 * Servicio unificado para registro externo
 * Crea usuario en CRM (cliente) o Cartera (inversionista) según el tipo
 */

import apiAuth from "@/lib/api/apiAuth";
import { registroExternoErrorDesde } from "./registroExterno.errors";
import type { IdentidadDelRegistro } from "./registroSinDpi";

export type UserType = "CLIENT" | "INVESTOR";

export interface RegisterExternalUserPayload {
  userType: UserType;
  fullName: string;
  email: string;
  dpi?: string;
  phone?: string;
}

export interface RegisterExternalUserResponse {
  success: boolean;
  message: string;
  userType: UserType;
  data?: any;
  /**
   * Identidad que quedó EN VIGOR en la cuenta tras el registro. La manda
   * `register-external-auth` y no se declaraba, así que el formulario no podía
   * ver que el servidor se había negado a escribir el DPI y trataba ese 200
   * como éxito. Ver `registroQuedoSinDpi`.
   */
  identity?: IdentidadDelRegistro | null;
  /**
   * Aviso del CRM de que reconoció la ficha pero NO le escribió el DPI. Se
   * declara para no perderla de vista, pero la decisión del formulario se toma
   * con `identity.dpi`: esta bandera solo la emite el camino de CLIENT y viene
   * `undefined` en el de INVESTOR y en las altas nuevas.
   */
  dpiRegistradoEnLead?: boolean;
}

// `registerExternalUser` (sin sesión, contra POST /api/unified/register-external)
// se retiró junto con esa ruta: llamaba al CRM con el secreto de servicio
// usando datos que elegía quien llamara, y devolvía el lead completo cuando
// coincidía el correo o el DPI. No tenía ningún llamador vivo.

/**
 * Registrar usuario externo (con autenticación)
 * Útil cuando un usuario ya logueado quiere completar su registro en CRM/Cartera
 */
export const registerExternalUserAuth = async (
  payload: RegisterExternalUserPayload
): Promise<RegisterExternalUserResponse> => {
  try {
    const response = await apiAuth.post<RegisterExternalUserResponse>(
      "/api/unified/register-external-auth",
      payload
    );
    return response.data;
  } catch (error: any) {
    console.error("Error al registrar usuario externo:", error);
    // Se conserva el status/código: el formulario necesita distinguir el DPI
    // ya tomado (corregible por el titular) de un fallo cualquiera.
    throw registroExternoErrorDesde(error);
  }
};
