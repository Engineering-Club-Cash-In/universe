import axios from "axios";

const API_URL = import.meta.env.VITE_BACK_URL || "https://qk4sw4kc4c088c8csos400wc.s3.devteamatcci.site";

const api = axios.create({ baseURL: API_URL });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("accessToken");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ===================== TIPOS =====================

export interface ReciboGenericoMonto {
  id: number;
  recibo_id: number;
  concepto: string;
  monto: string;
}

export interface ReciboGenerico {
  id: number;
  nombre: string;
  observaciones: string | null;
  fecha: string;
  created_at: string;
  montos: ReciboGenericoMonto[];
}

export interface CreateReciboGenericoPayload {
  nombre: string;
  observaciones?: string;
  montos: { concepto: string; monto: string }[];
}

export interface UpdateReciboGenericoPayload {
  nombre?: string;
  observaciones?: string;
  montos?: { concepto: string; monto: string }[];
}

// ===================== SERVICIOS =====================

export async function createReciboGenericoService(
  payload: CreateReciboGenericoPayload
): Promise<ReciboGenerico> {
  const res = await api.post("/recibos-genericos", payload);
  return res.data;
}

export async function getRecibosGenericosService(params?: {
  fecha_desde?: string;
  fecha_hasta?: string;
}): Promise<ReciboGenerico[]> {
  const res = await api.get("/recibos-genericos", { params });
  return res.data;
}

export async function getReciboGenericoByIdService(
  id: number
): Promise<ReciboGenerico> {
  const res = await api.get(`/recibos-genericos/${id}`);
  return res.data;
}

export async function updateReciboGenericoService(
  id: number,
  payload: UpdateReciboGenericoPayload
): Promise<ReciboGenerico> {
  const res = await api.put(`/recibos-genericos/${id}`, payload);
  return res.data;
}

export async function deleteReciboGenericoService(
  id: number
): Promise<{ message: string; recibo: Omit<ReciboGenerico, "montos"> }> {
  const res = await api.delete(`/recibos-genericos/${id}`);
  return res.data;
}

export async function getReciboGenericoPdfService(
  id: number
): Promise<{ pdfUrl: string }> {
  const res = await api.get(`/recibos-genericos/${id}/pdf`);
  return res.data;
}
