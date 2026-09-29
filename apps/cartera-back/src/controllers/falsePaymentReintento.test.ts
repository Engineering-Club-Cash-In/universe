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
};

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
    if (nombre === "pagos_credito_inversionistas_espejo") return estado.espejoDelPago;
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
          return estado.inversionistasDelEspejo;
        },
      },
      pagos_credito: { findFirst: async () => ({ pago_id: PAGO_ID, cuota: "0" }) },
      creditos: { findFirst: async () => ({ credito_id: CREDITO_ID }) },
    },
  } as any;
};

let motor: any = crearMotor();

mock.module("../database/index", () => ({
  db: new Proxy({}, { get: (_t, p) => motor[p] }),
  client: {},
  lockPool: {
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release: () => {},
    }),
  },
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
