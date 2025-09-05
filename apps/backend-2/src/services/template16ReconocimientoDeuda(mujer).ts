import axios from "axios";

export interface ReconocimientoDeudaMujerTemplate8Params {
  dia: string;
  mes: string;
  año: string;
  edadAndresAsencio: string;
  dpiAndresAsencio: string;
  nombreDeudora: string;
  edadDeudora: string;
  estadoCivilDeudora: string;
  profesionDeudora: string;
  nacionalidadDeudora: string;
  dpiDeudora: string;
  capitalAdeudado: string;
  mesesPrestamo: string;
  cuotasMensuales: string;
  porcentajeDeudaTexto: string;
  porcentajeDeudaNumero: string;
  porcentajeMoraTexto: string;
  porcentajeMoraNumero: string;
  direccionDeudora: string;
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
  nombreDeudoraFirma: string;
  dpiDeudoraFirma: string;
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

export async function generateReconocimientoDeudaMujerTemplate16Submission(
  params: ReconocimientoDeudaMujerTemplate8Params,
  email: string
) {
  try {
    const payload = {
      template_id: 16, // 📌 Template 16 - Reconocimiento de Deuda mujer
      submitters: [
        {
          email,
          values: {
            Día: params.dia,
            Mes: params.mes,
            Año: params.año,
            "Edad Andrés Asencio": params.edadAndresAsencio,
            "Dpi Andrés Asencio": params.dpiAndresAsencio,
            "Nombre Deudora": params.nombreDeudora,
            "Edad deudora": params.edadDeudora,
            "Estado Civil deudora": params.estadoCivilDeudora,
            "Profesión Deudora": params.profesionDeudora,
            "Nacionalidad Deudora": params.nacionalidadDeudora,
            "Dpi Deudora": params.dpiDeudora,
            "Capital Adeudado": params.capitalAdeudado,
            "meses préstamo": params.mesesPrestamo,
            "Cuotas Mensuales": params.cuotasMensuales,
            "Porcentaje Deuda": params.porcentajeDeudaTexto,
            "Porcentaje DeudaNum": params.porcentajeDeudaNumero,
            "Porcentaje Mora": params.porcentajeMoraTexto,
            "Porcentaje MoraNum": params.porcentajeMoraNumero,
            "Dirección Deudor": params.direccionDeudora,
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
            "Vehículo Cm3": params.vehiculoCm3,
            "Vehículo Asientos": params.vehiculoAsientos,
            "Vehículo Cilindros": params.vehiculoCilindros,
            "Vehículo ISCV": params.vehiculoIscv,
            "Nombre Deudor Firma": params.nombreDeudoraFirma,
            "Dpi Deudor Firma": params.dpiDeudoraFirma,

            // ✅ Firma de Andrés Asencio (base64)
            "Firma Andres Asensio":
              "data:image/jpeg;base64,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"
          }
        }
      ]
    };

    const response = await api.post("/submissions", payload);
    console.log("✅ Submission Reconocimiento Deuda Mujer creado:", response.data);
    return response.data;
  } catch (error: any) {
    console.error(
      "❌ Error al crear submission Reconocimiento Deuda Mujer:",
      error.response?.data || error.message
    );
    throw error;
  }
}
