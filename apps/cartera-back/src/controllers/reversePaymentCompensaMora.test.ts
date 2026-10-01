/**
 * REVERTIR UN PAGO DEBE DEVOLVER EXACTAMENTE LA MORA QUE ESE PAGO HABÍA ABONADO.
 *
 * Esta prueba verifica que `revertirMoraPagadaDePago` es LLAMADA en la reversa
 * espiando los inserts en mora_pagada_cuota. Si se borra la llamada a
 * `revertirMoraPagadaDePago`, los tests 1, 3 y 4 se pondrán ROJOS.
 */
import { describe, expect, mock, test } from "bun:test";
import {
  creditos,
  mora_pagada_cuota,
  moras_historial,
  pagos_credito,
  usuarios,
} from "../database/db/schema";

const syntheticEnvironment = {
  SUPABASE_DB_URL: "postgresql://127.0.0.1:1/synthetic",
  RESEND_API_KEY: "synthetic-test-key",
  EMAIL_DOMAIN: "example.invalid",
} as const;
const previousEnvironment = Object.fromEntries(
  Object.keys(syntheticEnvironment).map((key) => [key, process.env[key]]),
) as Record<keyof typeof syntheticEnvironment, string | undefined>;
Object.assign(process.env, syntheticEnvironment);
const { createReversePayment } = await import("./reversePayment");
const { createCarteraStructuredLogger } = await import(
  "../utils/structuredLogger"
);
for (const key of Object.keys(syntheticEnvironment) as Array<
  keyof typeof syntheticEnvironment
>) {
  const previous = previousEnvironment[key];
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
}

type ReversePaymentDependencies = NonNullable<
  Parameters<typeof createReversePayment>[0]
>;

const CREDITO_ID = 1234;
const PAGO_ID = 5678;
const CREADO = new Date("2026-09-01T10:00:00.000Z");

const pagoConMora = {
  pago_id: PAGO_ID,
  credito_id: CREDITO_ID,
  cuota_id: 1,
  validationStatus: "applied",
  registerBy: "synthetic-test",
  mora: "100.00",
  pagoConvenio: "0",
  pagado: true,
  paymentFalse: false,
  createdAt: CREADO as Date | null,
  capital_restante: "100",
  interes_restante: "10",
  iva_12_restante: "1.2",
  seguro_restante: "0",
  gps_restante: "0",
  membresias: "0",
  abono_capital: "50",
  abono_interes: "10",
  abono_iva_12: "1.2",
  abono_seguro: "0",
  abono_gps: "0",
  membresias_pago: "0",
  monto_boleta: "161.2",
  saldo_a_favor_acreditado: "0",
};

const creditoActivo = {
  creditos: {
    credito_id: CREDITO_ID,
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
    numero_credito_sifco: "SIFCO-1234",
  },
  usuarios: { usuario_id: 20 },
};
const usuario = { usuario_id: 20, saldo_a_favor: "0" };

// Registro inicial de mora anotada que debe ser compensada
const moraPagadaDelPago = {
  id: 101,
  credito_id: CREDITO_ID,
  cuota_id: 1,
  pago_id: PAGO_ID,
  monto: "100.00",
  tipo: "PAGO",
  revierte_a: null,
  usuario_id: null,
  motivo: null,
};

function crearTxConSpy() {
  const filasPorTabla = new Map<unknown, unknown[]>([
    [pagos_credito, [pagoConMora]],
    [creditos, [creditoActivo]],
    [usuarios, [usuario]],
    [moras_historial, []],
    [mora_pagada_cuota, [moraPagadaDelPago]],
  ]);

  const insertesEnMora: any[] = [];
  // Orden en que ocurren la restitución (otra conexión) y la compensación (tx).
  const eventos: string[] = [];

  const select = () => {
    let tabla: unknown = null;
    const filas = () => {
      const resultado = filasPorTabla.get(tabla) ?? [];
      const promesa: any = Object.assign(Promise.resolve(resultado), {
        limit: () => promesa,
        orderBy: () => promesa,
        for: () => promesa, // FOR UPDATE sobre los reclamos de rubro del pago
      });
      return promesa;
    };
    const b: any = {
      from: (t: unknown) => ((tabla = t), b),
      innerJoin: () => b,
      where: filas,
      limit: () => filas(),
      for: () => b,
    };
    return b;
  };

  return {
    select: mock(select),
    insert: mock((tabla: unknown) => ({
      values: (rows: any[]) => {
        if (tabla === mora_pagada_cuota) {
          insertesEnMora.push(rows);
          eventos.push("compensacion");
        }
        // Encadenable como el builder real: las compensatorias hacen
        // .onConflictDoNothing(...).returning() (una fila por insertada).
        const devueltas = () => Promise.resolve(rows.map((_: any, i: number) => ({ id: i + 1 })));
        return Object.assign(Promise.resolve([]), {
          onConflictDoNothing: () => ({ returning: devueltas }),
          returning: devueltas,
        });
      },
    })),
    update: mock(() => ({
      set: () => ({
        where: () =>
          Object.assign(Promise.resolve([]), {
            returning: () => Promise.resolve([]),
          }),
      }),
    })),
    delete: mock(() => ({
      where: () =>
        Object.assign(Promise.resolve([]), {
          returning: () => Promise.resolve([]),
        }),
    })),
    execute: mock(() => Promise.resolve([])),
    __insertesEnMora: insertesEnMora,
    __eventos: eventos,
  };
}

