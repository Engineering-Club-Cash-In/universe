import { ensureCarteraAuth } from "./loginCartera";

const carteraURL =
  import.meta.env.VITE_CARTERA_API_URL || "http://localhost:5000";

// Interfaces
export interface CreateInvestorPayload {
  nombre?: string;
  dpi: number;
  email?: string;
  emite_factura?: boolean;
  tipo_reinversion: string;
  banco?: string | null;
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
  banco: string | null;
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
    // Asegurar autenticación
    // const token = await ensureCarteraAuth();

    const response = await fetch(`${carteraURL}/investor`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error("Error al crear el inversionista");
    }

    const data: CreateInvestorResponse = await response.json();
    return data;
  } catch (error) {
    console.error("Error al crear inversionista:", error);
    throw error;
  }
};

/**
 * Obtener perfil de inversionista por DPI
 */
export const getInvestorProfile = async (
  dpi: string
): Promise<InvestorProfile> => {
  try {
    // Asegurar autenticación
    // const token = await ensureCarteraAuth();

    const response = await fetch(`${carteraURL}/investor?dpi=${dpi}`, {
      headers: {
        //"Authorization": `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error("Error al obtener perfil del inversionista");
    }

    const data: InvestorProfile = await response.json();
    return data;
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
    // Asegurar autenticación
    const token = await ensureCarteraAuth();

    const response = await fetch(`${carteraURL}/bancos`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error("Error al obtener catálogo de bancos");
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error("Error al obtener bancos:", error);
    throw error;
  }
};
