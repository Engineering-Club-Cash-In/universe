/**
 * Servicio unificado para registro de usuarios externos
 * Decide automáticamente si crear en CRM (cliente) o Cartera (inversionista)
 */

import { sendLead } from "../crm/profile.service";
import {
  CarteraInvestorError,
  createInvestor,
  findInvestorByEmail,
  type InvestorProfile,
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
   * Permite terminar un registro que quedó a medias reconociendo la fila que
   * ESTE MISMO registro creó. Solo lo activa el flujo autenticado: en el
   * público convertiría el 409 en un oráculo de correos/DPIs.
   */
  reconciliarRegistroPrevio?: boolean;
}

// ============================================
// SERVICIO UNIFICADO
// ============================================

/** Compara nombres como los guarda cartera: recortados y sin espacios dobles. */
const mismoNombre = (a: string, b: string): boolean =>
  a.trim().replace(/\s+/g, " ").toUpperCase() ===
  b.trim().replace(/\s+/g, " ").toUpperCase();

/**
 * Busca la fila que dejaría este mismo registro y la devuelve solo si coincide
 * en todo lo que el registro escribe: correo, DPI y nombre.
 *
 * Es lo que devuelve la idempotencia sin abrir el vector que cerró la creación
 * estricta. El upsert anterior encontraba al inversionista por DPI o por nombre
 * y le SOBREESCRIBÍA los datos con los del registro; aquí no se escribe nada en
 * cartera: solo se acepta como propia una fila que ya es idéntica al alta que
 * se intentó, y cualquier fila preexistente ajena (otro DPI, otro nombre, otro
 * correo, o un correo compartido por varios inversionistas) se sigue
 * rechazando.
 *
 * El correo no lo elige quien se registra: en el flujo autenticado sale de la
 * sesión, que es la misma identidad con la que el portal ya resuelve "cuál es
 * mi inversionista".
 */
const recuperarRegistroPropio = async (
  fullName: string,
  email: string,
  dpi: string,
): Promise<InvestorProfile | null> => {
  let existente: InvestorProfile | null = null;

  try {
    existente = await findInvestorByEmail(email);
  } catch {
    // Un correo ambiguo o un fallo de cartera no permiten afirmar nada.
    return null;
  }

  if (!existente) {
    return null;
  }

  const coincide =
    Number(existente.dpi) === Number(dpi) &&
    typeof existente.nombre === "string" &&
    mismoNombre(existente.nombre, fullName);

  return coincide ? existente : null;
};

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

    // El registro toca dos sistemas y no es atómico: cartera puede haber
    // insertado al inversionista y auth-google caerse (o fallar
    // `applyRegistrationOutcome`) antes de dejar el DPI y el rol en la cuenta
    // del portal. Con la creación estricta a secas, el reintento choca contra
    // la fila que él mismo creó y la cuenta se queda incompleta para siempre.
    //
    // Solo se recupera lo que este registro habría creado, y solo en el flujo
    // autenticado. Nada se escribe en cartera.
    if (
      options.reconciliarRegistroPrevio &&
      userType === "INVESTOR" &&
      error instanceof CarteraInvestorError &&
      error.status === 409
    ) {
      const propio = await recuperarRegistroPropio(fullName, email, dpi);

      if (propio) {
        return {
          success: true,
          message: "El inversionista ya estaba creado por este mismo registro",
          userType,
          data: propio,
        };
      }
    }

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
