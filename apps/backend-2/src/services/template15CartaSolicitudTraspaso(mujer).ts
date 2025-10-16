import axios from "axios";

/**
 * Interfaz con los campos del template 15 (CARTA SOLICITUD TRASPASO DE VEHÍCULO A RDBE. S.A. - Mujer)
 */
export interface VehicleTransferLetterWomanTemplate15Params {
  fecha: string;
  nombrePersona: string;
  dpiPersona: string;
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
  nombreFirmaPersona: string;
  dpiFirmaPersona: string;
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
 * 🧩 Corrige los espacios invisibles (non-breaking spaces) en los nombres de campo del template.
 */
function normalizeKeys(values: Record<string, string>) {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const correctedKey = key
      .replace("Marca Vehículo", "Marca\u00A0Vehículo")
      .replace("Color Vehículo", "Color\u00A0Vehículo")
      .replace("Uso Vehículo", "Uso\u00A0Vehículo")
      // ✅ Campo "Modelo  Vehículo" con non-breaking + espacio normal
      .replace("Modelo Vehículo", "Modelo\u00A0 Vehículo");
    normalized[correctedKey] = value;
  }
  return normalized;
}

/**
 * 🚗 Servicio para crear un submission de la plantilla ID 15 (Carta Traspaso Vehículo Mujer)
 */
export async function generateVehicleTransferLetterWomanTemplate15Submission(
  params: VehicleTransferLetterWomanTemplate15Params,
  email: string
) {
  try {
    console.log("📄 Generando submission para template 15 con params:", params);

    const values = normalizeKeys({
      Fecha: params.fecha,
      "Nombre Persona": params.nombrePersona,
      "Dpi Persona": params.dpiPersona,
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
      "Nombre Firma persona": params.nombreFirmaPersona,
      "Dpi Firma Persona": params.dpiFirmaPersona,
    });

    console.log("🔧 Valores normalizados:", values);

    const payload = {
      template_id: 15,
      submitters: [{ email, values }],
    };

    const response = await api.post("/submissions", payload);
    console.log("✅ Submission creado correctamente:", response.data);
    return response.data;
  } catch (error: any) {
    console.error(
      "❌ Error al crear submission Carta Traspaso Vehículo Mujer:",
      error.response?.data || error.message
    );
    throw error;
  }
}
