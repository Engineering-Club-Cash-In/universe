import axios from "axios";

export interface DebtAcknowledgementWomanParams {
  dia: string;
  mes: string;
  año: string;
  nombre: string;
  edad: string;
  dpiDeudora: string;
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
  duracion: string;
  fechaInicioContrato: string;
  direccionDeudor: string;
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

export async function generateDebtAcknowledgementWomanTemplate18Submission(
  params: DebtAcknowledgementWomanParams,
  email: string
) {
  try {
    const payload = {
      template_id: 18, // 📌 Template 18: CONTRATO PRIVADO DE USO, CARRO NUEVO (mujer)
      submitters: [
        {
          email,
          values: {
            día: params.dia,
            mes: params.mes,
            año: params.año,
            Nombre: params.nombre,
            edad: params.edad,
            "Dpi Deudora": params.dpiDeudora,
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
            "Vehículo asientos": params.vehiculoAsientos,
            "Vehículo cilindros": params.vehiculoCilindros,
            "Vehículo ISCV": params.vehiculoIscv,
            duración: params.duracion,
            "Fecha de Inicio del contrato": params.fechaInicioContrato,
            "Dirección Deudor": params.direccionDeudor,

           
            // 👇 Firma de CashIN fija en base64
            "FirmaCashIN":
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPAAAACUCAMAAACa7lTsAAAAwFBMVEX///8AAAD8/Pz4+Pj19fXo6Oju7u7x8fHe3d3r6+vGxcXV1NTPzs7Z2dni4uLl5eWTk5Ovrq6oqKi7urqhoKBKSUmAf39BQECMi4tWVlZeXV2bmppzcnKFhYVpaGi1tLQ2NjYdHBwtLCwkJCQVFRUODAwNAABUT08rJSQ7NDN8dHJ1aWmdkZBTRkUmHBsmFhYbDw5XRT9HOTaAbWk8Fgw5JidrW1stCAAtHRU3HgkiDgUiAABKKhmKencYAAA1Kicqo0pkAAATIklEQVR4nO1d55qjyJJVJD4BCZ94EKZUVW2m792d2dm7e6ff/60WJwmES1RS98739flRRkKQLiJOmEztdr/wC7..."
          },
        },
      ],
    };

    const response = await api.post("/submissions", payload);
    console.log("✅ Submission CONTRATO PRIVADO DE USO (mujer) creado:", response.data);
    return response.data;
  } catch (error: any) {
    console.error(
      "❌ Error al crear submission CONTRATO PRIVADO DE USO (mujer):",
      error.response?.data || error.message
    );
    throw error;
  }
}
