const baseURL = import.meta.env.VITE_API_URL || "http://localhost:3000";

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
    const response = await fetch(`${baseURL}/api/investments/${userId}`, {
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
  totalInvertido: number;
  totalRendimiento: number;
  inversionesActivas: number;
}

/**
 * Obtener estadísticas de inversiones
 */
export const getInvestmentsStats = async (userId: string): Promise<InvestmentsStats> => {
  const investments = await getInvestments(userId);

  const totalInvertido = investments.reduce(
    (sum, inv) => sum + inv.montoInvertido,
    0
  );

  const totalRendimiento = investments.reduce(
    (sum, inv) => sum + inv.rendimientoALaFecha,
    0
  );

  const inversionesActivas = investments.filter(
    (inv) => inv.estado === "activa"
  ).length;

  return {
    totalInvertido,
    totalRendimiento,
    inversionesActivas,
  };
};
