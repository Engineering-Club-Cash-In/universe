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
  banco: number | null;
  dpi:number | null;
  tipo_cuenta: string | null;
  re_inversion: string | null;
  numero_cuenta: string | null;
  moneda?: string;
  tipo_reinversion?: string | null;
  monto_reinversion?: number | null;
}
export interface InvestorResponse {
  inversionista_id: number;
  nombre: string;
  emite_factura: boolean;
  reinversion: boolean;
  banco: string | null;
  tipo_cuenta: string | null;
  numero_cuenta: string | null;
  moneda?: string;
  currencySymbol?: string;
  tipo_reinversion?: string | null;
  monto_reinversion?: number | null;
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
  permite_abono_capital?: boolean;
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
export interface ConvenioActivo {
  convenio_id: number;
  credito_id: number;
  monto_total_convenio: string;
  numero_meses: number;
  cuota_mensual: string;
  fecha_convenio: string;
  monto_pagado: string;
  monto_pendiente: string;
  pagos_realizados: number;
  pagos_pendientes: number;
  activo: boolean;
  completado: boolean;
  motivo: string | null;
  observaciones: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  
  // 🔥 NUEVOS CAMPOS TIPADOS
  cuotasEnConvenio: CuotaEnConvenio[];
  pagosConvenio: PagoConvenio[];
  cuotasConvenioMensuales: CuotaConvenioMensual[];
  cuotaConvenioAPagar: string;
}

// Cuota mensual del convenio (15 y 30)
export interface CuotaConvenioMensual {
  cuota_convenio_id: number;
  convenio_id: number;
  numero_cuota: number;
  fecha_vencimiento: string;
  fecha_pago: string | null;
  created_at: string;
}

// Cuotas del crédito que están en el convenio
export interface CuotaEnConvenio {
  cuota_id: number;
  credito_id: number;
  numero_cuota: number;
  fecha_vencimiento: string;
  monto_capital: string;
  monto_interes: string;
  monto_total: string;
  pagado: boolean;
  createdAt: string;
}

// Pagos asociados al convenio (tabla pivot)
export interface PagoConvenio {
  id: number;
  convenio_id: number;
  pago_id: number;
  created_at: string;
}
export interface ConvenioPagosResume {
  id: number;
  convenio_id: number;
  pago_id: number;
  created_at: string;
}
export interface GetCreditoByNumeroActivoResponse {
  flujo: "ACTIVO";
  credito: Credito;
  usuario: Usuario;
  cuotaActual: number;
  moraActual: number;
  cuotaActualPagada: boolean;
  cuotaActualStatus: 'no_required' | 'pending' | 'validated' | 'capital' | 'reset';

  // 🔥 ARRAYS DE CUOTAS (ahora con campos de abonos)
  cuotasAtrasadas: Cuota[];
  cuotasPagadas: Cuota[];
  cuotasPendientes: Cuota[];
  
  // 🔥 CONVENIO (puede ser null)
  convenioActivo: ConvenioActivo | null;
  
