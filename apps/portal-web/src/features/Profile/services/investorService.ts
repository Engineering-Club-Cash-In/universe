/**
 * Servicio de inversionistas - Proxy a través de Better Auth API
 */

import apiAuth from "@/lib/api/apiAuth";

// Interfaces

/**
 * Campos de cobro que el titular puede editar de su propio inversionista.
 *
 * La identidad no viaja en el cuerpo: el servidor resuelve el inversionista
 * con el correo de la sesión y dirige la escritura por su id.
 */
export interface UpdateInvestorPayload {
  banco_id?: number;
  tipo_cuenta?: string;
  numero_cuenta?: string;
}

export interface CreateInvestorResponse {
  success: boolean;
  message: string;
  data?: any;
}

export interface InvestorProfile {
  inversionista_id: number;
  nombre: string;
  dpi: number;
  email: string;
  emite_factura: boolean;
  tipo_reinversion: string;
  banco_id: string | null;
  tipo_cuenta: string | null;
  numero_cuenta: string | null;
}

export interface InvestorDocument {
  documento_id: number;
  inversionista_id: number;
  key: string;
  nombre: string;
  descripcion: string | null;
  visible: boolean;
  created_at: string;
  created_by: string | null;
  url: string;
  downloadUrl: string;
}

export interface Banco {
  banco_id: number;
  nombre: string;
  codigo: string;
}

/**
 * Actualizar los datos de cobro del inversionista de la cuenta autenticada
 */
export const updateOwnInvestor = async (
  payload: UpdateInvestorPayload
): Promise<CreateInvestorResponse> => {
  try {
    const response = await apiAuth.post<CreateInvestorResponse>(
      "/api/cartera/investor",
      payload
    );
    return response.data;
  } catch (error) {
    console.error("Error al actualizar inversionista:", error);
    throw error;
  }
};

/**
 * Obtener perfil de inversionista por DPI
 */
export const getInvestorProfile = async (
  dpi: string = "",
  email: string = ""
): Promise<InvestorProfile> => {
  try {
    const response = await apiAuth.get<{ data: InvestorProfile }>(
      `/api/cartera/investor?dpi=${encodeURIComponent(dpi)}&email=${encodeURIComponent(email)}`
    );
    return response.data.data;
  } catch (error) {
    console.error("Error al obtener perfil del inversionista:", error);
    throw error;
  }
};

/**
 * Obtener documentos del inversionista por email
 */
export const getInvestorDocuments = async (
  email: string
): Promise<InvestorDocument[]> => {
  try {
    const response = await apiAuth.get<{ data: InvestorDocument[] }>(
      `/api/cartera/investor-documents/client/${encodeURIComponent(email)}`
    );
    return response.data.data;
  } catch (error) {
    console.error("Error al obtener documentos del inversionista:", error);
    throw error;
  }
};

/**
 * Obtener catálogo de bancos
 */
export const getBancos = async (): Promise<Banco[]> => {
  try {
    const response = await apiAuth.get<{ data: Banco[] }>(
      "/api/cartera/bancos"
    );
    return response.data.data;
  } catch (error) {
    console.error("Error al obtener bancos:", error);
    throw error;
  }
};
