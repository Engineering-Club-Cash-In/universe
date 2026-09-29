/**
 * ANULAR UNA BOLETA ES REINTENTABLE, Y ESO HAY QUE EJERCERLO, NO DECLARARLO.
 *
 * ── El defecto que estas pruebas fijan ──────────────────────────────────────
 * Con la anulación ANTES de los espejos, `anularPagoYRestituirMoraSerializado`
 * commitea (boleta falsa, rubros devueltos, mora restituida) y recién después
 * corre `insertPagosCreditoInversionistas`. Si ESE paso fallaba, el router
 * devolvía 400, el operador reintentaba, la salida temprana veía
 * `paymentFalse = true` y devolvía 200 `updatedCount: 0`. Los espejos no se
 * escribían NUNCA y ninguna otra ruta los repara: éxito aparente sobre un
 * estado a medias. Con el orden viejo esto se recuperaba solo, porque los
 * espejos iban primero y su fallo dejaba el pago sin marcar.
 *
 * `pagos_credito_inversionistas_espejo` NO tiene unicidad por
 * (pago, inversionista) —verificado contra el esquema: solo la PK por `id`, el
 * índice de liquidación y los dos parciales de "no liquidado"; la unicidad
 * `uk_pago_inversionista` es de la tabla VIEJA—, y de hecho ya hay pares
 * repetidos legítimos: el espejo se regenera por período. Así que no se puede
 * protegerse con un "si ya existe, saltear" de la base: el guard de existencia
 * por `pago_id` es lo único que hay.
 *
 * ── Por qué este archivo cambió de forma ────────────────────────────────────
 * La versión anterior NO ejecutaba `falsePayment` ni una vez: leía
 * `payments.ts` con `Bun.file(...).text()` y comparaba índices de substring.
 * Sus cuatro casos verdes eran perfectamente compatibles con el defecto de
 * arriba —el orden que afirmaban era justamente el que lo causaba—. Un lint no
 * prueba una invariante de recuperación. Ahora se ejerce la función.
 *
 * `./anularPagoMora` entra mockeado a propósito: el cuerpo de la anulación
 * tiene sus propias pruebas (`anularPagoMora.test.ts`, y la traza del candado
 * en `anularPagoMoraCarrera.test.ts`). Lo que se prueba ACÁ es la
 * ORQUESTACIÓN de `falsePayment`: qué corre antes de qué, qué se saltea el
 * reintento y qué repara.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";

process.env.SUPABASE_DB_URL ??= "postgresql://nadie:nadie@127.0.0.1:1/ninguna";

const PAGO_ID = 77;
const CREDITO_ID = 5;

const estado = {
  /** Lo que la base dice hoy de la boleta. */
  paymentFalse: false,
  /** Filas de `creditos_inversionistas_espejo` del crédito (la precondición). */
  espejoDelCredito: [] as unknown[],
  /** Filas de `pagos_credito_inversionistas_espejo` de ESTE pago (el guard). */
  espejoDelPago: [] as unknown[],
  /** Cuántas veces se ENTRÓ al paso de espejos (su primera consulta). */
  pasosDeEspejo: 0,
  /** Si es >0, el paso de espejos falla esa cantidad de veces (error transitorio). */
  fallosTransitorios: 0,
  /** Cuántas veces se llamó a la anulación (tiene que ser 1, nunca 2). */
  anulaciones: 0,
  /** Qué inversionistas ve el espejo del crédito cuando el paso corre bien. */
  inversionistasDelEspejo: [] as unknown[],
  /** Cuánto tarda el paso de espejos (para poder solaparlo con otra llamada). */
  demoraDelPaso: 0,
  /**
   * Si es true, el paso de espejos ESCRIBE su fila al pasar, como el insert de
   * verdad. Sin esto el fake miente: la segunda llamada nunca vería lo que
   * escribió la primera.
   */
  escribeAlPasar: false,
};

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** El único inversionista es CUBE: `excludeCube` lo filtra y el paso sale limpio. */
const SOLO_CUBE = [
  { inversionista_id: 86, credito_id: CREDITO_ID, cuota_inversionista: "0" },
];

mock.module("./anularPagoMora", () => ({
  anularPagoYRestituirMoraSerializado: async () => {
    estado.anulaciones++;
    // La anulación COMMITEA: a partir de acá la boleta está falsa pase lo que
    // pase más adelante. Eso es exactamente lo que hace recuperable —o no— al
    // reintento.
    estado.paymentFalse = true;
    return 1;
  },
}));

