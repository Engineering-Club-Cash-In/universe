/**
 * Servicio de inversionistas - Proxy a través de Better Auth API
 */

import apiAuth from "@/lib/api/apiAuth";

// Interfaces
/**
 * Lo único que el inversionista puede editar de su propia ficha desde el
 * portal. El servidor descarta cualquier otro campo, y la entidad se identifica
 * por id — mandar dpi/email hacía que el upsert de cartera resolviera por DPI y
 * terminara editando la ficha personal en vez de la de la sociedad.
 */
export interface UpdateInvestorAccountPayload {
  inversionista_id: number;
  banco_id?: number;
  tipo_cuenta?: string;
  numero_cuenta?: string;
}

export interface UpdateInvestorAccountResponse {
  success: boolean;
  message: string;
  data?: any;
}

export interface InvestorProfile {
  inversionista_id: number;
  nombre: string;
  /** null en las sociedades: ahí el DPI del humano va en dpi_rep_legal. */
  dpi: number | null;
  dpi_rep_legal: string | null;
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
 * Actualizar los datos bancarios de una de las entidades del usuario
 */
export const updateInvestorAccount = async (
  payload: UpdateInvestorAccountPayload
): Promise<UpdateInvestorAccountResponse> => {
  try {
    const response = await apiAuth.post<UpdateInvestorAccountResponse>(
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
 * Obtener perfil de la entidad indicada
 */
export const getInvestorProfile = async (
  inversionistaId: number
): Promise<InvestorProfile> => {
  try {
    const response = await apiAuth.get<{ data: InvestorProfile }>(
      `/api/cartera/investor?inversionista_id=${inversionistaId}`
    );
    return response.data.data;
  } catch (error) {
    console.error("Error al obtener perfil del inversionista:", error);
    throw error;
  }
};

/**
 * Obtener documentos visibles de la entidad indicada
 */
export const getInvestorDocuments = async (
  inversionistaId: number
): Promise<InvestorDocument[]> => {
  try {
    const response = await apiAuth.get<{ data: InvestorDocument[] }>(
      `/api/cartera/investor-documents?inversionista_id=${inversionistaId}`
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
