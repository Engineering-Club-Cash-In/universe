import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

type PayloadCartera = {
  nombre?: string;
  dpi?: number;
  email?: string;
  creado_por_usuario_portal?: string;
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

// Lo que cartera devuelve al buscar por correo. Un error se lanza.
let inversionistaPorCorreo: unknown = null;
let correoConsultado: string | null = null;

mock.module("../cartera/investor.service", () => ({
  CarteraInvestorError,
  AmbiguousInvestorEmailError,
  createInvestor: (payload: PayloadCartera) => {
    payloadCartera = payload;

    return respuestaCrear instanceof Error
      ? Promise.reject(respuestaCrear)
      : Promise.resolve(respuestaCrear);
  },
  findInvestorByEmail: (email: string) => {
    correoConsultado = email;

    return inversionistaPorCorreo instanceof Error
      ? Promise.reject(inversionistaPorCorreo)
      : Promise.resolve(inversionistaPorCorreo);
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
  correoConsultado = null;
  inversionistaPorCorreo = null;
  respuestaCrear = { success: true, message: "ok", data: { id: 1 } };
});

/** Registro del que se quiere comprobar el reintento. */
const registroDeAna = {
  userType: "INVESTOR" as const,
  fullName: "Ana Pérez",
  email: "ana@example.com",
  dpi: "1234567890123",
};

/** Id de la cuenta de Better Auth con la que Ana se registra. */
const CUENTA_DE_ANA = "usuario-portal-de-ana";

/** La fila que dejó ese mismo registro, con su marca de procedencia. */
const filaDeAna = {
  inversionista_id: 77,
  nombre: "Ana Pérez",
  dpi: 1234567890123,
  email: "ana@example.com",
  creado_por_usuario_portal: CUENTA_DE_ANA,
};

const conflictoDeCartera = () =>
  new CarteraInvestorError(409, "Ya existe un inversionista con ese DPI");

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

  // El registro toca dos sistemas y no es atómico: cartera puede haber
  // insertado al inversionista y auth-google caerse antes de escribir el
  // DPI/rol del portal. Con `operation: "CREATE"` a secas, TODO reintento
  // choca contra la fila que él mismo acaba de crear y la cuenta queda
  // incompleta para siempre sin back office.
  describe("reintento tras un alta a medias", () => {
    it("reconoce la fila que creó este mismo registro y termina", async () => {
      respuestaCrear = conflictoDeCartera();
      inversionistaPorCorreo = filaDeAna;

      const resultado = await registerExternalUser(registroDeAna, {
        usuarioPortalId: CUENTA_DE_ANA,
      });

      expect(resultado.success).toBe(true);
      expect(resultado.data).toMatchObject({ inversionista_id: 77 });
      expect(correoConsultado).toBe("ana@example.com");
    });

    // El hallazgo que obligó a la columna de procedencia. Cartera devuelve
    // `dpi: dpi_rep_legal` cuando la fila tiene representante legal
    // (controllers/investor.ts, rama de búsqueda por correo), así que comparar
    // correo + DPI + nombre daba por propia una fila de sociedad: su `dpi` es
    // NULL y el que viaja es el del representante. Un registro del portal jamás
    // pudo crear esas filas —hay 10 en ese estado— y aun así pasaban.
    it("no reconoce la fila de una sociedad que devuelve el DPI del representante", async () => {
      respuestaCrear = conflictoDeCartera();
      inversionistaPorCorreo = {
        inversionista_id: 86,
        nombre: "Cube Investments",
        // Lo que responde cartera: el DPI del representante legal, no el de la
        // fila, que es NULL.
        dpi: 1234567890123,
        email: "ana@example.com",
        creado_por_usuario_portal: null,
      };

      await expect(
        registerExternalUser(
          { ...registroDeAna, fullName: "Cube Investments" },
          { usuarioPortalId: CUENTA_DE_ANA },
        ),
      ).rejects.toThrow();
    });

    // La marca prueba de QUIÉN es la fila, no que el reintento pida lo mismo.
    // El DPI del reintento se escribe en Better Auth (la reserva ocurre antes
    // del alta externa), así que aceptar una fila con otro DPI dejaría cartera
    // con uno y la cuenta del portal con otro — y ese otro puede pertenecer a
    // un inversionista antiguo.
    it("no reconoce su propia fila si el reintento trae otro DPI", async () => {
      respuestaCrear = conflictoDeCartera();
      inversionistaPorCorreo = { ...filaDeAna, dpi: 9999999999999 };

      await expect(
        registerExternalUser(registroDeAna, { usuarioPortalId: CUENTA_DE_ANA }),
      ).rejects.toThrow();
    });

    it("no reconoce su propia fila si en cartera quedó sin DPI", async () => {
      respuestaCrear = conflictoDeCartera();
      inversionistaPorCorreo = { ...filaDeAna, dpi: null };

      await expect(
        registerExternalUser(registroDeAna, { usuarioPortalId: CUENTA_DE_ANA }),
      ).rejects.toThrow();
    });

    it("no reconoce una fila sin marca de procedencia", async () => {
      respuestaCrear = conflictoDeCartera();
      inversionistaPorCorreo = {
        ...filaDeAna,
        creado_por_usuario_portal: null,
      };

      await expect(
        registerExternalUser(registroDeAna, { usuarioPortalId: CUENTA_DE_ANA }),
      ).rejects.toThrow();
    });

    it("no reconoce una fila marcada por otra cuenta del portal", async () => {
      respuestaCrear = conflictoDeCartera();
      inversionistaPorCorreo = {
        ...filaDeAna,
        creado_por_usuario_portal: "usuario-portal-de-otro",
      };

      await expect(
        registerExternalUser(registroDeAna, { usuarioPortalId: CUENTA_DE_ANA }),
      ).rejects.toThrow();
    });

    it("no reconoce nada cuando el conflicto fue por DPI de otro correo", async () => {
      respuestaCrear = conflictoDeCartera();
      inversionistaPorCorreo = null;

      await expect(
        registerExternalUser(registroDeAna, { usuarioPortalId: CUENTA_DE_ANA }),
      ).rejects.toThrow();
    });

    it("no reconoce nada si el correo apunta a varios inversionistas", async () => {
      respuestaCrear = conflictoDeCartera();
      inversionistaPorCorreo = new AmbiguousInvestorEmailError(3);

      await expect(
        registerExternalUser(registroDeAna, { usuarioPortalId: CUENTA_DE_ANA }),
      ).rejects.toThrow();
    });

    it("no reconcilia en el flujo sin sesión: sería un oráculo de DPIs", async () => {
      respuestaCrear = conflictoDeCartera();
      inversionistaPorCorreo = filaDeAna;

      await expect(registerExternalUser(registroDeAna)).rejects.toThrow();
      expect(correoConsultado).toBeNull();
    });
  });

  describe("marca de procedencia", () => {
    // En el MISMO insert: una escritura posterior que se cayera a medias
    // devolvería el problema, porque la fila quedaría sin dueño reconocible.
    it("el alta autenticada sella la fila con la cuenta que la pidió", async () => {
      await registerExternalUser(registroDeAna, {
        usuarioPortalId: CUENTA_DE_ANA,
      });

      expect(payloadCartera?.creado_por_usuario_portal).toBe(CUENTA_DE_ANA);
    });

    // carteraFront, el CRM y las importaciones dejan la columna en NULL; el
    // registro público del portal también, porque no hay cuenta que sellar.
    it("el alta sin sesión no sella nada", async () => {
      await registerExternalUser(registroDeAna);

      expect(payloadCartera).not.toBeNull();
      expect(payloadCartera).not.toHaveProperty("creado_por_usuario_portal");
    });

    it("el alta de un CLIENT no manda la marca al CRM", async () => {
      await registerExternalUser(
        { ...registroDeAna, userType: "CLIENT" },
        { usuarioPortalId: CUENTA_DE_ANA },
      );

      expect(payloadCrm).not.toHaveProperty("creado_por_usuario_portal");
    });

    it("no reconcilia un rechazo que no es un conflicto", async () => {
      respuestaCrear = new CarteraInvestorError(400, "banco inexistente");
      inversionistaPorCorreo = filaDeAna;

      await expect(
        registerExternalUser(registroDeAna, { usuarioPortalId: CUENTA_DE_ANA }),
      ).rejects.toThrow();
      expect(correoConsultado).toBeNull();
    });
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