/**
 * Motor de base falso DESPACHADO POR TABLA, no por posición.
 *
 * A propósito: la cola posicional de `falsePaymentRubros.test.ts` se rompe con
 * cualquier consulta que se agregue en el medio, aunque el comportamiento siga
 * bien. Acá cada tabla contesta lo suyo, así que la prueba sobrevive a que se
 * agregue una lectura y solo se pone roja cuando cambia lo que importa.
 */
const tablaDe = (t: any) =>
  t?.[Symbol.for("drizzle:Name")] ?? t?._?.name ?? t?.[Symbol.for("drizzle:BaseName")] ?? "";

const crearMotor = () => {
  const cadena = (tabla: { nombre: string }): any =>
    new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "then") {
            return (ok: any, err: any) =>
              Promise.resolve(resolver(tabla.nombre)).then(ok, err);
          }
          return (...args: any[]) => {
            if (prop === "from" || prop === "update" || prop === "insert") {
              tabla.nombre = tablaDe(args[0]);
            }
            return cadena(tabla);
          };
        },
      },
    );

  const resolver = (nombre: string) => {
    if (nombre === "creditos_inversionistas_espejo") return estado.espejoDelCredito;
    // Copia ordenada por `id` DESC: es lo que devuelve la consulta real, que
    // pide `orderBy(desc(id)).limit(1)` para leer la marca de agua.
    if (nombre === "pagos_credito_inversionistas_espejo")
      return [...(estado.espejoDelPago as { id: number }[])].sort((a, b) => b.id - a.id);
    if (nombre === "pagos_credito") return [{ paymentFalse: estado.paymentFalse }];
    // CUBE, para que el paso de espejos salga por su `return` limpio.
    if (nombre === "inversionistas")
      return [{ nombre: "Cube Investments S.A.", status: "ACTIVO" }];
    return [];
  };

  return {
    select: () => cadena({ nombre: "" }),
    update: (t: any) => cadena({ nombre: tablaDe(t) }),
    insert: (t: any) => cadena({ nombre: tablaDe(t) }),
    delete: (t: any) => cadena({ nombre: tablaDe(t) }),
    execute: () => Promise.reject(new Error("sin BD en tests")),
    transaction: async (cb: any) => cb(motor),
    query: {
      // La PRIMERA consulta de `insertPagosCreditoInversionistas`. Contarla es
      // contar cuántas veces se ENTRÓ al paso de espejos, que es justo lo que
      // el reintento tiene que volver a hacer (o saltear).
      creditos_inversionistas_espejo: {
        findMany: async () => {
          estado.pasosDeEspejo++;
          if (estado.fallosTransitorios > 0) {
            estado.fallosTransitorios--;
            throw new Error("connection terminated unexpectedly");
          }
          if (estado.demoraDelPaso > 0) await dormir(estado.demoraDelPaso);
          if (estado.escribeAlPasar) {
            const ids = (estado.espejoDelPago as { id: number }[]).map((f) => f.id);
            estado.espejoDelPago.push({ id: Math.max(900, ...ids) + 1 });
          }
          return estado.inversionistasDelEspejo;
        },
      },
      pagos_credito: { findFirst: async () => ({ pago_id: PAGO_ID, cuota: "0" }) },
      creditos: { findFirst: async () => ({ credito_id: CREDITO_ID }) },
    },
  } as any;
};

let motor: any = crearMotor();

/** Candado de juguete: no serializa nada. Sirve para todo lo secuencial. */
const lockPoolTrivial = {
  connect: async () => ({
    query: async () => ({ rows: [] }),
    release: () => {},
  }),
};

/**
 * Candado que SÍ serializa, como el `FOR NO KEY UPDATE` de verdad sobre la
 * fila del crédito: el `BEGIN` del segundo en llegar espera a que el primero
 * haga COMMIT/ROLLBACK. Es lo único que hace honesta una prueba de carrera.
 */
const crearLockPoolSerializado = () => {
  let cola: Promise<void> = Promise.resolve();
  return {
    connect: async () => {
      let soltar: () => void = () => {};
      const anterior = cola;
      cola = new Promise<void>((r) => {
        soltar = r;
      });
      let tomado = false;
      return {
        query: async (sqlTexto: string) => {
          if (sqlTexto === "BEGIN") {
            await anterior;
            tomado = true;
            return { rows: [] };
          }
          if (sqlTexto === "COMMIT" || sqlTexto === "ROLLBACK") {
            if (tomado) soltar();
            return { rows: [] };
          }
          return { rows: [] };
        },
        release: () => {
          if (!tomado) soltar();
        },
      };
    },
  };
};

let lockPoolActual: any = lockPoolTrivial;

