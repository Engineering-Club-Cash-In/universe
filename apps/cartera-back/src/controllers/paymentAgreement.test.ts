import { beforeEach, describe, expect, it, mock } from "bun:test";

// ── Mocks de infraestructura ────────────────────────────────────────────────
// El módulo bajo prueba arrastra la base de datos, el router y otros
// controllers; acá solo interesa el contrato prepare/commit del convenio.

/** Updates registrados: { tabla implícita por orden, values } */
const updates: Array<Record<string, unknown>> = [];
/** Cola de resultados para cada db.select() en orden de ejecución. */
let selectQueue: unknown[][] = [];
/** Simula el update guardado del commit: false = 0 filas afectadas. */
let updateAffectsRows = true;

const makeSelect = () => {
  const rows = selectQueue.shift() ?? [];
  const conChain = Object.assign(Promise.resolve(rows), {
    limit: () => Promise.resolve(rows),
    orderBy: () => ({ limit: () => Promise.resolve(rows) }),
  });
  return { from: () => ({ where: () => conChain }) };
};

mock.module("../database", () => ({
  client: {},
  lockPool: { connect: mock(() => Promise.resolve({ query: mock(), release: mock() })) },
  db: {
    select: mock(() => makeSelect()),
    update: mock(() => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push(values);
          return Object.assign(Promise.resolve(), {
            returning: () =>
              Promise.resolve(updateAffectsRows ? [values] : []),
          });
        },
      }),
    })),
  },
}));

mock.module("./latefee", () => ({ createMora: mock(() => Promise.resolve()) }));
mock.module("./payments", () => ({
  getPagosDelMesActual: mock(() => Promise.resolve("0.00")),
}));
mock.module("../routers", () => ({ creditRouter: {} }));

const { prepararConvenioPayment, processConvenioPayment } = await import(
  "./paymentAgreement"
);

// ── Fixtures ────────────────────────────────────────────────────────────────
// Números del caso real que motivó el cambio (convenio 102 / crédito 72,
// 26-ago-2026): 6 cuotas de 553.07, un pago real acreditado.
const convenioBase = {
  convenio_id: 102,
  credito_id: 72,
  monto_total_convenio: "3318.45",
  cuota_mensual: "553.07",
  monto_pagado: "553.07",
  monto_pendiente: "2765.38",
  pagos_realizados: 1,
  pagos_pendientes: 5,
  numero_meses: 6,
  completado: false,
  activo: true,
};

const paramsBase = {
  credito_id: 72,
  monto_pago: 1240.68,
  creditoInfo: {} as never,
  pagoMetadata: { montoBoleta: "1240.68", registerBy: 1 },
} as never;

beforeEach(() => {
  updates.length = 0;
  selectQueue = [];
  updateAffectsRows = true;
});

describe("prepararConvenioPayment: calcular sin escribir", () => {
  it("no escribe NADA en la base — ni convenios_pago ni convenio_cuotas", async () => {
    selectQueue = [[{ ...convenioBase }]];

    const preparado = await prepararConvenioPayment(paramsBase);

    expect(preparado.commit).not.toBeNull();
    expect(updates).toHaveLength(0);
  });

  it("regresión convenio 102: N intentos rechazados (prepare sin commit) no inflan el convenio", async () => {
    // Antes del cambio, cada reintento rechazado por el guard
    // anti-sobreaplicación acreditaba 553.07 y una cuota fantasma: 4 retries
    // dejaron el convenio 5/6 con un solo pago real.
    for (let intento = 0; intento < 4; intento++) {
      selectQueue.push([{ ...convenioBase }]);
      await prepararConvenioPayment(paramsBase);
    }

    expect(updates).toHaveLength(0);
  });

  it("el preview topa el monto a la cuota mensual y proyecta los acumulados post-commit", async () => {
    selectQueue = [[{ ...convenioBase }]];

    const { resultado } = await prepararConvenioPayment(paramsBase);

    expect(resultado.success).toBe(true);
    expect(resultado.monto_aplicado).toBe("553.07");
    expect(resultado.pago_completo).toBe(true);
    expect(resultado.convenio?.monto_pagado).toBe("1106.14");
    expect(resultado.convenio?.monto_pendiente).toBe("2212.31");
    expect(resultado.convenio?.pagos_realizados).toBe(2);
    expect(resultado.convenio?.pagos_pendientes).toBe(4);
    expect(resultado.convenio?.completado).toBe(false);
    expect(resultado.convenio?.activo).toBe(true);
  });

  it("sin convenio activo: resultado success=false y commit null", async () => {
    selectQueue = [[]];

    const preparado = await prepararConvenioPayment(paramsBase);

    expect(preparado.commit).toBeNull();
    expect(preparado.resultado.success).toBe(false);
    expect(preparado.resultado.monto_aplicado).toBe("0");
    expect(updates).toHaveLength(0);
  });
});

