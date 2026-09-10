import { beforeEach, describe, expect, it, mock } from "bun:test";

const existingInvestor = {
  inversionista_id: 10,
  nombre: "Isabella Sanchez",
  email: "isabella@example.com",
  status: "activo",
  tipo_reinversion: "reinversion_total",
};

// El SELECT de `current` en updateInvestorStatus es select().from().where()
// SIN .limit() (a diferencia de otros controllers de este archivo) — el mock
// tiene que resolver directo en `.where()`.
let currentInvestorRows: unknown[] = [];
let updateWasCalled = false;
let lastUpdateData: Record<string, unknown> | undefined;

// tx.select().from().where() dentro de la transacción del guard sirve dos
// queries: creditos_inversionistas_espejo (se resuelve directo, .then) y el
// FOR NO KEY UPDATE de creditos (encadena .orderBy().for(), nunca se resuelve
// sin ellos). checkInvestorHasUnliquidatedDrafts está mockeado aparte (no
// toca este tx), así que el contenido de creditosEspejoRows no cambia el
// resultado del guard — solo hace falta que la cadena no truene.
let creditosEspejoRows: { credito_id: number }[] = [];
// Regresión: sin FOR NO KEY UPDATE acá, el guard no se serializa con
// withPendingReturnCreditLocks (payments.ts), que toma el mismo lock de fila
// sobre creditos antes de insertar un borrador — la carrera vuelve a abrirse.
// ORDER BY explícito: sin él, dos transacciones con créditos superpuestos
// pueden lockear en órdenes distintos y producir deadlock.
let forCallsCount = 0;
let lastForArg: unknown;
let orderByCallsCount = 0;
let transactionWasUsed = false;
function makeWhereResult() {
  const promise = Promise.resolve(creditosEspejoRows);
  return Object.assign(promise, {
    orderBy: () => {
      orderByCallsCount++;
      return {
        for: (strength: unknown) => {
          forCallsCount++;
          lastForArg = strength;
          return Promise.resolve([]);
        },
      };
    },
  });
}

mock.module("../database/index", () => ({
  client: {},
  lockPool: {},
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(currentInvestorRows),
      }),
    }),
    // Suelto (fuera de transacción): no debería usarse para el update una
    // vez que status === 'pendiente_devolucion' pasa por el guard, pero se
    // deja definido por si algún camino lo sigue llamando directo.
    update: () => ({
      set: (data: Record<string, unknown>) => {
        updateWasCalled = true;
        lastUpdateData = data;
        return {
          where: () => ({
            returning: () =>
              Promise.resolve([{ ...existingInvestor, ...data }]),
          }),
        };
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      transactionWasUsed = true;
      const tx = {
        select: () => ({
          from: () => ({
            where: makeWhereResult,
          }),
        }),
        update: () => ({
          set: (data: Record<string, unknown>) => {
            updateWasCalled = true;
            lastUpdateData = data;
            return {
              where: () => ({
                returning: () =>
                  Promise.resolve([{ ...existingInvestor, ...data }]),
              }),
            };
          },
        }),
      };
      return fn(tx);
    },
  },
}));

mock.module("@cci/email", () => ({
  sendLiquidationEmail: mock(() => Promise.resolve()),
  sendPlainEmail: mock(() => Promise.resolve()),
  sendSimpleEmail: mock(() => Promise.resolve()),
  sendInvestorAddedToCreditsNotification: mock(() => Promise.resolve()),
  sendNewCreditNotification: mock(() => Promise.resolve()),
}));

mock.module("./addInvestorToCredit", () => ({
  addInvestorToCredit: mock(() => Promise.resolve()),
}));

// Guard B bajo prueba en su propio archivo (draftPaymentsGuard.test.ts) — acá
// se mockea checkInvestorHasUnliquidatedDrafts para controlar exactamente
// cuándo bloquea, sin reconstruir su query de selectDistinct/innerJoin.
// UnliquidatedDraftPaymentsError SÍ se importa real (es pura, sin queries):
// investor.ts hace `throw new UnliquidatedDraftPaymentsError(...)` y
// `instanceof` contra ella en su catch — con una clase mockeada aparte esas
// dos referencias apuntarían a constructores distintos y el catch nunca
// matchearía.
const { UnliquidatedDraftPaymentsError: RealUnliquidatedDraftPaymentsError } =
  await import("../utils/draftPaymentsGuard");

let draftsWarning: unknown = null;
const checkInvestorHasUnliquidatedDraftsMock = mock(() =>
  Promise.resolve(draftsWarning),
);
mock.module("../utils/draftPaymentsGuard", () => ({
  checkInvestorHasUnliquidatedDrafts: checkInvestorHasUnliquidatedDraftsMock,
  UnliquidatedDraftPaymentsError: RealUnliquidatedDraftPaymentsError,
}));

const { updateInvestorStatus } = await import("./investor");

function makeCtx(body: unknown) {
  const set: any = { status: 200 };
  return { body, set, request: {} as any };
}

beforeEach(() => {
  currentInvestorRows = [{ ...existingInvestor }];
  updateWasCalled = false;
  lastUpdateData = undefined;
  draftsWarning = null;
  checkInvestorHasUnliquidatedDraftsMock.mockClear();
  creditosEspejoRows = [];
  forCallsCount = 0;
  lastForArg = undefined;
  orderByCallsCount = 0;
  transactionWasUsed = false;
});

