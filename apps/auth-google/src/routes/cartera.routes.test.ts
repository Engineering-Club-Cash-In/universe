import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";

// Sesión que devuelve el mock de Better Auth. `null` = petición sin sesión.
let sessionActual: {
  user: { id: string; email?: string; role?: string };
} | null = null;

// Fila que cartera resuelve por el correo de la sesión.
let inversionistaPorCorreo: Record<string, unknown> | null = null;

// Escrituras que llegaron a cartera. Si la autorización funciona, un intento
// no autorizado las deja vacías.
let escrituras: unknown[] = [];

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

mock.module("../lib/auth", () => ({
  auth: { api: { getSession: () => Promise.resolve(sessionActual) } },
}));

mock.module("../lib/storage", () => ({
  getSignedUrlFromBucket: () => Promise.resolve(""),
}));

mock.module("../services/cartera", () => ({
  CarteraInvestorError,
  AmbiguousInvestorEmailError,
  findInvestorByEmail: () => Promise.resolve(inversionistaPorCorreo),
  createInvestor: (payload: unknown) => {
    escrituras.push(payload);
    return Promise.resolve({ success: true, message: "ok" });
  },
  getInvestorProfile: () => Promise.resolve(null),
  getInvestorDocuments: () => Promise.resolve([]),
  getBancos: () => Promise.resolve([]),
  getLiquidaciones: () => Promise.resolve([]),
  getInvestmentsStats: () => Promise.resolve({}),
  getAsesorById: () => Promise.resolve(null),
}));

let app: Hono;

beforeAll(async () => {
  const { default: carteraRoutes } = await import("./cartera.routes");

  app = new Hono();
  app.route("/api/cartera", carteraRoutes);
});

const editarCuenta = () =>
  app.request("http://localhost/api/cartera/investor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ numero_cuenta: "0011223344", banco_id: 7 }),
  });

/** Inversionista de siempre: nadie lo creó desde el portal. */
const filaDeLaVictima = {
  inversionista_id: 86,
  nombre: "Cube Investments",
  email: "victima@example.com",
  creado_por_usuario_portal: null,
};

describe("POST /api/cartera/investor", () => {
  beforeEach(() => {
    sessionActual = null;
    inversionistaPorCorreo = filaDeLaVictima;
    escrituras = [];
  });

  it("rechaza sin sesión", async () => {
    const res = await editarCuenta();

    expect(res.status).toBe(401);
    expect(escrituras).toEqual([]);
  });

  // El ataque: `requireEmailVerification` está en false, así que una sesión no
  // prueba que el correo sea de quien lo usa. Si el correo del inversionista
  // aún no estaba en Better Auth, cualquiera crea una cuenta con él y la
  // escritura aterriza sobre la fila de la víctima. Solo hace falta el correo:
  // ni el DPI ni el nombre.
  it("rechaza a una cuenta recién creada que solo aporta el correo", async () => {
    sessionActual = {
      user: {
        id: "cuenta-del-atacante",
        email: "victima@example.com",
        role: "CLIENT",
      },
    };

    const res = await editarCuenta();

    expect(res.status).toBe(403);
    expect(escrituras).toEqual([]);
  });

  it("deja escribir a una cuenta que el sistema reconoce como inversionista", async () => {
    sessionActual = {
      user: {
        id: "cuenta-del-titular",
        email: "victima@example.com",
        role: "INVESTOR",
      },
    };

    const res = await editarCuenta();

    expect(res.status).toBe(200);
    expect(escrituras).toHaveLength(1);
  });

  // Un registro cuyo alta en cartera salió bien pero cuyo ascenso de rol no
  // llegó a escribirse: la fila lleva SU sello, que prueba que la creó.
  it("deja escribir a quien creó la fila desde el portal aunque siga en CLIENT", async () => {
    inversionistaPorCorreo = {
      ...filaDeLaVictima,
      creado_por_usuario_portal: "cuenta-del-titular",
    };
    sessionActual = {
      user: {
        id: "cuenta-del-titular",
        email: "victima@example.com",
        role: "CLIENT",
      },
    };

    const res = await editarCuenta();

    expect(res.status).toBe(200);
    expect(escrituras).toHaveLength(1);
  });

  it("no acepta el sello de otra cuenta como propio", async () => {
    inversionistaPorCorreo = {
      ...filaDeLaVictima,
      creado_por_usuario_portal: "cuenta-de-otro",
    };
    sessionActual = {
      user: {
        id: "cuenta-del-atacante",
        email: "victima@example.com",
        role: "CLIENT",
      },
    };

    const res = await editarCuenta();

    expect(res.status).toBe(403);
    expect(escrituras).toEqual([]);
  });
});
