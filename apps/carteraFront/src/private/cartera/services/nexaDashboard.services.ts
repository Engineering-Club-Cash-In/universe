import api from "@/Provider/interceptor";

const API_URL = import.meta.env.VITE_BACK_URL || "";

export interface NexaDashboardTotales {
  creditos: number;
  conToken: number;
  pagosNexa: number;
  montoNexa: string;
  rechazosNexa: number;
  ultimoPagoNexa: number;
}

export interface NexaDashboardCredito {
  creditoId: number;
  numeroCreditoSifco: string;
  cliente: string;
  estado: string;
  nexaToken: string | null;
  bindingActivo: boolean;
  ultimoPagoFecha: string | null;
  ultimoPagoMonto: string | null;
  ultimoPagoNexa: boolean;
  pagosNexa: number;
  montoNexa: string;
  rechazosNexa: number;
}

export interface NexaDashboardResponse {
  totales: NexaDashboardTotales;
  creditos: NexaDashboardCredito[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NexaDashboardParams {
  q: string;
  page: number;
  pageSize: number;
}

export const getNexaDashboard = async (
  params: NexaDashboardParams
): Promise<NexaDashboardResponse> => {
  const { data } = await api.get(`${API_URL}/nexa/dashboard`, { params });
  return data;
};

export interface NexaPagoCredito {
  fechaPago: string | null;
  montoBoleta: string;
  canal: "NEXA" | "MANUAL";
  registradoPor: string | null;
  autorizacion: string | null;
  validado: boolean;
  filas: number;
  eventoEstado: string | null;
}

export interface NexaEventoSinPago {
  referencia: string;
  monto: string;
  estado: string;
  error: string | null;
  creado: string | null;
}

export interface NexaPagosCreditoResponse {
  creditoId: number;
  pagos: NexaPagoCredito[];
  eventosSinPago: NexaEventoSinPago[];
}

export const getNexaPagosCredito = async (
  creditoId: number
): Promise<NexaPagosCreditoResponse> =>
  (await api.get(`${API_URL}/nexa/dashboard/${creditoId}/pagos`)).data;

// Las fechas de Nexa llegan sin zona horaria (hora de Guatemala): se formatean como texto, sin Date.
export const fmtFechaNexa = (v: string | null) => {
  if (!v) return "--";
  const [f, h] = v.split("T");
  const [y, m, d] = f.split("-");
  return `${d}/${m}/${y} ${h?.slice(0, 5) ?? "--:--"}`;
};
