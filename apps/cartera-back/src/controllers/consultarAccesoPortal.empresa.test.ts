import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * La empresa NO se consulta contra sí misma.
 *
 * Aquí el envoltorio de solo lectura es el REAL —lo único sustituido es la base
 * y `fetch`— EN CUALQUIER ORDEN DE CARGA: ninguna suite de este repo publica un
 * `mock.module("../services/portalProvisioning")`, que es global al proceso y
 * volvía falsa esta misma frase cuando `consultarAccesoPortal.test.ts` corría
 * antes. Se prueba así porque lo que hay que probar es justo lo que el mock taparía: que
 * la decisión empresa-vs-persona sale de `decidirProvisionamiento` y NO se
 * reescribió en este controlador. Para una sociedad la cuenta del portal es la
 * de su REPRESENTANTE LEGAL, así que preguntar "¿tiene cuenta esta sociedad?"
 * se corta antes de salir a la red y contesta `omitida/es_empresa`.
 *
 * `fetch` se reemplaza por un espía que TIRA: si algún día la rama de empresa
 * dejara de cortar, la prueba lo dice en vez de salir a la red de verdad desde
 * la suite.
 */

// Estado compartido con `consultarAccesoPortal.test.ts`, que mockea la MISMA
// `../database/index`. `mock.module` es global al proceso y el controlador se
// enlaza una sola vez, así que si cada archivo mockeara contra su propia
// variable el que perdiera el orden de carga leería filas ajenas. Contra este
// objeto compartido, y con la misma forma exacta, cuál de los dos registros
// gane deja de importar. Reventar ante cualquier escritura es parte de esa
// forma: si este registro ganara recortado, la otra suite perdería su candado.
const estadoDb = ((globalThis as any).__accesoPortalDbFalsa ??= {
  filas: [] as unknown[],
  escrituras: [] as string[],
});

const dbFalsa = () => {
  const reventar = (operacion: string) => (): never => {
    estadoDb.escrituras.push(operacion);
    throw new Error(`ESCRITURA PROHIBIDA en una consulta: db.${operacion}`);
  };
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
 * EL MOCK VIVE SOLO DURANTE ESTAS PRUEBAS (mismo arreglo que
 * `consultarAccesoPortal.test.ts`, donde está la explicación larga).
 *
 * bun levanta el top-level de TODOS los archivos antes de correr ninguna
 * prueba y `mock.module` es global: manda el último que publicó. Sin este
 * paréntesis, `otorgarAccesoPortal.test.ts` y `provisionarCuentasPortal.test.ts`
 * —que publican un `portalProvisioning` de espías— dejaban a este archivo
 * hablando con SUS dobles y el encabezado de arriba mentía en la corrida por
 * directorio. Acá se publica lo nuestro en `beforeAll` y se devuelve en
 * `afterAll` lo que hubiera antes.
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

  // La afirmación del encabezado, comprobada en vez de prometida.
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

const fetchOriginal = globalThis.fetch;
const urlOriginal = process.env.AUTH_GOOGLE_URL;
const secretoOriginal = process.env.PORTAL_PROVISIONING_SECRET;

const salidas: { url: string; cuerpo: any }[] = [];

process.env.AUTH_GOOGLE_URL = "https://auth.test";
process.env.PORTAL_PROVISIONING_SECRET = "secreto-de-prueba";

globalThis.fetch = (async (url: any, init: any) => {
  salidas.push({ url: String(url), cuerpo: JSON.parse(String(init?.body ?? "{}")) });
  return Response.json({
    estado: "ya_tenia",
    usuarioEmail: "javier@ejemplo.com",
    resueltoPor: "dpi",
    advertencias: [],
    motivo: null,
  });
}) as typeof fetch;

afterAll(() => {
  if (provisioningPrevio) {
    const previo = provisioningPrevio;
    mock.module("../services/portalProvisioning", () => previo);
  }
  if (dbPrevia) {
    const previa = dbPrevia;
    mock.module("../database/index", () => previa);
  }
  globalThis.fetch = fetchOriginal;
  process.env.AUTH_GOOGLE_URL = urlOriginal;
  process.env.PORTAL_PROVISIONING_SECRET = secretoOriginal;
});

const llamar = async (id: string) => {
  const set: { status?: number } = {};
  const respuesta = (await consultarAccesoPortal({
    query: { inversionista_id: id },
    user: { role: "ADMIN" },
    set,
  } as never)) as Record<string, any>;
  return { set, respuesta };
};

describe("consultarAccesoPortal sobre una empresa", () => {
  beforeEach(() => {
    salidas.length = 0;
  });

  it("no pregunta por la sociedad: el acceso es del representante legal", async () => {
    estadoDb.filas = [
      {
        inversionista_id: 86,
        nombre: "Cube Investments S.A.",
        email: "contacto@cube.com",
        dpi: null,
        // Representante DISTINTO de la fila: es una empresa.
        dpi_rep_legal: "1573661970101",
      },
    ];

    const { respuesta } = await llamar("86");

    expect(respuesta).toEqual({
      estado: "omitida",
      usuarioEmail: null,
      resueltoPor: null,
      advertencias: [],
      motivo: "es_empresa",
    });
    // Ni una consulta a auth-google: no hay cuenta de la sociedad que buscar.
    expect(salidas).toHaveLength(0);
  });

  it("el autorrepresentado SÍ es persona, aunque traiga ceros a la izquierda", async () => {
    // Javier Kafie (187): `dpi=4036613`, `dpi_rep_legal='04036613'`. La regla
    // literal "tiene representante ⇒ es empresa" lo dejaría sin cuenta por un
    // cero. Se consulta contra `esEmpresaRepresentada`, no contra la presencia
    // del campo.
    estadoDb.filas = [
      {
        inversionista_id: 187,
        nombre: "Javier Kafie",
        email: "javier@ejemplo.com",
        dpi: 4036613,
        dpi_rep_legal: "04036613",
      },
    ];

    const { respuesta } = await llamar("187");

    expect(respuesta.estado).toBe("ya_tenia");
    expect(salidas).toHaveLength(1);
    expect(salidas[0].url).toBe(
      "https://auth.test/internal/provisioning/check-investor-account",
    );
    // La ruta de CONSULTA, nunca la que crea la cuenta.
    expect(salidas[0].url).not.toContain("ensure-investor-account");
    expect(salidas[0].cuerpo).toMatchObject({
      email: "javier@ejemplo.com",
      dpi: "4036613",
      inversionistaId: 187,
    });
  });
});
