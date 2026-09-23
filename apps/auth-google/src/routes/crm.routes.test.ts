/**
 * Las rutas del CRM exponen la ficha completa de un cliente, sus documentos
 * escaneados y sus créditos. Antes elegían a QUIÉN devolver esos datos con el
 * `email`/`dpi` del query string y con el `email` del cuerpo, así que cualquier
 * cuenta del portal —el registro es abierto— podía pedir los de otra persona.
 *
 * Estas pruebas fijan la única garantía que importa: el destinatario sale de la
 * SESIÓN. Lo que manda el navegador se ignora.
 */

import { beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Hono } from "hono";

// Sesión que devuelve el mock de Better Auth. `null` = petición sin sesión.
let sessionActual: {
  user: {
    id: string;
    email?: string;
    // `null` es un valor real de Better Auth, no un hueco del mock: es la
    // cuenta que todavía no registró su DPI (la primera captura).
    dpi?: string | null;
    passwordProvisionadaAt?: string | null;
  };
} | null = null;

mock.module("../lib/auth", () => ({
  auth: {
    api: {
      getSession: () => Promise.resolve(sessionActual),
    },
  },
}));

/** Argumentos con los que la ruta llamó a cada servicio del CRM. */
let llamadas: { fn: string; args: unknown[] }[] = [];

const espia =
  (fn: string, devuelve: (args: unknown[]) => unknown) =>
  (...args: unknown[]) => {
    llamadas.push({ fn, args });
    return Promise.resolve(devuelve(args));
  };

// Números SIFCO que el CRM reconoce como del lead de la sesión.
let sifcoDelLead: string[] = [];

// OJO: `mock.module` es global y sobrevive a este archivo. Correr este archivo
// solo (`bun test src/routes/crm.routes.test.ts`), no la suite entera.
mock.module("../services/crm", () => ({
  getProfile: espia("getProfile", () => ({ email: "quien-sea" })),
  updateLead: espia("updateLead", () => ({ data: { id: "lead-1" } })),
  getNumbersSifco: espia("getNumbersSifco", () =>
    sifcoDelLead.map((numeroSifco) => ({ numeroSifco })),
  ),
  getPersonalDocuments: espia("getPersonalDocuments", () => []),
  getContracts: espia("getContracts", () => []),
  getCredits: espia("getCredits", () => []),
  getCreditByNumeroSifco: espia("getCreditByNumeroSifco", () => ({
    credito: { numero_credito_sifco: "propio" },
  })),
}));

let app: Hono;

beforeAll(async () => {
  const { default: crmRoutes } = await import("./crm.routes");

  app = new Hono();
  app.route("/api/crm", crmRoutes);
});

const pedir = (path: string, init?: RequestInit) =>
  app.request(`http://localhost/api/crm${path}`, init);

