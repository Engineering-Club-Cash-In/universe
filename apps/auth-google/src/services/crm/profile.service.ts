/**
 * Servicio para operaciones del CRM - Perfil de Lead
 */

import { env } from "../../config/env";

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
}

// ============================================
// FUNCIONES
// ============================================

/**
 * Obtener perfil del usuario (lead) del CRM
 */
export const getProfile = async (
  email: string,
  dpi: string,
  token?: string
): Promise<ProfileData> => {
  const response = await fetch(
    `${env.CRM_API_URL}/api/portal/lead?email=${encodeURIComponent(email)}&dpi=${encodeURIComponent(dpi)}`,
    {
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
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
  payload: UpdateLeadPayload,
  token?: string
): Promise<UpdateFieldResponse> => {
  const response = await fetch(`${env.CRM_API_URL}/api/portal/lead/update`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
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
  dpi: string,
  token?: string
): Promise<Opportunity[]> => {
  const response = await fetch(
    `${env.CRM_API_URL}/api/portal/lead/sifco?email=${encodeURIComponent(email)}&dpi=${encodeURIComponent(dpi)}`,
    {
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
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
 */
export const sendLead = async (
  payload: SendLeadPayload,
  token?: string
): Promise<{ success: boolean; data?: any }> => {
  const response = await fetch(`${env.CRM_API_URL}/api/portal/lead`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(payload),
  });

  const result = (await response.json()) as { success: boolean; data?: any; error?: string };

  if (!response.ok) {
    throw new Error(result.error || "Error al crear el lead");
  }

  return result;
};
