import { describe, expect, test } from "bun:test";

// Mismo arranque que reversePayment.test.ts: el db se crea al importar, así que
// el entorno sintético va antes del import y se restaura después.
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
const { createRevertPaymentToPending } = await import("./revertPaymentToPending");
const { createCarteraStructuredLogger } = await import("../utils/structuredLogger");
const { rechazoReversaAbonoInicial, RechazoAbonoInicial } = await import("../lib/convenio-abono-inicial");
const { asegurarAbonoInicialLibre, pagosConAbonoInicialVivo, rechazoLoteAbonoInicial } = await import("./abonoInicialConvenio");
for (const key of Object.keys(syntheticEnvironment) as Array<keyof typeof syntheticEnvironment>) {
  const previous = previousEnvironment[key];
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
}

// COBROS-02 W4 (H3): el rechazo por abono inicial se responde con su status y su
// motivo. Las dependencias se inyectan para que el guard no toque la base: el
// `runTransaction` falso lanza el rechazo como lo haría el guard real.
const convenioDelAbono = { convenio_id: 7, activo: true, completado: false };
const body = { credito_id: 10, pago_id: 30 };
const silencioso = () => createCarteraStructuredLogger({ environment: "staging", sink: () => {} });

describe("reversa bloqueada por el abono inicial de un convenio", () => {
  test("reversePayment responde 409 con el motivo, no el 500 genérico", async () => {
    const handler = createReversePayment({
      withCreditLock: async (_creditoId: number, fn: () => Promise<unknown>) => fn(),
      runTransaction: async () => {
        throw rechazoReversaAbonoInicial(convenioDelAbono);
      },
    } as unknown as Parameters<typeof createReversePayment>[0]);
    const set = { status: 0 };
    const response = await handler({ body, set, telemetryLogger: silencioso() });

    expect(set.status).toBe(409);
    expect(response).toEqual({
      message: rechazoReversaAbonoInicial(convenioDelAbono).message,
      error: "abono_inicial_de_convenio",
    });
  });

  test("revertPaymentToPending responde 409 con success false y el motivo", async () => {
    const handler = createRevertPaymentToPending({
      withCreditLock: async (_creditoId: number, fn: () => Promise<unknown>) => fn(),
      runTransaction: async () => {
        throw rechazoReversaAbonoInicial(convenioDelAbono);
      },
      emitTerminal: () => {},
    } as unknown as Parameters<typeof createRevertPaymentToPending>[0]);
    const set = { status: 0 };
    const response = await handler({ body, set });

    expect(set.status).toBe(409);
    expect(response).toEqual({
      success: false,
      message: rechazoReversaAbonoInicial(convenioDelAbono).message,
    });
  });

  // El guard es la PRIMERA lectura de la transacción: si un convenio vivo sostiene
  // el abono, corta antes de cualquier escritura. El `tx` falso falla si se escribe.
  test("reversePayment: el guard corta antes de escribir y responde 409", async () => {
    const escrituras: string[] = [];
    const tx = {
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [convenioDelAbono] }) }),
      }),
      update: () => {
        escrituras.push("update");
        throw new Error("no debía escribir");
      },
      delete: () => {
        escrituras.push("delete");
        throw new Error("no debía escribir");
      },
    };
    const handler = createReversePayment({
      withCreditLock: async (_creditoId: number, fn: () => Promise<unknown>) => fn(),
      runTransaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    } as unknown as Parameters<typeof createReversePayment>[0]);
    const set = { status: 0 };
    const response = await handler({ body, set, telemetryLogger: silencioso() });

    expect(set.status).toBe(409);
    expect(response).toEqual({
      message: expect.stringContaining("convenio #7"),
      error: "abono_inicial_de_convenio",
    });
    expect(escrituras).toEqual([]);
  });

  test("revertPaymentToPending: el guard corta antes de escribir y responde 409", async () => {
    const escrituras: string[] = [];
    const tx = {
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [convenioDelAbono] }) }),
      }),
      update: () => {
        escrituras.push("update");
        throw new Error("no debía escribir");
      },
      delete: () => {
        escrituras.push("delete");
        throw new Error("no debía escribir");
      },
    };
    const handler = createRevertPaymentToPending({
      withCreditLock: async (_creditoId: number, fn: () => Promise<unknown>) => fn(),
      runTransaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
      emitTerminal: () => {},
    } as unknown as Parameters<typeof createRevertPaymentToPending>[0]);
    const set = { status: 0 };
    const response = await handler({ body, set });

    expect(set.status).toBe(409);
    expect(response).toEqual({ success: false, message: expect.stringContaining("convenio #7") });
    expect(escrituras).toEqual([]);
  });

  test("un error sin tipo, aunque lleve el prefijo, sigue siendo 500: se decide por tipo", async () => {
    const handler = createRevertPaymentToPending({
      withCreditLock: async (_creditoId: number, fn: () => Promise<unknown>) => fn(),
      runTransaction: async () => {
        throw new Error(rechazoReversaAbonoInicial(convenioDelAbono).message);
      },
      emitTerminal: () => {},
    } as unknown as Parameters<typeof createRevertPaymentToPending>[0]);
    const set = { status: 0 };
    await handler({ body, set });

    expect(set.status).toBe(500);
  });
});

describe("anulación como falso (falsePayment) bloqueada por el abono inicial", () => {
  test("asegurarAbonoInicialLibre: con convenio vivo lanza el rechazo 409; sin convenio no hace nada", async () => {
    const txCon = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [convenioDelAbono] }) }) }) };
    const txSin = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) };
    const error = await asegurarAbonoInicialLibre(txCon as any, 30).catch((e) => e);
    expect(error).toBeInstanceOf(RechazoAbonoInicial);
    expect(error.status).toBe(409);
    await expect(asegurarAbonoInicialLibre(txSin as any, 30)).resolves.toBeUndefined();
  });
});

describe("reescritura en lote (Excel de conta, marcar-cuotas) bloqueada por el abono inicial", () => {
  const txCon = (filas: unknown[]) => ({ select: () => ({ from: () => ({ where: async () => filas }) }) });

  test("pagosConAbonoInicialVivo devuelve solo los pagos ligados a un convenio vivo", async () => {
    const vivos = await pagosConAbonoInicialVivo(txCon([{ pago_id: 30 }, { pago_id: 31 }]) as any, [30, 31, 32]);
    expect([...vivos].sort()).toEqual([30, 31]);
  });

  test("sin pagos no consulta y devuelve vacío", async () => {
    const tx = { select: () => { throw new Error("no debía consultar"); } };
    expect((await pagosConAbonoInicialVivo(tx as any, [])).size).toBe(0);
  });

  test("el rechazo del lote es 409 y nombra los pagos", () => {
    const r = rechazoLoteAbonoInicial(new Set([30, 31]));
    expect(r).toBeInstanceOf(RechazoAbonoInicial);
    expect(r.status).toBe(409);
    expect(r.message).toContain("[ABONO_INICIAL_DE_CONVENIO]");
    expect(r.message).toContain("30, 31");
  });
});
