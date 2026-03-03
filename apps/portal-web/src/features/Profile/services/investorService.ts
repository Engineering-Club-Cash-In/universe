/**
 * Servicio de inversionistas - Proxy a través de Better Auth API
 */

import apiAuth from "@/lib/api/apiAuth";

// Interfaces
export interface CreateInvestorPayload {
  nombre?: string;
  dpi: number;
  email?: string;
  emite_factura?: boolean;
  tipo_reinversion: string;
  banco_id?: string | null;
  tipo_cuenta?: string | null;
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

export interface Banco {
  banco_id: number;
  nombre: string;
  codigo: string;
}

/**
 * Crear o actualizar un inversionista
 */
export const createInvestor = async (
  payload: CreateInvestorPayload
): Promise<CreateInvestorResponse> => {
  try {
    const response = await apiAuth.post<CreateInvestorResponse>(
      "/api/cartera/investor",
      payload
    );
    return response.data;
  } catch (error) {
    console.error("Error al crear inversionista:", error);
    throw error;
  }
};

/**
 * Obtener perfil de inversionista por DPI
 */
export const getInvestorProfile = async (
  dpi: string,
  email: string
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
