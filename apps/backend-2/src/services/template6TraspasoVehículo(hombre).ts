import axios from "axios";

/**
 * Interfaz con los campos del template "4. CARTA SOLICITUD TRASPASO DE VEHÍCULO A RDBE. S.A. _cube investments (hombre)"
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
 * Servicio para crear un submission de la plantilla ID 6
 */
export async function generateSolicitudTraspasoVehiculoSubmission(
  params: SolicitudTraspasoVehiculoParams,
  email: string
) {
  try {
    const payload = {
      template_id: 6, // ID fijo de la plantilla
      submitters: [
        {
          email,
          values: {
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
            "Modelo  Vehículo": params.modeloVehiculo,
            "cm3 Vehículo": params.cm3Vehiculo,
            "Asientos Vehículo": params.asientosVehiculo,
            "Cilindros Vehículo": params.cilindrosVehiculo,
            "ISCV Vehículo": params.iscvVehiculo,
            "Nombre de la persona": params.nombreDeLaPersona,
            Dpi: params.dpi,
            Firma: params.firma,
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
