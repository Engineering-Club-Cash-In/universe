import axios from "axios";

const CRM_API_URL = process.env.CRM_API_URL;

if (!CRM_API_URL) {
  console.warn("[WARN] CRM_API_URL is not set in env — CRM notifications will fail");
}

const crmApi = axios.create({
  baseURL: CRM_API_URL,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 10000,
});

// ============================================
// 📬 Notificar pago de inversionistas
// ============================================
export interface NotifyPayInvestorsInput {
  titulo: string;
  descripcion?: string;
}

export interface NotifyPayInvestorsResponse {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

/**
 * Envía una notificación al CRM indicando que los pagos
 * de inversionistas ya fueron cargados y contabilidad
 * puede proceder a subir las boletas.
 */
export async function notifyPayInvestors(
  input: NotifyPayInvestorsInput,
): Promise<NotifyPayInvestorsResponse> {
  try {
    console.log("\n📬 ========== NOTIFICACIÓN CRM: PAY-INVESTORS ==========");
    console.log(`   Título: ${input.titulo}`);
    if (input.descripcion) {
      console.log(`   Descripción: ${input.descripcion}`);
    }

    const payload = {
      titulo: input.titulo,
      descripcion:
        input.descripcion ??
        "Los pagos de inversionistas ya están cargados. Contabilidad puede proceder a cargar las boletas.",
    };

    const { data } = await crmApi.post("/api/notifications/pay-investors", payload);

    console.log("   ✅ Notificación enviada al CRM exitosamente");
    return {
      success: true,
      message: "Notificación enviada al CRM correctamente",
      data,
    };
  } catch (error: any) {
    const msg = error?.response?.data?.message ?? error?.message ?? "Error desconocido";
    console.error(`   ❌ Error enviando notificación al CRM: ${msg}`);
    return {
      success: false,
      message: `Error enviando notificación al CRM: ${msg}`,
      error: msg,
    };
  }
}

// ============================================
// 🧾 Abrir en el CRM la batería de contratos de un inversionista
// ============================================
export interface CreditoDeLaCompra {
  creditoId: number;
  numeroCreditoSifco: string;
  clienteNombre: string;
  /** Lo que puso ESTE inversionista en ESTE crédito. */
  monto: string;
  /** Fecha de la cuota 0: cuándo se formalizó el crédito. */
  fechaInicio?: string | null;
  /** Fecha de la última cuota: cuándo vence el crédito. */
  fechaVencimiento?: string | null;
}

export interface BateriaDeContratosInput {
  inversionista: {
    id: number;
    nombre: string;
    dpi?: string | null;
    /** DPI de su representante legal, cuando el inversionista es una sociedad. */
    dpiRepLegal?: string | null;
    email?: string | null;
    celular?: string | null;
  };
  compra: {
    creditos: CreditoDeLaCompra[];
    montoTotal: string;
    modalidad?: string | null;
    facturacion?: string | null;
    /** Cuándo se aceptó la compra, en ISO. */
    aceptadaEn: string;
    aceptadaPor?: string | null;
  };
}

/**
 * Le avisa al CRM que la compra de un inversionista fue aceptada, para que le
 * abra a jurídico la batería de contratos que le queda pendiente.
 *
 * El correo de aceptación sigue saliendo igual: esto es lo que deja el trabajo
 * anotado en algún lado en vez de sólo en un hilo de correo.
 *
 * **Es best-effort a propósito.** Cuando esto corre, la compra ya se aceptó y el
 * espejo ya se movió: tirar la operación porque el CRM no contestó dejaría la
 * aceptación a medias. El aviso es idempotente del otro lado (una batería por
 * inversionista y juego de créditos), así que reintentarlo no duplica nada.
 */
export async function abrirBateriaDeContratosEnCrm(
  input: BateriaDeContratosInput,
): Promise<{ success: boolean; batchId?: string; error?: string }> {
  const secreto = process.env.CARTERA_RELAY_SECRET;

  if (!secreto) {
    console.warn(
      "[WARN] CARTERA_RELAY_SECRET no está configurado — no se abre la batería de contratos en el CRM",
    );
    return { success: false, error: "CARTERA_RELAY_SECRET no configurado" };
  }

  try {
    const { data } = await crmApi.post(
      "/api/investor-contracts/compra-aceptada",
      input,
      { headers: { "x-cartera-relay-secret": secreto } },
    );

    console.log(
      `   ✅ Batería de contratos abierta en el CRM para ${input.inversionista.nombre}` +
        (data?.repetida ? " (ya existía)" : ""),
    );
    return { success: true, batchId: data?.batchId };
  } catch (error: any) {
    const msg = error?.response?.data?.error ?? error?.message ?? "Error desconocido";
    console.error(
      `   ❌ No se pudo abrir la batería de contratos de ${input.inversionista.nombre}: ${msg}`,
    );
    return { success: false, error: msg };
  }
}

// ============================================
// Obtener placa/chasis por número SIFCO
// ============================================
export interface VehicleDetails {
  id: string;
  make: string;
  model: string;
  year: number;
  licensePlate: string;
  vinNumber: string;
  color: string;
  vehicleType: string;
  kmMileage: number;
  fuelType: string;
  transmission: string;
  status: string;
  seguroVigente: boolean;
  numeroPoliza: string | null;
  companiaSeguro: string | null;
  fechaVencimientoSeguro: string | null;
  gpsActivo: boolean;
  notes: string | null;
}

export interface VehicleDetailsResponse {
  success: boolean;
  data?: {
    vehicle: VehicleDetails;
  };
  message?: string;
  error?: string;
}

export type VehicleReportDetails = Pick<VehicleDetails, "licensePlate" | "vinNumber">;

type VehiclesBySifcoApiResponse = {
  success: boolean;
  data?: {
    vehicles?: Array<{
      numeroSifco: string;
      licensePlate: string | null;
      vinNumber: string | null;
    }>;
  };
  message?: string;
  error?: string;
};

export async function getVehicleDetailsBySifco(
  numeroSifco: string,
): Promise<VehicleDetailsResponse> {
  try {
    const { data } = await crmApi.get("/info/vehicle-details", {
      params: { numero_sifco: numeroSifco },
    });
    if (!data) {
      return { success: false, message: "Sin respuesta del CRM" };
    }

    const vehicle = data?.data?.vehicle;
    if (!vehicle) {
      console.error(`No contiene datos del vehículo para número ${numeroSifco}`);
      return { success: false, message: "Vehículo no encontrado en CRM" };
    }

    console.log("Consultado detalles del vehículo exitosamente");
    return {
      success: true,
      message: "Detalles del vehículo obtenidos correctamente",
      data: { vehicle },
    };
  } catch (error: any) {
    const msg = error?.response?.data?.message ?? error?.message ?? "Error desconocido";
    console.error(`ERROR en getVehicleDetailsBySifco: ${msg}`);
    return {
      success: false,
      message: `Error obteniendo detalles del vehículo: ${msg}`,
      error: msg,
    };
  }
}

export async function getVehiclesBySifcoMap(
  sifcos: string[],
): Promise<Map<string, VehicleReportDetails>> {
  const uniqueSifcos = [...new Set(sifcos.map((sifco) => sifco.trim()).filter(Boolean))];
  const vehicles = new Map<string, VehicleReportDetails>();
  if (uniqueSifcos.length === 0) return vehicles;

  const { data } = await crmApi.post<VehiclesBySifcoApiResponse>("/info/vehicles-by-sifco", {
    numero_sifcos: uniqueSifcos,
  });

  if (!data.success) {
    throw new Error(data.message || data.error || "Error obteniendo vehículos del CRM");
  }

  for (const vehicle of data.data?.vehicles ?? []) {
    vehicles.set(vehicle.numeroSifco, {
      licensePlate: vehicle.licensePlate ?? "",
      vinNumber: vehicle.vinNumber ?? "",
    });
  }

  return vehicles;
}
