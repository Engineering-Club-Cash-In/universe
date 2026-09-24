import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La CONSULTA del acceso al portal. Solo lectura.
 *
 * Lo que esta suite protege son dos cosas distintas:
 *
 *  1. Que no se abra más que la escritura. La respuesta revela el CORREO de la
 *     cuenta del portal, así que exige el mismo `role === "ADMIN"` que
 *     `otorgarAccesoPortal`. Una consulta que enseña a qué buzón cae la
 *     contraseña no puede ser más pública que el botón que la manda.
 *
 *  2. Que NO escriba. La llama el CRM en cada carga de pantalla: si por aquí se
 *     colara el camino que crea cuentas, ver una ficha mandaría una contraseña.
 *
 * CÓMO SE SOSTIENE ESO SIN ROMPER A LAS DEMÁS
 * -------------------------------------------
 * `portalProvisioning` NO se mockea. Se corre el módulo REAL y lo único
 * sustituido es `fetch`, que es donde se ve la verdad que importa: a qué
 * endpoint de auth-google sale la consulta. El espía REVIENTA si alguna vez
 * apunta a `ensure-investor-account` —el camino que crea la cuenta y manda la
 * contraseña—, así que el candado sigue siendo explosivo, pero vive dentro de
 * este archivo.
 *
 * Antes acá se publicaba `mock.module("../services/portalProvisioning")` con un
 * `provisionarInversionista` que tiraba. `mock.module` es GLOBAL al proceso: esa
 * bomba se la comía `portalProvisioning.test.ts` —la suite que cuida el código
 * que decide si sale una contraseña— y le tumbaba 21 pruebas en cuanto las dos
 * corrían juntas. Un candado de una suite no puede detonar en otra.
 *
 * El mock de la base sí queda, y es idéntico —misma forma, mismo estado
 * compartido— al de `consultarAccesoPortal.empresa.test.ts`: los dos archivos
 * mockean `../database/index` y `mock.module` es global, así que gane el que
 * gane el orden de carga, el que queda publicado sirve a los dos y REVIENTA
 * igual ante cualquier insert/update/delete.
 */

// Estado compartido con `consultarAccesoPortal.empresa.test.ts`: los dos
// publican el MISMO mock de la base contra este mismo objeto, así que cuál de
// los dos registros gane deja de importar.
const estadoDb = ((globalThis as any).__accesoPortalDbFalsa ??= {
  filas: [] as unknown[],
  escrituras: [] as string[],
});

const dbFalsa = () => {
  const reventar = (operacion: string) => (): never => {
    estadoDb.escrituras.push(operacion);
    throw new Error(`ESCRITURA PROHIBIDA en una consulta: db.${operacion}`);
  };
  // La única consulta del controlador termina en `.limit()`.
  const cadena: any = {
    where: () => cadena,
    orderBy: () => cadena,
    limit: () => Promise.resolve(estadoDb.filas),
  };
  return {
    client: {},
    lockPool: {},
    db: {
      select: () => ({ from: () => cadena }),
      insert: reventar("insert"),
      update: reventar("update"),
      delete: reventar("delete"),
      execute: reventar("execute"),
      transaction: reventar("transaction"),
    },
  };
};

mock.module("../database/index", () => dbFalsa());

const { consultarAccesoPortal } = await import("./consultarAccesoPortal");

/**
 * EL MOCK VIVE SOLO DURANTE ESTAS PRUEBAS.
 *
 * bun levanta el top-level de TODOS los archivos antes de correr ninguna
 * prueba, y `mock.module` es global al proceso: manda el ÚLTIMO que publicó, no
 * el archivo que está corriendo. Por eso, en la corrida por directorio,
 * `otorgarAccesoPortal.test.ts` y `provisionarCuentasPortal.test.ts` —que
 * publican un `portalProvisioning` de espías— dejaban a este archivo hablando
 * con SUS dobles, y la frase "el envoltorio es el REAL" era falsa.
 *
 * Acá se publica lo nuestro en `beforeAll` y en `afterAll` se DEVUELVE lo que
 * hubiera antes, con las mismas funciones (los espías de la otra suite son los
 * mismos objetos, así que sus pruebas siguen viéndolos). Cada archivo manda
 * dentro de sus pruebas y sale sin dejar nada puesto. Republicar sí reenlaza a
 * quien ya importó: `mock.module` actualiza el namespace en vivo.
 */
