import axios from "axios";

/**
 * Interfaz con los campos del template
 * "4. CARTA SOLICITUD TRASPASO DE VEHÍCULO A RDBE. S.A. _cube investments (hombre)"
 */
export interface SolicitudTraspasoVehiculoParams {
  fecha: string;
  nombrePersona: string;
  dpiPersona: string;
  empresa: string;
  tipoVehiculo: string;
  marcaVehiculo: string;
  colorVehiculo: string;
  usoVehiculo: string;
  chasisVehiculo: string;
  combustibleVehiculo: string;
  motorVehiculo: string;
  serieVehiculo: string;
  lineaVehiculo: string;
  modeloVehiculo: string;
  cm3Vehiculo: string;
  asientosVehiculo: string;
  cilindrosVehiculo: string;
  iscvVehiculo: string;
  nombreDeLaPersona: string;
  dpi: string;
  firma: string; // base64 o vacío para que el usuario firme en DocuSeal
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
 * 🧩 Normaliza claves para evitar problemas con espacios invisibles en los nombres de campo del template.
 * DocuSeal usa non-breaking spaces (U+00A0) en algunos campos, por lo que este fix garantiza que coincidan.
 */
function normalizeKeys(values: Record<string, string>) {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    // ⚙️ Corrige espacios invisibles (non-breaking spaces)
    const correctedKey = key
      .replace("Color Vehículo", "Color\u00A0Vehículo")
      .replace("Uso Vehículo", "Uso\u00A0Vehículo")
      .replace("Marca Vehículo", "Marca\u00A0Vehículo")
      // ✅ Campo "Modelo  Vehículo" (non-breaking + espacio normal) 
    normalized[correctedKey] = value;
  }
  return normalized;
}
/**
 * Servicio para crear un submission de la plantilla ID 6 (CARTA SOLICITUD TRASPASO DE VEHÍCULO)
 */
export async function generateSolicitudTraspasoVehiculoSubmission(
  params: SolicitudTraspasoVehiculoParams,
  email: string
) {
  try {
    console.log("📄 Generando submission para template 6 con params:", params);

    const values = normalizeKeys({
      Fecha: params.fecha,
      "Nombre Persona": params.nombrePersona,
      "Dpi Persona": params.dpiPersona,
      Empresa: params.empresa,
      "Tipo Vehículo": params.tipoVehiculo,
      "Marca Vehículo": params.marcaVehiculo,
      "Color Vehículo": params.colorVehiculo,
      "Uso Vehículo": params.usoVehiculo,
      "Chasis Vehículo": params.chasisVehiculo,
      "Combustible Vehículo": params.combustibleVehiculo,
      "Motor Vehículo": params.motorVehiculo,
      "Serie Vehículo": params.serieVehiculo,
      "Linea Vehículo": params.lineaVehiculo,
      "Modelo Vehículo": params.modeloVehiculo,
      "cm3 Vehículo": params.cm3Vehiculo,
      "Asientos Vehículo": params.asientosVehiculo,
      "Cilindros Vehículo": params.cilindrosVehiculo,
      "ISCV Vehículo": params.iscvVehiculo,
      "Nombre de la persona": params.nombreDeLaPersona,
      Dpi: params.dpi,
      Firma: params.firma,
    });
    console.log("🔧 Valores normalizados para envío:", values);

    const payload = {
      template_id: 6, // ID fijo de la plantilla en DocuSeal
      submitters: [
        {
          email,
          values,
        },
      ],
    };

    const response = await api.post("/submissions", payload);
    console.log("✅ Submission creado correctamente:", response.data);
    return response.data;
  } catch (error: any) {
    console.error(
      "❌ Error al crear submission:",
      error.response?.data || error.message
    );
    throw error;
  }
}
