/**
 * Servicio para operaciones del CRM - Perfil de Lead
 */

import { env } from "../../config/env";
import { portalAuthHeaders } from "./portalAuth";

// ============================================
// INTERFACES
// ============================================

export interface ProfileData {
  name: string;
  lastName: string;
  email: string;
  idLead: string;
  dpi?: string;
  phone?: string;
  direccion?: string;
}

export interface VehiclePhoto {
  id: string;
  vehicleId: string;
  inspectionId: string | null;
  category: string;
  photoType: string;
  title: string;
  description: string;
  url: string;
  valuatorComment: string | null;
  noCommentsChecked: boolean;
  createdAt: string;
}

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  licensePlate: string;
  color: string;
  status: string;
  vin: string;
  type: string;
  origin: string;
  engine: string;
  photos: VehiclePhoto[];
}

export interface Opportunity {
  opportunityId: string;
  opportunityTitle: string;
  numeroSifco: string;
  vehicle: Vehicle;
}

export interface UpdateFieldResponse {
  success: boolean;
  message: string;
  data?: ProfileData;
  error?: string;
}

export interface UpdateLeadPayload {
  email: string;
  dpi?: string;
  phone?: string;
  address?: string;
}

export interface SendLeadPayload {
  nombreCompleto: string;
  correo: string;
  telefono?: string;
  dpi: string;
  descripcion?: string;
  isRegister?: boolean;
}

// ============================================
// ERRORES
// ============================================

/**
 * Rechazo del CRM al dar de alta un lead, con el status y el motivo que dio.
 *
 * Es el espejo de `CarteraInvestorError` en el camino de INVESTOR. `sendLead`
 * convertía CUALQUIER respuesta no-OK en un `Error` pelado, así que el 409 con
 * el que el CRM rechaza un reintento que trae otro DPI llegaba a la ruta
 * indistinguible de una caída y salía como 500. El formulario no podía
 * reconocerlo como conflicto corregible y dejaba a la persona en el paso 2,
 * con el campo del DPI —lo único que se le pedía corregir— en el paso 1.
 *
 * Conservar el status es lo que permite que la ruta lo conteste como 409 con
 * un código, igual que ya hace el conflicto de DPI del camino de inversionista.
 */
export class CrmLeadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CrmLeadError";
  }
}

// ============================================
// FUNCIONES
// ============================================

/**
 * Obtener perfil del usuario (lead) del CRM
 */
export const getProfile = async (
  email: string,
  dpi: string
): Promise<ProfileData> => {
  const response = await fetch(
    `${env.CRM_API_URL}/api/portal/lead?email=${encodeURIComponent(email)}&dpi=${encodeURIComponent(dpi)}`,
    {
      headers: {
        ...portalAuthHeaders(),
      },
    }
  );

  const result = (await response.json()) as { success: boolean; data?: ProfileData; error?: string };

  if (!response.ok) {
    throw new Error(result.error || "Error al cargar el perfil");
  }

  return result.data as ProfileData;
};

/**
 * Actualizar información del lead (DPI, teléfono o dirección)
 */
export const updateLead = async (
  payload: UpdateLeadPayload
): Promise<UpdateFieldResponse> => {
  const response = await fetch(`${env.CRM_API_URL}/api/portal/lead/update`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...portalAuthHeaders(),
    },
    body: JSON.stringify(payload),
  });

  const result = (await response.json()) as UpdateFieldResponse;

  if (!response.ok || !result.success) {
    throw new Error(result.error || "Error al actualizar la información");
  }

  return result;
};

/**
 * Obtener números SIFCO del lead
 */
export const getNumbersSifco = async (
  email: string,
  dpi: string
): Promise<Opportunity[]> => {
  const response = await fetch(
    `${env.CRM_API_URL}/api/portal/lead/sifco?email=${encodeURIComponent(email)}&dpi=${encodeURIComponent(dpi)}`,
    {
      headers: {
        ...portalAuthHeaders(),
      },
    }
  );

  const result = (await response.json()) as { success: boolean; data?: Opportunity[]; error?: string };

  if (!response.ok) {
    throw new Error(result.error || "Error al cargar los números Sifco");
  }

  return result.data as Opportunity[];
};

/**
 * Enviar/Crear un lead en el CRM
 *
 * `dpiRegistradoEnLead` viaja como campo HERMANO de `data`, no dentro de él, y
 * tiene que quedar declarado aquí: es el único aviso de que el CRM autorizó el
 * acceso PERO no se quedó con el DPI del registro (le pasa a los leads que
 * ventas creó sin DPI, donde solo un humano puede ponérselo). Perderlo deja que
 * el DPI se escriba igual en Better Auth y la persona queda clavada: el
 * formulario ya no se lo pide —porque la cuenta ya lo tiene— y el CRM sigue
 * diciendo que su ficha está incompleta.
 *
 * Ausente NO es `false`: el alta nueva no emite la bandera y ahí el DPI SÍ es el
 * que quedó en el lead.
 */
export const sendLead = async (
  payload: SendLeadPayload
): Promise<{
  success: boolean;
  data?: any;
  dpiRegistradoEnLead?: boolean;
}> => {
  const response = await fetch(`${env.CRM_API_URL}/api/portal/lead`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...portalAuthHeaders(),
    },
    body: JSON.stringify(payload),
  });

  const result = (await response.json()) as {
    success: boolean;
    data?: any;
    dpiRegistradoEnLead?: boolean;
    error?: string;
  };

  if (!response.ok) {
    // El status viaja con el error: sin él, el 409 del reintento con otro DPI
    // —lo único que la persona puede corregir sola— se vuelve un 500 mudo.
    throw new CrmLeadError(
      response.status,
      result.error || "Error al crear el lead",
    );
  }

  return result;
};
