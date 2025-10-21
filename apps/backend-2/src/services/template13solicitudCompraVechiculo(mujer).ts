import axios from "axios";

export interface VehiclePurchaseThirdPartyWomanTemplate13Params {
  año: number;
  mes: string;
  dia: number;
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
  // 🚫 Firma se deja en DocuSeal
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

export async function generateVehiclePurchaseThirdPartyWomanTemplate13Submission(
  params: VehiclePurchaseThirdPartyWomanTemplate13Params,
  email: string
) {
  try {
    const payload = {
      template_id: 13, // 📌 Template 13: Solicitud de Compra Vehículo por Instrucción de 3ro (mujer)
      submitters: [
        {
          email,
          values: {
            Año: params.año,
            Mes: params.mes,
            Día: params.dia,
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
            // 🚫 Firma gestionada directo en DocuSeal
          },
        },
      ],
    };

    const response = await api.post("/submissions", payload);
    console.log("✅ Submission Solicitud Compra Vehículo Mujer creado:", response.data);
    return response.data;
  } catch (error: any) {
    console.error(
      "❌ Error al crear submission Solicitud Compra Vehículo Mujer:",
      error.response?.data || error.message
    );
    throw error;
  }
}
