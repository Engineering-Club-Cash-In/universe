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

/**
 * 🧾 Genera el submission para el template 21:
 * "PAGARÉ ÚNICO LIBRE DE PROTESTO (MUJERES)"
 *
 * 📌 Los params se mantienen limpios (sin duplicados),
 * pero en `values` se reutilizan varias veces con los mismos nombres base.
 */
export async function generatePromissoryNoteWomanTemplate21Submission(
  params: PromissoryNoteWomanTemplate21Params,
  email: string
) {
  try {
    const payload = {
      template_id: 21, // 📄 Template 21: PAGARÉ ÚNICO LIBRE DE PROTESTO (mujeres)
      submitters: [
        {
          email,
          values: {
            // 💰 Datos principales
            Cantidad: params.cantidad,

            // 📅 Fechas (reutilizadas con los mismos nombres)
            dia: params.dia,
            mes: params.mes,
            año: params.año, 

            // 👤 Datos personales
            "Estado Civil": params.estadoCivil,
            "NOMBRE COMPLETO": params.nombreCompleto,
            edad: params.edad,
            dpi: params.dpi,
            dirección: params.direccion,

            // 💵 Monto en letras
            "Cantidad en Letras": params.cantidadEnLetras,

            // 🗓️ Letras (reutilizadas igual)
            "dia letras": params.diaLetras,
            "mes letras": params.mesLetras,
            "año letras": params.añoLetras, 

            // 🚫 La firma se realiza directamente en DocuSeal
          },
        },
      ],
    };

    const response = await api.post("/submissions", payload);
    console.log(
      "✅ Submission PAGARÉ ÚNICO LIBRE DE PROTESTO (mujeres) creado:",
      response.data
    );
    return response.data;
  } catch (error: any) {
    console.error(
      "❌ Error al crear submission PAGARÉ ÚNICO LIBRE DE PROTESTO (mujeres):",
      error.response?.data || error.message
    );
    throw error;
  }
}