mock.module("../database/index", () => ({
  db: new Proxy({}, { get: (_t, p) => motor[p] }),
  client: {},
  lockPool: { connect: (...args: any[]) => lockPoolActual.connect(...args) },
}));

const { falsePayment } = await import("./payments");

beforeEach(() => {
  estado.paymentFalse = false;
  estado.espejoDelCredito = [{ credito_id: CREDITO_ID }];
  estado.espejoDelPago = [];
  estado.pasosDeEspejo = 0;
  estado.fallosTransitorios = 0;
  estado.anulaciones = 0;
  estado.inversionistasDelEspejo = SOLO_CUBE;
  estado.demoraDelPaso = 0;
  estado.escribeAlPasar = false;
  lockPoolActual = lockPoolTrivial;
  motor = crearMotor();
});

describe("el reintento repara los espejos que el primer intento no llegó a escribir", () => {
  it("si el paso de espejos falla, el reintento SÍ los escribe", async () => {
    estado.fallosTransitorios = 1;

    // Primer intento: la anulación commitea y el paso de espejos revienta.
    await expect(falsePayment(PAGO_ID, CREDITO_ID)).rejects.toThrow(
      "connection terminated unexpectedly",
    );
    expect(estado.anulaciones).toBe(1);
    expect(estado.paymentFalse).toBe(true);
    expect(estado.pasosDeEspejo).toBe(1);

    // Reintento: entra por la salida temprana —la boleta ya está falsa— y
    // TIENE que volver a pasar por los espejos. Sin la red de seguridad se iba
    // con un 200 y el espejo en blanco para siempre.
    const resultado = await falsePayment(PAGO_ID, CREDITO_ID);

    expect(resultado.updatedCount).toBe(0);
    expect(resultado.message).toBe("Payment was already marked as false");
    // 👇 EL DEFECTO EN UNA LÍNEA: sin el arreglo esto queda en 1.
    expect(estado.pasosDeEspejo).toBe(2);
    // Y no se vuelve a anular: la mora y los rubros no se tocan de nuevo.
    expect(estado.anulaciones).toBe(1);
  });

  it("no duplica los espejos cuando ya están escritos", async () => {
    await falsePayment(PAGO_ID, CREDITO_ID);
    expect(estado.pasosDeEspejo).toBe(1);

    // Ahora la base YA tiene las filas de espejo de este pago.
    estado.espejoDelPago = [{ id: 900 }];

    await falsePayment(PAGO_ID, CREDITO_ID);

    // No vuelve a entrar: `pagos_credito_inversionistas_espejo` no tiene
    // unicidad por (pago, inversionista), así que volver a entrar DUPLICA filas
    // sin liquidar, y aguas abajo duplica montos.
    expect(estado.pasosDeEspejo).toBe(1);
    expect(estado.anulaciones).toBe(1);
  });

  it("un tercer intento tampoco repite una vez que el espejo quedó escrito", async () => {
    estado.fallosTransitorios = 1;
    await expect(falsePayment(PAGO_ID, CREDITO_ID)).rejects.toThrow();

    await falsePayment(PAGO_ID, CREDITO_ID);
    expect(estado.pasosDeEspejo).toBe(2);

    estado.espejoDelPago = [{ id: 900 }];
    await falsePayment(PAGO_ID, CREDITO_ID);

    expect(estado.pasosDeEspejo).toBe(2);
    expect(estado.anulaciones).toBe(1);
  });
});

describe("un crédito sin espejo de inversionistas no se anula a medias", () => {
  it("falla ANTES de marcar la boleta, y la boleta queda intacta", async () => {
    estado.espejoDelCredito = [];

    await expect(falsePayment(PAGO_ID, CREDITO_ID)).rejects.toMatchObject({
      code: "CREDIT_WITHOUT_INVESTOR_MIRROR",
    });

    // Lo único que importa: NO se anuló nada.
    expect(estado.anulaciones).toBe(0);
    expect(estado.paymentFalse).toBe(false);
    expect(estado.pasosDeEspejo).toBe(0);
  });

  it("el mensaje le dice al operador qué pasa y qué hacer", async () => {
    estado.espejoDelCredito = [];

    // Nada de "Failed to mark payment as false": el 400 genérico hacía que el
    // operador reintentara para siempre una anulación que nunca iba a salir.
    await expect(falsePayment(PAGO_ID, CREDITO_ID)).rejects.toThrow(
      /no tiene inversionistas en el espejo[\s\S]*No se anuló nada/,
    );
  });

  it("reintentar tampoco lo anula: el estado sigue igual", async () => {
    estado.espejoDelCredito = [];

    await expect(falsePayment(PAGO_ID, CREDITO_ID)).rejects.toThrow();
    await expect(falsePayment(PAGO_ID, CREDITO_ID)).rejects.toThrow();

    expect(estado.anulaciones).toBe(0);
    expect(estado.paymentFalse).toBe(false);
  });
});

