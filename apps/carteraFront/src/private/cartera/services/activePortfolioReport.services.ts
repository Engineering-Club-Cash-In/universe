import api from "@/Provider/interceptor";

const API_URL = import.meta.env.VITE_BACK_URL || "";

export const descargarReporteCarteraActiva = async (): Promise<Blob> => {
  const res = await api.get(`${API_URL}/reportes/cartera-activa/excel`, {
    responseType: "blob",
  });
  return res.data as Blob;
};
