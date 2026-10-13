import api from "@/Provider/interceptor";
import type { ParamsPreviewBoletaTardia, VistaPreviaBoletaTardia } from "../components/boletaTardia";

const API_URL = import.meta.env.VITE_BACK_URL || "";

export async function previewBoletaTardia(p: ParamsPreviewBoletaTardia): Promise<VistaPreviaBoletaTardia> {
  const res = await api.post<{ success: true; data: VistaPreviaBoletaTardia }>(`${API_URL}/pagos/boleta-tardia/preview`, p);
  return res.data.data;
}
