import api from "@/Provider/interceptor";

const API_URL = import.meta.env.VITE_BACK_URL || "";

export interface MoraHistorialRow {
  credito_id: number;
  numero_credito_sifco: string;
  cliente: string;
  asesor: string;
  status: string;
  cuotas_atrasadas: number;
  etapa: string;
  mora: string;
  capital: string;
  actualizado: string;
}

export interface MoraTotales {
  mora_total: string;
  mora_30: string;
  mora_60: string;
  mora_90: string;
  mora_120: string;
  creditos: number;
}

export interface MoraEvento {
  historial_id: number;
  fecha: string;
  tipo_evento: string;
  origen: string;
  monto_anterior: string;
  monto_nuevo: string;
  cuotas_atrasadas_anterior: number;
  cuotas_atrasadas_nuevas: number;
  motivo: string | null;
  usuario: string | null;
}

export interface MoraSnapshotResponse {
  success: boolean;
  fecha: string;
  data: MoraHistorialRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  totales: MoraTotales;
}

export interface SnapshotParams {
  fecha: string;
  asesor?: string;
  etapa?: string;
  numero_credito_sifco?: string;
  nombre_usuario?: string;
  page?: number;
  pageSize?: number;
}

export const getMoraHistorialSnapshot = async (params: SnapshotParams): Promise<MoraSnapshotResponse> => {
  const { data } = await api.get(`${API_URL}/moras/historial`, { params });
  return data;
};

export const getMoraTimeline = async (
  desde: string,
  hasta: string,
  asesor?: string
): Promise<{ success: boolean; data: { fecha: string; mora_total: string }[] }> => {
  const { data } = await api.get(`${API_URL}/moras/historial/timeline`, { params: { desde, hasta, asesor } });
  return data;
};

export const getMoraHistorialCredito = async (
  credito_id: number
): Promise<{ success: boolean; data: MoraEvento[] }> => {
  const { data } = await api.get(`${API_URL}/moras/historial/credito/${credito_id}`);
  return data;
};

export const descargarMoraExcel = async (params: Omit<SnapshotParams, "page" | "pageSize">): Promise<Blob> => {
  const res = await api.get(`${API_URL}/moras/historial/excel`, { params, responseType: "blob" });
  return res.data as Blob;
};
