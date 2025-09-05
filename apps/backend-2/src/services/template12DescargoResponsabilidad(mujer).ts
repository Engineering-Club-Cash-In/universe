import axios from "axios";

export interface DescargoMujerParams {
  vehiculoTipo: string;
  vehiculoMarca: string;
  vehiculoColor: string;
  vehiculoUso: string;
  vehiculoChasis: string;
  vehiculoCombustible: string;
  vehiculoMotor: string;
  vehiculoSerie: string;
  vehiculoLinea: string;
  vehiculoModelo: string;
  vehiculoCm3: string;
  vehiculoAsientos: string;
  vehiculoCilindros: string;
  vehiculoIscv: string;
  nombreDeudora: string;
  dpiDeudora: string;
  dia: string;
  mes: string;
  año: string; 
  nombreDeudoraConfirm: string;
  dpiDeudor: string;
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

export async function generateDescargoMujerSubmission(
  params: DescargoMujerParams,
  email: string
) {
  try {
    const payload = {
      template_id: 12, // 📌 ID del template DESCARGO DE RESPONSABILIDADES (mujer)
      submitters: [
        {
          email,
          values: {
            "Vehículo Tipo": params.vehiculoTipo,
            "Vehículo Marca": params.vehiculoMarca,
            "Vehículo Color": params.vehiculoColor,
            "Vehículo Uso": params.vehiculoUso,
            "Vehículo Chasis": params.vehiculoChasis,
            "Vehículo Combustible": params.vehiculoCombustible,
            "Vehículo Motor": params.vehiculoMotor,
            "Vehículo Serie": params.vehiculoSerie,
            "Vehículo Linea": params.vehiculoLinea,
            "Vehículo Modelo": params.vehiculoModelo,
            "Vehículo CM3": params.vehiculoCm3,
            "Vehículo Asientos": params.vehiculoAsientos,
            "Vehículo Cilindros": params.vehiculoCilindros,
            "Vehículo ISCV": params.vehiculoIscv,
            "Nombre Deudora": params.nombreDeudora,
            "DPI Deudora": params.dpiDeudora,
            dia: params.dia,
            mes: params.mes,
            año: params.año, 
            "Nombre Deudora ": params.nombreDeudoraConfirm, // campo duplicado del template
            "Dpi Deudor": params.dpiDeudor,
          },
        },
      ],
    };

    const response = await api.post("/submissions", payload);
    console.log("✅ Submission DESCARGO DE RESPONSABILIDADES (mujer) creado:", response.data);
    return response.data;
  } catch (error: any) {
    console.error(
      "❌ Error al crear submission DESCARGO DE RESPONSABILIDADES (mujer):",
      error.response?.data || error.message
    );
    throw error;
  }
}
