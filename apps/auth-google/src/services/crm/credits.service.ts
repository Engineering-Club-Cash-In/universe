/**
 * Servicio para operaciones de créditos desde Cartera
 * (Los créditos se consultan en Cartera pero los números SIFCO vienen del CRM)
 */

import { env } from "../../config/env";
import { ensureCarteraAuth } from "../cartera/carteraAuth.service";

// ============================================
// TIPOS
// ============================================

export type CreditStatus = "ACTIVO" | "FINALIZADO" | "PENDIENTE" | "ATRASADO" | "CANCELADO";
export type CreditType = "Nuevo" | "Renovacion" | "Ampliacion";
export type FormatoCredito = "Pool" | "Individual";
export type CuotaStatus = "no_required" | "required" | "pagado" | "atrasado";

// ============================================
// INTERFACES
// ============================================

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
}

export interface CreditoResponse {
  credito: Credito;
  usuario: Usuario;
  cuotaActual: number;
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

// ============================================
// FUNCIONES
// ============================================

/**
 * Obtener créditos por números SIFCO
 */
export const getCredits = async (numerosSifco: string[]): Promise<CreditoResponse[]> => {
  if (!numerosSifco || numerosSifco.length === 0) {
    return [];
  }

  try {
    const token = await ensureCarteraAuth();

    // Hacer fetch para cada número SIFCO
    const promises = numerosSifco.map(async (numeroSifco) => {
      const response = await fetch(
        `${env.CARTERA_API_URL}/credito?numero_credito_sifco=${encodeURIComponent(numeroSifco)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        console.error(`Error al cargar crédito ${numeroSifco}`);
        return null;
      }

      const data = (await response.json()) as CreditoResponse;
      return data;
    });

    const results = await Promise.all(promises);

    // Filtrar resultados nulos (errores)
    return results.filter((credit): credit is CreditoResponse => credit !== null);
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
    const token = await ensureCarteraAuth();

    const response = await fetch(
      `${env.CARTERA_API_URL}/credito?numero_credito_sifco=${encodeURIComponent(numeroSifco)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error("Error al cargar el crédito");
    }

    const data = (await response.json()) as CreditoResponse;
    return data;
  } catch (error) {
    console.error("Error al obtener crédito:", error);
    return null;
  }
};
