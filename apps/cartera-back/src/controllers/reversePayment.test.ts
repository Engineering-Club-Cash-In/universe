import { beforeEach, describe, expect, mock, test } from "bun:test";

const syntheticEnvironment = {
  SUPABASE_DB_URL: "postgresql://127.0.0.1:1/synthetic",
  RESEND_API_KEY: "synthetic-test-key",
  EMAIL_DOMAIN: "example.invalid",
} as const;
const previousEnvironment = Object.fromEntries(
  Object.keys(syntheticEnvironment).map((key) => [key, process.env[key]]),
) as Record<keyof typeof syntheticEnvironment, string | undefined>;
Object.assign(process.env, syntheticEnvironment);

const { createReversePayment, reversePayment } = await import("./reversePayment");
const { createCarteraStructuredLogger } = await import("../utils/structuredLogger");
const { pagos_credito } = await import("../database/db/schema");
for (const key of Object.keys(syntheticEnvironment) as Array<keyof typeof syntheticEnvironment>) {
  const previous = previousEnvironment[key];
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
}

describe("reversePayment observability contract", () => {
  test("preserves invalid-schema HTTP 400 and emits one safe rejection", async () => {
    const lines: string[] = [];
    const logger = createCarteraStructuredLogger({
      environment: "staging",
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      sink: (line) => lines.push(line),
    });
    const set = { status: 0 };
    const response = await reversePayment({ body: {}, set, telemetryLogger: logger });

    expect(set.status).toBe(400);
    expect(response).toEqual(expect.objectContaining({ message: "Validation failed", errors: expect.any(Object) }));
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(event).toEqual(expect.objectContaining({
      event: "payment.reversal",
      outcome: "rejected",
      previous_payment_state: "unknown",
      credit_updated: false,
      investments_reversed: false,
      manual_action_required: false,
      reason_code: "schema_invalid",
    }));
    for (const key of ["credito_id", "pago_id", "factura_id", "uuid", "monto", "message", "error", "stack"]) {
      expect(event).not.toHaveProperty(key);
    }
  });

  test("a broken clock and sink do not alter the validation response", async () => {
    const logger = createCarteraStructuredLogger({ sink: () => { throw new Error("synthetic sink failure"); } });
    const originalNow = Date.now;
    Date.now = () => { throw new Error("synthetic clock failure"); };
    try {
      const set = { status: 0 };
      const response = await reversePayment({ body: null, set, telemetryLogger: logger });
      expect(set.status).toBe(400);
      expect(response).toEqual(expect.objectContaining({ message: "Validation failed" }));
    } finally {
      Date.now = originalNow;
    }
  });
});

type ReversePaymentDependencies = NonNullable<Parameters<typeof createReversePayment>[0]>;

const pendingPayment = {
  pago_id: 30,
  credito_id: 10,
  cuota_id: null,
  validationStatus: "pending",
  registerBy: "synthetic-test",
  mora: "0",
  pagoConvenio: "0",
  pagado: false,
  capital_restante: "100",
  interes_restante: "10",
  iva_12_restante: "1.2",
  seguro_restante: "0",
  gps_restante: "0",
  membresias: "0",
  abono_capital: "0",
  abono_interes: "0",
  abono_iva_12: "0",
  abono_seguro: "0",
  abono_gps: "0",
  membresias_pago: "0",
  monto_boleta: "0",
};
const activeCredit = {
  creditos: {
    credito_id: 10,
    usuario_id: 20,
    statusCredit: "ACTIVO",
    capital: "1000",
    cuota_interes: "10",
    iva_12: "1.2",
    deudatotal: "1011.2",
    porcentaje_interes: "1",
    seguro_10_cuotas: "0",
    gps: "0",
    membresias_pago: "0",
    cuota: "100",
  },
  usuarios: { usuario_id: 20 },
};
const user = { usuario_id: 20, saldo_a_favor: "0" };

type RecordedUpdate = {
  table: unknown;
  payload: Record<string, unknown>;
  where?: unknown;
};

