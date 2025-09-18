import axios from "axios";

export interface PromissoryNoteWomanTemplate21Params {
  cantidad: string;
  dia?: string;
  mes?: string;
  año?: string;
  estadoCivil: string;
  nombreCompleto: string;
  edad: string;
  dpi: string;
  direccion: string;
  cantidadEnLetras: string;
  diaLetras?: string;
  mesLetras?: string;
  añoLetras?: string;
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

export async function generatePromissoryNoteWomanTemplate21Submission(
  params: PromissoryNoteWomanTemplate21Params,
  email: string
) {
  try {
    const payload = {
      template_id: 21, // 📌 Template 21: PAGARÉ ÚNICO LIBRE DE PROTESTO (mujeres)
      submitters: [
        {
          email,
          values: {
            Cantidad: params.cantidad,
            dia: params.dia,
            mes: params.mes,
            año: params.año,
            "Estado Civil": params.estadoCivil,
            "NOMBRE COMPLETO": params.nombreCompleto,
            edad: params.edad,
            dpi: params.dpi,
            dirección: params.direccion,
            "Cantidad en Letras": params.cantidadEnLetras,
            día: params.diaLetras,
            mesLetras: params.mesLetras,
            añoLetras: params.añoLetras,
            // 🚫 Firma se hace directo en DocuSeal
          },
        },
      ],
    };

    const response = await api.post("/submissions", payload);
    console.log("✅ Submission PAGARÉ ÚNICO LIBRE DE PROTESTO (mujeres) creado:", response.data);
    return response.data;
  } catch (error: any) {
    console.error(
      "❌ Error al crear submission PAGARÉ ÚNICO LIBRE DE PROTESTO (mujeres):",
      error.response?.data || error.message
    );
    throw error;
  }
}