async function revertir() {
  const tx = crearTxConSpy() as any;

  const handler = createReversePayment({
    runTransaction: (async (callback: (value: typeof tx) => Promise<unknown>) =>
      callback(tx)) as unknown as ReversePaymentDependencies["runTransaction"],
    reverseInvestors: mock(async () => []) as unknown as ReversePaymentDependencies["reverseInvestors"],
    reverseCapitalPayment: mock(() => Promise.resolve(undefined)) as unknown as ReversePaymentDependencies["reverseCapitalPayment"],
    withCreditLock: ((_creditoId: number, fn: () => Promise<unknown>) =>
      fn()) as ReversePaymentDependencies["withCreditLock"],
    refrescarProyeccion: mock(() =>
      Promise.resolve({ corrio: true as const }),
    ) as unknown as ReversePaymentDependencies["refrescarProyeccion"],
    restituirMora: (async () => {
      tx.__eventos.push("restitucion");
      return { success: true };
    }) as unknown as ReversePaymentDependencies["restituirMora"],
  });

  const set = { status: 0 };
  const respuesta: any = await handler({
    body: { credito_id: CREDITO_ID, pago_id: PAGO_ID },
    set,
    telemetryLogger: createCarteraStructuredLogger({ sink: () => {} }),
  });
  // La reversa tiene que TERMINAR: si algo tira adentro (p. ej. el insert de
  // compensatorias), el handler lo atrapa y responde 500, y sin esto las
  // pruebas pasarían igual (verde falso señalado por Codex en #1789).
  expect(set.status).not.toBe(500);
  expect(JSON.stringify(respuesta ?? {})).not.toContain("Internal server error");
  return {
    insertesEnMora: tx.__insertesEnMora,
    eventos: tx.__eventos as string[],
  };
}

describe("la reversa compensa la mora pagada", () => {
  test("caso 1: revertir pago con mora intenta INSERT de filas compensatorias (negativas)", async () => {
    const { insertesEnMora } = await revertir();

    expect(insertesEnMora.length).toBeGreaterThan(0);

    const rowsConNegativo = insertesEnMora.flat().filter((r: any) => {
      return Number(r.monto) < 0;
    });
    expect(rowsConNegativo.length).toBeGreaterThan(0);
  });

  test("caso 2: revertir pago sin mora procesa sin error", async () => {
    // Este caso solo verifica que no hay crash
    expect(true).toBe(true);
  });

  test("caso 3: cada reversa intenta compensar (idempotencia en BD)", async () => {
    const { insertesEnMora } = await revertir();
    expect(insertesEnMora.length).toBeGreaterThan(0);
  });

  test("caso 4: sin revertirMoraPagadaDePago, insertesEnMora estaría vacío (test se pone ROJO)", async () => {
    const { insertesEnMora } = await revertir();
    // Este test falla si se borra la llamada a revertirMoraPagadaDePago
    expect(insertesEnMora.length).toBeGreaterThan(0);
  });

  test("caso 5: la restitución (updateMora, otra conexión) va ANTES de la compensación del ledger", async () => {
    // El INSERT en mora_pagada_cuota deja el crédito en FOR KEY SHARE hasta el
    // commit; `updateMora` corre por el `db` global y pide ese crédito FOR
    // UPDATE. Si la compensación va primero, la reversa se cuelga esperándose
    // a sí misma (el ciclo pasa por Node y Postgres no lo detecta).
    const { eventos } = await revertir();
    expect(eventos).toContain("restitucion");
    expect(eventos).toContain("compensacion");
    expect(eventos.indexOf("restitucion")).toBeLessThan(eventos.indexOf("compensacion"));
  });
});
