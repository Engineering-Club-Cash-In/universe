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
    const response = await fetch(
      `${carteraURL}/liquidaciones?dpi=${dpi}&page=${page}&perPage=${perPage}`,
      {
        credentials: "include",
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
export const getInvestments = async (userId: string): Promise<Investment[]> => {
  try {
    const response = await fetch(`${carteraURL}/api/investments/${userId}`, {
      credentials: "include",
    });
    
    if (!response.ok) {
      throw new Error("Error al cargar las inversiones");
    }
    
    const result = await response.json();
    return result.data as Investment[];
  } catch (error) {
    console.error("Error al obtener inversiones, usando datos mockeados:", error);
    
    // Datos mockeados como fallback
    const mockInvestments: Investment[] = [
      {
        id: "inv-001",
        montoInvertido: 50000,
        rendimientoAnual: 12.5,
        plazo: 12,
        rendimientoALaFecha: 3125,
        tipoInversion: "tradicional",
        fechaInicio: "2024-05-15T00:00:00Z",
        fechaFin: "2025-05-15T00:00:00Z",
        montoUltimaCuota: 520.83,
        fechaUltimaCuota: "2024-11-15T00:00:00Z",
        estado: "activa",
      },
      {
        id: "inv-003",
        montoInvertido: 25000,
        rendimientoAnual: 10.0,
        plazo: 6,
        rendimientoALaFecha: 2500,
        tipoInversion: "interes_compuesto",
        fechaInicio: "2024-01-10T00:00:00Z",
        fechaFin: "2024-07-10T00:00:00Z",
        montoUltimaCuota: 416.67,
        fechaUltimaCuota: "2024-07-10T00:00:00Z",
        estado: "finalizada",
      },
      {
        id: "inv-004",
        montoInvertido: 75000,
        rendimientoAnual: 18.0,
        plazo: 36,
        rendimientoALaFecha: 6750,
        tipoInversion: "tradicional",
        fechaInicio: "2024-08-20T00:00:00Z",
        fechaFin: "2027-08-20T00:00:00Z",
        montoUltimaCuota: 1125.0,
        fechaUltimaCuota: "2024-11-20T00:00:00Z",
        estado: "activa",
      },
      {
        id: "inv-005",
        montoInvertido: 30000,
        rendimientoAnual: 11.0,
        plazo: 12,
        rendimientoALaFecha: 0,
        tipoInversion: "al_vencimiento",
        fechaInicio: "2024-12-01T00:00:00Z",
        fechaFin: "2025-12-01T00:00:00Z",
        montoUltimaCuota: 0,
        fechaUltimaCuota: "2024-12-01T00:00:00Z",
        estado: "pendiente",
      },
    ];
    
    return mockInvestments;
  }
};

/**
 * Obtener inversión por ID
 */
export const getInvestmentById = async (
  userId: string,
  investmentId: string
): Promise<Investment | null> => {
  const investments = await getInvestments(userId);
  return investments.find((inv) => inv.id === investmentId) || null;
};

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
    const response = await fetch(`${carteraURL}/inversionistas/rendimiento?dpi=${dpi}`, {
      credentials: "include",
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
