// import { ensureCarteraAuth } from "./loginCartera";

const carteraURL = import.meta.env.VITE_CARTERA_API_URL || "http://localhost:4000";

// ============================================
// INTERFACES PARA LIQUIDACIONES
// ============================================

export interface LiquidacionPago {
  pago_id: number;
  pago_credito_id: number;
  credito_id: number;
  numero_credito_sifco: string;
  nombre_cliente: string;
  nit_cliente: string;
  abono_capital: number;
  abono_interes: number;
  abono_iva: number;
  isr: number;
  porcentaje_participacion: number;
  fecha_pago: string;
  cuota: number;
}

export interface LiquidacionTotales {
  total_pagos_liquidados: number;
  total_capital: number;
  total_interes: number;
  total_iva: number;
  total_isr: number;
  total_cuota: number;
}

export interface Liquidacion {
  liquidacion_id: number;
  inversionista_id: number | null;
  nombre_inversionista: string;
  emite_factura: boolean;
  dpi: string;
  totales: LiquidacionTotales;
  reporte_liquidacion: string;
  fecha_liquidacion: string;
  pagos: LiquidacionPago[];
}

export interface LiquidacionesResponse {
  liquidaciones: Liquidacion[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

/**
 * Obtener liquidaciones del inversionista por DPI con paginación
 */
export const getLiquidaciones = async (
  dpi: string,
  page: number = 1,
  perPage: number = 10
): Promise<LiquidacionesResponse> => {
  try {
    // Asegurar autenticación
    // const token = await ensureCarteraAuth();

    const response = await fetch(
      `${carteraURL}/liquidaciones?dpi=${dpi}&page=${page}&perPage=${perPage}`,
      {
        credentials: "include",
        /*headers: {
          "Authorization": `Bearer ${token}`,
        },*/
      }
    );

    if (!response.ok) {
      throw new Error("Error al cargar las liquidaciones");
    }

    const result: LiquidacionesResponse = await response.json();
    return result;
  } catch (error) {
    console.error("Error al obtener liquidaciones:", error);
    throw error;
  }
};

// ============================================
// INTERFACES PARA ESTADÍSTICAS
// ============================================

export type InvestmentStatus = "activa" | "finalizada" | "pendiente";
export type InvestmentType = "tradicional" | "al_vencimiento" | "interes_compuesto";

export interface Investment {
  id: string;
  montoInvertido: number;
  rendimientoAnual: number; // Porcentaje
  plazo: number; // Meses
  rendimientoALaFecha: number; // Monto acumulado
  tipoInversion: InvestmentType;
  fechaInicio: string; // ISO 8601
  fechaFin: string; // ISO 8601
  montoUltimaCuota: number;
  fechaUltimaCuota: string; // ISO 8601
  estado: InvestmentStatus;
}

export interface GetInvestmentsResponse {
  success: boolean;
  data: Investment[];
}

/**
 * Obtener todas las inversiones del usuario
 */


export interface InvestmentsStats {
  inversionista_id: number;
  nombre: string;
  dpi: string;
  capital_total_aportado: number;
  cantidad_inversiones: number;
  rendimiento_estimado: number;
}

export interface InvestmentsStatsResponse {
  success: boolean;
  data: InvestmentsStats;
}

/**
 * Obtener estadísticas de inversiones desde la API de Cartera
 */
export const getInvestmentsStats = async (dpi: string): Promise<InvestmentsStats> => {
  try {
    // Asegurar autenticación
    // const token = await ensureCarteraAuth();

    const response = await fetch(`${carteraURL}/inversionistas/rendimiento?dpi=${dpi}`, {
      credentials: "include",
      /*headers: {
        "Authorization": `Bearer ${token}`,
      },*/
    });

    if (!response.ok) {
      throw new Error("Error al cargar las estadísticas de inversión");
    }

    const result: InvestmentsStatsResponse = await response.json();
    return result.data;
  } catch (error) {
    console.error("Error al obtener estadísticas de inversión:", error);
    throw error;
  }
};

// ============================================
// INTERFACES PARA ASESORES
// ============================================

export interface Asesor {
  asesor_id: number;
  nombre: string;
  telefono: string | null;
  activo: boolean;
  email: string;
  is_active: boolean;
  phone: string;
}

export interface AsesorResponse {
  success: boolean;
  data: Asesor;
}

/**
 * Obtener información del asesor por ID
 */
export const getAsesorById = async (asesorId: number): Promise<Asesor> => {
  try {
    const response = await fetch(`${carteraURL}/advisor?id=${asesorId}`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Error al cargar información del asesor");
    }

    const result = await response.json();
    
    // Si la respuesta tiene formato { success, data }
    if (result.success && result.data) {
      return result.data;
    }
    
    // Si la respuesta es directamente el objeto asesor
    return result;
  } catch (error) {
    console.error("Error al obtener información del asesor:", error);
    throw error;
  }
};
