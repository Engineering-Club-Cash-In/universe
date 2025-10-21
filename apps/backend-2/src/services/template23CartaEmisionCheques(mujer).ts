import axios from "axios";

export interface CheckIssuanceLetterWomanTemplate23Params {
  dia: string;
  mes: string;
  año: string;
  dia2: string;
  mes2: string;
  año2: string;
  dia3: string;
  mes3: string;
  año3: string;
  entidad: string;
  cantidad: string;
  cuenta1: string;
  valor1: string;
  cuenta2: string;
  valor2: string;
  nombreCompleto: string;
  dpi: string;
}

const DOCUSEAL_API_URL = process.env.DOCUSEAL_API_URL!;
const DOCUSEAL_API_TOKEN = process.env.DOCUSEAL_API_TOKEN!;

const api = axios.create({
  baseURL: DOCUSEAL_API_URL,
  headers: {
    "X-Auth-Token": DOCUSEAL_API_TOKEN,
    "Content-Type": "application/json",
  },
});

export async function generateCheckIssuanceLetterWomanTemplate23Submission(
  params: CheckIssuanceLetterWomanTemplate23Params,
  email: string
) {
  try {
    const payload = {
      template_id: 23, // 📌 Template 23: CARTA DE EMISIÓN DE CHEQUES (mujeres)
      submitters: [
        {
          email,
          values: {
            día: params.dia,
            mes: params.mes,
            año: params.año,
            "día ": params.dia2,
            "mes ": params.mes2,
            "año ": params.año2,
            "día  ": params.dia3,
            "mes  ": params.mes3,
            "año  ": params.año3,
            Entidad: params.entidad,
            Cantidad: params.cantidad,
            Cuenta: params.cuenta1,
            valor: params.valor1,
            "Cuenta ": params.cuenta2,
            "valor ": params.valor2,
            "Nombre Completo": params.nombreCompleto,
            Dpi: params.dpi,

            // 🚫 Firma se hace directo en DocuSeal
          },
        },
      ],
    };

    const response = await api.post("/submissions", payload);
    console.log("✅ Submission CARTA DE EMISIÓN DE CHEQUES (mujeres) creado:", response.data);
    return response.data;
  } catch (error: any) {
    console.error(
      "❌ Error al crear submission CARTA DE EMISIÓN DE CHEQUES (mujeres):",
      error.response?.data || error.message
    );
    throw error;
  }
}
