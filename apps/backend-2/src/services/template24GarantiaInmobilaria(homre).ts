import axios from "axios";

export interface MovableGuaranteeManTemplate24Params {
  // 📅 Fechas principales
  dia: string;
  mes: string;
  año: string;

  // 👤 Datos personales
  edadAndres: string;
  nombreCompleto: string;
  edad: string;
  estadoCivil: string;
  dpiLetras: string;

  // 💰 Monto principal
  montoLetras: string;

  // 🚗 Datos del vehículo
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

  // 📆 Plazos
  plazoTexto: string;
  plazo: string;
  añoLetras: string;

  // 📍 Contacto
  direccion: string;
  correo: string;
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
 * 🧾 Genera el submission para el template 24:
 * "GARANTÍA MOBILIARIA (HOMBRES)"
 *
 * 📌 Params limpios (sin duplicados). En `values` se reusan varias veces los mismos
 * nombres base ("dia", "mes", "año", etc.) según lo requiera el documento.
 */
export async function generateMovableGuaranteeManTemplate24Submission(
  params: MovableGuaranteeManTemplate24Params,
  email: string
) {
  try {
    const payload = {
      template_id: 24, // 📄 Template 24: Garantía Mobiliaria Hombre
      submitters: [
        {
          email,
          values: {
            // 📅 Fechas (reutilizadas)
            dia: params.dia,
            mes: params.mes,
            año: params.año, 

            // 👤 Datos personales
            "Edad Andres": params.edadAndres,
            "Nombre Completo": params.nombreCompleto,
            edad: params.edad,
            "Estado Civil": params.estadoCivil,
            "DPI Letras": params.dpiLetras,

            // 💰 Monto principal
            "Monto Letras": params.montoLetras, 

            // 🚗 Datos del vehículo
            "Vehículo Tipo": params.vehiculoTipo,
            "Vehículo Marca": params.vehiculoMarca,
            "Vehículo Color": params.vehiculoColor,
            "Vehículo Uso": params.vehiculoUso,
            "Vehículo Chasis": params.vehiculoChasis,
            "Vehículo Combustible": params.vehiculoCombustible,
            "Vehículo Motor": params.vehiculoMotor,
            "Vehículo Serie": params.vehiculoSerie,
            "Vehículo Línea": params.vehiculoLinea,
            "Vehículo Modelo": params.vehiculoModelo,
            "Vehículo CM3": params.vehiculoCm3,
            "Vehículo Asientos": params.vehiculoAsientos,
            "Vehículo Cilindros": params.vehiculoCilindros,
            "Vehículo ISCV": params.vehiculoIscv,

            // 📆 Plazos
            "Plazo Texto": params.plazoTexto,
            Plazo: params.plazo,
            "Año Letras": params.añoLetras, 

            // 📍 Contacto
            Dirección: params.direccion,
            Correo: params.correo,
            FirmaCashIN:
              "data:image/png;base64,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",

            // 🚫 Firmas se hacen directo en DocuSeal
          },
        },
      ],
    };

    const response = await api.post("/submissions", payload);
    console.log(
      "✅ Submission Garantía Mobiliaria Hombre creado:",
      response.data
    );
    return response.data;
  } catch (error: any) {
    console.error(
      "❌ Error al crear submission Garantía Mobiliaria Hombre:",
      error.response?.data || error.message
    );
    throw error;
  }
}
