import api from "@/Provider/interceptor";
import type { CuotaFranjaNexa, CuotaMesNexa, FiltroCuotaMes, RechazoNexa } from "@/lib/cuotasNexa";

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
  // Banco de la boleta manual; null en Nexa (cartera no recibe el banco de origen).
  ultimoPagoBanco: string | null;
  pagosNexa: number;
  montoNexa: string;
  rechazosNexa: number;
  // Los 5 más recientes de los que cuenta rechazosNexa.
  rechazosDetalle: RechazoNexa[];
  // Últimas 12 cuotas hasta fin del mes en curso, de la más vieja a la más nueva.
  ultimasCuotas: CuotaFranjaNexa[];
  // Primera cuota que vence este mes (hora de Guatemala); sin cuota este mes, la última vencida.
  cuotaMes: CuotaMesNexa | null;
}

export interface NexaDashboardResponse {
  totales: NexaDashboardTotales;
  creditos: NexaDashboardCredito[];
  total: number;
  page: number;
  pageSize: number;
}

// Rango de fecha de pago en formato YYYY-MM-DD; "" = sin límite.
export interface RangoFechas {
  desde: string;
  hasta: string;
}

export interface NexaDashboardParams extends RangoFechas {
  q: string;
  // Cuota del mes: pagados o pendientes (vencida o por vencer). "" = todos.
  cuotaMes: "" | FiltroCuotaMes;
  // Medio con que se pagó la cuota del mes; el back lo ignora si cuotaMes no es "pagados".
  medio: "" | "nexa" | "manual";
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
  cuotas: number[];
  banco: string | null;
}

export interface NexaEventoSinPago {
  referencia: string;
  monto: string;
  estado: string;
  error: string | null;
  creado: string | null;
  /** failed con filas de pago vivas: Nexa devolvió el dinero; esas filas se anulan, no se validan. */
  tieneFilasVivas: boolean;
}

export interface NexaPagosCreditoResponse {
  creditoId: number;
  pagos: NexaPagoCredito[];
  eventosSinPago: NexaEventoSinPago[];
}

export const getNexaPagosCredito = async (
  creditoId: number,
  rango: RangoFechas
): Promise<NexaPagosCreditoResponse> =>
  (await api.get(`${API_URL}/nexa/dashboard/${creditoId}/pagos`, { params: rango })).data;

// Las fechas de Nexa llegan sin zona horaria (hora de Guatemala): se formatean como texto, sin Date.
export const fmtFechaNexa = (v: string | null) => {
  if (!v) return "--";
  const [f, h] = v.split("T");
  const [y, m, d] = f.split("-");
  return `${d}/${m}/${y} ${h?.slice(0, 5) ?? "--:--"}`;
};

const fmtDia = (v: string) => v.split("-").reverse().join("/");
// " · pagos del 01/09/2026 al 30/09/2026" (o solo desde / hasta); "" si no hay rango.
export const describirRango = ({ desde, hasta }: RangoFechas) =>
  desde && hasta ? ` · pagos del ${fmtDia(desde)} al ${fmtDia(hasta)}`
  : desde ? ` · pagos desde el ${fmtDia(desde)}`
  : hasta ? ` · pagos hasta el ${fmtDia(hasta)}`
  : "";

// "Cuota 20", "Cuotas 18–20" (seguidas) o "Cuotas 16, 18"; "" si el pago no tocó cuotas.
export const cuotasTexto = (cuotas: number[]) => {
  if (cuotas.length === 0) return "";
  if (cuotas.length === 1) return `Cuota ${cuotas[0]}`;
  const seguidas = cuotas.every((c, i) => i === 0 || c === cuotas[i - 1] + 1);
  return `Cuotas ${seguidas ? `${cuotas[0]}–${cuotas[cuotas.length - 1]}` : cuotas.join(", ")}`;
};

// Pagos del crédito que entraron por Nexa y siguen vigentes (por boleta, no por fila).
export interface PagosNexaCredito {
  cantidad: number;
  montoTotal: string;
}

export const getPagosNexaCredito = async (creditoId: number): Promise<PagosNexaCredito> =>
  (await api.get(`${API_URL}/nexa/credito/${creditoId}/pagos-nexa`)).data;
