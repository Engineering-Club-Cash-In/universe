export interface CartaAceptacionGpsMujerParams {
  fecha: string;
  nombreDeudora: string;
  tipo: string;
  marca: string;
  color: string;
  uso: string;
  chasis: string;
  combustible: string;
  motor: string;
  serie: string;
  linea: string;
  modelo: string;
  cm3: string;
  asientos: string;
  cilindros: string;
  iscv: string;
  dpiDeudora: string;
}
import axios from "axios";

const DOCUSEAL_API_URL = process.env.DOCUSEAL_API_URL!;
const DOCUSEAL_API_TOKEN = process.env.DOCUSEAL_API_TOKEN!;

const api = axios.create({
  baseURL: DOCUSEAL_API_URL,
  headers: {
    "X-Auth-Token": DOCUSEAL_API_TOKEN,
    "Content-Type": "application/json"
  }
});

export async function generateCartaAceptacionGpsMujerSubmission(
  params: CartaAceptacionGpsMujerParams,
  email: string
) {
  try {
    const payload = {
      template_id: 14, // 📌 Template 14 - Carta Aceptación GPS Modificada (mujer)
      submitters: [
        {
          email,
          values: {
            Fecha: params.fecha,
            "Nombre DEUDORA": params.nombreDeudora,
            Tipo: params.tipo,
            Marca: params.marca,
            Color: params.color,
            Uso: params.uso,
            Chasis: params.chasis,
            Combustible: params.combustible,
            Motor: params.motor,
            Serie: params.serie,
            Linea: params.linea,
            Modelo: params.modelo,
            cm3: params.cm3,
            Asientos: params.asientos,
            Cilindros: params.cilindros,
            ISCV: params.iscv,
            "Dpi Deudora": params.dpiDeudora
          }
        }
      ]
    };

    const response = await api.post("/submissions", payload);
    console.log("✅ Submission Carta Aceptación GPS Mujer creado:", response.data);
    return response.data;
  } catch (error: any) {
    console.error(
      "❌ Error al crear submission Carta Aceptación GPS Mujer:",
      error.response?.data || error.message
    );
    throw error;
  }
}
