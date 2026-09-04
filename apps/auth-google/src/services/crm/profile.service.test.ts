import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";

mock.module("../../config/env", () => ({
  env: { CRM_API_URL: "http://crm.local", INTERNAL_API_SECRET: "secreto" },
}));

mock.module("./portalAuth", () => ({
  portalAuthHeaders: () => ({ Authorization: "Bearer secreto" }),
}));

type Servicio = typeof import("./profile.service");

let sendLead: Servicio["sendLead"];
let CrmLeadError: Servicio["CrmLeadError"];

const fetchOriginal = globalThis.fetch;

/** Deja que el CRM conteste lo que pida la prueba. */
const crmResponde = (status: number, cuerpo: unknown) => {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify(cuerpo), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    )) as unknown as typeof fetch;
};

beforeAll(async () => {
  const servicio = await import("./profile.service");

  sendLead = servicio.sendLead;
  CrmLeadError = servicio.CrmLeadError;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

const registroDeAna = {
  nombreCompleto: "Ana Pérez",
  correo: "ana@example.com",
  dpi: "1234567890123",
};

// El CRM contesta 409 cuando el correo de la sesión ya tiene un lead con OTRO
// DPI. Aplanarlo a un `Error` pelado hacía que la ruta lo envolviera en un 500
// y que el formulario no pudiera llevar a la persona al campo del DPI: se le
// pedía corregir algo que ya no podía tocar.
describe("sendLead", () => {
  it("conserva el 409 del CRM y su mensaje", async () => {
    crmResponde(409, {
      success: false,
      error: "Ya existe un registro con este correo y otro DPI.",
    });

    const error = await sendLead(registroDeAna).catch((e) => e);

    expect(error).toBeInstanceOf(CrmLeadError);
    expect(error.status).toBe(409);
    expect(error.message).toBe(
      "Ya existe un registro con este correo y otro DPI.",
    );
  });

  it("conserva el status de cualquier otro rechazo del CRM", async () => {
    crmResponde(400, { success: false, error: "El DPI no es válido" });

    const error = await sendLead(registroDeAna).catch((e) => e);

    expect(error).toBeInstanceOf(CrmLeadError);
    expect(error.status).toBe(400);
  });

  it("devuelve el lead cuando el CRM acepta", async () => {
    crmResponde(200, { success: true, data: { id: "lead-1" } });

    expect(await sendLead(registroDeAna)).toMatchObject({
      data: { id: "lead-1" },
    });
  });
});