  // 🔥 ESTOS YA NO SON NECESARIOS porque están dentro de convenioActivo
  // pero los dejamos para compatibilidad
  cuotasEnConvenio: Cuota[];
  pagosConvenio: ConvenioPagosResume[];
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
export interface InversionistaEspejo {
  credito_id: number;
  inversionista_id: number;
  nombre: string;
  monto_aportado: string;
  porcentaje_participacion: string;
  porcentaje_cash_in: string;
  porcentaje_inversion: string;
  monto_cash_in: string;
  monto_inversionista: string;
  cuota_inversionista: string;
  fecha_inicio_participacion?: string;
}

export interface CreditoUsuarioPago {
  creditos: Credito;
  usuarios: Usuario;
  inversionistas: AporteInversionista[];
  creditos_inversionistas_espejo?: InversionistaEspejo[];
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
  permite_abono_capital?: boolean;
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
  fecha_inicio_participacion?: string;
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
  estado: "ACTIVO" | "CANCELADO" | "INCOBRABLE" | "PENDIENTE_CANCELACION" | "MOROSO" | "EN_CONVENIO";
  excel: boolean;
  asesor_id?: number;
  nombre_usuario?: string;
  is_vehiculo_propio?: boolean;
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
      ...(params.nombre_usuario && {
        nombre_usuario: params.nombre_usuario,
      }),
      ...(params.is_vehiculo_propio !== undefined && {
        is_vehiculo_propio: params.is_vehiculo_propio,
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
    fecha_aplicado: string;
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
    monto_aplicado: string | null;
    abono_capital_id?: number | null;
    abono_capital_detalle?: {
      monto: string;
      tipo: string;
    } | null;
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
    abono_capital_id?: number | null;
    abono_capital_detalle?: {
      monto: string;
      tipo: string;
    } | null;
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
  fecha_inicio_participacion?: string;
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

  // Campos de usuario
  nombre?: string;
  nit?: string;
  direccion?: string;
  saldo_a_favor?: number;

  // Formato de crédito
  formato_credito?: string;

  // Abono capital
  permite_abono_capital?: boolean;

  // Inversionistas nuevos
  inversionistas?: InversionistaPayload[];
  inversionistas_espejo?: InversionistaPayload[];
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
export async function reversePagosInversionistasService({ pago_id, credito_id,reverseAccounting }: { pago_id: number; credito_id: number, reverseAccounting: boolean }) {
  const res = await api.post(`${API_URL}/reversePayment`, {
    pago_id,
    credito_id,
    reverseAccounting,
  });
  return res.data;
}

// Revertir pago a pendiente
export async function revertPaymentToPendingService({ pago_id, credito_id }: { pago_id: number; credito_id: number }) {
  const res = await api.post(`${API_URL}/revertPaymentToPending`, {
    pago_id,
    credito_id,
  });
  return res.data;
}

// Revalidar pago
export async function revalidatePaymentService({ pago_id, credito_id }: { pago_id: number; credito_id: number }) {
  const res = await api.post(`${API_URL}/revalidatePayment`, {
    pago_id,
    credito_id,
  });
  return res.data;
}

// Procesar inversionistas manualmente
export async function processInvestorsService({ pago_id, credito_id }: { pago_id: number; credito_id: number }) {
  const res = await api.post(`${API_URL}/processInvestors`, {
    pago_id,
    credito_id,
  });
  return res.data;
}
export async function recalcularPagosService({ numero_credito_sifco, numero_cuota }: { numero_credito_sifco: string; numero_cuota: number }) {
  const res = await api.post(`${API_URL}/recalcular-pagos`, {
    numero_credito_sifco,
    numero_cuota,
  });
  return res.data;
}

// Editar un pago (PATCH)
export interface EditPaymentParams {
  abono_capital?: string;
  abono_interes?: string;
  abono_iva_12?: string;
  abono_seguro?: string;
  abono_gps?: string;
  capital_restante?: string;
  interes_restante?: string;
  iva_12_restante?: string;
  seguro_restante?: string;
  gps_restante?: string;
  membresias?: string;
  membresias_pago?: string;
  otros?: string;
  mora?: string;
  monto_boleta?: string;
  monto_aplicado?: string;
  observaciones?: string;
  pagado?: boolean;
  fecha_pago?: string;
  origen_pago?: string;
}

export async function editPaymentService(pagoId: number, params: EditPaymentParams) {
  const { data } = await api.patch(`${API_URL}/editPayment/${pagoId}`, params);
  return data;
}

export interface PagoCredito {
  id: number;
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
  abono_capital_id?: number | null;
  abono_capital_detalle?: {
    monto: string;
    tipo: string;
  } | null;
}

// Detalle de cada crédito en el que participa un inversionista
export interface CreditoInversionistaData {
  credito_id: number;
  credito_inversionista_espejo_id?: number;
  tipo_reinversion?: string;
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
  total_cuota_sin_reinversion: number;
  total_cuota_con_reinversion: number;
  total_monto_aportado: number;
  total_reinversion_capital: number;
  total_reinversion_interes: number;
  total_reinversion: number;
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
  re_inversion: string;
  monto_reinversion?: string | null;
  saldo_reinversion?: string | null;
  dpi: number | null;
  tieneBoletaPendiente: boolean;
  moneda?: string;
  currencySymbol?: string;
}

// La respuesta completa (paginada)
// 🔧 SERVICIO
export interface InversionistasCreditosResponse {
  inversionistas: InversionistaConCreditos[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

// 🆕 NUEVA INTERFACE: Respuesta de totales globales (sin paginación)
export interface InvestorTotalsResponse {
  inversionista_id: number;
  nombre_inversionista: string;
  moneda?: string;
  currencySymbol?: string;
  totales: SubtotalInversionista;
}

export interface GetInvestorParams {
  id?: number;
  dpi?: string; // 🆕
  page?: number;
  perPage?: number;
  numeroCreditoSifco?: string; // 🆕
  nombreUsuario?: string; // 🆕
  incluirLiquidados?: boolean; // 🆕
  numeroCuota?: number; // 🆕
  tipo?: "originales" | "espejos" | "ambas"; // 🆕 NUEVO: Permite consultar originales, espejos o ambas
}

export async function getInvestorServices(
  params?: GetInvestorParams
): Promise<InversionistasCreditosResponse> {
  const query = new URLSearchParams();

  if (params?.id !== undefined) query.append("id", String(params.id));
  if (params?.dpi) query.append("dpi", params.dpi); // 🆕
  if (params?.page !== undefined) query.append("page", String(params.page));
  if (params?.perPage !== undefined) query.append("perPage", String(params.perPage));
  if (params?.numeroCreditoSifco) query.append("numeroCreditoSifco", params.numeroCreditoSifco); // 🆕
  if (params?.nombreUsuario) query.append("nombreUsuario", params.nombreUsuario); // 🆕
  if (params?.incluirLiquidados !== undefined) query.append("incluirLiquidados", String(params.incluirLiquidados)); // 🆕
  if (params?.numeroCuota !== undefined) query.append("numeroCuota", String(params.numeroCuota)); // 🆕
  if (params?.tipo) query.append("tipo", params.tipo); // 🆕 NUEVO: Agregar tipo a la query

  const url = `${import.meta.env.VITE_BACK_URL}/getInvestors${query.toString() ? `?${query.toString()}` : ""}`;
  const res = await api.get<InversionistasCreditosResponse>(url);
  return res.data;
}

// 🆕 NUEVO SERVICIO: Obtener totales globales (sin paginación)
export async function getInvestorTotalsService(
  params?: GetInvestorParams
): Promise<InvestorTotalsResponse> {
  const query = new URLSearchParams();

  if (params?.id !== undefined) query.append("id", String(params.id));
  if (params?.dpi) query.append("dpi", params.dpi);
  if (params?.tipo) query.append("tipo", params.tipo);
  if (params?.incluirLiquidados !== undefined) 
    query.append("incluirLiquidados", String(params.incluirLiquidados));
  if (params?.numeroCuota !== undefined) 
    query.append("numeroCuota", String(params.numeroCuota));

  const url = `${import.meta.env.VITE_BACK_URL}/getInvestorTotals${query.toString() ? `?${query.toString()}` : ""}`;
  const res = await api.get<InvestorTotalsResponse>(url);
  return res.data;
}

// ============================================================
// calcularPagosEspejo — POST /calcularPagosEspejo
// ============================================================
export interface CalcularPagosEspejoResponse {
  success: boolean;
  message: string;
  inversionistaId: number;
  totalCreditosProcesados: number;
  data: {
    creditoId: number;
    numeroCreditoSifco: string;
    cuotaProcesada: number;
    pagosRegistrados: number;
  }[];
}

export async function calcularPagosEspejoService(
  inversionistaId: number
): Promise<CalcularPagosEspejoResponse> {
  const res = await api.post<CalcularPagosEspejoResponse>(
    `${import.meta.env.VITE_BACK_URL}/calcularPagosEspejo`,
    { inversionistaId }
  );
  return res.data;
}

// ============================================================
// getInvestorMirrorSummary — GET /getInvestorMirrorSummary
// ============================================================
export interface InvestorMirrorSummaryResponse {
  inversionista_id: number;
  nombre: string;
  emite_factura: boolean;
  reinversion: string;
  banco_id: number | null;
  tipo_cuenta: string | null;
  numero_cuenta: string | null;
  dpi: number | null;
  moneda?: string;
  currencySymbol?: string;
  subtotal: {
    total_abono_capital: number;
    total_abono_interes: number;
    total_abono_iva: number;
    total_isr: number;
    total_cuota_sin_reinversion: number;
    total_cuota_con_reinversion: number;
    total_monto_aportado: number;
    totalAbonoGeneralInteres: number;
    total_capital_creditos: number;
    total_capital_actual: number;
    total_reinversion_capital: number;
    total_reinversion_interes: number;
    total_reinversion: number;
  };
}

export async function getInvestorMirrorSummaryService(params: {
  id?: number;
  dpi?: string;
  incluirLiquidados?: boolean;
}): Promise<InvestorMirrorSummaryResponse> {
  const query = new URLSearchParams();
  if (params.id !== undefined) query.append("id", String(params.id));
  if (params.dpi) query.append("dpi", params.dpi);
  if (params.incluirLiquidados !== undefined)
    query.append("incluirLiquidados", String(params.incluirLiquidados));

  const url = `${import.meta.env.VITE_BACK_URL}/getInvestorMirrorSummary${
    query.toString() ? `?${query.toString()}` : ""
  }`;
  const res = await api.get<InvestorMirrorSummaryResponse>(url);
  return res.data;
}

// ============================================================
// recalcularPagosEspejo — POST /recalcularPagosEspejo
// ============================================================
export interface RecalcularPagoPayload {
  id: number;
  abono_capital: string;
  abono_interes: string;
  abono_iva_12: string;
  porcentaje_participacion: string;
  cuota: string;
  estado_liquidacion?: "NO_LIQUIDADO" | "LIQUIDADO";
}

export interface RecalcularPagosEspejoResponse {
  success: boolean;
  message: string;
  actualizados: number;
}

export async function recalcularPagosEspejoService(
  pagos: RecalcularPagoPayload[]
): Promise<RecalcularPagosEspejoResponse> {
  const res = await api.post<RecalcularPagosEspejoResponse>(
    `${import.meta.env.VITE_BACK_URL}/recalcularPagosEspejo`,
    { pagos }
  );
  return res.data;
}

// ============================================================
// aplicarPagosEspejo — POST /aplicarPagosEspejo
// ============================================================
export interface AplicarPagosEspejoResponse {
  success: boolean;
  message: string;
  actualizados: number;
}

export async function aplicarPagosEspejoService(
  inversionistaId: number
): Promise<AplicarPagosEspejoResponse> {
  const res = await api.post<AplicarPagosEspejoResponse>(
    `${import.meta.env.VITE_BACK_URL}/aplicarPagosEspejo`,
    { inversionistaId }
  );
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
export interface LiquidateByInvestorRequest {
  inversionista_id: number;
}

// Response body (ajústalo según tu backend, aquí uso lo que mandas arriba)
export interface LiquidateByInvestorResponse {
  inversionista_id(arg0: string, inversionista_id: any): unknown;
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
    capital: string;
    interes: string;
    iva: string;
    membresias: string;
    seguro: string;
    gps: string;
    mora: string;
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
  traspaso?: number;
  garantia_mobiliaria?: number;
  otros?: number;
  cuotas_atrasadas?: number;
  montosAdicionales?: MontoAdicional[];
}
export interface PendingCancelCreditPayload {
  creditId: number;
  accion: "PENDIENTE_CANCELACION";
  motivo: string;
  observaciones?: string;
  monto_cancelacion: number;
  cuotas_atrasadas?: number;
  traspaso?: number;
  garantia_mobiliaria?: number;
  otros?: number;
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
  monto_cancelacion: number;
  traspaso?: number;
  garantia_mobiliaria?: number;
  otros?: number;
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
  montoBoleta: number | string;
  url_boletas: string[];
  cuota: number;
  banco_id: number;
  montoIncobrable?: number;
  numeroAutorizacion?: string;
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
  telefono?: string | null;
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

// 🔄 Monto adicional dentro de una cancelación
export interface MontoAdicionalCancelacion {
  concepto: string;
  monto: string;
}

// 🔄 Cancelación asociada a un pago reset
export interface CancelacionPago {
  id: number;
  motivo: string;
  observaciones?: string | null;
  fechaCancelacion?: string;
  montoCancelacion: string;
  activo?: boolean;
  traspaso: string;
  garantiaMobiliaria: string;
  otros: string;
  cuotasAtrasadas: number;
  montosAdicionales?: MontoAdicionalCancelacion[];
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
  pagoConvenio: number | null;
  observaciones: string | null;
  registerBy: string | null;
  registerByNombre: string | null;
  bancoNombre: string | null;
  fechaBoleta: string | null;
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
  boletas: BoletaPago[];
  monto_aplicado: number | null;

  cuentaEmpresaBanco: string | null;
  cuentaEmpresaNombre: string | null;
  cuentaEmpresaNumero: string | null;

  // 🔄 Cancelación (solo presente en pagos reset)
  cancelacion?: CancelacionPago | null;
}

// 💰 Totales generales de todos los pagos
export interface TotalInversionista {
  inversionistaId: number;
  nombreInversionista: string;
  totalAbonoCapital: number;
  totalAbonoInteres: number;
  totalAbonoIva: number;
  totalIsr: number;
  totalMontoAportado: number;
}

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
  totalConvenio: number;
}

// 📊 Respuesta del servicio
export interface GetPagosResponse {
  success: boolean;
  message: string;
  page: number;
  pageSize: number;
  total: number;
  data: PagoDataInvestor[];
  totales?: TotalesPagos;
  totalesInversionistas?: TotalInversionista[];
  excelUrl?: string;
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
  fechaInicio?: string;
  fechaFin?: string;
  fechaAplicado?: string;
  categoriaCredito?: string;
  formatoCredito?: string;
  soloAplicados?: boolean;
  inversionistaId?: number;
  excel?: boolean;
  usuarioNombre?: string;
  validationStatus?: string;
  reportAdvisor?: boolean;
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
          totalConvenio: Number(data.totales.totalConvenio ?? 0),
        }
      : undefined,
    totalesInversionistas: data.totalesInversionistas ?? undefined,
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



export const notificarContabilidadBoletas = async () => {
  const { data } = await api.post("/notifications/pay-investors", {
    titulo: "Pagos de inversionistas cargados",
    descripcion:
      "Ya se pueden cargar las boletas correspondientes al mes de febrero 2026.",
  });
  return data;
};

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

// Historial de liquidaciones
export interface BoletaLiquidacion {
  boleta_id: number;
  boleta_url: string;
  estado: string;
  notas: string | null;
  monto_boleta: string;
  fecha_subida: string;
}

export interface LiquidacionResumen {
  inversionista_id: number;
  nombre: string;
  emite_factura: boolean;
  reinversion: string;
  banco: string | null;
  tipo_cuenta: string | null;
  numero_cuenta: string | null;
  total_abono_capital: number;
  total_abono_interes: number;
  total_abono_iva: number;
  total_isr: number;
  total_a_recibir_sin_reinversion: number;
  total_reinversion: number;
  total_a_recibir_con_reinversion: number;
  total_cuota: number;
  boleta_pendiente: string | null;
  boleta_liquidacion: BoletaLiquidacion | null;
  reporte_liquidacion_url: string | null;
  estado_liquidacion_resumen: string;
}

export async function getResumenGlobalLiquidaciones(params: {
  mes: number;
  anio: number;
  estado?: string;
}): Promise<LiquidacionResumen[]> {
  const { data } = await api.get(`${API_URL}/resumen-global-liquidaciones`, {
    params: { mes: params.mes, anio: params.anio, estado: params.estado ?? "liquidated" },
  });
  return data;
}

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
          pagoId: pagoId.toString(),
          cuentaEmpresaId: cuentaEmpresaId.toString(),
        },
      }
    );

    // Si el backend responde 200 pero sin campo success, asumimos éxito
    if (data.success === undefined) {
      return { ...data, success: true, message: data.message || "Cuenta actualizada correctamente" };
    }

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
    const { data } = await api.post(`${API_URL}/payment-agreements`, input);

    return data;
  } catch (error: any) {
    console.error("Error creating payment agreement:", error);
    throw new Error(error?.response?.data?.message || "Failed to create payment agreement");
  }
};


// GET payment agreements with filters
export const getPaymentAgreements = async (
  filters?: GetPaymentAgreementsFilters
): Promise<PaymentAgreementResponse> => {
  try {
    const params: Record<string, any> = {};

    if (filters?.credit_id) params.credit_id = filters.credit_id;
    if (filters?.start_date) params.start_date = filters.start_date;
    if (filters?.end_date) params.end_date = filters.end_date;
    if (filters?.year) params.year = filters.year;
    if (filters?.month) params.month = filters.month;
    if (filters?.day) params.day = filters.day;
    if (filters?.status) params.status = filters.status;

    const { data } = await api.get(`${API_URL}/payment-agreements`, {
      params,
    });

    return data;
  } catch (error: any) {
    console.error("Error fetching payment agreements:", error);
    throw new Error(error?.response?.data?.message || "Failed to fetch payment agreements");
  }
};
// Toggle payment agreement status (activate/deactivate)
export const togglePaymentAgreementStatus = async (
  convenio_id: number,
  activo: boolean
): Promise<{ success: boolean; message: string }> => {
  try {
    const { data } = await api.post(`${API_URL}/payment-agreements/toggle-status`, {
      convenio_id,
      activo,
    });

    return data;
  } catch (error: any) {
    console.error("Error toggling payment agreement status:", error);
    throw new Error(
      error?.response?.data?.message || "Failed to toggle payment agreement status"
    );
  }
};



// ============================================================
// reversePagosEspejo — POST /reversePagosEspejo
// ============================================================
export interface ReversePagosEspejoResponse {
  success: boolean;
  message: string;
}

export async function reversePagosEspejoService(
  inversionistaId: number
): Promise<ReversePagosEspejoResponse> {
  const res = await api.post<ReversePagosEspejoResponse>(
    `${import.meta.env.VITE_BACK_URL}/deletePagosEspejoNoLiquidados`,
    { inversionistaId }
  );
  return res.data;
}

// 📋 TYPES
export interface FacturaElectronica {
  factura_id: number;
  pago_id: number;
  serie: string;
  numero: string;
  uuid: string;
  tipo_documento: string;
  monto_total: string;
  monto_iva: string;
  pdf_url: string;
  xml_url?: string;
  receptor_nit: string;
  receptor_nombre: string;
  fecha_emision: string;
  fecha_certificacion: string;
  status: 'ACTIVA' | 'ANULADA';
  fecha_anulacion?: string;
  motivo_anulacion?: string;
  anulada_por?: number;
  created_at: string;
  created_by?: number;
}

export interface FacturarPagoCompletoRequest {
  pago_id: number;
  created_by?: number;
}

export interface FacturarPagoCompletoResponse {
  success: boolean;
  data?: {
    pago_id: number;
    cliente: {
      nombre: string;
      nit: string;
    };
    total_facturas: number;
    facturas: Array<{
      tipo: 'SERVICIOS' | 'INTERESES';
      inversionista?: string;
      inversionista_id?: number;
      factura_id: number;
      idInterno: string;
      serie: string;
      numero: number;
      uuid: string;
      xmlCertificado: string;
      fechaEmision: string;
      pdfUrl: string;
      pdfFilename: string;
      monto_total: number;
      monto_iva: number;
      receptor: {
        nombre: string;
        nit: string;
      };
    }>;
  };
  mensaje?: string;
  error?: string;
  stack?: string;
}
export interface AnularFacturaRequest {
  uuid: string;
  xmlAnulacion: string;
  motivo: string;
  userId: number;
}

export interface ObtenerFacturaResponse {
  success: boolean;
  data?: FacturaElectronica & {
    xmlCertificado?: string;
  };
  mensaje?: string;
  error?: string;
}

export interface FacturasPorPagoResponse {
  success: boolean;
  data?: {
    total_facturas: number;
    facturas_activas: number;
    facturas_anuladas: number;
    monto_total_activo: number;
    facturas: FacturaElectronica[];
  };
  mensaje?: string;
  error?: string;
}

// 🔥 SERVICIOS API

// 1. Certificar factura
export const facturarPagoCompleto = async (
  data: FacturarPagoCompletoRequest
): Promise<FacturarPagoCompletoResponse> => {
  const response = await api.post('/api/dte/facturar-pago-completo', data);
  return response.data;
};
// 2. Obtener factura por UUID
export const obtenerFacturaPorUUID = async (uuid: string): Promise<ObtenerFacturaResponse> => {
  const response = await api.get(`/api/dte/obtener/${uuid}`);
  return response.data;
};

// 3. Anular factura
export const anularFactura = async (data: AnularFacturaRequest) => {
  const response = await api.post('/api/dte/anular', data);
  return response.data;
};

// 4. Obtener facturas por pago
export const obtenerFacturasPorPago = async (pagoId: number): Promise<FacturasPorPagoResponse> => {
  const response = await api.get(`/api/dte/credito/${pagoId}`);
  return response.data;
};


// src/api/facturas.ts - AGREGAR este tipo y servicio

export interface FacturaConPago extends FacturaElectronica {
  pago_fecha: string;
  pago_monto_boleta: string;
  pago_mes_pagado: string;
}

export interface FacturasPorCreditoResponse {
  success: boolean;
  data?: {
    credito_id: number;
    total_facturas: number;
    facturas_activas: number;
    facturas_anuladas: number;
    monto_total_activo: number;
    facturas: FacturaConPago[];
  };
  mensaje?: string;
  error?: string;
}

// 🔥 Obtener facturas por crédito
export const obtenerFacturasPorCredito = async (creditoId: number): Promise<FacturasPorCreditoResponse> => {
  const response = await api.get(`/api/dte/credito/${creditoId}/facturas`);
  return response.data;
};


// services/dte.service.ts

interface Desglose {
  abono_capital: string;
  abono_seguro: string;
  abono_gps: string;
  membresias_pago: string;
  mora: string;
  abono_interes: string;
  abono_iva_12: string;
}

interface Pago {
  pago_id: number;
  credito_id: number;
  mes_pagado: number;
  fecha_pago: string;
  fecha_vencimiento: string;
  monto_boleta: string;
  validationStatus: string;
  desglose: Desglose;
}

interface Cliente {
  usuario_id: number;
  nombre: string;
  nit: string;
  direccion: string;
}

 

interface Factura {
  factura_id: number;
  serie: string;
  numero: string;
  uuid: string;
  tipo_documento: string;
  monto_total: string;
  monto_iva: string;
  pdf_url: string;
  receptor_nit: string;
  receptor_nombre: string;
  status: string;
  fecha_emision: string;
  fecha_certificacion: string;
  fecha_anulacion: string | null;
  motivo_anulacion: string | null;
  created_at: string;
  link_pdf: string;
  link_fel: string;
}

interface Facturas {
  total: number;
  activas: number;
  anuladas: number;
  estadisticas: {
    monto_total_facturado: string;
    monto_iva_facturado: string;
  };
  listado: Factura[];
}

interface PagoCompletoResponse {
  success: boolean;
  data: {
    pago: Pago;
    cliente: Cliente;
    credito: Credito;
    facturas: Facturas;
  };
  mensaje: string;
}

export const getPagoCompleto = async (pagoId: number): Promise<PagoCompletoResponse> => {
  const response = await api.get(`/api/dte/pago-completo/${pagoId}`);
  return response.data;
};

export const generarReciboPago = async (pagoId: number): Promise<{ pdfUrl: string }> => {
  const response = await api.get<{ pdfUrl: string }>(`/recibo-pago/${pagoId}`);
  return response.data;
};

// 🔥 TIPOS
export interface Boleta {
  boleta_id: number;
  inversionista_id: number;
  boleta_url: string;
  estado: "PENDIENTE" | "PROCESADO";
  monto_boleta: string | null;
  notas: string | null;
  fecha_subida: string;
  fecha_procesado: string | null;
  subido_por: number | null;
}

export interface CreateBoletaDTO {
  inversionista_id: number;
  boleta_url: string;
  monto_boleta?: string;
  notas?: string;
  subido_por?: number;
}

export interface GetBoletasFilters {
  inversionista_id?: number;
  estado?: "PENDIENTE" | "PROCESADO";
  limit?: number;
  offset?: number;
}

export interface BoletaConInversionista {
  boleta: Boleta;
  inversionista: {
    inversionista_id: number;
    nombre: string;
    dpi: string;
    emite_factura: boolean;
  };
}

// ============================================
// 📝 CREATE - Crear boleta
// ============================================
export const createBoleta = async (data: CreateBoletaDTO) => {
  try {
    console.log("📝 Creando boleta:", data);

    const response = await axios.post<{
      success: boolean;
      message: string;
      data: Boleta;
    }>(`${API_URL}/boletas`, data);

    return response.data;
  } catch (error: any) {
    console.error("❌ Error creando boleta:", error);
    throw new Error(
      error.response?.data?.message || "Error al crear boleta"
    );
  }
};

// ============================================
// 📖 READ - Listar boletas
// ============================================
export const getBoletas = async (filters?: GetBoletasFilters) => {
  try {
    console.log("📋 Obteniendo boletas con filtros:", filters);

    const params = new URLSearchParams();
    
    if (filters?.inversionista_id) {
      params.append("inversionista_id", filters.inversionista_id.toString());
    }
    if (filters?.estado) {
      params.append("estado", filters.estado);
    }
    if (filters?.limit) {
      params.append("limit", filters.limit.toString());
    }
    if (filters?.offset) {
      params.append("offset", filters.offset.toString());
    }

    const response = await axios.get<{
      success: boolean;
      data: BoletaConInversionista[];
      total: number;
    }>(`${API_URL}/boletas?${params.toString()}`);

    return response.data;
  } catch (error: any) {
    console.error("❌ Error obteniendo boletas:", error);
    throw new Error(
      error.response?.data?.message || "Error al obtener boletas"
    );
  }
};

// ============================================
// 🔥 FACTURAR GENÉRICO - TYPES Y SERVICIO
// ============================================

export interface FacturarGenericoItem {
  monto: number;
  rubro: string;
}

export type EmisorKey = "CUBE" | "SE_PRESTA" | "AMJK" | "CREACION_IMAGEN" | "GRUPO_BATRO" | "AUTOCASH";

export interface FacturarGenericoRequest {
  nit: string;
  items: FacturarGenericoItem[];
  created_by: number;
  emisor: EmisorKey;
}

export interface FacturarGenericoResponse {
  success: boolean;
  data?: {
    factura_id: number;
    serie: string;
    numero: string;
    uuid: string;
    monto_total: number;
    monto_iva: number;
    pdf_url: string;
    receptor: {
      idReceptor: string;
      nombreReceptor: string;
    };
    items_facturados: number;
    emisor: {
      key: EmisorKey;
      nombre: string;
      nit: string;
    };
  };
  mensaje?: string;
  error?: string;
  stack?: string;
}

export const facturarGenerico = async (
  data: FacturarGenericoRequest
): Promise<FacturarGenericoResponse> => {
  const response = await api.post('/api/dte/facturar-generico', data);
  return response.data;
};

// ============================================
// 🔥 OBTENER FACTURAS GENÉRICAS - TYPES Y SERVICIO
// ============================================

export interface FacturaGenericaItem {
  factura_id: number;
  pago_id: number | null;
  serie: string;
  numero: string;
  uuid: string;
  tipo_documento: string;
  monto_total: string;
  monto_iva: string;
  pdf_url: string;
  receptor_nit: string;
  receptor_nombre: string;
  fecha_emision: string;
  fecha_certificacion: string;
  status: string;
  created_by: number | null;
  created_at: string;
  es_generica: boolean;
  link_pdf: string;
}

export type TipoFacturaGenerica = 'pago' | 'credito_nuevo';

export interface GetFacturasGenericasParams {
  created_by?: number;
  nit?: string;
  fecha_inicio?: string;
  fecha_fin?: string;
  tipo?: TipoFacturaGenerica;
  excel?: string;
  page?: number;
  limit?: number;
}

export interface GetFacturasGenericasExcelResponse {
  success: boolean;
  mensaje?: string;
  url?: string;
  total_facturas?: number;
  monto_total?: string;
  error?: string;
}

export interface FacturasGenericasPagination {
  total_items: number;
  total_pages: number;
  current_page: number;
  per_page: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface GetFacturasGenericasResponse {
  success: boolean;
  data?: {
    pagination: FacturasGenericasPagination;
    monto_total_pagina: string;
    filtros: {
      created_by: string | null;
      nit: string | null;
    };
    facturas: FacturaGenericaItem[];
  };
  mensaje?: string;
  error?: string;
}

export const getFacturasGenericas = async (
  params: GetFacturasGenericasParams
): Promise<GetFacturasGenericasResponse> => {
  const queryParams: Record<string, string> = {};

  if (params.created_by) {
    queryParams.created_by = params.created_by.toString();
  }
  if (params.nit) {
    queryParams.nit = params.nit;
  }
  if (params.fecha_inicio) {
    queryParams.fecha_inicio = params.fecha_inicio;
  }
  if (params.fecha_fin) {
    queryParams.fecha_fin = params.fecha_fin;
  }
  if (params.tipo) {
    queryParams.tipo = params.tipo;
  }
  if (params.excel) {
    queryParams.excel = params.excel;
  }
  if (params.page) {
    queryParams.page = params.page.toString();
  }
  if (params.limit) {
    queryParams.limit = params.limit.toString();
  }

  const response = await api.get('/api/dte/facturas-genericas', { params: queryParams });
  return response.data;
};

export const exportFacturasGenericasExcel = async (
  params: Omit<GetFacturasGenericasParams, 'excel' | 'page' | 'limit'>
): Promise<GetFacturasGenericasExcelResponse> => {
  const queryParams: Record<string, string> = { excel: 'true' };

  if (params.created_by) {
    queryParams.created_by = params.created_by.toString();
  }
  if (params.nit) {
    queryParams.nit = params.nit;
  }
  if (params.fecha_inicio) {
    queryParams.fecha_inicio = params.fecha_inicio;
  }
  if (params.fecha_fin) {
    queryParams.fecha_fin = params.fecha_fin;
  }
  if (params.tipo) {
    queryParams.tipo = params.tipo;
  }

  const response = await api.get('/api/dte/facturas-genericas', { params: queryParams });
  return response.data;
};

// ============================================
// 🔄 TOGGLE CANCELACION ACTIVO
// ============================================

export interface ToggleCancelacionActivoPayload {
  creditId: number;
  activo: boolean;
}

export interface ToggleCancelacionActivoResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export const toggleCancelacionActivoService = async (
  payload: ToggleCancelacionActivoPayload
): Promise<ToggleCancelacionActivoResponse> => {
  const { data } = await api.post<ToggleCancelacionActivoResponse>(
    '/cancelacion/toggle-activo',
    payload
  );
  return data;
};

// Recalcular cuota
export interface RecalculateQuotaPayload {
  numero_credito_sifco: string;
}

export async function recalculateQuotaService(payload: RecalculateQuotaPayload) {
  const { data } = await api.post(`${API_URL}/recalculate-quota`, payload);
  return data;
}

// Actualizar saldo de reinversión de un inversionista
export interface UpdateSaldoReinversionPayload {
  inversionista_id: number;
  saldo_reinversion: number;
}

export async function updateSaldoReinversionService(payload: UpdateSaldoReinversionPayload) {
  const { data } = await api.post(`${API_URL}/investor/saldo-reinversion`, payload);
  return data;
}

// ============================================
// Efectividad de Asesores
// ============================================

export interface EfectividadTotales {
  total_cuotas: number;
  cuotas_pagadas: number;
  cuotas_pendientes: number;
  monto_esperado: string;
  monto_cobrado: string;
  monto_pendiente: string;
  efectividad: string;
}

export interface EfectividadCredito {
  asesor_id: number;
  asesor_nombre: string;
  credito_id: number;
  numero_credito_sifco: string;
  usuario_nombre: string;
  statusCredit: string;
  total_cuotas: string;
  cuotas_pagadas: string;
  cuotas_pendientes: string;
  monto_esperado: string;
  monto_cobrado: string;
  monto_pendiente: string;
  efectividad: string;
}

export interface EfectividadAsesor {
  asesor_id: number;
  asesor_nombre: string;
  totales: EfectividadTotales;
  creditos: EfectividadCredito[];
}

export interface EfectividadAsesoresResponse {
  ok: boolean;
  mes: number;
  anio: number;
  asesor_id: number | null;
  total_asesores: number;
  data: EfectividadAsesor[];
}

export const getEfectividadAsesores = async (params: {
  dia?: number;
  mes: number;
  anio: number;
  asesor_id?: number;
}): Promise<EfectividadAsesoresResponse> => {
  const query = new URLSearchParams({
    mes: params.mes.toString(),
    anio: params.anio.toString(),
  });
  if (params.dia) query.set("dia", params.dia.toString());
  if (params.asesor_id) query.set("asesor_id", params.asesor_id.toString());

  const { data } = await api.get<EfectividadAsesoresResponse>(
    `/efectividad-asesores/consulta?${query}`
  );
  return data;
};

// ============================================
// Abonos por cuota
// ============================================
export interface AbonosCuotaResponse {
  success: boolean;
  numero_credito_sifco: string;
  numero_cuota: number;
  total_pagos: number;
  abono_capital: string;
  abono_iva_12: string;
  abono_interes: string;
  membresias_pago: string;
  abono_seguro: string;
  abono_gps: string;
}

export async function getAbonosCuotaService(
  numero_credito_sifco: string,
  numero_cuota: number
): Promise<AbonosCuotaResponse> {
  const { data } = await api.get<AbonosCuotaResponse>(
    `/abonos-cuota/${numero_credito_sifco}/${numero_cuota}`
  );
  return data;
}

// Marcar cuotas pagadas hasta un número de cuota
export interface MarcarCuotasBody {
  numero_credito_sifco: string;
  hasta_cuota: number;
}

export async function marcarCuotasService(body: MarcarCuotasBody) {
  const { data } = await api.post("/marcar-cuotas", body);
  return data;
}

// Cambiar fecha de inicio (cuota 1)
export interface CambiarFechaInicioBody {
  numero_credito_sifco: string;
  nueva_fecha_inicio: string;
  changed_by: string;
  razon: string;
}

export async function cambiarFechaInicioService(body: CambiarFechaInicioBody) {
  const { data } = await api.post("/cambiar-fecha-inicio", body);
  return data;
}

// Historial de cambios de fecha de inicio
export interface HistorialCambioFecha {
  id: number;
  fecha_inicio_anterior: string;
  fecha_inicio_nueva: string;
  changed_by: string;
  razon: string;
  created_at: string;
}

export async function getHistorialCambioFecha(numeroCreditoSifco: string): Promise<HistorialCambioFecha[]> {
  const { data } = await api.get(`/historial-cambio-fecha/${numeroCreditoSifco}`);
  return data.historial ?? [];
}

// ─── Investor Documents ──────────────────────────────────────────────────────

export async function getInvestorDocuments(inversionistaId: number) {
  const { data } = await api.get(`/investor-documents/admin/${inversionistaId}`);
  return data;
}

export async function uploadInvestorDocument(params: {
  file: File;
  inversionista_id: number;
  nombre: string;
  descripcion?: string;
  visible?: boolean;
  created_by?: string;
}) {
  const formData = new FormData();
  formData.append("file", params.file);
  formData.append("inversionista_id", String(params.inversionista_id));
  formData.append("nombre", params.nombre);
  if (params.descripcion) formData.append("descripcion", params.descripcion);
  if (params.visible !== undefined) formData.append("visible", String(params.visible));
  if (params.created_by) formData.append("created_by", params.created_by);

  const { data } = await api.post("/investor-documents", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function toggleDocumentVisibility(documentoId: number, visible: boolean) {
  const { data } = await api.put(`/investor-documents/${documentoId}/visibility`, { visible });
  return data;
}

export async function deleteInvestorDocument(documentoId: number) {
  const { data } = await api.patch(`/investor-documents/${documentoId}/delete`);
  return data;
}

// ============================================================
// asignarReinversion — POST /asignar-reinversion
// ============================================================
export type TipoReinversionEspejo =
  | "sin_reinversion"
  | "reinversion_capital"
  | "reinversion_interes"
  | "reinversion_total"
  | "reinversion_variable"
  | "reinversion_combinada";

export interface AsignarReinversionPayload {
  inversionista_id: number;
  asignaciones: {
    id_credito_inversionista_espejo: number;
    tipo_reinversion: TipoReinversionEspejo;
  }[];
}

export interface AsignarReinversionResponse {
  success: boolean;
  message: string;
  actualizados: number;
}

export async function asignarReinversionService(
  payload: AsignarReinversionPayload
): Promise<AsignarReinversionResponse> {
  const res = await api.post<AsignarReinversionResponse>(
    `${import.meta.env.VITE_BACK_URL}/asignar-reinversion`,
    payload
  );
  return res.data;
}