/**
 * Servicio unificado para registro de usuarios externos
 * Decide automáticamente si crear en CRM (cliente) o Cartera (inversionista)
 */

import { sendLead } from "../crm/profile.service";
import { createInvestor } from "../cartera/investor.service";

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
  const { userType, fullName, email, dpi, phone } = payload;

  try {
    if (userType === "CLIENT") {
      // Crear lead en CRM
      const result = await sendLead({
        nombreCompleto: fullName,
        correo: email,
        telefono: phone,
        dpi: dpi,
        descripcion: `Registro desde portal - Tipo: ${userType}`,
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
        emite_factura: false,
        tipo_reinversion: "sin_reinversion",
        banco: null,
        tipo_cuenta: null,
        numero_cuenta: "",
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
