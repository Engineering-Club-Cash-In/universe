/**
 * Servicio unificado para registro de usuarios externos
 * Decide automáticamente si crear en CRM (cliente) o Cartera (inversionista)
 */

import { sendLead } from "../crm/profile.service";
import { createInvestor } from "../cartera/investor.service";
import { normalizeDpi } from "../../lib/portalIdentity";

// ============================================
// TIPOS
// ============================================

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

// ============================================
// SERVICIO UNIFICADO
// ============================================

/**
 * Registrar usuario externo según su tipo
 * - CLIENT: Crea un lead en el CRM
 * - INVESTOR: Crea un inversionista en Cartera
 */
export const registerExternalUser = async (
  payload: RegisterExternalUserPayload
): Promise<RegisterExternalUserResponse> => {
  const { userType, fullName, email, phone } = payload;

  // Último punto donde el DPI sigue siendo una cadena antes de convertirse en
  // el entero que se guarda en cartera. Se normaliza aquí para que ningún
  // llamador pueda colar separadores hasta el `parseInt`: "1234-56789-0123"
  // se convertiría en 1234 y cartera quedaría con un identificador distinto
  // al que guarda Better Auth.
  const dpi = normalizeDpi(payload.dpi);

  if (!dpi) {
    throw new Error("El DPI debe tener exactamente 13 dígitos");
  }

  try {
    if (userType === "CLIENT") {
      // Crear lead en CRM
      const result = await sendLead({
        nombreCompleto: fullName,
        correo: email,
        telefono: phone,
        dpi: dpi,
        descripcion: `Registro desde portal - Tipo: ${userType}`,
        isRegister: true
      });

      return {
        success: true,
        message: "Cliente registrado exitosamente en CRM",
        userType,
        data: result.data,
      };
    } else if (userType === "INVESTOR") {
      // Crear inversionista en Cartera
      const result = await createInvestor({
        nombre: fullName,
        dpi: parseInt(dpi, 10),
        email: email,
      });

      return {
        success: true,
        message: "Inversionista registrado exitosamente en Cartera",
        userType,
        data: result.data,
      };
    } else {
      throw new Error(`Tipo de usuario no válido: ${userType}`);
    }
  } catch (error) {
    console.error(`Error al registrar usuario externo (${userType}):`, error);
    throw error;
  }
};