function createTransactionTx(
  payment: Record<string, unknown> = pendingPayment,
  recordedUpdates: RecordedUpdate[] = [],
  /**
   * Cuántas filas tiene la cuota del pago. La reversa lo consulta con un
   * `COUNT(*)` para decidir entre BORRAR la fila (hay hermanas) o resetearla
   * (es la única); el harness lo responde por la forma del SELECT y no por su
   * posición en la cola, que cambia con cada paso nuevo de la reversa.
   */
  filasEnLaCuota = 1,
  /** Cláusulas WHERE con las que la reversa pidió ese `COUNT(*)`. */
  recordedCountWheres: unknown[] = [],
) {
  const selectResults: unknown[][] = [[payment], [activeCredit], [user], []];
  const takeRows = () => {
    const rows = selectResults.shift() ?? [];
    return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
  };
  const updateWhere = () =>
    Object.assign(Promise.resolve([]), {
      returning: () => Promise.resolve([]),
    });
  const takeCount = (clause?: unknown) => {
    recordedCountWheres.push(clause);
    const rows = [{ count: filasEnLaCuota }];
    return Object.assign(Promise.resolve(rows), {
      limit: () => Promise.resolve(rows),
      for: () => Promise.resolve(rows),
    });
  };
  return {
    select: mock((fields?: Record<string, unknown>) => ({
      from: () => ({
        innerJoin: () => ({ where: takeRows }),
        where: fields && "count" in fields ? takeCount : takeRows,
      }),
    })),
    update: mock((table: unknown) => ({
      set: (payload: Record<string, unknown>) => {
        const recorded: RecordedUpdate = { table, payload };
        recordedUpdates.push(recorded);
        return {
          where: (clause: unknown) => {
            recorded.where = clause;
            return updateWhere();
          },
        };
      },
    })),
    delete: mock(() => ({
      where: () =>
        Object.assign(Promise.resolve([]), {
          returning: () => Promise.resolve([]),
        }),
    })),
    // `setCapitalSource` (rama de pago YA aplicado) emite un SET de sesión.
    execute: mock(() => Promise.resolve([])),
  };
}

function createPersistenceHarness(
  reverseInvestors: ReversePaymentDependencies["reverseInvestors"],
  payment: Record<string, unknown> = pendingPayment,
  recordedUpdates: RecordedUpdate[] = [],
  filasEnLaCuota = 1,
  recordedCountWheres: unknown[] = [],
) {
  const tx = createTransactionTx(
    payment,
    recordedUpdates,
    filasEnLaCuota,
    recordedCountWheres,
  );
  const runTransaction = mock(async (callback: (value: typeof tx) => Promise<unknown>) => {
    await callback(tx);
    throw new Error("synthetic later transaction failure");
  });
  const handler = createReversePayment({
    runTransaction: runTransaction as unknown as ReversePaymentDependencies["runTransaction"],
    reverseInvestors,
    reverseCapitalPayment: mock(() => Promise.resolve(undefined)) as unknown as ReversePaymentDependencies["reverseCapitalPayment"],
    // Lock identidad: acá no hay concurrencia que serializar y el real
    // abriría conexión al lockPool.
    withCreditLock: ((_creditoId: number, fn: () => Promise<unknown>) =>
      fn()) as ReversePaymentDependencies["withCreditLock"],
    // El refresco de proyección corre DESPUÉS del commit; en este harness la
    // transacción revienta antes, así que nunca debería llamarse.
    refrescarProyeccion: mock(() =>
      Promise.resolve({ corrio: true as const }),
    ) as unknown as ReversePaymentDependencies["refrescarProyeccion"],
  });
  return { handler, runTransaction };
}

