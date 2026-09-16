import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

type PayloadCartera = {
  nombre?: string;
  dpi?: number;
  email?: string;
  creado_por_usuario_portal?: string;
};

let payloadCartera: PayloadCartera | null = null;
let payloadCrm: Record<string, unknown> | null = null;

class CrmLeadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CrmLeadError";
  }
}

// Respuesta que da el mock del CRM al crear el lead. Un error se lanza.
let respuestaCrm: unknown = { data: { ok: true } };

mock.module("../crm/profile.service", () => ({
  CrmLeadError,
  sendLead: (payload: Record<string, unknown>) => {
    payloadCrm = payload;

    return respuestaCrm instanceof Error
      ? Promise.reject(respuestaCrm)
      : Promise.resolve(respuestaCrm);
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
  respuestaCrm = { data: { ok: true } };
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

  // NOTA: aquí vivía un describe entero ("reintento tras un alta a medias")
  // sobre `recuperarRegistroPropio`: buscaba el inversionista por correo,
  // comparaba la marca de procedencia y el DPI, y decidía si el 409 de cartera
  // era en realidad la fila que este mismo registro había creado.
  //
  // Se borró, no se movió de sitio: esa decisión la toma ahora cartera, que es
  // quien tiene las restricciones de unicidad y puede resolverla en una sola
  // operación. Sus casos viven en
  // `apps/cartera-back/src/controllers/investor.test.ts`
  // ("insertInvestor · reintento del registro del portal"), con la ventaja de
  // que allí se compara contra la FILA y no contra lo que devuelve la búsqueda
  // por correo —que sustituye el `dpi` por el `dpi_rep_legal` y era de donde
  // salía el agujero de las filas de sociedad.

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

    // El motivo exacto de cartera no sale de aquí: "ya existe un inversionista
    // con ese DPI" sería un oráculo sobre qué DPIs y correos están dados de
    // alta.
    it("generaliza el rechazo de cartera antes de propagarlo", async () => {
      respuestaCrear = new CarteraInvestorError(
        409,
        "Ya existe un inversionista con ese DPI",
      );

      await expect(
        registerExternalUser(registroDeAna, { usuarioPortalId: CUENTA_DE_ANA }),
      ).rejects.toThrow("No se pudo completar el registro del inversionista");
    });
  });

  // El espejo del conflicto de cartera, en el camino de CLIENT. Aquí el motivo
  // SÍ sale: el 409 del CRM habla del lead que cuelga del correo de la sesión
  // —el de quien pregunta—, no de si un DPI ajeno existe, así que no es un
  // oráculo. Y es lo único que la persona puede corregir sola.
  describe("rechazo del CRM", () => {
    it("propaga el 409 del CRM con su status intacto", async () => {
      respuestaCrm = new CrmLeadError(
        409,
        "Ya existe un registro con este correo y otro DPI.",
      );

      const error = await registerExternalUser({
        ...registroDeAna,
        userType: "CLIENT",
      }).catch((e) => e);

      expect(error).toBeInstanceOf(CrmLeadError);
      expect(error.status).toBe(409);
    });
  });

  // La bandera del CRM es lo único que distingue "el lead se quedó con este
  // DPI" de "el lead sigue sin DPI y solo un humano puede ponérselo". Si se
  // queda dentro de este servicio, la ruta escribe el DPI en Better Auth igual y
  // la persona queda clavada: el formulario deja de pedírselo porque ya lo
  // tiene, y el CRM sigue diciendo que su ficha está incompleta.
  describe("bandera dpiRegistradoEnLead", () => {
    it("propaga el aviso de que el CRM no escribió el DPI", async () => {
      respuestaCrm = {
        success: true,
        data: { id: "lead-1" },
        dpiRegistradoEnLead: false,
      };

      const resultado = await registerExternalUser({
        ...registroDeAna,
        userType: "CLIENT",
      });

      expect(resultado.dpiRegistradoEnLead).toBeFalse();
    });

    it("propaga también el caso en que el CRM sí lo escribió", async () => {
      respuestaCrm = {
        success: true,
        data: { id: "lead-1" },
        dpiRegistradoEnLead: true,
      };

      const resultado = await registerExternalUser({
        ...registroDeAna,
        userType: "CLIENT",
      });

      expect(resultado.dpiRegistradoEnLead).toBeTrue();
    });

    // El alta nueva del CRM no emite la bandera, y el camino de INVESTOR no
    // pasa por el CRM. En los dos casos el DPI del registro SÍ es el que quedó,
    // así que `undefined` tiene que llegar como `undefined` y no aplanarse a
    // `false`: tratarlo como rechazo rompería los dos caminos.
    it("deja undefined el alta nueva del CRM, que no manda bandera", async () => {
      respuestaCrm = { success: true, data: { id: "lead-1" } };

      const resultado = await registerExternalUser({
        ...registroDeAna,
        userType: "CLIENT",
      });

      expect(resultado.dpiRegistradoEnLead).toBeUndefined();
    });

    it("deja undefined el camino de INVESTOR, que no pasa por el CRM", async () => {
      const resultado = await registerExternalUser(registroDeAna);

      expect(resultado.dpiRegistradoEnLead).toBeUndefined();
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
