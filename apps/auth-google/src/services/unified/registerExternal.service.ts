/**
 * Servicio unificado para registro de usuarios externos
 * Decide automáticamente si crear en CRM (cliente) o Cartera (inversionista)
 */

import { sendLead } from "../crm/profile.service";

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
      // CERRADO. Esta ruta no lleva `requireAuth` (unified.routes.ts:63), así
      // que este brazo dejaba a cualquiera escribir en `cartera.inversionistas`
      // el nombre, el DPI y el correo que quisiera.
      //
      // El daño no era solo una fila de más: `insertInvestor` cae en el upsert
      // legacy y, si el DPI ya existe, UPDATEA la fila del inversionista REAL y
      // le reescribe el correo (investor.ts:672-678). Con eso, la liquidación y
      // los avisos de esa persona se van al buzón de quien mandó el POST, sin
      // que nadie apriete nada.
      //
      // Un alta de inversionista es un acto de back office: pasa por
      // `POST /investor` de cartera con un usuario de cartera. No hay
      // autoservicio.
      throw new Error(
        "El registro público no da de alta inversionistas. El alta la hace back office desde cartera.",
      );
    } else {
      throw new Error(`Tipo de usuario no válido: ${userType}`);
    }
  } catch (error) {
    console.error(`Error al registrar usuario externo (${userType}):`, error);
    throw error;
  }
};