describe("reversePayment global-persistence evidence", () => {
  let lines: string[];
  let logger: ReturnType<typeof createCarteraStructuredLogger>;

  beforeEach(() => {
    lines = [];
    logger = createCarteraStructuredLogger({
      environment: "staging",
      clock: () => new Date("2026-08-24T00:00:00.000Z"),
      sink: (line) => lines.push(line),
    });
  });

  test("keeps an investor no-op followed by a transaction failure as an ordinary failure", async () => {
    const reverseInvestors = mock(async (
      _creditoId: number,
      _pagoId: number,
      _onPersisted?: () => void,
    ) => []);
    const { handler } = createPersistenceHarness(
      reverseInvestors as unknown as ReversePaymentDependencies["reverseInvestors"],
    );
    const set = { status: 0 };

    const response = await handler({
      body: { credito_id: 10, pago_id: 30 },
      set,
      telemetryLogger: logger,
    });

    expect(reverseInvestors).toHaveBeenCalledWith(10, 30, expect.any(Function));
    expect(set.status).toBe(500);
    expect(response).toEqual({
      message: "Internal server error",
      error: "synthetic later transaction failure",
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event: "payment.reversal",
      outcome: "failed",
      manual_action_required: false,
      error_code: "unknown",
    });
  });

  test("preserves actual investor-write evidence when a later investor operation fails", async () => {
    const reverseInvestors = mock(async (
      _creditoId: number,
      _pagoId: number,
      onPersisted?: () => void,
    ) => {
      onPersisted?.();
      throw new Error("synthetic later investor failure");
    });
    const { handler } = createPersistenceHarness(
      reverseInvestors as unknown as ReversePaymentDependencies["reverseInvestors"],
    );
    const set = { status: 0 };

    const response = await handler({
      body: { credito_id: 10, pago_id: 30 },
      set,
      telemetryLogger: logger,
    });

    expect(reverseInvestors).toHaveBeenCalledWith(10, 30, expect.any(Function));
    expect(set.status).toBe(500);
    expect(response).toEqual({
      message: "Internal server error",
      error: "synthetic later investor failure",
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event: "payment.reversal",
      outcome: "partially_completed",
      manual_action_required: true,
      reason_code: "local_state_inconsistent",
    });
  });
});

describe("reversePayment limpia fecha_aplicado", () => {
  const noopInvestors = mock(async (
    _creditoId: number,
    _pagoId: number,
    _onPersisted?: () => void,
  ) => []) as unknown as ReversePaymentDependencies["reverseInvestors"];

  async function reversarYCapturarResetDelPago(
    payment: Record<string, unknown>,
  ) {
    const recordedUpdates: RecordedUpdate[] = [];
    const { handler } = createPersistenceHarness(
      noopInvestors,
      payment,
      recordedUpdates,
    );

    await handler({
      body: { credito_id: 10, pago_id: 30 },
      set: { status: 0 },
      telemetryLogger: createCarteraStructuredLogger({ sink: () => {} }),
    });

    // El reset de la fila es el único UPDATE sobre pagos_credito que devuelve
    // el pago a `no_required`; el resto de UPDATEs de la reversa van a otras
    // tablas (ajuste_fecha_ideal_pago, creditos, usuarios, cuotas_credito).
    return recordedUpdates.filter(
      (update) =>
        update.table === pagos_credito &&
        update.payload.validationStatus === "no_required",
    );
  }

  test("deja fecha_aplicado en null al resetear una cuota que estaba pagada", async () => {
    const resets = await reversarYCapturarResetDelPago({
      ...pendingPayment,
      pagado: true,
      validationStatus: "validated",
    });

    expect(resets).toHaveLength(1);
    expect(resets[0]?.payload).toMatchObject({
      monto_aplicado: "0",
      fecha_pago: null,
      fecha_aplicado: null,
    });
  });

  test("deja fecha_aplicado en null al resetear el único parcial de la cuota", async () => {
    const resets = await reversarYCapturarResetDelPago(pendingPayment);

    expect(resets).toHaveLength(1);
    expect(resets[0]?.payload).toMatchObject({
      monto_aplicado: "0",
      fecha_pago: null,
      fecha_aplicado: null,
    });
  });
});

/**
 * El saldo de una cuota vive REPLICADO en todas sus filas vivas (insertPayment
 * estampa los `nuevo_*_restante` con `WHERE cuota_id = X AND credito_id = Y AND
 * paymentFalse = false`). Si la reversa devuelve los restantes sólo en la fila
 * que revierte, las hermanas se quedan con el saldo POSTERIOR al pago revertido:
 * el pago siguiente distribuye contra ese saldo subestimado y cierra la cuota
 * corta (crédito 9234: cuota 1 de Q2,998.48 cerrada con Q1,000.00 cobrados y
 * Q1,998.48 estampados en la cuota 2).
 *
 * Por eso lo que se verifica acá no es "se escribió el valor" sino DÓNDE: el
 * UPDATE de restantes tiene que ir filtrado por cuota + crédito + vivas, no por
 * `pago_id`.
 */
