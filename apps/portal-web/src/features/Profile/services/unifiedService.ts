/**
 * Servicio unificado para registro externo
 * Crea usuario en CRM (cliente) o Cartera (inversionista) según el tipo
 */

import apiAuth from "@/lib/api/apiAuth";

export type UserType = "CLIENT" | "INVESTOR";

export interface RegisterExternalUserPayload {
  userType: UserType;
  fullName: string;
  email: string;
  dpi: string;
  phone?: string;
}

export interface RegisterExternalUserResponse {
  success: boolean;
  message: string;
  userType: UserType;
  data?: any;
}

/**
 * Registrar usuario externo (sin autenticación requerida)
 * La API decide automáticamente si crear en CRM o Cartera según userType
 */
export const registerExternalUser = async (
  payload: RegisterExternalUserPayload
): Promise<RegisterExternalUserResponse> => {
  try {
    const response = await apiAuth.post<RegisterExternalUserResponse>(
      "/api/unified/register-external",
      payload
    );
    return response.data;
  } catch (error: any) {
    const message = error.response?.data?.message || "Error al registrar usuario externo";
    console.error("Error al registrar usuario externo:", error);
    throw new Error(message);
  }
};

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
    const message = error.response?.data?.message || "Error al registrar usuario externo";
    console.error("Error al registrar usuario externo:", error);
    throw new Error(message);
  }
};