const postJson = (path: string, body: unknown) =>
  pedir(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** Devuelve los argumentos de la única llamada que hizo la ruta. */
const argsDe = (fn: string) => llamadas.find((l) => l.fn === fn)?.args;

// La cuenta del atacante y la víctima a la que apunta con los parámetros.
const ATACANTE = "atacante@example.com";
const VICTIMA = "victima@example.com";
const DPI_VICTIMA = "1234567890123";
const DPI_ATACANTE = "9876543210987";

describe("rutas del CRM: el destinatario sale de la sesión", () => {
  beforeEach(() => {
    llamadas = [];
    sifcoDelLead = [];
    sessionActual = {
      user: { id: "user-atacante", email: ATACANTE, dpi: DPI_ATACANTE },
    };
  });

  // El registro (`decidirLeadDelPortal`) normaliza los dos correos antes de
  // compararlos, así que una cuenta creada como "Ana@Ejemplo.com " se registra
  // bien contra el lead "ana@ejemplo.com". Si estas rutas mandan el correo tal
  // cual, el CRM lo busca con un `=` exacto y no encuentra nada: la cuenta se
  // registra con éxito y después no puede ver ni su perfil.
  it("manda el correo de la sesión normalizado, como lo normaliza el registro", async () => {
    sessionActual = {
      user: { id: "user-1", email: "  Ana@Ejemplo.COM  ", dpi: DPI_ATACANTE },
    };

    const res = await pedir("/profile");

    expect(res.status).toBe(200);
    expect(argsDe("getProfile")?.[0]).toBe("ana@ejemplo.com");
  });

  it("rechaza sin sesión", async () => {
    sessionActual = null;

    const res = await pedir(
      `/profile?email=${VICTIMA}&dpi=${DPI_VICTIMA}`,
    );

    expect(res.status).toBe(401);
    expect(llamadas).toHaveLength(0);
  });

  // La pantalla de primer ingreso vive en el cliente y se salta con un `curl`.
  // Si el candado no estuviera también aquí, entrar con la contraseña que
  // mandamos por correo bastaría para seguir usando los datos indefinidamente.
  it("rechaza a quien todavía usa la contraseña que le generamos", async () => {
    sessionActual = {
      user: {
        id: "user-atacante",
        email: ATACANTE,
        dpi: DPI_ATACANTE,
        passwordProvisionadaAt: "2026-09-07T12:00:00.000Z",
      },
    };

    const res = await pedir("/profile");

    expect(res.status).toBe(403);
    expect(llamadas).toHaveLength(0);
  });

  it("deja pasar a quien ya eligió la suya", async () => {
    sessionActual = {
      user: {
        id: "user-atacante",
        email: ATACANTE,
        dpi: DPI_ATACANTE,
        passwordProvisionadaAt: null,
      },
    };

    const res = await pedir("/profile");

    expect(res.status).toBe(200);
  });

  // ------------------------------------------------------------------
  // LECTURA
  // ------------------------------------------------------------------

  const rutasDeLectura = [
    { path: "/profile", servicio: "getProfile" },
    { path: "/sifco", servicio: "getNumbersSifco" },
    { path: "/documents", servicio: "getPersonalDocuments" },
    { path: "/contracts", servicio: "getContracts" },
  ];

  for (const { path, servicio } of rutasDeLectura) {
    it(`${path} ignora el email y el dpi del query y usa el correo de la sesión`, async () => {
      const res = await pedir(`${path}?email=${VICTIMA}&dpi=${DPI_VICTIMA}`);

      expect(res.status).toBe(200);
      expect(argsDe(servicio)?.[0]).toBe(ATACANTE);
    });

    it(`${path} responde igual sin email ni dpi en el query`, async () => {
      // El front puede dejar de mandarlos sin que la ruta se caiga: ya no son
      // parte de la decisión.
      const res = await pedir(path);

      expect(res.status).toBe(200);
      expect(argsDe(servicio)?.[0]).toBe(ATACANTE);
    });

    // El DPI de la sesión lo autodeclara el usuario (POST /api/profile/me/dpi)
    // y el CRM busca el lead con OR(email, dpi). Reenviarlo dejaría que quien
    // reclame el DPI de otro —basta que esa persona no tenga cuenta— caiga en
    // el lead ajeno por la rama del DPI. Por eso NO viaja como llave.
    it(`${path} no manda el DPI de la sesión como llave de búsqueda`, async () => {
      sessionActual = {
        user: { id: "user-atacante", email: ATACANTE, dpi: DPI_VICTIMA },
      };

      await pedir(path);

      expect(argsDe(servicio)?.[1]).toBe("");
    });
  }

  // ------------------------------------------------------------------
  // ESCRITURA
  // ------------------------------------------------------------------

  it("/profile/update escribe sobre el lead de la sesión, no sobre el del cuerpo", async () => {
    const res = await postJson("/profile/update", {
      email: VICTIMA,
      phone: "55555555",
      address: "una dirección",
    });

    expect(res.status).toBe(200);
    expect(argsDe("updateLead")?.[0]).toMatchObject({
      email: ATACANTE,
      phone: "55555555",
      address: "una dirección",
    });
  });

  it("/profile/update nunca reenvía el DPI del cuerpo", async () => {
    await postJson("/profile/update", { email: VICTIMA, dpi: DPI_VICTIMA });

    expect(argsDe("updateLead")?.[0]).toMatchObject({
      email: ATACANTE,
      dpi: DPI_ATACANTE,
    });
  });

  it("/profile/update no inventa campos que el cuerpo no trajo", async () => {
    await postJson("/profile/update", { phone: "55555555" });

    const payload = argsDe("updateLead")?.[0] as Record<string, unknown>;
    expect(payload).toEqual({ email: ATACANTE, phone: "55555555" });
  });

  // ------------------------------------------------------------------
  // CRÉDITOS
  // ------------------------------------------------------------------

  it("/credits solo pide los créditos del lead de la sesión", async () => {
    sifcoDelLead = ["propio-1", "propio-2"];

    const res = await pedir("/credits?numerosSifco=ajeno-1,ajeno-2");

    expect(res.status).toBe(200);
    expect(argsDe("getCredits")?.[0]).toEqual(["propio-1", "propio-2"]);
  });

  it("/credit rechaza un número SIFCO que no es del lead de la sesión", async () => {
    sifcoDelLead = ["propio-1"];

    const res = await pedir("/credit?numeroSifco=ajeno-1");

    expect(res.status).toBe(403);
    expect(argsDe("getCreditByNumeroSifco")).toBeUndefined();
  });

  it("/credit devuelve el crédito cuando el número sí es del lead de la sesión", async () => {
    sifcoDelLead = ["propio-1"];

    const res = await pedir("/credit?numeroSifco=propio-1");

    expect(res.status).toBe(200);
    expect(argsDe("getCreditByNumeroSifco")?.[0]).toBe("propio-1");
  });
});

// ====================================================================
// SIMULACRO DEL CAMBIO DE DPI (`soloValidar`)
// ====================================================================
//
// El portal valida el DPI NUEVO en el CRM antes de escribirlo en la cuenta
// (ver `aplicarCambioDeDpi` en portal-web): el contrato obliga a escribir la
// cuenta primero, así que un rechazo del CRM después dejaría la identidad
// partida entre los dos servicios.
//
// Ese simulacro sólo sirve si el BFF reenvía DOS cosas: la bandera
// `soloValidar` —sin ella el CRM ESCRIBE— y el DPI del CUERPO, que es el
// nuevo; el de la sesión es el viejo, y validar el viejo no valida nada.
//
// El invariante de la escritura real NO cambia: ahí el DPI sigue saliendo de
// la sesión.
describe("/profile/update: simulacro vs escritura real", () => {
  beforeEach(() => {
    llamadas = [];
    sifcoDelLead = [];
    sessionActual = {
      user: { id: "user-atacante", email: ATACANTE, dpi: DPI_ATACANTE },
    };
  });

  const DPI_NUEVO = "2468013579246";

  // ------------------------------------------------------------------
  // 1. SIMULACRO: la bandera y el DPI del cuerpo llegan al CRM
  // ------------------------------------------------------------------

  it("en simulacro reenvía soloValidar y el DPI del CUERPO", async () => {
    sessionActual = {
      user: { id: "user-simulacro-1", email: ATACANTE, dpi: DPI_ATACANTE },
    };

    const res = await postJson("/profile/update", {
      dpi: DPI_NUEVO,
      soloValidar: true,
    });

    expect(res.status).toBe(200);
    expect(argsDe("updateLead")?.[0]).toMatchObject({
      email: ATACANTE,
      dpi: DPI_NUEVO,
      soloValidar: true,
    });
  });

  // ------------------------------------------------------------------
  // 2. RED DE SEGURIDAD: la escritura real no cambia
  // ------------------------------------------------------------------
  //
  // Estas dos pruebas tienen que estar verdes ANTES y DESPUÉS del arreglo.
  // Un DPI arbitrario escrito en un lead envenena la resolución de identidad
  // del portal, que casa leads por DPI.

  it("sin soloValidar, el DPI sigue saliendo de la SESIÓN", async () => {
    sessionActual = {
      user: { id: "user-escritura-1", email: ATACANTE, dpi: DPI_ATACANTE },
    };

    const res = await postJson("/profile/update", { dpi: DPI_VICTIMA });

    expect(res.status).toBe(200);
    const payload = argsDe("updateLead")?.[0] as Record<string, unknown>;
    expect(payload.dpi).toBe(DPI_ATACANTE);
    expect(payload.soloValidar).toBeUndefined();
  });

  // La comparación es contra `true` estricto: un `"true"` de texto o un `1`
  // son escritura real, no simulacro. Si no, la puerta del DPI del cuerpo se
  // abre con cualquier valor que JavaScript considere verdadero.
  it("un soloValidar que no es `true` estricto es escritura real", async () => {
    for (const valor of ["true", 1, {}]) {
      llamadas = [];
      sessionActual = {
        user: { id: "user-escritura-2", email: ATACANTE, dpi: DPI_ATACANTE },
      };

      await postJson("/profile/update", { dpi: DPI_VICTIMA, soloValidar: valor });

      const payload = argsDe("updateLead")?.[0] as Record<string, unknown>;
      expect(payload.dpi).toBe(DPI_ATACANTE);
      expect(payload.soloValidar).toBeUndefined();
    }
  });

  // ------------------------------------------------------------------
  // 3. CUENTA SIN DPI PREVIO: la primera captura
  // ------------------------------------------------------------------

  it("cuenta sin DPI previo: el simulacro llega al CRM con el DPI del cuerpo", async () => {
    sessionActual = {
      user: { id: "user-sin-dpi-1", email: ATACANTE, dpi: null },
    };

    const res = await postJson("/profile/update", {
      dpi: DPI_NUEVO,
      soloValidar: true,
    });

    // Antes contestaba 409 acá y el portal abortaba el cambio ENTERO: quien
    // no tenía DPI no podía registrarlo nunca.
    expect(res.status).toBe(200);
    expect(argsDe("updateLead")?.[0]).toMatchObject({
      dpi: DPI_NUEVO,
      soloValidar: true,
    });
  });

  it("cuenta sin DPI previo: la escritura real sigue dando 409", async () => {
    sessionActual = {
      user: { id: "user-sin-dpi-2", email: ATACANTE, dpi: null },
    };

    const res = await postJson("/profile/update", { dpi: DPI_NUEVO });

    expect(res.status).toBe(409);
    expect(argsDe("updateLead")).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // 4. LÍMITE DE INTENTOS (enumeración)
  // ------------------------------------------------------------------
  //
  // El simulacro contesta el motivo del rechazo —mora, duplicado, candado—,
  // así que sin tope cualquier cuenta del portal puede preguntar, DPI por
  // DPI, quién está en mora. El tope es por CUENTA y sólo sobre el simulacro.
  //
  // El número va a mano a propósito (la ruta lo declara en
  // `LIMITE_SIMULACRO_DPI`): si alguien lo baja, esta prueba avisa.
  const LIMITE = 15;

  it("el simulacro se corta al pasarse del límite, por cuenta", async () => {
    sessionActual = {
      user: { id: "user-limite-1", email: ATACANTE, dpi: DPI_ATACANTE },
    };

    for (let intento = 0; intento < LIMITE; intento++) {
      const res = await postJson("/profile/update", {
        dpi: `111111111111${intento % 10}`,
        soloValidar: true,
      });
      expect(res.status).toBe(200);
    }

    const cortado = await postJson("/profile/update", {
      dpi: DPI_VICTIMA,
      soloValidar: true,
    });

    expect(cortado.status).toBe(429);
    expect(llamadas.filter((l) => l.fn === "updateLead")).toHaveLength(LIMITE);
  });

  // 🔴 Un límite mal calibrado ya tumbó el login una vez. Este no puede
  // tumbar ni al vecino de cuenta ni al resto del perfil.
  it("el límite agotado de una cuenta no toca a otra", async () => {
    sessionActual = {
      user: { id: "user-limite-2", email: ATACANTE, dpi: DPI_ATACANTE },
    };
    for (let intento = 0; intento <= LIMITE; intento++) {
      await postJson("/profile/update", { dpi: DPI_NUEVO, soloValidar: true });
    }

    sessionActual = {
      user: { id: "user-limite-3", email: VICTIMA, dpi: DPI_VICTIMA },
    };
    const otra = await postJson("/profile/update", {
      dpi: DPI_NUEVO,
      soloValidar: true,
    });

    expect(otra.status).toBe(200);
  });

  it("el límite agotado no bloquea la escritura real ni el resto del perfil", async () => {
    sessionActual = {
      user: { id: "user-limite-4", email: ATACANTE, dpi: DPI_ATACANTE },
    };
    for (let intento = 0; intento <= LIMITE; intento++) {
      await postJson("/profile/update", { dpi: DPI_NUEVO, soloValidar: true });
    }

    const escritura = await postJson("/profile/update", {
      phone: "55555555",
      address: "una dirección",
    });
    const lectura = await pedir("/profile");

    expect(escritura.status).toBe(200);
    expect(lectura.status).toBe(200);
  });

  // El uso legítimo es UNA persona cambiando su DPI una vez, con reintentos
  // por corrección. Tres simulacros seguidos no pueden rozar el tope.
  it("no corta el uso legítimo: tres simulacros seguidos pasan", async () => {
    sessionActual = {
      user: { id: "user-legitimo-1", email: ATACANTE, dpi: DPI_ATACANTE },
    };

    for (let intento = 0; intento < 3; intento++) {
      const res = await postJson("/profile/update", {
        dpi: DPI_NUEVO,
        soloValidar: true,
      });
      expect(res.status).toBe(200);
    }
  });

  // ------------------------------------------------------------------
  // 5. RASTRO
  // ------------------------------------------------------------------

  it("anota el simulacro cuyo DPI no es el de la sesión", async () => {
    sessionActual = {
      user: { id: "user-rastro-1", email: ATACANTE, dpi: DPI_ATACANTE },
    };
    const aviso = spyOn(console, "warn").mockImplementation(() => {});

    try {
      await postJson("/profile/update", {
        dpi: DPI_VICTIMA,
        soloValidar: true,
      });

      expect(aviso).toHaveBeenCalled();
      const anotado = aviso.mock.calls.flat().join(" ");
      expect(anotado).toContain("user-rastro-1");
      // El DPI ajeno va enmascarado: el rastro sirve para ver el barrido, no
      // para dejar una lista de DPI de terceros en los logs.
      expect(anotado).not.toContain(DPI_VICTIMA);
      expect(anotado).toContain(DPI_VICTIMA.slice(-4));
    } finally {
      aviso.mockRestore();
    }
  });

  // 🔴 El DPI del cuerpo llega al log ANTES de que el CRM valide su formato, y
  // `trim()` solo saca espacio en blanco de las PUNTAS: un ESC, un NEL o un
  // salto de línea metido entre los últimos caracteres sobrevivía al recorte y
  // viajaba entero al `console.warn`. Con eso, el cuerpo parte la línea del
  // rastro en dos —inventando una entrada que nadie escribió— o la ensucia con
  // secuencias ANSI; y el rastro es justo lo que queda para reconstruir un
  // barrido de enumeración.
  const DPIS_ENVENENADOS = [
    // Parte la línea: el sufijo de 4 se lleva el salto de línea.
    { nombre: "salto de línea", dpi: "1234567890123ABC\nX99" },
    { nombre: "retorno de carro", dpi: "1234567890123ABC\r\rX9" },
    // Ensucia el flujo: ESC + secuencia ANSI dentro de los últimos 4.
    { nombre: "escape ANSI", dpi: "1234567890123\u001b[2J" },
    // No es espacio en blanco para `trim()`, pero muchos lectores de logs lo
    // tratan como fin de línea.
    { nombre: "NEL", dpi: "1234567890123AB\u0085X9" },
  ];

  it.each(DPIS_ENVENENADOS)(
    "el rastro no se parte ni se ensucia con un DPI del cuerpo que trae $nombre",
    async ({ dpi }) => {
      sessionActual = {
        user: { id: "user-rastro-envenenado", email: ATACANTE, dpi: DPI_ATACANTE },
      };
      const aviso = spyOn(console, "warn").mockImplementation(() => {});

      try {
        const res = await postJson("/profile/update", { dpi, soloValidar: true });
        expect(res.status).toBe(200);

        expect(aviso).toHaveBeenCalled();
        const anotado = aviso.mock.calls.flat().join(" ");

        // El efecto, no la llamada: lo que SALIÓ al log es una sola línea y no
        // trae ningún carácter de control.
        expect(anotado.split(/\r|\n|\u0085|\u2028|\u2029/)).toHaveLength(1);
        expect(anotado).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);

        // Y sigue siendo un rastro útil: el prefijo enmascarado se conserva.
        expect(anotado).toContain("dpi=****");
        expect(anotado).toContain("user-rastro-envenenado");
      } finally {
        aviso.mockRestore();
      }
    },
  );

  it("no anota nada cuando el simulacro valida el DPI de la propia sesión", async () => {
    sessionActual = {
      user: { id: "user-rastro-2", email: ATACANTE, dpi: DPI_ATACANTE },
    };
    const aviso = spyOn(console, "warn").mockImplementation(() => {});

    try {
      await postJson("/profile/update", {
        dpi: DPI_ATACANTE,
        soloValidar: true,
      });

      expect(aviso).not.toHaveBeenCalled();
    } finally {
      aviso.mockRestore();
    }
  });
});
