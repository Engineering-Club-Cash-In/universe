import api from "@/Provider/interceptor";

const API_URL = import.meta.env.VITE_BACK_URL || "";

// ───────────── Types ─────────────

export interface ResumenAseguradora {
  id: number;
  nombre: string;
  cantidad_creditos: number;
  monto_seguro: string;
}

// ───────────── Resumen ─────────────

export const getResumenAseguradoras = async (): Promise<{
  data: ResumenAseguradora[];
}> => {
  const { data } = await api.get(`${API_URL}/aseguradoras/resumen`);
  return data;
};

export const descargarResumenExcel = async (): Promise<Blob> => {
  const res = await api.get(`${API_URL}/aseguradoras/resumen`, {
    params: { excel: true },
    responseType: "blob",
  });
  return res.data as Blob;
};

// ───────────── CRUD ─────────────

export const crearAseguradora = async (
  nombre: string
): Promise<{ id: number; nombre: string }> => {
  const { data } = await api.post(`${API_URL}/aseguradoras`, { nombre });
  return data;
};

export const cambiarAseguradoraCredito = async (
  credito_id: number,
  aseguradora_id: number
): Promise<{ success: true }> => {
  const { data } = await api.post(`${API_URL}/creditos/cambiar-aseguradora`, {
    credito_id,
    aseguradora_id,
  });
  return data;
};