function describirWhere(clause: unknown) {
  const columnas: string[] = [];
  const valores: unknown[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node.name === "string" && node.table) columnas.push(node.name);
    else if ("value" in node && !Array.isArray(node.value)) valores.push(node.value);
    if (Array.isArray(node.queryChunks)) node.queryChunks.forEach(walk);
  };
  walk(clause);
  return { columnas, valores };
}

const LLAVES_RESTANTES = [
  "capital_restante",
  "interes_restante",
  "iva_12_restante",
  "seguro_restante",
  "gps_restante",
  "membresias",
] as const;

/** El UPDATE que replica el saldo trae SÓLO los seis restantes y nada más. */
function esReplicaDeRestantes(update: RecordedUpdate) {
  const llaves = Object.keys(update.payload);
  return (
    update.table === pagos_credito &&
    llaves.length === LLAVES_RESTANTES.length &&
    LLAVES_RESTANTES.every((llave) => llaves.includes(llave))
  );
}

describe("reversePayment replica el saldo restaurado a toda la cuota", () => {
  const noopInvestors = mock(async (
    _creditoId: number,
    _pagoId: number,
    _onPersisted?: () => void,
  ) => []) as unknown as ReversePaymentDependencies["reverseInvestors"];

  // Pago de una cuota real: cobró 500 de capital, 80 de interés, 9.6 de IVA,
  // 245 de seguro, 0 de GPS y 100 de membresías, y dejó sus restantes en 0.
  const pagoDeCuota = {
    ...pendingPayment,
    cuota_id: 55,
    capital_restante: "0",
    interes_restante: "0",
    iva_12_restante: "0",
    seguro_restante: "0",
    gps_restante: "0",
    membresias: "0",
    abono_capital: "500",
    abono_interes: "80",
    abono_iva_12: "9.6",
    abono_seguro: "245",
    abono_gps: "0",
    membresias_pago: "100",
  };

  async function reversarYCapturarReplicas(
    payment: Record<string, unknown>,
    filasEnLaCuota: number,
  ) {
    const recordedUpdates: RecordedUpdate[] = [];
    const { handler } = createPersistenceHarness(
      noopInvestors,
      payment,
      recordedUpdates,
      filasEnLaCuota,
    );

    await handler({
      body: { credito_id: 10, pago_id: 30 },
      set: { status: 0 },
      telemetryLogger: createCarteraStructuredLogger({ sink: () => {} }),
    });

    return recordedUpdates.filter(esReplicaDeRestantes);
  }

  test("cuota con 3 filas: el saldo restaurado va a TODAS las filas vivas, no sólo a la revertida", async () => {
    // La fila revertida se BORRA (hay hermanas), así que si el saldo no se
    // replica el restante restaurado se pierde entero: las hermanas siguen
    // diciendo "esta cuota ya no debe nada".
    const replicas = await reversarYCapturarReplicas(pagoDeCuota, 3);

    expect(replicas).toHaveLength(1);
    expect(replicas[0]?.payload).toEqual({
      capital_restante: "500",
      interes_restante: "80",
      iva_12_restante: "9.6",
      seguro_restante: "245",
      gps_restante: "0",
      membresias: "100",
    });

    const { columnas, valores } = describirWhere(replicas[0]?.where);
    expect(columnas).toEqual(["cuota_id", "credito_id", "paymentFalse"]);
    expect(valores).toEqual([55, 10, false]);
    // Si estuviera filtrado por pago_id volveríamos al defecto original.
    expect(columnas).not.toContain("pago_id");
  });

  test("cuota con 1 sola fila: se replica el mismo saldo que la fila reseteada", async () => {
    const replicas = await reversarYCapturarReplicas(pagoDeCuota, 1);

    expect(replicas).toHaveLength(1);
    expect(replicas[0]?.payload).toMatchObject({
      capital_restante: "500",
      seguro_restante: "245",
      membresias: "100",
    });
    const { valores } = describirWhere(replicas[0]?.where);
    expect(valores).toEqual([55, 10, false]);
  });

  test("pago que ESTABA pagado: también deja el saldo parejo en la cuota", async () => {
    const replicas = await reversarYCapturarReplicas(
      { ...pagoDeCuota, pagado: true, validationStatus: "validated" },
      3,
    );

    expect(replicas).toHaveLength(1);
    expect(replicas[0]?.payload).toMatchObject({ capital_restante: "500" });
  });

  test("un pago sin cuota (abono directo a capital) no replica nada", async () => {
    // Sin `cuota_id` no hay cuota cuyo saldo replicar, y un UPDATE sin ese
    // filtro barrería filas de otras cuotas del crédito.
    const replicas = await reversarYCapturarReplicas(
      { ...pagoDeCuota, cuota_id: null },
      1,
    );

    expect(replicas).toHaveLength(0);
  });

  // `insertarPago` (registerPayment.ts) inserta los pagos de SOLO MORA / SOLO
  // OTROS / SOLO CONVENIO con los seis `*_restante` en "0" literal, todos los
  // `abono_*` en 0, y los engancha a la primera cuota PENDIENTE vía
  // `getSpecialPaymentCuotaId` — no a una cuota que ellos hayan "pagado" (no
  // pagaron ninguna). Si se replicara igual, `nuevo*Restante = 0 + 0 = 0` para
  // los seis y el UPDATE estampa CERO en todas las filas vivas de esa cuota
  // abierta, dejándola incobrable.
  const pagoSoloMora = {
    ...pendingPayment,
    cuota_id: 55,
    capital_restante: "0",
    interes_restante: "0",
    iva_12_restante: "0",
    seguro_restante: "0",
    gps_restante: "0",
    membresias: "0",
    abono_capital: "0",
    abono_interes: "0",
    abono_iva_12: "0",
    abono_seguro: "0",
    abono_gps: "0",
    membresias_pago: "0",
    mora: "150",
  };

  test("pago de SOLO MORA (todo en 0 salvo mora) sobre una cuota con más filas: NO replica", async () => {
    const replicas = await reversarYCapturarReplicas(pagoSoloMora, 3);

    expect(replicas).toHaveLength(0);
  });

  test("pago de SOLO OTROS (todo en 0 salvo otros): tampoco replica", async () => {
    const pagoSoloOtros = { ...pagoSoloMora, mora: "0", otros: "200" };
    const replicas = await reversarYCapturarReplicas(pagoSoloOtros, 3);

    expect(replicas).toHaveLength(0);
  });
});

