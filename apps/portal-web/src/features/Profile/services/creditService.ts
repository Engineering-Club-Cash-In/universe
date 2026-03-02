/**
 * Servicio de créditos - Proxy a través de Better Auth API
 */

import apiAuth from "@/lib/api/apiAuth";

// Tipos
export type CreditStatus = "ACTIVO" | "FINALIZADO" | "PENDIENTE" | "ATRASADO" | "CANCELADO";
export type CreditType = "Nuevo" | "Renovacion" | "Ampliacion";
export type FormatoCredito = "Pool" | "Individual";
export type CuotaStatus = "no_required" | "required" | "pagado" | "atrasado";

// Interfaces basadas en la API de cartera
export interface Credito {
  credito_id: number;
  usuario_id: number;
  fecha_creacion: string;
  numero_credito_sifco: string;
  capital: string;
  porcentaje_interes: string;
  deudatotal: string;
  cuota_interes: string;
  cuota: string;
  iva_12: string;
  seguro_10_cuotas: string;
  gps: string;
  observaciones: string;
  no_poliza: string;
  como_se_entero: string;
  asesor_id: number;
  plazo: number;
  membresias_pago: string;
  membresias: string;
  formato_credito: FormatoCredito;
  porcentaje_royalti: string;
  tipoCredito: CreditType;
  royalti: string;
  statusCredit: CreditStatus;
  otros: string;
}

export interface Usuario {
  usuario_id: number;
  nombre: string;
  nit: string;
  direccion: string;
  municipio: string;
  departamento: string;
  codigo_postal: string;
  pais: string;
  categoria: string;
  como_se_entero: string;
  saldo_a_favor: string;
}

export interface Cuota {
  cuota_id: number;
  credito_id: number;
  numero_cuota: number;
  fecha_vencimiento: string;
  pagado: boolean;
  liquidado_inversionistas?: boolean;
  fecha_liquidacion_inversionistas?: string | null;
  createdAt: string;
  pago_id?: number;
  monto_boleta?: string;
  fecha_pago?: string;
  validationStatus?: string;
}

export interface CuotaActual {
  cuota_id: number;
  credito_id: number;
  numero_cuota: number;
  fecha_vencimiento: string;
  pagado: boolean;
  createdAt: string;
  validationStatus?: string;
  pago_id?: number;
  monto_boleta?: string;
  abono_capital?: string;
  abono_interes?: string;
  abono_iva_12?: string;
  abono_interes_ci?: string;
  abono_iva_ci?: string;
  abono_seguro?: string;
  abono_gps?: string;
  abono_membresias?: string;
  capital_restante?: string;
  interes_restante?: string;
  iva_12_restante?: string;
  seguro_restante?: string;
  gps_restante?: string;
  membresias_restante?: string;
  pago_mora?: string;
  pago_otros?: string;
}

export interface CreditoResponse {
  credito: Credito;
  usuario: Usuario;
  cuotaActual: CuotaActual;
  cuotaActualPagada: boolean;
  cuotaActualStatus: CuotaStatus;
  cuotasPendientes: Cuota[];
  cuotasAtrasadas: Cuota[];
  cuotasPagadas: Cuota[];
  moraActual: number;
  convenioActivo: any | null;
  cuotasEnConvenio: any[];
  pagosConvenio: any[];
}

// Servicios

/**
 * Obtener créditos por números SIFCO
 */
export const getCredits = async (numerosSifco: string[]): Promise<CreditoResponse[]> => {
  if (!numerosSifco || numerosSifco.length === 0) {
    return [];
  }

  try {
    const response = await apiAuth.get<{ data: CreditoResponse[] }>(
      `/api/crm/credits?numerosSifco=${encodeURIComponent(numerosSifco.join(","))}`
    );
    return response.data.data || [];
  } catch (error) {
    console.error("Error al obtener créditos:", error);
    return [];
  }
};

/**
 * Obtener un crédito específico por número SIFCO
 */
export const getCreditByNumeroSifco = async (
  numeroSifco: string
): Promise<CreditoResponse | null> => {
  try {
    const response = await apiAuth.get<{ data: CreditoResponse }>(
      `/api/crm/credit?numeroSifco=${encodeURIComponent(numeroSifco)}`
    );
    return response.data.data;
  } catch (error) {
    console.error("Error al obtener crédito:", error);
    return null;
  }
};
