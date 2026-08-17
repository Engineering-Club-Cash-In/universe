import { beforeEach, describe, expect, it, mock } from "bun:test";

const updates: Record<string, unknown>[] = [];
let selectResults: unknown[][] = [];
const insertInvestors = mock(() => Promise.resolve());

const tx = {
  execute: mock(() => Promise.resolve()),
  select: mock(() => ({
    from: () => ({
      where: () => {
        const rows = selectResults.shift() ?? [];
        return Object.assign(Promise.resolve(rows), {
          limit: () => Promise.resolve(rows),
        });
      },
    }),
  })),
  update: mock(() => ({
    set: (values: Record<string, unknown>) => ({
      where: () => {
        updates.push(values);
        return Object.assign(Promise.resolve(), {
          returning: () => Promise.resolve([{ pago_id: 30 }]),
        });
      },
    }),
  })),
};

const lockQuery = mock(() => Promise.resolve());
const lockRelease = mock(() => {});

mock.module("../database", () => ({
  client: {},
  db: {
    transaction: mock(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  },
  // Pool de advisory locks: el wrapper withPaymentAdvisoryLock pide una
  // conexión, lockea/deslockea y la libera.
  lockPool: {
    connect: mock(() =>
      Promise.resolve({ query: lockQuery, release: lockRelease }),
    ),
  },
}));

mock.module("../utils/withAuditContext", () => ({
  setCapitalSource: mock(() => Promise.resolve()),
  // El mock es global al proceso de bun test: sin estos exports, cualquier
  // módulo cargado después que importe withAuditContext/withCapitalContext
  // (p. ej. updateCredit.ts) no enlaza y su archivo de tests entero muere en
  // la suite completa (mismo veneno de caché que el sweep de client:{}).
  withAuditContext: mock((_userId: unknown, fn: (t: typeof tx) => unknown) => fn(tx)),
  withCapitalContext: mock(
    (_userId: unknown, _source: unknown, _motivo: unknown, fn: (t: typeof tx) => unknown) =>
      fn(tx),
  ),
}));

mock.module("./payments", () => ({
  insertPagosCreditoInversionistasV2: insertInvestors,
}));

const { revalidatePayment } = await import("./revalidatePayment");

const pagoCompletoPendiente = {
  pago_id: 30,
  credito_id: 10,
  cuota_id: 20,
  validationStatus: "pending",
  paymentFalse: false,
  monto_aplicado: "100.00",
  abono_capital: "80.00",
  abono_interes: "17.86",
  abono_iva_12: "2.14",
  abono_seguro: "0",
  abono_gps: "0",
  membresias_pago: "0",
  mora: "0",
  otros: "0",
  pagoConvenio: "0",
};

const credito = {
  credito_id: 10,
  numero_credito_sifco: "CRED-10",
  capital: "1000.00",
  cuota: "100.00",
  porcentaje_interes: "1",
  seguro_10_cuotas: "0",
  gps: "0",
  membresias_pago: "0",
};

describe("revalidatePayment", () => {
  beforeEach(() => {
    updates.length = 0;
    selectResults = [[pagoCompletoPendiente], [credito], []];
    tx.execute.mockClear();
    insertInvestors.mockClear();
    lockQuery.mockClear();
    lockRelease.mockClear();
  });

  it("restaura la cuota cerrada al revalidar el pago completo reversado", async () => {
    const set = { status: 0 };

    await revalidatePayment({
      body: { credito_id: 10, pago_id: 30 },
      set,
    });

    expect(set.status).toBe(200);
    expect(updates.some((values) => values.pagado === true)).toBeTrue();
    expect(insertInvestors).toHaveBeenCalledWith(30, 10, undefined, tx);
    // El lock por crédito ahora se toma/libera en el pool dedicado, no con
    // pg_advisory_xact_lock dentro de la transacción.
    expect(lockQuery).toHaveBeenCalledWith("SELECT pg_advisory_lock($1, $2)", [
      8765, 10,
    ]);
    expect(lockQuery).toHaveBeenCalledWith(
      "SELECT pg_advisory_unlock($1, $2)",
      [8765, 10],
    );
    expect(lockRelease).toHaveBeenCalledTimes(1);
  });

  it("valida un pago parcial sin cerrar la cuota", async () => {
    const pagoParcial = {
      ...pagoCompletoPendiente,
      monto_aplicado: "60.00",
      abono_capital: "50.00",
      abono_interes: "8.93",
      abono_iva_12: "1.07",
    };
    selectResults = [
      [pagoParcial],
      [credito],
      [pagoParcial],
    ];
    const set = { status: 0 };

    await revalidatePayment({
      body: { credito_id: 10, pago_id: 30 },
      set,
    });

    expect(set.status).toBe(200);
    expect(
      updates.some((values) => values.validationStatus === "validated"),
    ).toBeTrue();
    expect(updates.some((values) => values.pagado === true)).toBeFalse();
  });

  it("no cuenta dos veces el pago actual devuelto por el query de la cuota", async () => {
    const pagoParcial = {
      ...pagoCompletoPendiente,
      monto_aplicado: "60.00",
      abono_capital: "50.00",
      abono_interes: "8.93",
      abono_iva_12: "1.07",
    };
    selectResults = [[pagoParcial], [credito], [pagoParcial]];
    const set = { status: 0 };

    await revalidatePayment({
      body: { credito_id: 10, pago_id: 30 },
      set,
    });

    expect(set.status).toBe(200);
    expect(updates.some((values) => values.pagado === true)).toBeFalse();
  });

  it("cierra la cuota cuando el pago actual y un hermano validated cubren el monto", async () => {
    const pagoParcial = {
      ...pagoCompletoPendiente,
      monto_aplicado: "40.00",
      abono_capital: "30.00",
      abono_interes: "8.93",
      abono_iva_12: "1.07",
    };
    selectResults = [
      [pagoParcial],
      [credito],
      [
        {
          ...pagoCompletoPendiente,
          pago_id: 29,
          validationStatus: "validated",
          monto_aplicado: "60.00",
          abono_capital: "50.00",
          abono_interes: "8.93",
          abono_iva_12: "1.07",
        },
      ],
    ];
    const set = { status: 0 };

    await revalidatePayment({
      body: { credito_id: 10, pago_id: 30 },
      set,
    });

    expect(set.status).toBe(200);
    expect(updates.some((values) => values.pagado === true)).toBeTrue();
  });

  it("no cierra la cuota contando un pago hermano que sigue pending", async () => {
    const pagoActual = {
      ...pagoCompletoPendiente,
      monto_aplicado: "40.00",
      abono_capital: "30.00",
      abono_interes: "8.93",
      abono_iva_12: "1.07",
    };
    selectResults = [[pagoActual], [credito], []];
    const set = { status: 0 };

    await revalidatePayment({
      body: { credito_id: 10, pago_id: 30 },
      set,
    });

    expect(set.status).toBe(200);
    expect(updates.some((values) => values.pagado === true)).toBeFalse();
  });

  it("no vuelve a descontar del capital los pagos hermanos ya validados", async () => {
    const pagoActual = {
      ...pagoCompletoPendiente,
      monto_aplicado: "40.00",
      abono_capital: "30.00",
      abono_interes: "8.93",
      abono_iva_12: "1.07",
    };
    selectResults = [
      [pagoActual],
      [{ ...credito, capital: "950.00" }],
      [
        {
          ...pagoCompletoPendiente,
          pago_id: 29,
          validationStatus: "validated",
          monto_aplicado: "60.00",
          abono_capital: "50.00",
          abono_interes: "8.93",
          abono_iva_12: "1.07",
        },
      ],
    ];

    await revalidatePayment({
      body: { credito_id: 10, pago_id: 30 },
      set: { status: 0 },
    });

    expect(updates.find((values) => values.capital)?.capital).toBe("920");
  });
});
