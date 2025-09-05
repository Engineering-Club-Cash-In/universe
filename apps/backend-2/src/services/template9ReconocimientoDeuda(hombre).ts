import axios from "axios";

export interface ReconocimientoDeudaParams {
  dia: string;
  mes: string;
  año: string; 
  edadAndresAsencio: string;
  dpiAndresAsencio: string;
  nombreDeudor: string;
  edadDeudor: string;
  estadoCivilDeudor: string;
  profesionDeudor: string;
  nacionalidadDeudor: string;
  dpiDeudor: string;
  capitalAdeudado: string;
  mesesPrestamo: string;
  cuotasMensuales: string;
  porcentajeDeudaTexto: string;
  porcentajeDeudaNumero: string;
  porcentajeMoraTexto: string;
  porcentajeMoraNumero: string;
  direccionDeudor: string;
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
  nombreDeudorFirma: string;
  dpiDeudorFirma: string;

  firma: string;        // Firma del deudor
  firmaCashIn: string;  // Nueva firma de CashIn
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

export async function generateReconocimientoDeudaSubmission(
  params: ReconocimientoDeudaParams,
  email: string
) {
  try {
    const payload = {
      template_id: 9, // 📌 ID del template RECONOCIMIENTO DE DEUDA
      submitters: [
        {
          email,
          values: {
            día: params.dia,
            mes: params.mes,
            año: params.año, 
            "Edad Andrés Asencio": params.edadAndresAsencio,
            "Dpi Andrés Asencio": params.dpiAndresAsencio,
            "Nombre Deudor": params.nombreDeudor,
            "Edad deudor": params.edadDeudor,
            "Estado Civil deudor": params.estadoCivilDeudor,
            "Profesión Deudor": params.profesionDeudor,
            "Nacionalidad Deudor": params.nacionalidadDeudor,
            "Dpi Deudor": params.dpiDeudor,
            "Capital Adeudado": params.capitalAdeudado,
            "meses préstamo": params.mesesPrestamo,
            "Cuotas Mensuales": params.cuotasMensuales,
            "Porcentaje Deuda": params.porcentajeDeudaTexto,
            "Porcentaje DeudaNum": params.porcentajeDeudaNumero,
            "Porcentaje Mora": params.porcentajeMoraTexto,
            "Porcentaje MoraNum": params.porcentajeMoraNumero,
            "Dirección Deudor": params.direccionDeudor,
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
            "Nombre Deudor Firma": params.nombreDeudorFirma,
            "Dpi Deudor Firma": params.dpiDeudorFirma,

            firma: params.firma,               // Firma de Deudor
            "FirmaCashIn": params.firmaCashIn // Nueva Firma CashIn
          }
        }
      ]
    };

    const response = await api.post("/submissions", payload);
    console.log("✅ Submission RECONOCIMIENTO DE DEUDA creado:", response.data);
    return response.data;
  } catch (error: any) {
    console.error("❌ Error al crear submission RECONOCIMIENTO DE DEUDA:", error.response?.data || error.message);
    throw error;
  }
}
