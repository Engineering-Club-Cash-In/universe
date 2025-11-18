import axios from "axios";

export interface CartaCarroNuevoParams {
  fecha: string;
  nombreDeudor: string;
  dpiDeudor: string;
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
  empresa: string;
  nombreDeudorFirma: string;
  dpiFirmaPersona: string;
  firma: string; // "" para que el usuario firme en DocuSeal
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

export async function generateCartaCarroNuevoSubmission(
  params: CartaCarroNuevoParams,
  email: string
) {
  try {
    const payload = {
      template_id: 10, // 📌 Template "CARTA PARA CARRO NUEVO"
      submitters: [
        {
          email,
          values: {
            Fecha: params.fecha,
            "Nombre Deudor": params.nombreDeudor,
            "Dpi Deudor": params.dpiDeudor,
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
            "Vehículo cm3": params.vehiculoCm3,
            "Vehículo Asientos": params.vehiculoAsientos,
            "Vehículo Cilindros": params.vehiculoCilindros,
            "Vehículo ISCV": params.vehiculoIscv,
            Empresa: params.empresa,
            "Nombre Deudor Firma": params.nombreDeudorFirma,
            "DPI Firma Persona": params.dpiFirmaPersona,
            Firma: params.firma
          }
        }
      ]
    };

    const response = await api.post("/submissions", payload);
    console.log("✅ Submission CARTA PARA CARRO NUEVO creado:", response.data);
    return response.data;
  } catch (error: any) {
    console.error(
      "❌ Error al crear submission CARTA PARA CARRO NUEVO:",
      error.response?.data || error.message
    );
    throw error;
  }
}
