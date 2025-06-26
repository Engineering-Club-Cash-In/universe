import axios from "axios";
import type { PagoFormValues } from "../hooks/registerPayment";

const API_URL = import.meta.env.VITE_BACK_URL  ;

// Traer todos los inversionistas
export const getInvestors = async () => {
  const res = await axios.get(`${API_URL}/investor`);
  return res.data;
};
export const getAdvisors = async () => {
  const res = await axios.get(`${API_URL}/advisor`);
  return res.data;
};
// types/credit.ts

export interface CreditFormValues {
  usuario: string;
  numero_credito_sifco: string;
  capital: number;
  porcentaje_interes: number;
  porcentaje_cash_in: number;
  seguro_10_cuotas: number;
  gps: number;
  inversionista_id: number;
  observaciones: string;
  no_poliza: string;
  como_se_entero: string;
  asesor: string;
  plazo: number;
  porcentaje_participacion_inversionista: number;
  cuota: number;
  membresias_pago: number;
  formato_credito: string;
  categoria: string;
  nit: string;
}

// El tipo de respuesta depende de tu backend. Puedes ajustarlo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createCredit = async (data: CreditFormValues): Promise<any> => {
  const res = await axios.post(`${API_URL}/newCredit`, data);
  return res.data;
};
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
  inversionista_id: number;
  porcentaje_participacion_inversionista: string;
  monto_asignado_inversionista: string;
  iva_inversionista: string;
  porcentaje_cash_in: string;
  cuota_cash_in: string;
  iva_cash_in: string;
  membresias_pago: string;
  membresias: string;
  formato_credito: string;
}

export interface Usuario {
  usuario_id: number;
  nombre: string;
  nit: string;
  categoria: string;
  como_se_entero: string;
  saldo_a_favor: string;
}
export interface GetCreditoByNumeroResponse {
  creditos: Credito;
  usuarios: Usuario;
}


export const createPago = async (data: PagoFormValues) => {
  const res = await axios.post(`${API_URL}/newPayment`, data);
  return res.data;
};

export const getCreditoByNumero = async (
  numero_credito_sifco: string
): Promise<GetCreditoByNumeroResponse> => {
  const res = await axios.get<GetCreditoByNumeroResponse>(`${API_URL}/credito`, {
    params: { numero_credito_sifco },
  });
  return res.data;
};export interface PagoCredito {
  pago_id: number;
  credito_id: number;
  cuota: string;
  cuota_interes: string;
  numero_cuota: number;
  fecha_pago: string;
  abono_capital: string;
  abono_interes: string;
  abono_iva_12: string;
  abono_interes_ci: string;
  abono_iva_ci: string;
  abono_seguro: string;
  abono_gps: string;
  pago_del_mes: string;
  llamada: string;
  monto_boleta: string;
  fecha_filtro: string;
  renuevo_o_nuevo: string;
  capital_restante: string;
  interes_restante: string;
  iva_12_restante: string;
  seguro_restante: string;
  gps_restante: string;
  total_restante: string;
  tipoCredito: string;
  membresias: number;
  membresias_pago: number;
  membresias_mes: number;
  otros: string;
  mora: string;
  monto_boleta_cuota: string;
  seguro_total: string;
  pagado: boolean;
  facturacion: string;
  mes_pagado: string;
  seguro_facturado: string;
  gps_facturado: string;
  reserva: string;
  observaciones: string;
  numero_credito_sifco?: string;
}

export interface CreditoUsuarioPago {
  creditos: Credito;
  usuarios: Usuario;
 
}

export interface GetCreditosResponse {
  data: CreditoUsuarioPago[];
  page: number;
  perPage: number;
  totalCount: number;
  totalPages: number;
}
export const getCreditosPaginados = async (params: {
  mes: number;
  anio: number;
  page?: number;
  perPage?: number;
}): Promise<GetCreditosResponse> => {
  
  const res = await axios.get<GetCreditosResponse>(`${API_URL}/getAllCredits`, { params });
  console.log("getCreditosPaginados response:", res.data);
  return res.data;
};

export const getPagosByCredito = async (
  numero_credito_sifco: string,
  fecha_pago?: string
): Promise<PagoCredito[]> => {
 
  const res = await axios.get(`${API_URL}/paymentByCredit`, {
    params: { numero_credito_sifco, fecha_pago },
  });
  return res.data;
};
export async function getPagosByMesAnio({ mes, anio, page = 1, perPage = 10 }: {
  mes: number,
  anio: number,
  page?: number,
  perPage?: number
}) {
  const { data } = await axios.get(`${API_URL}/payments`, {
    params: { mes, anio, page, perPage }
  });
  return data;
}