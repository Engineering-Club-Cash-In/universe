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

mock.module("../database/index", () => ({
  client: {},
  lockPool: {},
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(currentInvestorRows),
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
// se mockea para controlar exactamente cuándo bloquea, sin reconstruir su
// query de selectDistinct/innerJoin.
let draftsWarning: unknown = null;
const checkInvestorHasUnliquidatedDraftsMock = mock(() =>
  Promise.resolve(draftsWarning),
);
mock.module("../utils/draftPaymentsGuard", () => ({
  checkInvestorHasUnliquidatedDrafts: checkInvestorHasUnliquidatedDraftsMock,
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

    const ctx = makeCtx({ inversionista_id: 10, status: "pendiente_devolucion" });
    const res: any = await updateInvestorStatus(ctx);

    expect(ctx.set.status).toBe(200);
    expect(res.success).toBe(true);
    expect(updateWasCalled).toBe(true);
    expect(lastUpdateData).toEqual({
      status: "pendiente_devolucion",
      tipo_reinversion: "sin_reinversion",
    });
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
