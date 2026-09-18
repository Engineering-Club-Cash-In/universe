import api from "@/Provider/interceptor";

const API_URL = import.meta.env.VITE_BACK_URL || "";

export interface PagaloLinkResumen {
  id: string;
  linkType: "CAPITAL" | "MORA_INTERES";
  status: string;
  generation: number;
  pollAttempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  lastPollError: string | null;
  activatedAt: string | null;
  createdAt: string;
  paymentUrl: string | null;
  transactionAmount: string | null;
  motivoCierre: string | null;
}

export interface PagaloGrupo {
  id: string;
  status: string;
  origen: "ASESOR" | "BOT";
  casoCobroId: string | null;
  numeroCreditoSifco: string;
  carteraCreditoId: number;
  totalAmount: string;
  capitalTotal: string;
  facturableTotal: string;
  dispatchAttemptCount: number;
  nextDispatchAt: string | null;
  lastDispatchError: string | null;
  carteraImportId: number | null;
  createdAt: string;
  creadoPor: string | null;
  clienteNombre: string | null;
  asesoresNombres: string[];
  links: PagaloLinkResumen[];
}

export interface PagaloResumenKpis {
  grupos: number;
  capitalTotal: string;
  facturableTotal: string;
  totalAmount: string;
  linksTotal: number;
  linksPagados: number;
}

export interface PagaloSupervisionResponse {
  success: boolean;
  grupos: PagaloGrupo[];
  total: number;
  conteoPorEstado: Record<string, number>;
  resumenKpis: PagaloResumenKpis;
}

export interface PagaloSupervisionParams {
  estados?: string;
  problemasLink?: string;
  soloHuerfanos?: boolean;
  antiguedadMinDias?: number;
  numeroSifco?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  sortBy?: "totalAmount" | "createdAt" | "linksAmountCapital" | "linksAmountMora";
  sortDir?: "asc" | "desc";
  soloProblematicos?: boolean;
  limit?: number;
  offset?: number;
}

export interface DescargaExport {
  blob: Blob;
  truncado: boolean;
  total: number;
  cantidad: number;
}

export const getPagaloSupervision = async (
  params: PagaloSupervisionParams
): Promise<PagaloSupervisionResponse> => {
  const { data } = await api.get(`${API_URL}/pagalo/supervision`, { params });
  return data;
};

/**
 * El archivo lo arma el backend; acá solo se descarga. La señal de "el reporte
 * salió incompleto" no cabe en el blob, así que viaja por headers.
 */
const descargarExport = async (
  formato: "excel" | "pdf",
  params: Omit<PagaloSupervisionParams, "limit" | "offset">
): Promise<DescargaExport> => {
  const res = await api.get(`${API_URL}/pagalo/supervision/${formato}`, {
    params,
    responseType: "blob",
  });
  return {
    blob: res.data as Blob,
    truncado: res.headers["x-export-truncado"] === "true",
    total: Number(res.headers["x-export-total"] ?? 0),
    cantidad: Number(res.headers["x-export-cantidad"] ?? 0),
  };
};

export const descargarPagaloExcel = (
  params: Omit<PagaloSupervisionParams, "limit" | "offset">
) => descargarExport("excel", params);

export const descargarPagaloPDF = (
  params: Omit<PagaloSupervisionParams, "limit" | "offset">
) => descargarExport("pdf", params);
