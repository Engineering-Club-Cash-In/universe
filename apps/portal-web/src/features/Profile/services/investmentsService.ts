/**
 * Servicio de inversiones y liquidaciones - Proxy a través de Better Auth API
 */

import apiAuth from "@/lib/api/apiAuth";

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

export interface LiquidacionBoleta {
  boleta_id: number;
  inversionista_id: number;
  boleta_url: string;
  estado: string;
  monto_boleta: number;
  notas: string | null;
  fecha_subida: string;
  fecha_procesado: string | null;
  subido_por: string;
}

export interface LiquidacionReinversion {
  reinversion_capital: number;
  reinversion_interes: number;
  reinversion_total: number;
}

export interface Liquidacion {
  liquidacion_id: number;
  inversionista_id: number | null;
  nombre_inversionista: string;
  emite_factura: boolean;
  dpi: string;
  boleta: LiquidacionBoleta | null;
  totales: LiquidacionTotales;
  reinversion: LiquidacionReinversion | null;
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
    const response = await apiAuth.get<{
      success: boolean;
      liquidaciones: Liquidacion[];
      page: number;
      perPage: number;
      totalItems: number;
      totalPages: number;
    }>(
      `/api/cartera/liquidaciones?dpi=${encodeURIComponent(dpi)}&page=${page}&perPage=${perPage}`
    );

    const result = response.data;
    return {
      liquidaciones: result.liquidaciones || [],
      page: result.page || page,
      perPage: result.perPage || perPage,
      totalItems: result.totalItems || 0,
      totalPages: result.totalPages || 0,
    };
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
    const response = await apiAuth.get<InvestmentsStatsResponse>(
      `/api/cartera/investments/stats?dpi=${encodeURIComponent(dpi)}`
    );
    return response.data.data;
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
    const response = await apiAuth.get<AsesorResponse>(
      `/api/cartera/advisor?id=${asesorId}`
    );
    return response.data.data;
  } catch (error) {
    console.error("Error al obtener información del asesor:", error);
    throw error;
  }
};
