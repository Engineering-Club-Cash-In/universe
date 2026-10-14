import api from "@/Provider/interceptor";
import type { ParamsPreviewBoletaTardia, VistaPreviaBoletaTardia } from "../components/boletaTardia";

const API_URL = import.meta.env.VITE_BACK_URL || "";

// Con timeout: Confirmar espera esta respuesta, y `api` no trae timeout propio.
export async function previewBoletaTardia(p: ParamsPreviewBoletaTardia): Promise<VistaPreviaBoletaTardia> {
  const res = await api.post<{ success: true; data: VistaPreviaBoletaTardia }>(`${API_URL}/pagos/boleta-tardia/preview`, p, { timeout: 10_000 });
  return res.data.data;
}
