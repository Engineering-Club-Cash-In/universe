import axios from "axios";

export interface DebtAcknowledgementWomanTemplate19Params {
  fecha: string;
  nombreDeudora: string;
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
  nombreDeudoraFirma: string;
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

export async function generateDebtAcknowledgementWomanTemplate19Submission(
  params: DebtAcknowledgementWomanTemplate19Params,
  email: string
) {
  try {
    const payload = {
      template_id: 19, // 📌 Template 19: CARTA PARA CARRO NUEVO 1D (mujer)
      submitters: [
        {
          email,
          values: {
            Fecha: params.fecha,
            "Nombre Deudora": params.nombreDeudora,
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
            "Nombre Deudora Firma": params.nombreDeudoraFirma ,
            "DPI Firma Persona": params.dpiFirmaPersona
            // 🚫 La firma la coloca el usuario en DocuSeal, no se manda aquí
          },
        },
      ],
    };

    const response = await api.post("/submissions", payload);
    console.log("✅ Submission CARTA PARA CARRO NUEVO 1D (mujer) creado:", response.data);
    return response.data;
  } catch (error: any) {
    console.error(
      "❌ Error al crear submission CARTA PARA CARRO NUEVO 1D (mujer):",
      error.response?.data || error.message
    );
    throw error;
  }
}
