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
   * Id de la cuenta de auth-google que pide el registro. Solo lo pasa el flujo
   * autenticado, y hace dos cosas: sella la fila nueva en cartera con esa
   * cuenta, y habilita reconocer al reintentar la fila que ESE MISMO sello
   * identifica como propia.
   *
   * Sin él no hay reconciliación, y así debe ser en el flujo público: allí
   * convertiría el 409 en un oráculo de correos y DPIs dados de alta.
   */
  usuarioPortalId?: string;
}

// ============================================
// SERVICIO UNIFICADO
// ============================================

/**
 * Devuelve la fila de cartera que creó ESTA MISMA cuenta del portal, o `null`.
 *
 * La única prueba admisible es la marca de procedencia
 * (`creado_por_usuario_portal`), que cartera escribe solo en el INSERT del
 * alta. No se compara ningún dato de la fila.
 *
 * Antes se comparaban correo, DPI y nombre, y esa heurística no podía
 * funcionar: coincidir en esos tres campos prueba que una fila TIENE los
 * valores pedidos, no que este registro la haya creado. Peor aún, el DPI que
 * llegaba no era el de la fila: la consulta por correo de cartera devuelve
 * `dpi: dpi_rep_legal` cuando hay representante legal, así que las filas de
 * sociedad —`dpi` NULL, `dpi_rep_legal` puesto, imposibles de crear desde el
 * portal— pasaban la comparación con el DPI del representante. Con el registro
 * por correo sin verificar, bastaba con crear una cuenta con el correo del
 * inversionista y mandar su nombre y ese DPI para quedarse con la fila.
 */
const recuperarRegistroPropio = async (
  email: string,
  usuarioPortalId: string,
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

  return existente.creado_por_usuario_portal === usuarioPortalId
    ? existente
    : null;
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

    // El registro toca dos sistemas y no es atómico: cartera puede haber
    // insertado al inversionista y auth-google caerse (o fallar
    // `applyRegistrationOutcome`) antes de dejar el DPI y el rol en la cuenta
    // del portal. Con la creación estricta a secas, el reintento choca contra
    // la fila que él mismo creó y la cuenta se queda incompleta para siempre.
    //
    // Solo se recupera lo que este registro habría creado, y solo en el flujo
    // autenticado. Nada se escribe en cartera.
    if (
      options.usuarioPortalId &&
      userType === "INVESTOR" &&
      error instanceof CarteraInvestorError &&
      error.status === 409
    ) {
      const propio = await recuperarRegistroPropio(
        email,
        options.usuarioPortalId,
      );

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