describe("updateInvestorStatus — guard de borradores sin liquidar", () => {
  it("bloquea activo -> pendiente_devolucion si hay pagos espejo sin liquidar", async () => {
    draftsWarning = {
      warning: true,
      code: "UNLIQUIDATED_DRAFT_PAYMENTS",
      message:
        "No se puede marcar al inversionista para devolución: tiene pagos sin liquidar en los créditos SIFCO-1. Liquidalos primero.",
      creditos_bloqueantes: [
        { credito_id: 1, numero_credito_sifco: "SIFCO-1" },
      ],
    };

    const ctx = makeCtx({ inversionista_id: 10, status: "pendiente_devolucion" });
    const res: any = await updateInvestorStatus(ctx);

    expect(ctx.set.status).toBe(400);
    expect(res.success).toBe(false);
    expect(res.code).toBe("UNLIQUIDATED_DRAFT_PAYMENTS");
    expect(res.message).toContain("SIFCO-1");
    expect(updateWasCalled).toBe(false);
  });

  it("permite activo -> pendiente_devolucion sin borradores pendientes", async () => {
    draftsWarning = null;
    creditosEspejoRows = [{ credito_id: 5 }];

    const ctx = makeCtx({ inversionista_id: 10, status: "pendiente_devolucion" });
    const res: any = await updateInvestorStatus(ctx);

    expect(ctx.set.status).toBe(200);
    expect(res.success).toBe(true);
    expect(updateWasCalled).toBe(true);
    expect(lastUpdateData).toEqual({
      status: "pendiente_devolucion",
      tipo_reinversion: "sin_reinversion",
    });
    // Regresión: guard + update corren dentro de la MISMA transacción,
    // tomando FOR NO KEY UPDATE sobre los créditos del inversionista antes
    // de consultar el guard. ORDER BY explícito antes del FOR: sin él, dos
    // transacciones con créditos superpuestos pueden lockear en órdenes
    // distintos y producir deadlock.
    expect(transactionWasUsed).toBe(true);
    expect(orderByCallsCount).toBe(1);
    expect(forCallsCount).toBe(1);
    expect(lastForArg).toBe("no key update");
  });

  it("no toma el lock cuando el inversionista no tiene créditos en el espejo", async () => {
    draftsWarning = null;
    creditosEspejoRows = [];

    const ctx = makeCtx({ inversionista_id: 10, status: "pendiente_devolucion" });
    await updateInvestorStatus(ctx);

    // Sin créditos, no hay fila que lockear — el guard igual se consulta
    // (checkInvestorHasUnliquidatedDraftsMock corre siempre que
    // status === 'pendiente_devolucion').
    expect(forCallsCount).toBe(0);
    expect(checkInvestorHasUnliquidatedDraftsMock).toHaveBeenCalled();
  });

  it("permite salir de pendiente_devolucion aunque haya borradores sin liquidar", async () => {
    currentInvestorRows = [{ ...existingInvestor, status: "pendiente_devolucion" }];
    draftsWarning = {
      warning: true,
      code: "UNLIQUIDATED_DRAFT_PAYMENTS",
      message: "irrelevante para esta transición",
      creditos_bloqueantes: [{ credito_id: 1, numero_credito_sifco: "SIFCO-1" }],
    };

    const ctx = makeCtx({ inversionista_id: 10, status: "activo" });
    const res: any = await updateInvestorStatus(ctx);

    expect(ctx.set.status).toBe(200);
    expect(res.success).toBe(true);
    expect(updateWasCalled).toBe(true);
    // El guard solo se consulta al ENTRAR a pendiente_devolucion.
    expect(checkInvestorHasUnliquidatedDraftsMock).not.toHaveBeenCalled();
  });

  it("no consulta el guard en un no-op (status sin cambios)", async () => {
    currentInvestorRows = [{ ...existingInvestor, status: "pendiente_devolucion" }];
    draftsWarning = {
      warning: true,
      code: "UNLIQUIDATED_DRAFT_PAYMENTS",
      message: "irrelevante para esta transición",
      creditos_bloqueantes: [{ credito_id: 1, numero_credito_sifco: "SIFCO-1" }],
    };

    const ctx = makeCtx({ inversionista_id: 10, status: "pendiente_devolucion" });
    const res: any = await updateInvestorStatus(ctx);

    expect(ctx.set.status).toBe(200);
    expect(res.success).toBe(true);
    expect(updateWasCalled).toBe(false);
    expect(checkInvestorHasUnliquidatedDraftsMock).not.toHaveBeenCalled();
  });

  it("permite activo -> inactivo aunque haya borradores sin liquidar", async () => {
    draftsWarning = {
      warning: true,
      code: "UNLIQUIDATED_DRAFT_PAYMENTS",
      message: "irrelevante para esta transición",
      creditos_bloqueantes: [{ credito_id: 1, numero_credito_sifco: "SIFCO-1" }],
    };

    const ctx = makeCtx({ inversionista_id: 10, status: "inactivo" });
    const res: any = await updateInvestorStatus(ctx);

    expect(ctx.set.status).toBe(200);
    expect(res.success).toBe(true);
    expect(updateWasCalled).toBe(true);
    expect(checkInvestorHasUnliquidatedDraftsMock).not.toHaveBeenCalled();
  });
});
