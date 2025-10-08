import axios from "axios";

export interface PromissoryNoteManTemplate20Params {
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
 * 🧾 Genera el submission para el template 20:
 * "PAGARÉ ÚNICO LIBRE DE PROTESTO (HOMBRES)"
 *
 * 📌 Los params están limpios (sin duplicados),
 * pero en `values` se reutilizan varias veces
 * con los mismos nombres base (“dia”, “mes”, “año”, etc.).
 */
export async function generatePromissoryNoteManTemplate20Submission(
  params: PromissoryNoteManTemplate20Params,
  email: string
) {
  try {
    const payload = {
      template_id: 20, // 📄 Template 20: PAGARÉ ÚNICO LIBRE DE PROTESTO (hombres)
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

            // 🗓️ Letras de fechas (reutilizadas igual)
            "dia letras": params.diaLetras,
            "mes letras": params.mesLetras,
            "año letras": params.añoLetras,
 

            // 🚫 La firma se realiza en DocuSeal
          },
        },
      ],
    };

    const response = await api.post("/submissions", payload);
    console.log(
      "✅ Submission PAGARÉ ÚNICO LIBRE DE PROTESTO (hombres) creado:",
      response.data
    );
    return response.data;
  } catch (error: any) {
    console.error(
      "❌ Error al crear submission PAGARÉ ÚNICO LIBRE DE PROTESTO (hombres):",
      error.response?.data || error.message
    );
    throw error;
  }
}
