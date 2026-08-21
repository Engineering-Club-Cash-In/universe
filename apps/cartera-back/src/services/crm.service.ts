import axios from "axios";

const CRM_API_URL = process.env.CRM_API_URL;

if (!CRM_API_URL) {
  console.warn("[WARN] CRM_API_URL is not set in env — CRM notifications will fail");
}

if (!process.env.CARTERA_BACK_API_KEY) {
  console.warn(
    "[WARN] CARTERA_BACK_API_KEY is not set in env — recibo de pago por WhatsApp fallará (401 del CRM)",
  );
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
// 📄 Enviar recibo de pago por WhatsApp
// ============================================
export interface NotifyReciboPagoWhatsappInput {
  pagoId: number;
  numeroSifco: string;
  reciboUrl: string;
  clienteNombre: string;
  numeroCuota?: number | null;
  asesorNombre?: string | null;
  asesorTelefono?: string | null;
}

export interface NotifyReciboPagoWhatsappResponse {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

/**
 * Envía al cliente, por WhatsApp, el recibo de comprobante del pago recién
 * facturado. Fire-and-forget desde el caller: nunca lanza, siempre devuelve
 * un resultado tipado para no afectar la respuesta de facturación si falla.
 */
export async function notifyReciboPagoWhatsapp(
  input: NotifyReciboPagoWhatsappInput,
): Promise<NotifyReciboPagoWhatsappResponse> {
  try {
    const { data } = await crmApi.post(
      "/api/notifications/recibo-pago-whatsapp",
      {
        pagoId: input.pagoId,
        numeroSifco: input.numeroSifco,
        reciboUrl: input.reciboUrl,
        clienteNombre: input.clienteNombre,
        numeroCuota: input.numeroCuota ?? null,
        asesorNombre: input.asesorNombre ?? null,
        asesorTelefono: input.asesorTelefono ?? null,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.CARTERA_BACK_API_KEY}`,
        },
      },
    );

    if (!data?.sent) {
      const msg = data?.mensaje ?? "El CRM no pudo enviar el recibo por WhatsApp";
      console.error(`❌ Error enviando recibo de pago por WhatsApp: ${msg}`);
      return { success: false, message: msg, error: msg, data };
    }

    return {
      success: true,
      message: "Recibo de pago enviado por WhatsApp correctamente",
      data,
    };
  } catch (error: any) {
    const msg = error?.response?.data?.message ?? error?.message ?? "Error desconocido";
    console.error(`❌ Error enviando recibo de pago por WhatsApp: ${msg}`);
    return {
      success: false,
      message: `Error enviando recibo de pago por WhatsApp: ${msg}`,
      error: msg,
    };
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
