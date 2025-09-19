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
import axios from "axios";

const DOCUSEAL_API_URL = process.env.DOCUSEAL_API_URL!;
const DOCUSEAL_API_TOKEN = process.env.DOCUSEAL_API_TOKEN!;

const api = axios.create({
  baseURL: DOCUSEAL_API_URL,
  headers: {
    "X-Auth-Token": DOCUSEAL_API_TOKEN,
    "Content-Type": "application/json"
  }
});

export async function generateVehicleTransferLetterWomanTemplate15Submission(
  params: VehicleTransferLetterWomanTemplate15Params,
  email: string
) {
  try {
    const payload = {
      template_id: 15, // 📌 Template 15 - Carta Traspaso Vehículo a RDBE S.A. (mujer)
      submitters: [
        {
          email,
          values: {
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
            "Modelo  Vehículo": params.modeloVehiculo,
            "cm3 Vehículo": params.cm3Vehiculo,
            "Asientos Vehículo": params.asientosVehiculo,
            "Cilindros Vehículo": params.cilindrosVehiculo,
            "ISCV Vehículo": params.iscvVehiculo,
            "Nombre de la persona": params.nombreFirmaPersona,
            Dpi: params.dpiFirmaPersona
          }
        }
      ]
    };

    const response = await api.post("/submissions", payload);
    console.log("✅ Submission Carta Traspaso Vehículo Mujer creado:", response.data);
    return response.data;
  } catch (error: any) {
    console.error(
      "❌ Error al crear submission Carta Traspaso Vehículo Mujer:",
      error.response?.data || error.message
    );
    throw error;
  }
}