describe("reversePayment cuenta SÓLO las filas vivas de la cuota", () => {
  const noopInvestors = mock(async (
    _creditoId: number,
    _pagoId: number,
    _onPersisted?: () => void,
  ) => []) as unknown as ReversePaymentDependencies["reverseInvestors"];

  test("el COUNT que decide borrar-vs-resetear filtra por cuota, crédito y paymentFalse=false", async () => {
    // Ese conteo decide si la fila se BORRA (hay hermanas) o se RESETEA (es la
    // única). Filtrando sólo por `cuota_id`, una fila ya anulada
    // (`paymentFalse = true`) bastaba para que diera >1 y se borrara la única
    // fila viva: la réplica del saldo se quedaba sin destino y el restante
    // restaurado se perdía igual que antes del fix. Con `paymentFalse = false`
    // ese caso cae en la rama de reset, que conserva la fila con su saldo.
    const recordedCountWheres: unknown[] = [];
    const { handler } = createPersistenceHarness(
      noopInvestors,
      {
        ...pendingPayment,
        cuota_id: 55,
        capital_restante: "0",
        abono_capital: "500",
      },
      [],
      1,
      recordedCountWheres,
    );

    await handler({
      body: { credito_id: 10, pago_id: 30 },
      set: { status: 0 },
      telemetryLogger: createCarteraStructuredLogger({ sink: () => {} }),
    });

    expect(recordedCountWheres).toHaveLength(1);
    const { columnas, valores } = describirWhere(recordedCountWheres[0]);
    expect(columnas).toEqual(["cuota_id", "credito_id", "paymentFalse"]);
    expect(valores).toEqual([55, 10, false]);
  });
});
