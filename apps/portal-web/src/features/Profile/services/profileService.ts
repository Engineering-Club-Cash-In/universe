const crmURL = import.meta.env.VITE_CRM_API_URL || "http://localhost:4000";

export interface ProfileData {
  name: string;
  lastName: string;
  email: string;
  idLead: string;
  dpi?: string;
  phone?: string;
  direccion?: string;
}

export interface Opportunity {
  opportunityId: string;
  opportunityTitle: string;
  numeroSifco: string;
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

/**
 * Obtener perfil del usuario
 */
export const getProfile = async (
  email: string,
  token: string | null
): Promise<ProfileData> => {
  const response = await fetch(`${crmURL}/api/portal/lead?email=${email}`, {
    credentials: "include",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const result = await response.json();

  if (!response.ok) {
    const error: {
      message: string;
      status?: number;
      //
      data?: {
        success: boolean;
        error?: string;
      };
    } = new Error(result.error || "Error al cargar el perfil");
    error.status = response.status;
    error.data = result;
    throw error;
  }

  return result.data as ProfileData;
};

/**
 * Actualizar información del lead (DPI, teléfono o dirección)
 */
export const updateLead = async (
  payload: UpdateLeadPayload,
  token: string | null
): Promise<UpdateFieldResponse> => {
  const response = await fetch(`${crmURL}/api/portal/lead/update`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.error || "Error al actualizar la información");
  }

  return result;
};

export const getNumbersSifco = async (
  dpi: string,
  token: string | null
): Promise<Opportunity[]> => {
  const response = await fetch(`${crmURL}/api/portal/lead/sifco?dpi=${dpi}`, {
    credentials: "include",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const result = await response.json();

  if (!response.ok) {
    const error: {
      message: string;
      status?: number;
      //
      data?: {
        success: boolean;
        error?: string;
      };
    } = new Error(result.error || "Error al cargar los números Sifco");
    error.status = response.status;
    error.data = result;
    throw error;
  }

  return result.data as Opportunity[];
};
