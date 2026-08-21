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

// ============================================
// 🤖 Circuito de vuelta del bot de cobros
// ============================================

/**
 * Los cinco caminos que puede tomar un pago después de registrarse. Cada uno
 * corresponde a un botón que contabilidad aprieta en carteraFront.
 */
export type EventoPagoBot =
  | "validado"
  | "revertido"
  | "regresado_a_pendiente"
  | "marcado_falso";

export interface EventoPagoBotInput {
  pagoId: number;
  creditoId?: number | null;
  numeroSifco?: string | null;
  evento: EventoPagoBot;
  motivo?: string | null;
  usuario?: string | null;
}

/**
 * Le avisa al CRM que un pago cambió de estado, para que el bot le escriba al
 * cliente que subió la boleta.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NUNCA TIRA, NUNCA BLOQUEA (D-28).
 *
 * Un WhatsApp caído no puede tumbar la validación de un pago: contabilidad está
 * haciendo su trabajo y el aviso es un efecto secundario. Try/catch, log y
 * seguir — el mismo patrón que `notifyPayInvestors`.
 *
 * El costo de eso es que un aviso se puede perder si el CRM está caído justo en
 * ese segundo. Se acepta a propósito: del lado del CRM hay un job que cada hora
 * pregunta por los pagos sin resolver, así que el webhook **adelanta** el aviso
 * y el job lo **garantiza** (D-35). Montar un outbox con reintentos acá adentro
 * —tabla y worker nuevos dentro de la app que mueve el dinero— era el precio
 * que no valía la pena.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Va con `CARTERA_WEBHOOK_API_KEY`, que es **otra** llave que la del bot: quien
 * puede consultar créditos no tiene por qué poder disparar mensajes a clientes.
 */
/**
 * Dispara el aviso SIN esperar la respuesta.
 *
 * El evento se emite después del commit: el pago ya está aplicado (o
 * revertido) pase lo que pase con el aviso. Esperar al CRM acá significaba
 * que con el CRM lento cada acción de contabilidad —validar, revertir,
 * marcar falso— se quedaba colgada hasta el timeout de axios (10 s) para
 * responder un éxito que ya había ocurrido. El job de respaldo del CRM
 * existe justamente para que este aviso pueda perderse sin consecuencias.
 *
 * `notificarEventoPagoBot` nunca rechaza (catch interno), así que el `void`
 * no deja promesas huérfanas sin manejar.
 */
export function emitirEventoPagoBot(input: EventoPagoBotInput): void {
  void notificarEventoPagoBot(input);
}

export async function notificarEventoPagoBot(
  input: EventoPagoBotInput,
): Promise<void> {
  const apiKey = process.env.CARTERA_WEBHOOK_API_KEY;

  if (!apiKey || !CRM_API_URL) {
    // Sin configuración no se intenta, pero se deja rastro: si esto aparece en
    // los logs de producción, los clientes no se están enterando de sus pagos.
    console.warn(
      `[BotCobros] sin CARTERA_WEBHOOK_API_KEY o CRM_API_URL: no se avisó el evento '${input.evento}' del pago ${input.pagoId}`,
    );
    return;
  }

  try {
    await crmApi.post(
      "/api/bot/cobros/pagos/evento",
      { ...input, ocurridoEn: new Date().toISOString() },
      { headers: { "x-api-key": apiKey } },
    );
  } catch (error: any) {
    const msg = error?.response?.data?.message ?? error?.message ?? "desconocido";
    console.error(
      `[BotCobros] no se pudo avisar el evento '${input.evento}' del pago ${input.pagoId}: ${msg}`,
    );
  }
}

/**
 * ¿Este pago lo subió un cliente por el bot?
 *
 * El CRM sabe contestar que no (`PAGO_NO_ES_DEL_BOT`) y responde 200, así que
 * avisar de todos los pagos sería correcto — pero serían miles de POST inútiles
 * en el camino caliente de contabilidad, cada uno con su timeout. El filtro es
 * una comparación de texto sobre un dato que ya tenemos en la mano.
 *
 * El CRM igual conserva su chequeo: acá se filtra por eficiencia, no por
 * seguridad, y las dos puntas tienen que poder defenderse solas.
 */
export function esPagoDelBotCobros(registerBy: string | null | undefined): boolean {
  return (registerBy ?? "").trim().toLowerCase() === "bot-cobros@clubcashin.com";
}
