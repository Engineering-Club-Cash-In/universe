/**
 * Servicio unificado para registro de usuarios externos
 * Decide automáticamente si crear en CRM (cliente) o Cartera (inversionista)
 */

import { sendLead } from "../crm/profile.service";
import {
  CarteraInvestorError,
  createInvestor,
} from "../cartera/investor.service";
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

export interface RegisterExternalUserOptions {
  /**
   * Id de la cuenta de auth-google que pide el registro. Solo lo pasa el flujo
   * autenticado, y sirve para una cosa: sellar la fila nueva de cartera con esa
   * cuenta (`creado_por_usuario_portal`, migración 0033).
   *
   * Ese sello es lo que permite que el alta sea IDEMPOTENTE, y la decisión la
   * toma cartera, no este servicio: ante un choque, cartera devuelve la fila
   * existente solo si lleva esta misma marca, y 409 en cualquier otro caso.
   * Aquí no queda ninguna reconciliación que mantener.
   */
  usuarioPortalId?: string;
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
  payload: RegisterExternalUserPayload,
  options: RegisterExternalUserOptions = {},
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
      // Crear inversionista en Cartera.
      //
      // `operation: "CREATE"` es deliberado: el DPI de este payload lo escribió
      // quien se está registrando y nadie lo verificó. Sin el modo estricto,
      // cartera usaría ese DPI (o el nombre) para encontrar un inversionista ya
      // existente y le sobrescribiría los datos con los del registro. En modo
      // estricto un DPI, correo o nombre repetido responde 409 y no se toca
      // ninguna fila: enlazar una cuenta del portal con un inversionista que ya
      // existe es una operación de back office, no algo que decida el registro.
      //
      // La única excepción la decide cartera y no este servicio: si la fila con
      // la que se choca lleva la marca de procedencia de ESTA MISMA cuenta,
      // cartera la devuelve tal cual, sin escribir nada. Eso hace idempotente el
      // alta —un reintento repite y obtiene la misma fila— y es lo que permitió
      // borrar de aquí la reconciliación por correo, con su búsqueda, su
      // comparación de campos y la trampa del `dpi_rep_legal`.
      const result = await createInvestor({
        operation: "CREATE",
        nombre: fullName,
        dpi: parseInt(dpi, 10),
        email: email,
        // La marca viaja en el MISMO INSERT que crea la fila. Sellarla después
        // sería una segunda escritura: si se cayera en medio, la fila quedaría
        // sin dueño reconocible y el reintento volvería a chocar para siempre.
        // En el flujo público no hay cuenta que sellar y la columna queda NULL.
        ...(options.usuarioPortalId
          ? { creado_por_usuario_portal: options.usuarioPortalId }
          : {}),
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

    // El motivo exacto de cartera NO sale por aquí: "ya existe un inversionista
    // con ese DPI" convertiría el registro en un oráculo para averiguar qué
    // DPIs y correos están dados de alta en cartera. El conflicto que el
    // titular SÍ puede corregir por su cuenta —un DPI que ya pertenece a otra
    // cuenta del portal— se detecta antes, en la ruta, y se contesta 409 con
    // `dpi_ya_registrado`.
    if (error instanceof CarteraInvestorError) {
      throw new Error("No se pudo completar el registro del inversionista");
    }

    throw error;
  }
};
