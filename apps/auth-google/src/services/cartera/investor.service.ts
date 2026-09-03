/**
 * Servicio para operaciones de inversionistas en Cartera
 */

import { env } from "../../config/env";
import { ensureCarteraAuth } from "./carteraAuth.service";

// ============================================
// INTERFACES
// ============================================

export interface CreateInvestorPayload {
  /**
   * Destino explícito de la escritura. Cuando viene, cartera edita esa fila y
   * no intenta resolverla por DPI/correo/nombre.
   */
  inversionista_id?: number;
  /**
   * `"CREATE"` pone a cartera en modo estricto: si el DPI, el correo o el
   * nombre ya existen responde 409 en vez de actualizar la fila existente.
   */
  operation?: "CREATE";
  nombre?: string;
  dpi?: number;
  email?: string;
  emite_factura?: boolean;
  tipo_reinversion?: string;
  banco?: string | null;
  banco_id?: number;
  tipo_cuenta?: string | null;
  numero_cuenta?: string | null;
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
}

// ============================================
// FUNCIONES DE INVERSIONISTAS
// ============================================

/**
 * Crear o actualizar un inversionista
 */
export const createInvestor = async (
  payload: CreateInvestorPayload,
): Promise<CreateInvestorResponse> => {
  try {
    // Asegurar autenticación
    const token = await ensureCarteraAuth();

    console.log("Creating investor with payload:", payload);

    const response = await fetch(`${env.CARTERA_API_URL}/investor`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error("Error response from Cartera API:", await response.text());
      throw new Error("Error al crear el inversionista");
    }

    const data = (await response.json()) as CreateInvestorResponse;
    return data;
  } catch (error) {
    console.error("Error al crear inversionista:", error);
    throw error;
  }
};

/**
 * Busca el inversionista dueño de un correo.
 *
 * Es la forma en que el portal resuelve "cuál es MI inversionista": el correo
 * sale de la sesión, que es lo único que Better Auth autentica. Devuelve
 * `null` cuando no hay ninguno, en vez de tratarlo como error.
 */
export const findInvestorByEmail = async (
  email: string,
): Promise<InvestorProfile | null> => {
  const token = await ensureCarteraAuth();

  const url = new URL(`${env.CARTERA_API_URL}/investor`);
  url.searchParams.set("email", email);

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Error al obtener perfil del inversionista");
  }

  const data = (await response.json()) as InvestorProfile | null;

  return data?.inversionista_id ? data : null;
};

/**
 * Obtener perfil de inversionista por DPI
 */
export const getInvestorProfile = async (
  dpi: string,
  email: string,
): Promise<InvestorProfile> => {
  try {
    // Asegurar autenticación
    const token = await ensureCarteraAuth();

    const response = await fetch(
      `${env.CARTERA_API_URL}/investor?dpi=${dpi}&email=${email}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error("Error al obtener perfil del inversionista");
    }

    const data = (await response.json()) as InvestorProfile;
    return data;
  } catch (error) {
    console.error("Error al obtener perfil del inversionista:", error);
    throw error;
  }
};

/**
 * Obtener documentos de un inversionista por email
 */
export const getInvestorDocuments = async (
  email: string,
): Promise<InvestorDocument[]> => {
  try {
    const token = await ensureCarteraAuth();

    const response = await fetch(
      `${env.CARTERA_API_URL}/investor-documents/client/${encodeURIComponent(email)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    console.log("Response status for getInvestorDocuments:", response);

    if (!response.ok) {
      throw new Error("Error al obtener documentos del inversionista");
    }

    const json = (await response.json()) as {
      success: boolean;
      data: InvestorDocument[];
    };
    return json.data;
  } catch (error) {
    console.error("Error al obtener documentos del inversionista:", error);
    throw error;
  }
};

/**
 * Obtener catálogo de bancos
 * @param soloConTransferencia Si es true, sólo devuelve bancos con id_banco_transferencia asignado
 */
export const getBancos = async (
  soloConTransferencia = false
): Promise<Banco[]> => {
  try {
    // Asegurar autenticación
    const token = await ensureCarteraAuth();

    const url = new URL(`${env.CARTERA_API_URL}/bancos`);
    
    url.searchParams.set("con_transferencia", "true");
    

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error("Error al obtener catálogo de bancos");
    }

    const data = (await response.json()) as { data: Banco[] };
    return data.data;
  } catch (error) {
    console.error("Error al obtener bancos:", error);
    throw error;
  }
};
