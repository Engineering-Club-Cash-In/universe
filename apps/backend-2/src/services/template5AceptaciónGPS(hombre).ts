import axios from "axios";

/**
 * Interfaz con los campos del template "3. Carta de Aceptacion INSTALACIÓN GPS MODIFICADA (hombre) 2025"
 */
export interface CartaGpsParams {
  fecha: string; // formato tipo "D MMMM YYYY"
  nombreDeudor: string;
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
  nombreFirmaPersona: string;
  dpiDeudor: string;
  // Firma no se manda directamente: DocuSeal genera el campo para que firme el usuario
  firma?: string;
  // Checkboxes opcionales
  opcion1?: boolean;
  opcion2?: boolean;
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
 * Servicio para crear un submission de la plantilla ID 5
 */
export async function generateCartaGpsSubmission(
  params: CartaGpsParams,
  email: string
) {
  try {
    const payload = {
      template_id: 5, // ID fijo de la plantilla
      submitters: [
        {
          email,
          values: {
            Fecha: params.fecha,
            "Nombre DEUDOR": params.nombreDeudor,
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
            "Nombre DEUDOR Firma": params.nombreFirmaPersona,
            "Dpi Deudor": params.dpiDeudor,
            // Firma no se pasa, DocuSeal la deja para el usuario
          },
        },
      ],
    };

    const response = await api.post("/submissions", payload);
    console.log("✅ Submission creado:", response.data);
    return response.data;
  } catch (error: any) {
    console.error(
      "❌ Error al crear submission:",
      error.response?.data || error.message
    );
    throw error;
  }
}