const provisioningReal = (await import(
	`${"../services/portalProvisioning.ts"}?real`
)) as typeof import("../services/portalProvisioning");

let provisioningPrevio: Record<string, unknown> | null = null;
let dbPrevia: Record<string, unknown> | null = null;

beforeAll(async () => {
  provisioningPrevio = { ...(await import("../services/portalProvisioning")) };
  dbPrevia = { ...(await import("../database/index")) };

  mock.module("../services/portalProvisioning", () => ({ ...provisioningReal }));
  mock.module("../database/index", () => dbFalsa());

  // El encabezado AFIRMA que el envoltorio que corre es el real. Esto lo
  // comprueba en vez de confiar: si algún día otro archivo lograra dejar su
  // doble puesto, sale un rojo que lo nombra.
  const publicado: any = await import("../services/portalProvisioning");
  if (
    publicado.consultarAccesoInversionista !==
    provisioningReal.consultarAccesoInversionista
  ) {
    throw new Error(
      "portalProvisioning no es el real durante estas pruebas: otra suite dejó su doble publicado.",
    );
  }
});

afterAll(() => {
  if (provisioningPrevio) {
    const previo = provisioningPrevio;
    mock.module("../services/portalProvisioning", () => previo);
  }
  if (dbPrevia) {
    const previa = dbPrevia;
    mock.module("../database/index", () => previa);
  }
});

const fetchOriginal = globalThis.fetch;
const urlOriginal = process.env.AUTH_GOOGLE_URL;
const secretoOriginal = process.env.PORTAL_PROVISIONING_SECRET;

process.env.AUTH_GOOGLE_URL = "https://auth.test";
process.env.PORTAL_PROVISIONING_SECRET = "secreto-de-prueba";

const salidas: { url: string; cuerpo: any }[] = [];
let cuerpoDeAuth: Record<string, unknown> = {};
// auth-google no siempre contesta 200 ni contesta siquiera: estas dos palancas
// son lo que permite ver qué `motivo` sale de aquí cuando algo va mal, que es
// justo donde antes salía una cadena interna.
let statusDeAuth = 200;
let reventarFetchCon: Error | null = null;

globalThis.fetch = (async (url: any, init: any) => {
  const destino = String(url);
  // El camino que CREA cuentas y manda contraseñas. Si el controlador llegara
  // aquí, la consulta de una pantalla sería un envío de credenciales.
  if (destino.includes("ensure-investor-account")) {
    estadoDb.escrituras.push("ensure-investor-account");
    throw new Error(
      "ESCRITURA PROHIBIDA en una consulta: ensure-investor-account",
    );
  }
  salidas.push({ url: destino, cuerpo: JSON.parse(String(init?.body ?? "{}")) });
  if (reventarFetchCon) throw reventarFetchCon;
  return Response.json(cuerpoDeAuth, { status: statusDeAuth });
}) as typeof fetch;

afterAll(() => {
  globalThis.fetch = fetchOriginal;
  process.env.AUTH_GOOGLE_URL = urlOriginal;
  process.env.PORTAL_PROVISIONING_SECRET = secretoOriginal;
});

const fila = (over: Record<string, unknown> = {}) => ({
  inversionista_id: 7,
  nombre: "Ana Pérez",
  email: "ana@ejemplo.com",
  dpi: 1573661970101,
  dpi_rep_legal: null,
  ...over,
});

const respuestaDeAuth = () => ({
  estado: "ya_tenia",
  usuarioEmail: "ana@ejemplo.com",
  resueltoPor: "dpi",
  correo: {
    enviado: false,
    plantilla: null,
    redirigido: false,
    destinatarioReal: null,
  },
  advertencias: [] as string[],
  motivo: null,
});

// `user` NO tiene default: un parámetro con valor por defecto se activa también
// cuando se pasa `undefined` a propósito, y con eso la prueba de "llamada sin
// usuario" terminaba corriendo como ADMIN y pasando por la razón equivocada.
const llamar = async (
  query: Record<string, unknown>,
  ...resto: [user?: Record<string, unknown>]
) => {
  const user = resto.length === 0 ? { role: "ADMIN" } : resto[0];
  const set: { status?: number } = {};
  const respuesta = await consultarAccesoPortal({ query, user, set } as never);
  return { set, respuesta: respuesta as Record<string, any> };
};

