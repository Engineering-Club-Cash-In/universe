import api from "@/Provider/interceptor";

const API_URL = import.meta.env.VITE_BACK_URL || "";

// ─── COBROS-02 · Buckets (módulos temporales de auditoría del motor) ─────────

export interface BucketCatalogo {
  numero: number;
  prefijo: string;
  nombre: string;
  descripcion: string | null;
  cuotas_min: number | null;
  cuotas_max: number | null;
  color: string | null;
}

// Catálogo dinámico B0-B5 (fuente única: cartera-back). Los badges usan el
// color REAL del catálogo, no un mapeo hardcodeado en el front.
export const getBucketsCatalogo = async (): Promise<{
  success: boolean;
  data: BucketCatalogo[];
}> => {
  const { data } = await api.get(`${API_URL}/config/buckets`);
  return data;
};

export interface BucketEventoRow {
  historial_id: number;
  fecha: string;
  credito_id: number;
  numero_credito_sifco: string;
  cliente: string;
  asesor_id: number | null;
  asesor: string | null;
  tipo_evento: "INICIAL" | "SUBIDA" | "BAJADA";
  origen: string;
  bucket_anterior: number | null;
  bucket_anterior_prefijo: string | null;
  bucket_anterior_nombre: string | null;
  bucket_nuevo: number;
  bucket_nuevo_prefijo: string | null;
  bucket_nuevo_nombre: string | null;
  cuotas_atrasadas_nuevas: number | null;
  status_credito: string | null;
  status_actual: string;
  capital: string;
  asesor_atribucion_id: number | null;
  asesor_atribucion: string | null;
  pago_id: number | null;
  motivo: string | null;
}

export interface BucketsHistorialResponse {
  success: boolean;
  data: BucketEventoRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  resumen: { total: number; iniciales: number; subidas: number; bajadas: number };
}

export interface BucketsHistorialParams {
  desde?: string;
  hasta?: string;
  tipo_evento?: string; // CSV: INICIAL,SUBIDA,BAJADA
  origen?: string; // PROCESO_AUTO | API_MANUAL
  bucket_nuevo?: string; // CSV de enteros
  numero_credito_sifco?: string;
  nombre_usuario?: string;
  asesor?: string; // CSV de nombres
  page?: number;
  pageSize?: number;
}

export const getBucketsHistorial = async (
  params: BucketsHistorialParams
): Promise<BucketsHistorialResponse> => {
  const { data } = await api.get(`${API_URL}/buckets/historial`, { params });
  return data;
};

export interface AsesorCambioRow {
  historial_id: number;
  fecha: string;
  credito_id: number;
  numero_credito_sifco: string;
  cliente: string;
  asesor_anterior_id: number | null;
  asesor_anterior: string | null;
  asesor_nuevo_id: number | null;
  asesor_nuevo: string | null;
  bucket: number | null;
  bucket_prefijo: string | null;
  bucket_nombre: string | null;
  origen: string;
  motivo: string | null;
  usuario: string | null;
  status_actual: string;
}

export interface AsesorHistorialResponse {
  success: boolean;
  data: AsesorCambioRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  resumen: { total: number; automaticos: number; manuales: number; creditos: number };
}

export interface AsesorHistorialParams {
  desde?: string;
  hasta?: string;
  origen?: string; // PROCESO_AUTO | API_MANUAL
  bucket?: string; // CSV de enteros (snapshot)
  asesor_nuevo?: string; // CSV de nombres
  asesor_anterior?: string; // CSV de nombres
  numero_credito_sifco?: string;
  nombre_usuario?: string;
  page?: number;
  pageSize?: number;
}

export const getAsesorHistorial = async (
  params: AsesorHistorialParams
): Promise<AsesorHistorialResponse> => {
  const { data } = await api.get(`${API_URL}/buckets/asesores-historial`, { params });
  return data;
};
