import axios from "axios";

export interface CoberturaInrexsaParams {
 
  dia: string;
  mes: string;
  año: string;
  nombreDeudor: string; 
  firma: string; // puede ir vacío para que firme en DocuSeal
}

const DOCUSEAL_API_URL = process.env.DOCUSEAL_API_URL!;
const DOCUSEAL_API_TOKEN = process.env.DOCUSEAL_API_TOKEN!;

const api = axios.create({
  baseURL: DOCUSEAL_API_URL,
  headers: {
    "X-Auth-Token": DOCUSEAL_API_TOKEN,
    "Content-Type": "application/json"
  }
});

export async function generateCoberturaInrexsaSubmission(
  params: CoberturaInrexsaParams,
  email: string
) {
  try {
    const payload = {
      template_id: 8, // 📌 ID del template Cobertura INREXSA
      submitters: [
        {
          email,
          values: {
          
            dia: params.dia,
            mes: params.mes,
            año: params.año,
            "Nombre Deudor": params.nombreDeudor,
     
            firma: params.firma
          }
        }
      ]
    };

    const response = await api.post("/submissions", payload);
    console.log("✅ Submission COBERTURA INREXSA creado:", response.data);
    return response.data;
  } catch (error: any) {
    console.error("❌ Error al crear submission COBERTURA INREXSA:", error.response?.data || error.message);
    throw error;
  }
}
