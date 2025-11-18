import axios from "axios";

export interface DescargoResponsabilidadesParams {
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
  nombreDeudor: string;
  dpiDeudorTexto: string; // con letras minúsculas (ejemplo: juan perez (1234567890123))
  dia: string;
  mes: string;
  año: string;
  nombreDeudorFirma: string;
  dpiDeudor: string; // solo 13 dígitos
  firma: string; // puede ir vacío, DocuSeal mostrará firma
}

const DOCUSEAL_API_URL = process.env.DOCUSEAL_API_URL!;
const DOCUSEAL_API_TOKEN = process.env.DOCUSEAL_API_TOKEN!;

const api = axios.create({
  baseURL: DOCUSEAL_API_URL,
  headers: {
    "X-Auth-Token": DOCUSEAL_API_TOKEN,
    "Content-Type": "application/json"
  }
});

export async function generateDescargoResponsabilidadesSubmission(
  params: DescargoResponsabilidadesParams,
  email: string
) {
  try {
    const payload = {
      template_id: 7, // ID del template DESCARGO RESPONSABILIDADES HOMBRE
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
            "Nombre Deudor": params.nombreDeudor,
            "DPI Deudor Texto": params.dpiDeudorTexto,
            dia: params.dia,  
            mes: params.mes,
            año: params.año,
            "Nombre Deudor Firma": params.nombreDeudorFirma,
            "Dpi Deudor": params.dpiDeudor,
            firma: params.firma
          }
        }
      ]
    };

    const response = await api.post("/submissions", payload);
    console.log("✅ Submission DESCARGO creado:", response.data);
    return response.data;
  } catch (error: any) {
    console.error("❌ Error al crear submission DESCARGO:", error.response?.data || error.message);
    throw error;
  }
}
