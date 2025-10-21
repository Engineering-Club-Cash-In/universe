import axios from "axios";

export interface CheckIssuanceLetterManTemplate22Params {
  dia: string;
  mes: string;
  año: string;
  entidad: string;
  cantidad: string;
  cuenta: string;
  valor: string;
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

/**
 * 🧾 Genera el submission para el template 22:
 * "CARTA DE EMISIÓN DE CHEQUES (HOMBRES)"
 *
 * 📌 Los params se mantienen limpios, sin duplicados.
 * En `values` se reutilizan varias veces los mismos nombres base (“dia”, “mes”, “año”).
 */
export async function generateCheckIssuanceLetterManTemplate22Submission(
  params: CheckIssuanceLetterManTemplate22Params,
  email: string
) {
  try {
    const payload = {
      template_id: 22, // 📄 Template 22: CARTA DE EMISIÓN DE CHEQUES (hombres)
      submitters: [
        {
          email,
          values: {
            // 📅 Fechas (reutilizadas las veces necesarias)
            dia: params.dia,
            mes: params.mes,
            año: params.año, 

            // 🏦 Datos bancarios
            Entidad: params.entidad,
            Cantidad: params.cantidad,
            Cuenta: params.cuenta,
            valor: params.valor, 

            // 👤 Datos personales
            "Nombre Completo": params.nombreCompleto,
            Dpi: params.dpi,

            // 🚫 Firma se hace directo en DocuSeal
          },
        },
      ],
    };

    const response = await api.post("/submissions", payload);
    console.log(
      "✅ Submission CARTA DE EMISIÓN DE CHEQUES (hombres) creado:",
      response.data
    );
    return response.data;
  } catch (error: any) {
    console.error(
      "❌ Error al crear submission CARTA DE EMISIÓN DE CHEQUES (hombres):",
      error.response?.data || error.message
    );
    throw error;
  }
}
