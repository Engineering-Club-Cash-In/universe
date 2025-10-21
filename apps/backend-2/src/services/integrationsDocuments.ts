import axios from "axios";

/**
 * Interfaz con los campos del template "2. SOLICITUD DE COMPRA DE VEHÍCULO POR INSTRUCCIÓN DE 3RO un deudor"
 */
export interface SolicitudVehiculoParams {
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
  empresa: string;
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
 * Servicio para crear un submission de la plantilla ID 4
 */
export async function generateSolicitudVehiculoSubmission(
  params: SolicitudVehiculoParams,
  email: string
) {
  try {
    const payload = {
      template_id: 4, // ID de la plantilla
      submitters: [
        {
          email,
          values: {
            "Fecha": params.fecha,
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
            Empresa: params.empresa,
            "Nombre Firma Persona": params.nombreFirmaPersona,
            "DPI Firma Persona": params.dpiFirmaPersona,
 
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
