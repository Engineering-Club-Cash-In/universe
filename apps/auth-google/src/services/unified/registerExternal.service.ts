/**
 * Servicio unificado para registro de usuarios externos
 * Decide automáticamente si crear en CRM (cliente) o Cartera (inversionista)
 */

import { sendLead } from "../crm/profile.service";
import {
  CarteraInvestorError,
  createInvestor,
} from "../cartera/investor.service";

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
        isRegister: true
      });

      return {
        success: true,
        message: "Cliente registrado exitosamente en CRM",
        userType,
        data: result.data,
      };
    } else if (userType === "INVESTOR") {
      // Crear inversionista en Cartera.
      //
      // `operation: "CREATE"` es deliberado: el DPI de este payload lo escribió
      // quien se está registrando y nadie lo verificó. Sin el modo estricto,
      // cartera usaría ese DPI (o el nombre) para encontrar un inversionista ya
      // existente y le sobrescribiría los datos con los del registro. En modo
      // estricto un DPI, correo o nombre repetido responde 409 y no se toca
      // ninguna fila: enlazar una cuenta del portal con un inversionista que ya
      // existe es una operación de back office, no algo que decida el registro.
      const result = await createInvestor({
        operation: "CREATE",
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

    // El motivo exacto de cartera NO sale por aquí. Este servicio lo usa
    // también `POST /api/unified/register-external`, que no pide sesión:
    // devolver "ya existe un inversionista con ese DPI" convertiría el registro
    // en un oráculo para averiguar qué DPIs están dados de alta.
    if (error instanceof CarteraInvestorError) {
      throw new Error("No se pudo completar el registro del inversionista");
    }

    throw error;
  }
};
