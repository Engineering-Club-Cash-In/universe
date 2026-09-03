import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

type PayloadCartera = {
  nombre?: string;
  dpi?: number;
  email?: string;
};

let payloadCartera: PayloadCartera | null = null;
let payloadCrm: Record<string, unknown> | null = null;

mock.module("../crm/profile.service", () => ({
  sendLead: (payload: Record<string, unknown>) => {
    payloadCrm = payload;
    return Promise.resolve({ data: { ok: true } });
  },
}));

class CarteraInvestorError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CarteraInvestorError";
  }
}

class AmbiguousInvestorEmailError extends Error {
  constructor(readonly coincidencias: number) {
    super("El correo está asociado a más de un inversionista");
    this.name = "AmbiguousInvestorEmailError";
  }
}

// Respuesta que da el mock de cartera al intentar crear. Un error se lanza.
let respuestaCrear: unknown = {
  success: true,
  message: "ok",
  data: { id: 1 },
};

mock.module("../cartera/investor.service", () => ({
  CarteraInvestorError,
  AmbiguousInvestorEmailError,
  createInvestor: (payload: PayloadCartera) => {
    payloadCartera = payload;

    return respuestaCrear instanceof Error
      ? Promise.reject(respuestaCrear)
      : Promise.resolve(respuestaCrear);
  },
}));

type Servicio = typeof import("./registerExternal.service");

let registerExternalUser: Servicio["registerExternalUser"];

beforeAll(async () => {
  const servicio = await import("./registerExternal.service");

  registerExternalUser = servicio.registerExternalUser;
});

beforeEach(() => {
  payloadCartera = null;
  payloadCrm = null;
  respuestaCrear = { success: true, message: "ok", data: { id: 1 } };
});

describe("registerExternalUser", () => {
  it("manda a cartera los 13 dígitos aunque el DPI venga con separadores", async () => {
    await registerExternalUser({
      userType: "INVESTOR",
      fullName: "Ana Pérez",
      email: "ana@example.com",
      dpi: "1234-56789-0123",
    });

    // Sin normalizar, el `parseInt` de aquí corta en el primer separador y
    // cartera se queda con el DPI 1234.
    expect(payloadCartera?.dpi).toBe(1234567890123);
  });

  it("manda al CRM el DPI ya normalizado", async () => {
    await registerExternalUser({
      userType: "CLIENT",
      fullName: "Ana Pérez",
      email: "ana@example.com",
      dpi: "1234 56789 0123",
    });

    expect(payloadCrm?.dpi).toBe("1234567890123");
  });

  it("rechaza un DPI que no llega a 13 dígitos sin tocar cartera", async () => {
    await expect(
      registerExternalUser({
        userType: "INVESTOR",
        fullName: "Ana Pérez",
        email: "ana@example.com",
        dpi: "1234",
      }),
    ).rejects.toThrow();

    expect(payloadCartera).toBeNull();
  });
});