describe("commit: persiste exactamente lo previsualizado", () => {
  it("acredita convenios_pago y marca la cuota completada del convenio", async () => {
    selectQueue = [
      [{ ...convenioBase }],
      // cuotas pendientes del convenio que el marcado va a consumir
      [{ cuota_convenio_id: 525, numero_cuota: 2 }],
    ];

    const { commit } = await prepararConvenioPayment(paramsBase);
    await commit!();

    expect(updates).toHaveLength(2);
    const [updConvenio, updCuotas] = updates;
    expect(updConvenio.monto_pagado).toBe("1106.14");
    expect(updConvenio.monto_pendiente).toBe("2212.31");
    expect(updConvenio.pagos_realizados).toBe(2);
    expect(updConvenio.pagos_pendientes).toBe(4);
    expect(updConvenio.completado).toBe(false);
    expect(updConvenio.activo).toBe(true);
    expect(updCuotas.fecha_pago).toBeInstanceOf(Date);
  });

  it("pago parcial (no completa cuota): acredita el acumulado sin marcar cuotas", async () => {
    selectQueue = [[{ ...convenioBase }]];

    const { commit } = await prepararConvenioPayment({
      ...(paramsBase as Record<string, unknown>),
      monto_pago: 200,
    } as never);
    await commit!();

    expect(updates).toHaveLength(1);
    expect(updates[0].monto_pagado).toBe("753.07");
    expect(updates[0].pagos_realizados).toBe(1);
  });

  it("convenio cambiado entre prepare y commit (P2 Codex #1482): el update guardado no matchea y NO se marcan cuotas", async () => {
    selectQueue = [[{ ...convenioBase }]];

    const { commit } = await prepararConvenioPayment(paramsBase);
    // Otro escritor (updateConvenioStatus, reversa) tocó el convenio: el
    // update condicionado afecta 0 filas.
    updateAffectsRows = false;
    await commit!();

    // Solo el intento de acreditación; nada de convenio_cuotas.
    expect(updates).toHaveLength(1);
  });

  it("última cuota: el commit cierra el convenio (completado=true, activo=false)", async () => {
    selectQueue = [
      [
        {
          ...convenioBase,
          monto_pagado: "2765.35",
          monto_pendiente: "553.10",
          pagos_realizados: 5,
          pagos_pendientes: 1,
        },
      ],
      [{ cuota_convenio_id: 529, numero_cuota: 6 }],
    ];

    const { resultado, commit } = await prepararConvenioPayment({
      ...(paramsBase as Record<string, unknown>),
      monto_pago: 553.1,
    } as never);
    await commit!();

    expect(resultado.convenio?.completado).toBe(true);
    expect(updates[0].completado).toBe(true);
    expect(updates[0].activo).toBe(false);
  });
});

describe("processConvenioPayment: wrapper calcular+commitear (comportamiento histórico)", () => {
  it("escribe en un solo paso lo mismo que prepare+commit", async () => {
    selectQueue = [
      [{ ...convenioBase }],
      [{ cuota_convenio_id: 525, numero_cuota: 2 }],
    ];

    const resultado = await processConvenioPayment(paramsBase);

    expect(resultado.success).toBe(true);
    expect(resultado.monto_aplicado).toBe("553.07");
    expect(updates).toHaveLength(2);
    expect(updates[0].pagos_realizados).toBe(2);
  });

  it("sin convenio activo no escribe nada", async () => {
    selectQueue = [[]];

    const resultado = await processConvenioPayment(paramsBase);

    expect(resultado.success).toBe(false);
    expect(updates).toHaveLength(0);
  });
});