describe("el orden: la anulación va ANTES de los espejos", () => {
  it("en el camino feliz se anula una vez y se escriben los espejos una vez", async () => {
    const resultado = await falsePayment(PAGO_ID, CREDITO_ID);

    expect(resultado.updatedCount).toBe(1);
    expect(estado.anulaciones).toBe(1);
    expect(estado.pasosDeEspejo).toBe(1);
  });

  it("si la ANULACIÓN falla, los espejos ni se intentan y no queda nada escrito", async () => {
    // El otro lado del orden, el que sale gratis: la anulación no commiteó
    // nada, así que el reintento arranca limpio.
    const { anularPagoYRestituirMoraSerializado } = await import("./anularPagoMora");
    const original = anularPagoYRestituirMoraSerializado;
    mock.module("./anularPagoMora", () => ({
      anularPagoYRestituirMoraSerializado: async () => {
        estado.anulaciones++;
        throw new Error("la restitución de mora falló");
      },
    }));

    try {
      await expect(falsePayment(PAGO_ID, CREDITO_ID)).rejects.toThrow(
        "la restitución de mora falló",
      );
      expect(estado.pasosDeEspejo).toBe(0);
      expect(estado.paymentFalse).toBe(false);
    } finally {
      mock.module("./anularPagoMora", () => ({
        anularPagoYRestituirMoraSerializado: original,
      }));
    }
  });
});

describe("dos clics SOLAPADOS no duplican el espejo", () => {
  /**
   * Los ocho casos de arriba son secuenciales: la segunda llamada empieza
   * cuando la primera ya terminó. Eso NO ejerce el defecto real, que es de
   * concurrencia: A commitea la anulación y todavía está escribiendo los
   * espejos cuando entra B (segundo clic del asesor, o el reintento impaciente).
   *
   * Con el chequeo de existencia AFUERA del candado, B leía «no hay filas»
   * mientras A todavía no había insertado, hacía fila, y escribía un SEGUNDO
   * juego: filas duplicadas sin liquidar, que aguas abajo duplican montos.
   * No hace falta ningún fallo transitorio — alcanza un doble clic normal.
   *
   * El `lockPool` de esta prueba serializa de verdad, como el
   * `FOR NO KEY UPDATE` sobre la fila del crédito. Con el chequeo adentro del
   * candado, B toma el candado recién cuando A lo soltó, y para entonces ve
   * las filas de A.
   */
  it("B entra mientras A escribe, y el espejo se escribe UNA sola vez", async () => {
    lockPoolActual = crearLockPoolSerializado();
    estado.escribeAlPasar = true;
    estado.demoraDelPaso = 60; // A sigue adentro del candado cuando entra B

    const a = falsePayment(PAGO_ID, CREDITO_ID);
    await dormir(20); // A ya commiteó la anulación y está en el paso de espejos
    const b = falsePayment(PAGO_ID, CREDITO_ID);

    const resultados = await Promise.allSettled([a, b]);
    expect(resultados.every((r) => r.status === "fulfilled")).toBe(true);

    // 👇 EL DEFECTO EN DOS LÍNEAS: sin el arreglo esto da 2 y 2.
    expect(estado.pasosDeEspejo).toBe(1);
    expect(estado.espejoDelPago.length).toBe(1);
    // Y la anulación, como siempre, una sola vez.
    expect(estado.anulaciones).toBe(1);
  });

  /**
   * El contraveneno del arreglo del camino normal: ahí el guard NO puede ser
   * "¿hay filas de este pago?", porque un pago que era válido hasta hace un
   * instante bien puede tener filas de espejo VIEJAS Y LEGÍTIMAS —la
   * regeneración por período llama a la misma función sobre pagos vivos—. Con
   * ese guard, anular un pago ya espejado se saltearía su propia escritura:
   * plata que FALTA, que es peor que plata duplicada. Por eso lo que se guarda
   * es una marca de agua.
   */
  it("las filas viejas del espejo no le impiden a la anulación escribir las suyas", async () => {
    estado.escribeAlPasar = true;
    estado.espejoDelPago = [{ id: 900 }]; // de la regeneración por período

    const resultado = await falsePayment(PAGO_ID, CREDITO_ID);

    expect(resultado.updatedCount).toBe(1);
    expect(estado.pasosDeEspejo).toBe(1);
    expect(estado.espejoDelPago.length).toBe(2);
  });
});
