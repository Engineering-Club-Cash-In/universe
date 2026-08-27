import { beforeEach, describe, expect, it, mock } from "bun:test";

let transactionCalls = 0;
let globalInsertCalls = 0;
let txInsertCalls = 0;

const creditRow = { credito_id: 123 };
const initialInstallment = [{ cuota_id: 1 }];
const regularInstallments = [
  { cuota_id: 2, numero_cuota: 1, fecha_vencimiento: "2026-06-15" },
];

const createInsertBuilder = (scope: "global" | "tx") => {
  const callNumber = scope === "global" ? ++globalInsertCalls : ++txInsertCalls;

  return {
    values: () => {
      if (callNumber === 6) {
        throw new Error("payments insert failed");
      }

      return {
        returning: () => {
          if (callNumber === 1) return Promise.resolve([creditRow]);
          if (callNumber === 4) return Promise.resolve(initialInstallment);
          if (callNumber === 5) return Promise.resolve(regularInstallments);
          return Promise.resolve([]);
        },
      };
    },
  };
};

mock.module("../database", () => {
  const tx = {
    insert: () => createInsertBuilder("tx"),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  };

  return {
    client: {},
    db: {
      transaction: async (callback: (transactionClient: typeof tx) => Promise<unknown>) => {
        transactionCalls += 1;
        return callback(tx);
      },
      insert: () => createInsertBuilder("global"),
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    },
  };
});

mock.module("./users", () => ({
  findOrCreateUserByName: mock(() => Promise.resolve({ usuario_id: 77 })),
}));

mock.module("./advisor", () => ({
  findOrCreateAdvisorByName: mock(() => Promise.resolve({ asesor_id: 1 })),
  getAsesorConMenorCarga: mock(() => Promise.resolve(1)),
}));

mock.module("@cci/email", () => ({
  sendNewCreditNotification: mock(() => Promise.resolve()),
}));

const { insertCredit, findOrCreateAseguradora, generatePaymentDates } = await import("./createCredit");

type Executor = Parameters<typeof findOrCreateAseguradora>[1];

const validCreditBody = {
  usuario: "Cliente prueba",
  numero_credito_sifco: "TEST-001",
  capital: 1000,
  porcentaje_interes: 10,
  seguro_10_cuotas: 0,
  gps: 0,
  observaciones: "",
  no_poliza: "",
  como_se_entero: "CRM",
  plazo: 1,
  cuota: 1120,
  dia_pago_mensual: 15,
  membresias_pago: 0,
  porcentaje_royalti: 0,
  royalti: 0,
  categoria: "Vehiculo",
  nit: "CF",
  otros: 0,
  reserva: 0,
  asesor_id: 1,
  inversionistas: [
    {
      inversionista_id: 10,
      monto_aportado: 1000,
      porcentaje_cash_in: 100,
      porcentaje_inversion: 0,
    },
  ],
};

describe("insertCredit", () => {
  beforeEach(() => {
    transactionCalls = 0;
    globalInsertCalls = 0;
    txInsertCalls = 0;
  });

  it("ejecuta la creación del crédito dentro de una transacción", async () => {
    const set = { status: 200 };

    await insertCredit({ body: validCreditBody, set });

    expect(transactionCalls).toBe(1);
    expect(globalInsertCalls).toBe(0);
    expect(txInsertCalls).toBeGreaterThan(0);
    expect(set.status).toBe(500);
  });
});

describe("findOrCreateAseguradora", () => {
  it("devuelve el id existente sin insertar", async () => {
    const executor = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ id: 7 }]) }),
        }),
      }),
      insert: () => {
        throw new Error("no debería insertar si ya existe");
      },
    } as unknown as Executor;

    const id = await findOrCreateAseguradora("GyT", executor);
    expect(id).toBe(7);
  });

  it("crea y devuelve el id nuevo cuando no existe", async () => {
    const executor = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([]) }),
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([{ id: 42 }]),
          }),
        }),
      }),
    } as unknown as Executor;

    const id = await findOrCreateAseguradora("MAPFRE", executor);
    expect(id).toBe(42);
  });

  it("re-busca cuando el insert choca por carrera (onConflictDoNothing)", async () => {
    let selectCount = 0;
    const executor = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              selectCount += 1;
              return Promise.resolve(selectCount === 1 ? [] : [{ id: 99 }]);
            },
          }),
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      }),
    } as unknown as Executor;

    const id = await findOrCreateAseguradora("Universales", executor);
    expect(id).toBe(99);
  });
});

describe("generatePaymentDates", () => {
  // Regresión del P2 de revisión (rollover de fin de mes, PR #1263): CRM
  // calcula el ajuste con su propio "hoy" y cartera-back generaba el
  // calendario con OTRO "hoy" propio, minutos/segundos después por la
  // llamada HTTP. Si esa llamada cruza la medianoche del último día del
  // mes, cada lado usaba un mes distinto para el prorrateo. Pasar
  // fechaReferencia hace que cartera-back use EXACTAMENTE el mismo "hoy"
  // que ya usó el CRM para calcular el ajuste.
  it("con fechaReferencia a las 23:59:59 del último día del mes, agenda la cuota 1 en el mes siguiente correcto (no en el que caería si leyera su propio reloj después de medianoche)", () => {
    // 31-ene-2026 23:59:59 — el ejemplo exacto de la revisión.
    const fechaReferencia = new Date(2026, 0, 31, 23, 59, 59);
    const fechas = generatePaymentDates(1, 15, fechaReferencia);

    // fechas[0] es "hoy"; fechas[1] es la cuota 1.
    expect(fechas[1]).toBe("2026-02-15");
  });

  it("respeta el clamp de fin de mes usando el mes de fechaReferencia, no el que tocaría cruzando a marzo", () => {
    // Elegido 31, pero febrero 2026 (no bisiesto) solo tiene 28 días.
    const fechaReferencia = new Date(2026, 0, 31, 23, 59, 59);
    const fechas = generatePaymentDates(1, 31, fechaReferencia);

    expect(fechas[1]).toBe("2026-02-28");
  });

  it("sin fechaReferencia, sigue funcionando como antes (no revienta ni la exige)", () => {
    const fechas = generatePaymentDates(2, 15);
    expect(fechas.length).toBe(3); // "hoy" + 2 cuotas
  });
});
