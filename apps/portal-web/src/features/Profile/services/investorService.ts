// import { ensureCarteraAuth } from "./loginCartera";

const carteraURL = import.meta.env.VITE_CARTERA_API_URL || "http://localhost:5000";

// Interfaces
export interface CreateInvestorPayload {
  nombre: string;
  dpi: number;
  email: string;
  emite_factura: boolean;
  reinversion: boolean;
  banco: string;
  tipo_cuenta: string;
  numero_cuenta: string;
}

export interface CreateInvestorResponse {
  success: boolean;
  message: string;
  data?: any;
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
      credentials: "include",
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
