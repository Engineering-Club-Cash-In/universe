/* eslint-disable @typescript-eslint/no-explicit-any */
import axios  from "axios";
import type { PagoFormValues } from "../hooks/registerPayment";
import type { ReactNode } from "react";

const API_URL = import.meta.env.VITE_BACK_URL  ||'https://qk4sw4kc4c088c8csos400wc.s3.devteamatcci.site'; ;
const api = axios.create({
  baseURL: API_URL,
});
api.interceptors.request.use((config) => {
const token = localStorage.getItem("accessToken");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Traer todos los inversionistas
export const getInvestors = async () => {
  const res = await api.get(`/investor`);
  return res.data;
};
export interface InvestorPayload {
  inversionista_id?: number;
  nombre: string;
  emite_factura: boolean;
  reinversion: boolean;
  banco: string | null;
  tipo_cuenta: string | null;
  re_inversion: string | null;
  numero_cuenta: string | null;
}
export interface InvestorResponse {
  inversionista_id: number;
  nombre: string;
  emite_factura: boolean;
  reinversion: boolean;
  banco: string | null;
  tipo_cuenta: string | null;
  numero_cuenta: string | null;
}

// Crear inversionista(s)
export async function insertInvestorService(
  data: InvestorPayload | InvestorPayload[]
): Promise<InvestorResponse[]> {
  const res = await api.post(`${API_URL}/investor`, data);
  return res.data;
}

// Actualizar inversionista(s)
export async function updateInvestorService(
  data: InvestorPayload | InvestorPayload[]
): Promise<InvestorResponse[]> {
  const res = await api.post(`${API_URL}/investor/update`, data);
  return res.data;
}
export const getAdvisors = async () => {
  const res = await api.get(`${API_URL}/advisor`);
  return res.data;
};
// types/credit.ts

export interface CreditFormValues {
  usuario: string;
  reserva: number;
  numero_credito_sifco: string;
  capital: number;
  porcentaje_interes: number;
 cuota_interes?: number;
  seguro_10_cuotas: number;
  gps: number;
  observaciones: string;
  no_poliza: string;
  como_se_entero: string;
  asesor: string;
  plazo: number;
  porcentaje_royalti: number;
  royalti: number;
  cuota: number;
  membresias_pago: number;
  categoria: string;
  nit: string;
  otros: number;
  inversionistas: {
    inversionista_id: number;
    monto_aportado: number;
    porcentaje_cash_in: number;
    porcentaje_inversion: number;
  }[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createCredit = async (data: CreditFormValues): Promise<any> => {
  const res = await api.post(`${API_URL}/newCredit`, data);
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
  statusCredit: string; // ACTIVO, CANCELADO, INCOBRABLE
}

export interface Usuario {
  usuario_id: number;
  nombre: string;
  nit: string;
  categoria: string;
  como_se_entero: string;
  saldo_a_favor: number;
}

export interface Cuota {
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
  abono_gps: string | null;
  pago_del_mes: string;
  llamada: string | null;
  monto_boleta: string;
  fecha_filtro: string;
  renuevo_o_nuevo: string | null;
  capital_restante: string;
  interes_restante: string;
  iva_12_restante: string;
  seguro_restante: string;
  gps_restante: string;
  total_restante: string;
  membresias: number;
  membresias_pago: string;
  membresias_mes: string;
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
}

export interface GetCreditoByNumeroActivoResponse {
  flujo: "ACTIVO";
  credito: Credito;
  usuario: Usuario;
  cuotaActual: number;
  moraActual: number;
  cuotaActualPagada: boolean;
  cuotaActualStatus: 'no_required' | 'pending' | 'validated' | 'capital' | 'reset';

  cuotasAtrasadas: Cuota[];
  cuotasPagadas: Cuota[];
  cuotasPendientes: Cuota[];
}

export interface CancelacionCredito {
  id: number;
  credit_id: number;
  motivo: string;
  observaciones?: string;
  fecha_cancelacion: string;
  monto_cancelacion: string;
}

export interface GetCreditoByNumeroCanceladoResponse {
  flujo: "CANCELADO";
  credito: Credito;
  usuario: Usuario;
  cancelacion: CancelacionCredito | null;
}

// Respuesta unificada usando discriminación de tipos:
export type GetCreditoByNumeroResponse =
  | GetCreditoByNumeroActivoResponse
  | GetCreditoByNumeroCanceladoResponse;

export const createPago = async (data: PagoFormValues) => {
  const res = await api.post(`${API_URL}/newPayment`, data);
  return res.data;
};

export const getCreditoByNumero = async (
  numero_credito_sifco: string
): Promise<GetCreditoByNumeroResponse> => {
  const res = await api.get<GetCreditoByNumeroResponse>(`${API_URL}/credito`, {
    params: { numero_credito_sifco },
  });
  return res.data;
};export interface GetCreditosResponse {
  data: CreditoUsuarioPago[];
  page: number;
  perPage: number;
  totalCount: number;
  totalPages: number;
}
export interface CreditCancelation {
  id: number;
  credit_id: number;
  motivo: string;
  observaciones?: string | null;
  fecha_cancelacion: string; // o Date, según como lo manejes
  monto_cancelacion: number;
}

export interface BadDebt {
  id: number;
  credit_id: number;
  motivo: string;
  observaciones?: string | null;
  fecha_registro: string; // o Date
  monto_incobrable: number;
    incobrable?: BadDebt | null;
  cancelacion?: CreditCancelation | null;
}

export interface CreditoUsuarioPago {
  creditos: Credito;
  usuarios: Usuario;
  inversionistas: AporteInversionista[];
  resumen: ResumenCreditos;
  asesor: Asesor; // 👈 corregí el typo "aseor" -> "asesor"
  cancelacion?: CreditCancelation | null;
  incobrable?: BadDebt | null;
  rubros: Rubro[];
  mora: Mora | null;
  deuda_total_con_mora: string;
}

export interface Mora {
  mora_id: number;
  credito_id: number;
  activa: boolean;
  porcentaje_mora: string;
  monto_mora: string;
  cuotas_atrasadas: number;
  created_at: string;
  updated_at?: string;
}

export interface Rubro {
  nombre_rubro: string;
  monto: number;
}

export interface Credito {
  credito_id: number;
  usuario_id: number;
  otros: number;
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
  formato_credito: string;
  porcentaje_royalti: string;
  tipoCredito: string;
  royalti: string;
  mora: string;
}

export interface Usuario {
  usuario_id: number;
  nombres: string;
  apellidos: string;
  telefono: string;
  dpi: string;
  email: string;
  saldo_a_favor: number;
}

export interface Asesor {
  asesorId: number;
  nombre: string;
  activo: boolean;
}

export interface AporteInversionista {
  nombre: ReactNode;
  emite_factura: boolean;
  cuota_inversionista(cuota_inversionista: any): unknown;
  credito_id: number;
  inversionista: {
    inversionista_id: number;
    nombre: string;
    dpi: string;
    correo: string;
  };
  porcentaje_participacion_inversionista: string;
  monto_aportado: string;
  porcentaje_cash_in: string;
  iva_inversionista: string;
  iva_cash_in: string;
  monto_inversionista: string;
  monto_cash_in: string;
}

export interface ResumenCreditos {
  total_cash_in_monto: string;
  total_cash_in_iva: string;
  total_inversionistas_monto: string;
  total_inversionistas_iva: string;
}

export const getCreditosPaginados = async (params: {
  mes: number;
  anio: number;
  page?: number;
  perPage?: number;
  numero_credito_sifco?: string;
  estado: "ACTIVO" | "CANCELADO" | "INCOBRABLE" | "PENDIENTE_CANCELACION" | "MOROSO";
  excel: boolean;
  asesor_id?: number;        // 👈 NUEVO
  nombre_usuario?: string;   // 👈 NUEVO
}): Promise<GetCreditosResponse> => {
  const BACK_URL = import.meta.env.VITE_BACK_URL || "";
  const response = await api.get(`${BACK_URL}/getAllCredits`, {
    params: {
      mes: params.mes,
      anio: params.anio,
      page: params.page ?? 1,
      perPage: params.perPage ?? 10,
      estado: params.estado,
      excel: params.excel,
      ...(params.numero_credito_sifco && {
        numero_credito_sifco: params.numero_credito_sifco,
      }),
      ...(params.asesor_id && {           // 👈 NUEVO
        asesor_id: params.asesor_id,
      }),
      ...(params.nombre_usuario && {      // 👈 NUEVO
        nombre_usuario: params.nombre_usuario,
      }),
    },
  });
  return response.data;
};;export interface ExcelResponse {
  excelUrl: string;
}
export interface PagoData {
  numeroCredito: ReactNode;
  usuarioNombre: ReactNode;
  cuota: any;
  creditoId: any;
  capital(capital: any): unknown;
  deudaTotal(deudaTotal: any): unknown;
  abono_interes(abono_interes: any): unknown;
  abono_iva_12(abono_iva_12: any): unknown;
  abono_interes_ci(abono_interes_ci: any): unknown;
  abono_iva_ci(abono_iva_ci: any): unknown;
  abono_seguro(abono_seguro: any): unknown;
  abono_gps(abono_gps: any): unknown;
  pago: {
    pago_id: number;
    credito_id: number;
    numero_cuota: number;
    cuota: string;
    cuota_interes: string;
    abono_capital: string;
    abono_interes: string;
    abono_iva_12: string;
    abono_interes_ci: string;
    abono_iva_ci: string;
    abono_seguro: string;
    abono_gps: string | null;
    pago_del_mes: string;
    monto_boleta: string;
    capital_restante: string;
    interes_restante: string;
    iva_12_restante: string;
    seguro_restante: string;
    gps_restante: string;
    total_restante: string;
    llamada: string | null;
    fecha_pago: string;
    fecha_filtro: string;
    renuevo_o_nuevo: string | null;
    membresias: number;
    membresias_pago: string;
    membresias_mes: string;
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
    usuario_id: number;
    numero_credito_sifco: string;
    usuario_nombre: string;
    usuario_categoria: string;
    usuario_nit: string;
    url_boleta: string | null; // URL del PDF de la boleta
    paymentFalse:boolean
    boletas:string[]
    // Agrega más campos si los necesitas
    // Puedes agregar campos extra si necesitas
  };
  inversionistasData: {
    id: number;
    cuota_inversionista: string;
    credito_id: number;
    inversionista_id: number;
    porcentaje_participacion_inversionista: string;
    monto_aportado: string;
    porcentaje_cash_in: string;
    iva_inversionista: string;
    iva_cash_in: string;
    fecha_creacion: string;
    monto_inversionista: string;
    monto_cash_in: string;
    nombre: string;
    emite_factura: boolean;
    // Si hay campos adicionales del inversionista, agrégalos aquí
  }[];
  pagosInversionistas: {
    id: number;
    pago_id: number;
    inversionista_id: number;
    credito_id: number;
    abono_capital: string;
    abono_interes: string;
      nombre: string;
    abono_iva_12: string;
    porcentaje_participacion: string;
    fecha_pago: string;
    estado_liquidacion: "NO_LIQUIDADO" | "POR_LIQUIDAR" | "LIQUIDADO";
    cuota: string;
  }[];
}
export const getPagosByCredito = async (
  numero_credito_sifco: string,
  excel: boolean,
  fecha_pago?: string,
): Promise<PagoData[] | ExcelResponse> => {
  const res = await api.get(`${API_URL}/paymentByCredit`, {
    params: { numero_credito_sifco, fecha_pago, excel },
  });
  return res.data;
};

export interface Credit {
  credito_id: number;
  numero_credito_sifco: string;
  capital: string;
  porcentaje_participacion: string;
  monto_asignado: string;
  iva: string;
}

export interface Investor {
  inversionista_id: number;
  nombre: string;
  emite_factura: boolean;
  reinversion: boolean;          // 🔹 nuevo campo
  banco: string | null;          // 🔹 nuevo campo
  tipo_cuenta: string | null;    // 🔹 nuevo campo
  numero_cuenta: string | null;  // 🔹 nuevo campo

  // Ya existentes
  total_creditos: number;
  total_monto_asignado: string;
  creditos: Credit[];
}

export const getInvestorsWithCredits = async (): Promise<Investor[]> => {
  const { data } = await api.get(`${API_URL}/getInvestorsWithFullCredits`);
  return data;
};


// types.ts
export interface InversionistaPayload {
  inversionista_id: number;
  monto_aportado: number;
  porcentaje_cash_in: number;
  porcentaje_inversion: number;
  cuota_inversionista: number; // Nuevo campo opcional
}

export interface UpdateCreditBody {
  credito_id: number;
  mora?: number;

  // Campos opcionales
  usuario_id?: number;
  numero_credito_sifco?: string;
  capital?: number;
  porcentaje_interes?: number;
  deudaTotal?: number;
  cuota: number;
  iva_12?: number; 
  gps?: number;
  observaciones?: string;
  no_poliza?: number;
  como_se_entero?: string;
  asesor_id?: number;
  plazo?: number;
  capital_interes?: number;
  otros?: number;
  membresias_pago?: number;
  reserva?: number;
  seguro_10_cuotas?: number;
  

  // Inversionistas nuevos
  inversionistas?: InversionistaPayload[];
}
export async function updateCreditService(body: UpdateCreditBody) {
  const response = await api.post(`${API_URL}/updateCredit`, body);
  return response.data;
}

// Liquidar pagos
export async function liquidatePagosInversionistasService({ pago_id, credito_id, cuota }: { pago_id: number; credito_id: number; cuota?: number }) {
  const res = await api.post(`${API_URL}/liquidate-pagos-inversionistas`, {
    pago_id,
    credito_id,
    cuota,
  });
  return res.data;
}

// Reversar pagos
export async function reversePagosInversionistasService({ pago_id, credito_id }: { pago_id: number; credito_id: number }) {
  const res = await api.post(`${API_URL}/reversePayment`, {
    pago_id,
    credito_id,
  });
  return res.data;
}
export interface PagoCredito {
  mes: string;
  abono_capital: string;
  abono_interes: string;
  abono_iva: string;
  isr: string;
  porcentaje_inversor: string;
  cuota_inversor: string;
  cuota:number;
  fecha_pago: string;
   abonoGeneralInteres?:number
     tasaInteresInvesor?:number
}

// Detalle de cada crédito en el que participa un inversionista
export interface CreditoInversionistaData {
  credito_id: number;
  numero_credito_sifco: string;
  nombre_usuario: string;
  nit_usuario: string;
  plazo: number;
  capital: string;
  porcentaje_interes: string;
  meses_en_credito: number;
  monto_aportado: string;
  porcentaje_inversionista: string;
  cuota_inversionista: string;
  pagos: PagoCredito[];
  total_abono_capital: string;
  total_abono_interes: string;
  total_abono_iva: string;
  total_isr: string;
  total_cuota: string;
  cuota_interes:number
}

// Subtotal global por inversionista (sumando todos sus créditos)
export interface SubtotalInversionista {
  total_abono_capital: string;
  total_abono_interes: string;
  total_abono_iva: string;
  total_isr: string;
  total_cuota: string;
}

// Un inversionista con sus créditos y sus subtotales
export interface InversionistaConCreditos {
  inversionista_id: number;
  inversionista: string;
  nombre_inversionista: string;
  emite_factura: boolean;
  creditos: CreditoInversionistaData[];
  subtotal: SubtotalInversionista;
    reinversion: boolean;           // 🔹 nuevo
  banco: string | null;           // 🔹 nuevo
  tipo_cuenta: string | null;     // 🔹 nuevo
  numero_cuenta: string | null;   // 🔹 nuevo
  re_inversion:string

}

// La respuesta completa (paginada)
export interface InversionistasCreditosResponse {
  inversionistas: InversionistaConCreditos[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}
export async function getInvestorServices(
  params?: { id?: number; page?: number; perPage?: number }
): Promise<InversionistasCreditosResponse> {
  const query = new URLSearchParams();

  if (params?.id !== undefined) query.append("id", String(params.id));
  if (params?.page !== undefined) query.append("page", String(params.page));
  if (params?.perPage !== undefined) query.append("perPage", String(params.perPage));

  const url = `${import.meta.env.VITE_BACK_URL}/getInvestors${query.toString() ? `?${query.toString()}` : ""}`;
  const res = await api.get<InversionistasCreditosResponse>(url);
  return res.data;
}


// Interfaces para los pagos
export interface PagoResumen {
  pago_id: number;
  nombre_cliente: string;
  nit_cliente: string;
  monto: number;
  fecha_pago: string;
  estado: string;
  abono_capital: number;
  abono_interes: number;
  abono_iva: number;
  isr: number;
  cuota: number;
  numero_credito_sifco: string;
  nombre_inversionista: string;
  // Agrega más campos si los necesitas
}

export interface PagosPorMesAnioResponse {
  data: PagoResumen[];
  totalItems: number;
  totalPages: number;
  page: number;
  perPage: number;
}

// Servicio con tipado
export async function getPagosByMesAnio({
  mes,
  anio,
  page = 1,
  perPage = 10,
  numero_credito_sifco
}: {
  mes: number;
  anio: number;
  page?: number;
  perPage?: number;
  numero_credito_sifco?: string;
}): Promise<PagosPorMesAnioResponse> {
  const { data } = await api.get<PagosPorMesAnioResponse>(`${API_URL}/payments`, {
    params: { mes, anio, page, perPage, numero_credito_sifco },
  });
  console.log("getPagosByMesAnio response:", data);
  return data;
}

// Request body
export interface LiquidateByInvestorRequest {
  inversionista_id: number;
}

// Response body (ajústalo según tu backend, aquí uso lo que mandas arriba)
export interface LiquidateByInvestorResponse {
  message: string;
  updatedCount: number;
}
export async function liquidateByInvestorService(
  data: LiquidateByInvestorRequest
): Promise<LiquidateByInvestorResponse> {
  const response = await api.post<LiquidateByInvestorResponse>(
    `${import.meta.env.VITE_BACK_URL}/liquidate-inversionista-pagos`,
    data
  );
  return response.data;
}
type PdfUploadResponse = {
  success: boolean;
  url: string;
  filename: string;
};
// Recibe los params y retorna un Blob del PDF
export async function downloadInvestorPDFService(
  id: number,
  page: number = 1,
  perPage: number = 1
): Promise<PdfUploadResponse> {
  const BACK_URL = import.meta.env.VITE_BACK_URL || "";

  const { data } = await api.post<PdfUploadResponse>(
    `${BACK_URL}/investor/pdf`,
    // ✅ Enviar datos en el body, no en params
    { id, page, perPage },
    {
      // Asegura que el backend responda JSON (no blob)
      headers: { Accept: "application/json" },
      responseType: "json", 
    }
  );

  if (!data?.url) {
    throw new Error("[ERROR] La respuesta no contiene url del PDF subido.");
  }

  return data;
}

export async function uploadFileService(file: File | Blob): Promise<{ url: string; filename: string }> {
  const BACK_URL = import.meta.env.VITE_BACK_URL || ""; // tu variable de entorno

  const formData = new FormData();
  formData.append("file", file);

  const response = await api.post(`${BACK_URL}/upload`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  // Devuelve { url, filename } (y lo que mande el backend)
  return response.data;
}

export interface FalsePaymentPayload {
  pago_id: number;
  credito_id: number;
}

export interface FalsePaymentResponse {
  message: string;
  updatedCount: number;
  error?: string;
}

export async function falsePaymentService(data: FalsePaymentPayload): Promise<FalsePaymentResponse> {
  const res = await api.post(`${API_URL}/false-payment`, data);
  return res.data;
}


export interface CancelCreditResponse {
  message: string;
  credito: {
    capital_actual: string;
    total_intereses_pendientes: string;
    total_membresias_pendientes: string;
    total_seguro_pendiente: string;
    total_iva_pendiente: string;
    cuotas_pendientes: number;
    mora:number
  };
  error?: string;
}
 

export async function cancelCreditService(creditId: number): Promise<CancelCreditResponse> {
  const res = await api.post(`${API_URL}/cancelCredit`, { creditId });
  return res.data;
}

export type CreditAction = "CANCELAR" | "ACTIVAR" | "INCOBRABLE" |"PENDIENTE_CANCELACION";
export interface MontoAdicional {
  concepto: string;
  monto: number; // positivo = cargo, negativo = descuento
}

export interface CancelCreditPayload {
  creditId: number;
  accion: "CANCELAR";
  motivo: string;
  observaciones?: string;
  monto_cancelacion: number;
    montosAdicionales?: MontoAdicional[];
}
export interface PendingCancelCreditPayload {
  creditId: number;
  accion: "PENDIENTE_CANCELACION";
  motivo: string;
  observaciones?: string;
  monto_cancelacion: number;
  montosAdicionales?: MontoAdicional[];
}
export interface ActivateCreditPayload {
  creditId: number;
  accion: "ACTIVAR";
} 
export interface BadDebtCreditPayload {
  creditId: number;
  accion: "INCOBRABLE";
  motivo: string;
  observaciones?: string;
  monto_cancelacion: number; // Puedes llamarlo monto_incobrable si quieres ser más explícito
    montosAdicionales?: MontoAdicional[];
}


export type CreditActionPayload = CancelCreditPayload | ActivateCreditPayload | BadDebtCreditPayload | PendingCancelCreditPayload;

// Respuesta genérica
export interface CreditActionResponse {
  ok: boolean;
  message: string;
}

// Cambia esta URL por la de tu backend 
// Servicio para cancelar o activar crédito
export async function creditAction(payload: CreditActionPayload): Promise<CreditActionResponse> {
  const { data } = await api.post(`${API_URL}/creditAction`, payload);
  return data;
}

export interface ResetCreditParams {
  creditId: number;
  montoIncobrable?: number;
  montoBoleta: number | string;
  url_boletas: string[];
  cuota: number;
}

export async function resetCreditService(params: ResetCreditParams) {
  const { data } = await api.post(`${API_URL}/resetCredit`, params);
  return data;
}
export interface UsuarioConCreditosSifco {
  usuario_id: number;
  nombre: string;
  nit?: string | null;
  categoria?: string | null;
  como_se_entero?: string | null;
  saldo_a_favor: string;
  numeros_credito_sifco: string[];
}

/**
 * Servicio para obtener usuarios con sus números de crédito SIFCO
 */
export async function getUsersWithSifco(): Promise<UsuarioConCreditosSifco[]> {
  const { data } = await api.get<{ success: boolean; data: UsuarioConCreditosSifco[] }>(
    `${API_URL}/users-with-sifco`
  );
  return data.data; // 👈 Retornar solo el array de usuarios
}

/** Supported output format */
export type ReportFormat = "pdf" | "excel";

/** Three backend endpoints (kinds) */
export type ReportKind =
  | "cancelation"          // /credit/cancelation-report
  | "cancelation-intern"   // /credit/cancelation-report-intern
  | "cost-detail";         // /credit/cost-detail-report

/** Request params */
export interface ReportQuery {
  numero_sifco: string;
  format?: ReportFormat; // default pdf on backend if omitted
}

/** Standard backend response */
export interface ReportResponse {
  ok: boolean;
  format: ReportFormat;
  url: string;
  filename: string;
  size: number;
}

/** Build query params in the same way backend accepts them */
function buildParams(q: ReportQuery): Record<string, string> {
  const params: Record<string, string> = { numero_sifco: q.numero_sifco };
  // You can switch to "format" if you prefer (?format=pdf|excel)
  if (q.format === "excel") params.excel = "true";
  if (q.format === "pdf") params.pdf = "true";
  return params;
}

/** Map kind → endpoint path */
function pathFor(kind: ReportKind): string {
  switch (kind) {
    case "cancelation":
      return "/credit/cancelation-report";
    case "cancelation-intern":
      return "/credit/cancelation-report-intern";
    case "cost-detail":
      return "/credit/cost-detail-report";
  }
}

/** Single service for any report kind */
export async function generateReport(
  kind: ReportKind,
  query: ReportQuery
): Promise<ReportResponse> {
  const url = `${API_URL}${pathFor(kind)}`;
  const { data } = await api.get<ReportResponse>(url, {
    params: buildParams(query),
  });
  return data;
}

/** Utility: open in new tab */
export function openReportUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}


export interface InversionistaResumen {
  inversionista_id: number;
  nombre: string;
  emite_factura: boolean;
  reinversion: boolean;
  banco: string | null;
  tipo_cuenta: string | null;
  numero_cuenta: string | null;
  total_abono_capital: number;
  total_abono_interes: number;
  total_abono_iva: number;
  total_isr: number;
  total_a_recibir: number;
}

export interface ResumenInversionistasExcel {
  success: boolean;
  url: string;
  filename: string;
}

/**
 * Consulta el resumen global de inversionistas.
 * Si `excel = true`, devuelve un archivo con URL pública.
 */
export async function getResumenInversionistas(params?: {
  id?: number;
  mes?: number;
  anio?: number;
  excel?: boolean;
}): Promise<InversionistaResumen[] | ResumenInversionistasExcel> {
  const { id, mes, anio, excel } = params || {};
  const res = await api.get(
    `${API_URL}/resumen-inversionistas`,
    {
      params: {
        id,
        mes,
        anio,
        excel,
      },
    }
  );

  return res.data;}

  export interface Advisor {
  asesor_id: number;
  nombre: string;
  activo: boolean;
  email?: string;
}

 

export const createAdvisor = async (data: Partial<Advisor> & { password?: string }) => {
  const res = await api.post(`${API_URL}/advisor`, data);
  return res.data;
};

export const updateAdvisor = async (
  id: number,
  data: Partial<Advisor> & { password?: string }
) => {
  const res = await api.post(`${API_URL}/updateAdvisor?id=${id}`, data);
  return res.data;
};
// types/conta.ts
export interface ContaPayload {
  nombre: string;
  apellido: string;
  email: string;
  telefono?: string;
  password: string;
}

export interface ContaUpdatePayload {
  email?: string;
  password?: string;
  is_active?: boolean;
  telefono?: string;
  nombre?: string;
  apellido?: string;
}

export interface ContaUser {
  conta_id: number;
  nombre: string;
  apellido: string;
  email: string;
  telefono?: string | null;
}

export interface PlatformUser {
  id: number;
  email: string;
  role: "ASESOR" | "CONTA"; // excluimos ADMIN
  is_active: boolean;
  conta_id?: number | null;
  asesor_id?: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile?: Record<string, any>; // datos enriquecidos
}

// Crear conta user
export async function createContaServiceFrontend(data: ContaPayload): Promise<ContaUser> {
  const { data: res } = await api.post("/auth/conta", data);
  return res.data;
}

// Actualizar conta user
export async function updateContaServiceFrontend(
  contaId: number,
  updates: ContaUpdatePayload
): Promise<{ message: string }> {
  const { data: res } = await api.post(`/auth/conta/update`, updates, {
    params: { contaId },
  });
  return res.data;
}

// Obtener platform users (sin admins)
export async function getPlatformUsersServiceFrontend(): Promise<PlatformUser[]> {
  const { data: res } = await api.get("/auth/platform-users");
  return res.data;
}


export type EstadoCredito = "ACTIVO" | "CANCELADO" | "INCOBRABLE" | "PENDIENTE_CANCELACION" | "MOROSO";

export interface Mora {
  mora_id: number;
  credito_id: number;
  monto_mora: string;
  cuotas_atrasadas: number;
  activa: boolean;
  porcentaje_mora: string;
  updated_at?: string;
}

export interface CreditoConMora {
  credito_id: number;
  numero_credito_sifco: string;
  capital: string;
  cuota: string;
  plazo: number;
  estado: EstadoCredito;
  fecha_creacion: string;
  observaciones?: string;
  usuario: string;
  usuario_nit: string;
  usuario_categoria: string;
  asesor: string;
  monto_mora: string;
  cuotas_atrasadas: number;
  mora_activa: boolean;
}

export interface Condonacion {
  condonacion_id: number;
  credito_id: number;
  numero_credito_sifco: string;
  estado_credito: EstadoCredito;
  capital: string;
  usuario: string;
  asesor: string;
  motivo: string;
  fecha: string;
  usuario_email: string;
  montoCondonacion: string;
}

// ---------- Requests ----------
export interface CreateMoraPayload {
  credito_id: number;
  monto_mora?: number;
  cuotas_atrasadas?: number;
}

export interface UpdateMoraPayload {
  credito_id?: number;
  numero_credito_sifco?: string;
  monto_cambio: number;
  tipo: "INCREMENTO" | "DECREMENTO";
  cuotas_atrasadas?: number;
  activa?: boolean;
}

export interface CondonarMoraPayload {
  credito_id: number;
  motivo: string;
  usuario_email: string;
}

// ---------- Services ----------

// Crear mora
export async function createMoraService(payload: CreateMoraPayload) {
  const { data } = await api.post<{ success: boolean; mora: Mora }>(`/mora`, payload);
  return data;
}

// Actualizar mora
export async function updateMoraService(payload: UpdateMoraPayload) {
  const { data } = await api.post<{ success: boolean; mora: Mora }>(`/mora/update`, payload);
  return data;
}

// Procesar todas las moras automáticamente
export async function procesarMorasService() {
  const { data } = await api.post<{ success: boolean; message: string }>(`/moras/procesar`);
  return data;
}

// Condonar mora
export async function condonarMoraService(payload: CondonarMoraPayload) {
  const { data } = await api.post<{ success: boolean; mora: Mora; condonacion: Condonacion }>(
    `/mora/condonar`,
    payload
  );
  return data;
}

// Listar créditos con mora
export async function getCreditosWithMorasService(params?: {
  numero_credito_sifco?: string;
  cuotas_atrasadas?: number;
  estado?: EstadoCredito;
  excel?: boolean;
}) {
  const { data } = await api.get<{ success: boolean; data: CreditoConMora[]; excelUrl?: string }>(
    `/moras/creditos`,
    { params }
  );
  return data;
}

// Listar condonaciones
export async function getCondonacionesMoraService(params?: {
  numero_credito_sifco?: string;
  usuario_email?: string;
  fecha_desde?: string;
  fecha_hasta?: string;
  excel?: boolean;
}) {
  const { data } = await api.get<{ success: boolean; data: Condonacion[]; excelUrl?: string }>(
    `/moras/condonaciones`,
    { params }
  );
  return data;}

 
export interface CuotaPago {
  cuotaId: number;
  numeroCuota: number;
  fechaVencimiento: string;
}

// 📄 Información de la boleta
export interface BoletaPago {
  boletaId: number;
  urlBoleta: string;
}

// 💰 Inversionista vinculado al pago
export interface InversionistaPago {
  inversionistaId: number;
  nombreInversionista: string;
  emiteFactura: boolean;
  abonoCapital: number;
  abonoInteres: number;
  abonoIva: number;
  isr: number;
  cuotaPago: number | null;
  montoAportado: number;
  porcentajeParticipacion: number;
}

// 💳 Información del crédito asociado
export interface CreditoPago {
  creditoId: number;
  numeroCreditoSifco: string;
  capital: number;
  deudaTotal: number;
  statusCredit: string;
  porcentajeInteres: number;
  fechaCreacion: string;
}

// 🧍‍♂️ Información del usuario del crédito
export interface UsuarioPago {
  usuarioId: number;
  nombre: string;
  nit: string;
  Categoria: string;
}

// 💵 Objeto principal del pago
export interface PagoDataInvestor {
  pagoId: number;
  montoBoleta: number;
  numeroAutorizacion: string | null;
  fechaPago: string;

  // 🆕 Campos adicionales del pago
  mora: number | null;
  otros: number | null;
  reserva: number | null;
  membresias: number | null;
  observaciones: string | null;
  registerBy: string | null;
  bancoNombre: string | null;
  numeroautorizacion: string | null;
  validationStatus: string;

  // 💰 Abonos asociados directamente al pago
  abono_interes: number;
  abono_iva_12: number;
  abono_seguro: number;
  abono_gps: number;
  abono_capital: number;

  // 🔗 Relaciones
  credito: CreditoPago;
  cuota: CuotaPago | null;
  usuario: UsuarioPago;
  inversionistas: InversionistaPago[];
  boleta: BoletaPago | null;

  cuentaEmpresaBanco: string | null;
  cuentaEmpresaNombre: string | null;
  cuentaEmpresaNumero: string | null;
}

// 💰 Totales generales de todos los pagos
export interface TotalesPagos {
  totalAbonoCapital: number;
  totalAbonoInteres: number;
  totalAbonoIva: number;
  totalAbonoSeguro: number;
  totalAbonoGps: number;
  totalMora: number;
  totalOtros: number;
  totalReserva: number;
  totalMembresias: number;
  totalGeneral: number;
}

// 📊 Respuesta del servicio
export interface GetPagosResponse {
  success: boolean;
  message: string;
  page: number;
  pageSize: number;
  total: number;
  data: PagoDataInvestor[];
  totales?: TotalesPagos; // 🆕 Totales opcionales (vienen cuando NO es Excel)
  excelUrl?: string; // 🆕 URL del Excel (viene cuando excel=true)
  totalPages: number
}

// ⚙️ Parámetros del query
export interface GetPagosParams {
  page?: number;
  pageSize?: number;
  numeroCredito?: string;
  dia?: number;
  mes?: number;
  anio?: number;
  inversionistaId?: number;
  excel?: boolean;
  usuarioNombre?: string;
  validationStatus?: string; // 🆕 Filtro por estado de validación
}

/**
 * 🔹 Servicio que obtiene los pagos junto con su información completa
 * (crédito, usuario, cuota, inversionistas, boleta, etc.)
 */
export async function getPagosConInversionistasService(
  params: GetPagosParams
): Promise<GetPagosResponse> {
  const { data } = await api.get<GetPagosResponse>(
    `/reportes/pagos-inversionistas`,
    { params }
  );

  // 🔄 Aseguramos que el backend siempre devuelva tipos consistentes
  const parsedData: GetPagosResponse = {
    ...data,
    data: (data.data || []).map((pago) => ({
      ...pago,
      mora: pago.mora ?? 0,
      otros: pago.otros ?? 0,
      reserva: pago.reserva ?? 0,
      membresias: pago.membresias ?? 0,
      observaciones: pago.observaciones ?? null,
      abono_capital: Number(pago.abono_capital ?? 0), // 🆕 Agregado
      abono_interes: Number(pago.abono_interes ?? 0),
      abono_iva_12: Number(pago.abono_iva_12 ?? 0),
      abono_seguro: Number(pago.abono_seguro ?? 0),
      abono_gps: Number(pago.abono_gps ?? 0),
      inversionistas: pago.inversionistas ?? [],
    })),
    // 💰 Incluir totales si vienen del backend (solo cuando NO es Excel)
    totales: data.totales
      ? {
          totalAbonoCapital: Number(data.totales.totalAbonoCapital ?? 0),
          totalAbonoInteres: Number(data.totales.totalAbonoInteres ?? 0),
          totalAbonoIva: Number(data.totales.totalAbonoIva ?? 0),
          totalAbonoSeguro: Number(data.totales.totalAbonoSeguro ?? 0),
          totalAbonoGps: Number(data.totales.totalAbonoGps ?? 0),
          totalMora: Number(data.totales.totalMora ?? 0),
          totalOtros: Number(data.totales.totalOtros ?? 0),
          totalReserva: Number(data.totales.totalReserva ?? 0),
          totalMembresias: Number(data.totales.totalMembresias ?? 0),
          totalGeneral: Number(data.totales.totalGeneral ?? 0),
        }
      : undefined,
    // 📊 Incluir URL del Excel si viene
    excelUrl: data.excelUrl,
  };

  return parsedData;
}

export interface AplicarPagoResponse {
  success: boolean;
  applied?: boolean;
  message: string;
  data?: {
    credito_id: number;
    capital_anterior: string;
    abono_capital: string;
    capital_nuevo: string;
    deuda_total_nueva: string;
  };
}

export const pagosService = {
  /**
   * Aplica un pago al crédito y lo valida
   * @param pagoId - ID del pago a aplicar
   */
  aplicarPago: async (pagoId: number): Promise<AplicarPagoResponse> => {
    try {
      const { data } = await api.post<AplicarPagoResponse>(
        `/aplicar-pago`,
        null,
        { params: { pago_id: pagoId } }
      );
      return data;
    } catch (error) {
      console.error('Error en aplicarPago:', error);
      throw error;
    }
  },
};
export interface CreditoInfo {
  credito_id: number;
  numero_credito_sifco: string;
  capital: string;
  deudatotal: string;
  statusCredit:
    | "ACTIVO"
    | "CANCELADO"
    | "INCOBRABLE"
    | "PENDIENTE_CANCELACION"
    | "MOROSO";
  monto_mora: string; // 💰 Total de mora por crédito
  cuotas_atrasadas: number; // 📆 Cuotas vencidas
}

export interface AsesorResumen {
  asesor_id: number;
  asesor: string;
  total_creditos: number;
  total_capital: string;
  total_deuda: string;
  total_mora: string; // 💰 Mora total por asesor
  total_cuotas_atrasadas: number; // 📆 Cuotas vencidas totales
  creditos_al_dia: number;
  creditos_morosos: number;
  creditos: CreditoInfo[];
}

export interface ResponseCreditosPorAsesor {
  success: boolean;
  message: string;
  data: AsesorResumen[];
}

/**
 * 🔹 Servicio: Obtiene los créditos agrupados por asesor con mora y cuotas atrasadas
 * -------------------------------------------------------------------------------
 * @param numero_credito_sifco (opcional) - Filtra por número de crédito SIFCO
 * @returns Promise<ResponseCreditosPorAsesor>
 */
export const getCreditosPorAsesorService = async (
  numero_credito_sifco?: string
): Promise<ResponseCreditosPorAsesor> => {
  const params = numero_credito_sifco ? { numero_credito_sifco } : {};
  const { data } = await api.get<ResponseCreditosPorAsesor>(
    `/creditos-por-asesor`,
    { params }
  );
  return data;
};

// types/inversionistas.types.ts

export interface InversionistaResumen {
  inversionista_id: number;
  nombre: string;
  emite_factura: boolean;
  reinversion: boolean;
  banco: string | null;
  tipo_cuenta: string | null;
  numero_cuenta: string | null;
  total_abono_capital: number;
  total_abono_interes: number;
  total_abono_iva: number;
  total_isr: number;
  total_a_recibir: number;
}

export interface ResumenGlobalParams {
  inversionistaId?: number;
  mes?: number;
  anio?: number;
  excel?: boolean;
}

export interface ResumenGlobalExcelResponse {
  success: boolean;
  url: string;
  filename: string;
}

export type ResumenGlobalResponse = 
  | InversionistaResumen[] 
  | ResumenGlobalExcelResponse;



export const inversionistasService = {
  
  // 📊 Obtener resumen global
  getResumenGlobal: async (params: ResumenGlobalParams): Promise<ResumenGlobalResponse> => {
    const queryParams = new URLSearchParams();
    
    if (params.inversionistaId) {
      queryParams.append("inversionistaId", params.inversionistaId.toString());
    }
    if (params.mes) {
      queryParams.append("mes", params.mes.toString());
    }
    if (params.anio) {
      queryParams.append("anio", params.anio.toString());
    }
    if (params.excel !== undefined) {
      queryParams.append("excel", params.excel.toString());
    }

    const { data } = await api.get(
      `/resumen-global?${queryParams.toString()}`
    );
    
    return data;
  },

};

// 📁 types/pagos-pendientes.types.ts

/**
 * 💳 Información del crédito
 */
export interface CreditoInfoFalsePayment{
  creditoId: number;
  numeroCreditoSifco: string;
  capital: number;
  deudaTotal: number;
  statusCredit: string;
  montoAportado: number;
  porcentajeParticipacion: number;
}

/**
 * 📅 Información de la cuota actual
 */
export interface CuotaActual {
  cuotaId: number;
  numeroCuota: number;
  fechaVencimiento: string;
  montoCuota: number;
  capital: number;
  interes: number;
  iva: number;
}

/**
 * 💰 Información de un pago pendiente
 */
export interface PagoPendiente {
  pagoId: number;
  creditoId: number;
  cuotaId: number;
  fechaPago: string;
  montoBoleta: number;
  abonoCapital: number;
  abonoInteres: number;
  abonoIva: number;
  abonoSeguro: number;
  abonoGps: number;
  validationStatus: string;
  pagado: boolean;
}

/**
 * 📊 Crédito con su cuota actual y pagos pendientes
 */
export interface CreditoConPagosPendientes {
  credito: CreditoInfoFalsePayment;
  cuotaActual: CuotaActual;
  pagosPendientes: PagoPendiente[];
}

/**
 * 📋 Parámetros para generar pagos falsos
 */
export interface GenerateFalsePaymentsParams {
  inversionistaId: number;
  generateFalsePayment: boolean;
}

/**
 * ✅ Respuesta del servicio
 */
export interface GenerateFalsePaymentsResponse {
  success: boolean;
  message: string;
  inversionistaId: number;
  totalCreditosConPagos: number;
  pagosGenerados: boolean;
  data: CreditoConPagosPendientes[];
}

/**
 * ❌ Respuesta de error
 */
export interface GenerateFalsePaymentsError {
  success: false;
  error: string;
}
/**
 * 🚀 Genera pagos falsos para un inversionista
 * 
 * @param params - Parámetros del request
 * @returns Promesa con la respuesta del servidor
 * 
 * @example
 * // Solo consultar sin generar
 * const resultado = await generateFalsePaymentsService({
 *   inversionistaId: 123,
 *   generateFalsePayment: false
 * });
 * 
 * @example
 * // Consultar y generar pagos
 * const resultado = await generateFalsePaymentsService({
 *   inversionistaId: 123,
 *   generateFalsePayment: true
 * });
 */
export async function generateFalsePaymentsService(
  params: GenerateFalsePaymentsParams
): Promise<GenerateFalsePaymentsResponse | GenerateFalsePaymentsError> {
  try {
    const { data } = await api.post<GenerateFalsePaymentsResponse>(
      "/generateFalsePayments",
      params
    );

    return data;
  } catch (error: any) {
    console.error("❌ Error en generateFalsePaymentsService:", error);
    
    // Retornar error estructurado
    return {
      success: false,
      error: error.response?.data?.error || error.message || "Error al generar pagos",
    };
  }
}

export interface Banco {
  banco_id: number;
  nombre: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBancoDto {
  nombre: string;
}

export interface UpdateBancoDto {
  nombre: string;
}

export interface BancoResponse {
  success: boolean;
  data?: Banco;
  message?: string;
  error?: string;
}

export interface BancosResponse {
  success: boolean;
  data?: Banco[];
  message?: string;
  error?: string;
}

export const bancoService = {
  // 📋 Obtener todos los bancos
  getAll: async (): Promise<Banco[]> => {
    const { data } = await api.get<BancosResponse>('/bancos');
    return data.data || [];
  },

  // 🔍 Obtener un banco por ID
  getById: async (id: number): Promise<Banco> => {
    const { data } = await api.get<BancoResponse>(`/bancos/${id}`);
    if (!data.data) throw new Error('Banco no encontrado');
    return data.data;
  },

  // ✨ Crear nuevo banco
  create: async (bancoData: CreateBancoDto): Promise<Banco> => {
    const { data } = await api.post<BancoResponse>('/bancos', bancoData);
    if (!data.data) throw new Error('Error al crear banco');
    return data.data;
  },

  // ✏️ Actualizar banco
  update: async (id: number, bancoData: UpdateBancoDto): Promise<Banco> => {
    const { data } = await api.put<BancoResponse>(`/bancos/${id}`, bancoData);
    if (!data.data) throw new Error('Error al actualizar banco');
    return data.data;
  },

  // 🗑️ Eliminar banco
  delete: async (id: number): Promise<void> => {
    await api.delete<BancoResponse>(`/bancos/${id}`);
  },
};


export interface CondonarMasivaRequest {
  motivo: string;
  usuario_email: string;
}

export interface CondonacionMasivaResponse {
  success: boolean;
  message: string;
  condonados?: number;
  creditos_afectados?: number[];
  condonaciones?: any[];
  error?: string;
}

export const morasService = {
  /**
   * Condonar mora de TODOS los créditos morosos
   */
  condonarMorasMasivo: async (data: CondonarMasivaRequest): Promise<CondonacionMasivaResponse> => {
    const response = await api.post('/moras/condonar-masivo', data);
    return response.data;
  },
};

// types/cuentasEmpresa.types.ts

export interface CuentaEmpresa {
  cuentaId: number;
  nombreCuenta: string;
  banco: string;
  numeroCuenta: string;
  descripcion?: string | null;
  activo: boolean;
  fecha_creacion: string;
  fecha_actualizacion: string;
}

export interface CuentasEmpresaResponse {
  success: boolean;
  message: string;
  data: CuentaEmpresa[];
}

export interface ActualizarCuentaPagoRequest {
  pagoId: number;
  cuentaEmpresaId: number;
}

export interface ActualizarCuentaPagoResponse {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}



// 🏦 Obtener todas las cuentas de empresa activas
export async function getCuentasEmpresaService(): Promise<CuentasEmpresaResponse> {
  try {
    const { data } = await api.get<CuentasEmpresaResponse>(
      `${API_URL}/api/cuentas`
    );

    return data;
  } catch (error: any) {
    console.error("❌ Error en getCuentasEmpresaService:", error);
    
    // Retornar respuesta de error estructurada
    return {
      success: false,
      message: error.response?.data?.message || "Error al obtener las cuentas de empresa",
      data: [],
    };
  }
}

// 🔄 Actualizar cuenta de empresa en un pago
export async function actualizarCuentaPagoService(
  params: ActualizarCuentaPagoRequest
): Promise<ActualizarCuentaPagoResponse> {
  try {
    const { pagoId, cuentaEmpresaId } = params;

    const { data } = await api.post<ActualizarCuentaPagoResponse>(
      `${API_URL}/actualizar-cuenta`,
      null, // No body porque usamos query params
      {
        params: {
          pagoId: pagoId.toString(), // 👈 Convertir a string
          cuentaEmpresaId: cuentaEmpresaId.toString(), // 👈 Convertir a string
        },
      }
    );

    return data;
  } catch (error: any) {
    console.error("❌ Error en actualizarCuentaPagoService:", error);
    
    return {
      success: false,
      message: error.response?.data?.message || "Error al actualizar la cuenta del pago",
      error: error.message,
    };
  }
}
 
export interface CreatePaymentAgreementInput {
  credit_id: number;
  payment_ids: number[];
  total_agreement_amount: number;
  number_of_months: number;
  reason?: string;
  observations?: string;
  created_by: number;
}

export interface GetPaymentAgreementsFilters {
  credit_id?: number;
  start_date?: string; // ISO format
  end_date?: string;
  year?: number;
  month?: number;
  day?: number;
  status?: 'active' | 'completed' | 'inactive' | 'all';
}

export interface PaymentAgreementResponse {
  success: boolean;
  data: any;
  message: string;
  error?: any;
}

// CREATE payment agreement
export const createPaymentAgreement = async (
  input: CreatePaymentAgreementInput
): Promise<PaymentAgreementResponse> => {
  try {
    const response = await fetch(`${API_URL}/payment-agreements`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Failed to create payment agreement");
    }

    return data;
  } catch (error) {
    console.error("Error creating payment agreement:", error);
    throw error;
  }
};

// GET payment agreements with filters
export const getPaymentAgreements = async (
  filters?: GetPaymentAgreementsFilters
): Promise<PaymentAgreementResponse> => {
  try {
    const params = new URLSearchParams();

    if (filters?.credit_id) {
      params.append("credit_id", filters.credit_id.toString());
    }
    if (filters?.start_date) {
      params.append("start_date", filters.start_date);
    }
    if (filters?.end_date) {
      params.append("end_date", filters.end_date);
    }
    if (filters?.year) {
      params.append("year", filters.year.toString());
    }
    if (filters?.month) {
      params.append("month", filters.month.toString());
    }
    if (filters?.day) {
      params.append("day", filters.day.toString());
    }
    if (filters?.status) {
      params.append("status", filters.status);
    }

    const url = `${API_URL}/payment-agreements${
      params.toString() ? `?${params.toString()}` : ""
    }`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Failed to fetch payment agreements");
    }

    return data;
  } catch (error) {
    console.error("Error fetching payment agreements:", error);
    throw error;
  }
};