describe("consultarAccesoPortal", () => {
  beforeEach(() => {
    estadoDb.filas = [];
    estadoDb.escrituras.length = 0;
    salidas.length = 0;
    cuerpoDeAuth = respuestaDeAuth();
    statusDeAuth = 200;
    reventarFetchCon = null;
  });

  it("le cierra la puerta a quien no es ADMIN", async () => {
    estadoDb.filas = [fila()];

    const { set, respuesta } = await llamar(
      { inversionista_id: "7" },
      { role: "SELLER" },
    );

    expect(set.status).toBe(403);
    expect(respuesta.error).toBe("forbidden");
    // Y ni siquiera se preguntó: el correo de la cuenta no se toca antes de
    // saber quién pregunta.
    expect(salidas).toHaveLength(0);
    expect(respuesta.usuarioEmail).toBeUndefined();
  });

  it("le cierra la puerta a una llamada sin usuario", async () => {
    estadoDb.filas = [fila()];

    const { set } = await llamar({ inversionista_id: "7" }, undefined);

    expect(set.status).toBe(403);
    expect(salidas).toHaveLength(0);
  });

  it("rechaza un id que no es un entero positivo", async () => {
    for (const valor of ["0", "-3", "abc", "1.5", undefined]) {
      salidas.length = 0;
      const { set } = await llamar({ inversionista_id: valor });
      expect(set.status).toBe(400);
      expect(salidas).toHaveLength(0);
    }
  });

  it("404 cuando el inversionista no existe: no se inventa un 'no tiene cuenta'", async () => {
    estadoDb.filas = [];

    const { set, respuesta } = await llamar({ inversionista_id: "7" });

    expect(set.status).toBe(404);
    expect(respuesta.error).toBe("inversionista_no_encontrado");
    expect(salidas).toHaveLength(0);
  });

  it("devuelve lo que contestó el envoltorio de solo lectura", async () => {
    estadoDb.filas = [fila()];
    cuerpoDeAuth = {
      ...respuestaDeAuth(),
      advertencias: ["cuenta_sin_rol_de_inversionista"],
    };

    const { set, respuesta } = await llamar({ inversionista_id: "7" });

    expect(set.status).toBeUndefined();
    // `correo` no viaja: la consulta nunca manda ninguno.
    expect(respuesta).toEqual({
      estado: "ya_tenia",
      usuarioEmail: "ana@ejemplo.com",
      resueltoPor: "dpi",
      advertencias: ["cuenta_sin_rol_de_inversionista"],
      motivo: null,
    });
  });

  it("pregunta por la RUTA DE CONSULTA, con los datos de la fila", async () => {
    estadoDb.filas = [fila()];

    await llamar({ inversionista_id: "7" });

    expect(salidas).toHaveLength(1);
    expect(salidas[0].url).toBe(
      "https://auth.test/internal/provisioning/check-investor-account",
    );
    expect(salidas[0].cuerpo).toMatchObject({
      email: "ana@ejemplo.com",
      dpi: "1573661970101",
      inversionistaId: 7,
    });
  });

  it("le pasa la fila ENTERA, con el representante legal incluido", async () => {
    // `decidirProvisionamiento` decide empresa-vs-persona con `dpi_rep_legal`.
    // Recortar la fila aquí convertiría a toda empresa en una persona y la
    // consulta contestaría por la sociedad, no por su representante. Como el
    // envoltorio es el REAL, si el campo no llegara la sociedad saldría a la
    // red como persona en vez de cortarse en `omitida/es_empresa`.
    estadoDb.filas = [fila({ dpi: null, dpi_rep_legal: "04036613" })];

    const { respuesta } = await llamar({ inversionista_id: "7" });

    expect(respuesta.estado).toBe("omitida");
    expect(respuesta.motivo).toBe("es_empresa");
    expect(salidas).toHaveLength(0);
  });

  // ─── El `motivo` que se publica ─────────────────────────────────────────
  //
  // Esta respuesta la sirve el CRM en CADA carga de la pantalla del
  // inversionista, a las once familias de rol que pasan su guard. El
  // envoltorio embuda cualquier excepción inesperada en
  // `motivo: String(error?.message ?? error)` y además deja pasar el `motivo`
  // que venga en el cuerpo de auth-google: los dos son texto sin vocabulario
  // acotado, y los dos salían tal cual.

  it("un mensaje de excepción crudo NO sale en el motivo", async () => {
    estadoDb.filas = [fila()];
    reventarFetchCon = new Error(
      "getaddrinfo ENOTFOUND auth-google.internal",
    );

    const { set, respuesta } = await llamar({ inversionista_id: "7" });

    // Sigue siendo un 200 con `fallo`: el desenlace no se esconde, el texto sí.
    expect(set.status).toBeUndefined();
    expect(respuesta.estado).toBe("fallo");
    expect(respuesta.motivo).toBe("no_reconocido");
    expect(JSON.stringify(respuesta)).not.toContain("ENOTFOUND");
    expect(JSON.stringify(respuesta)).not.toContain("auth-google.internal");
  });

  it("un motivo que inventa auth-google tampoco sale", async () => {
    estadoDb.filas = [fila()];
    cuerpoDeAuth = {
      ...respuestaDeAuth(),
      estado: "fallo",
      motivo: "columna users.foo no existe en public",
    };

    const { respuesta } = await llamar({ inversionista_id: "7" });

    expect(respuesta.motivo).toBe("no_reconocido");
  });

  it("los motivos que cartera sí nombra viajan tal cual", async () => {
    for (const motivo of [
      "sin_nombre",
      "sin_correo",
      "es_empresa",
      "provisionamiento_no_configurado",
      "timeout",
    ]) {
      estadoDb.filas = [fila()];
      cuerpoDeAuth = { ...respuestaDeAuth(), estado: "fallo", motivo };

      const { respuesta } = await llamar({ inversionista_id: "7" });

      expect(respuesta.motivo).toBe(motivo);
    }
  });

  it("el status con que contestó auth-google sí viaja: son tres dígitos", async () => {
    estadoDb.filas = [fila()];
    statusDeAuth = 503;

    const { respuesta } = await llamar({ inversionista_id: "7" });

    expect(respuesta.estado).toBe("fallo");
    expect(respuesta.motivo).toBe("http_503");
  });

  it("un 'http_' que no sea un status de tres dígitos no pasa", async () => {
    estadoDb.filas = [fila()];
    cuerpoDeAuth = {
      ...respuestaDeAuth(),
      estado: "fallo",
      motivo: "http_no me conecto a http://interno:5432",
    };

    const { respuesta } = await llamar({ inversionista_id: "7" });

    expect(respuesta.motivo).toBe("no_reconocido");
    expect(JSON.stringify(respuesta)).not.toContain("interno:5432");
  });

  it("sin motivo sigue siendo null, no 'no_reconocido'", async () => {
    estadoDb.filas = [fila()];
    cuerpoDeAuth = { ...respuestaDeAuth(), motivo: null };

    const { respuesta } = await llamar({ inversionista_id: "7" });

    expect(respuesta.motivo).toBeNull();
  });

  it("un motivo que ni siquiera es texto se colapsa igual", async () => {
    estadoDb.filas = [fila()];
    cuerpoDeAuth = {
      ...respuestaDeAuth(),
      estado: "fallo",
      motivo: { stack: "en /srv/cartera-back/src/services/portalProvisioning.ts" },
    };

    const { respuesta } = await llamar({ inversionista_id: "7" });

    expect(respuesta.motivo).toBe("no_reconocido");
    expect(JSON.stringify(respuesta)).not.toContain("/srv/");
  });

  it("NO escribe nada: ni base ni provisionamiento", async () => {
    estadoDb.filas = [fila()];

    await llamar({ inversionista_id: "7" });

    expect(estadoDb.escrituras).toEqual([]);
  });

  // Los mocks prueban la corrida de hoy; esto protege la DECISIÓN. Sin ello,
  // cambiar `consultarAccesoInversionista` por `provisionarInversionista`
  // pasaría en verde el día que alguien "unifique" los dos caminos.
  it("el código ni siquiera nombra al camino que escribe", () => {
    const fuente = readFileSync(
      join(import.meta.dir, "consultarAccesoPortal.ts"),
      "utf8",
    );

    expect(fuente).toContain("consultarAccesoInversionista");
    expect(fuente).not.toContain("provisionarInversionista");
    expect(fuente).not.toContain("db.insert");
    expect(fuente).not.toContain("db.update");
    expect(fuente).not.toContain("db.delete");
    // El mismo candado que la escritura (otorgarAccesoPortal.ts:50).
    expect(fuente).toContain('user?.role !== "ADMIN"');
  });
});
