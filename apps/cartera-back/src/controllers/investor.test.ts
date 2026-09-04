import { beforeEach, describe, expect, it, mock } from "bun:test";

import { lockPoolMock } from "../utils/testMocks";

const existingInvestor = {
  inversionista_id: 10,
  nombre: "Isabella Sanchez",
  dpi: 1234567890101,
  email: "isabella@example.com",
};

let selectResponses: unknown[][] = [];
let updateWasCalled = false;
let insertWasCalled = false;
let lastUpdateData: Record<string, unknown> | undefined;
let lastInsertData: Record<string, unknown> | undefined;

mock.module("../database/index", () => ({
  client: {},
  lockPool: lockPoolMock,
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectResponses.shift() ?? []),
        }),
      }),
    }),
    update: () => {
      updateWasCalled = true;
      return {
        set: (data: Record<string, unknown>) => {
          lastUpdateData = data;
          return {
          where: () => ({
            returning: () =>
              Promise.resolve([
                { ...existingInvestor, nombre: "LPT Lopez Sanchez, S.A." },
              ]),
          }),
          };
        },
      };
    },
    insert: () => {
      insertWasCalled = true;
      return {
        values: (data: Record<string, unknown>) => {
          lastInsertData = data;
          return {
            returning: () => Promise.resolve([{ ...data, inversionista_id: 99 }]),
          };
        },
      };
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

const {
  insertInvestor,
  lockPendingReturnCreditsForLiquidation,
  orderUniqueCreditIds,
} = await import("./investor");

describe("insertInvestor", () => {
  beforeEach(() => {
    selectResponses = [];
    updateWasCalled = false;
    insertWasCalled = false;
    lastUpdateData = undefined;
    lastInsertData = undefined;
  });

  it("rechaza operation CREATE con email ya usado por otro inversionista", async () => {
    selectResponses = [[existingInvestor]];
    const set = { status: 200 };

    const result = await insertInvestor({
      body: {
        operation: "CREATE",
        nombre: "LPT Lopez Sanchez, S.A.",
        email: "ISABELLA@example.com",
      },
      set,
    });

    expect(set.status).toBe(409);
    expect(result).toEqual({
      message: "Ya existe un inversionista con ese email",
      error: "duplicate_email",
    });
    expect(updateWasCalled).toBeFalse();
    expect(insertWasCalled).toBeFalse();
  });

  it("conserva upsert legacy por email cuando no viene operation ni mode", async () => {
    selectResponses = [[existingInvestor]];
    const set = { status: 200 };

    const result = await insertInvestor({
      body: {
        nombre: "LPT Lopez Sanchez, S.A.",
        email: "ISABELLA@example.com",
      },
      set,
    });

    expect(set.status).toBe(201);
    expect(result.data).toEqual([
      { ...existingInvestor, nombre: "LPT Lopez Sanchez, S.A." },
    ]);
    expect(updateWasCalled).toBeTrue();
    expect(insertWasCalled).toBeFalse();
  });

  it("edita exclusivamente por inversionista_id cuando viene el ID", async () => {
    selectResponses = [[existingInvestor]];
    const set = { status: 200 };

    const result = await insertInvestor({
      body: {
        inversionista_id: existingInvestor.inversionista_id,
        nombre: "LPT Lopez Sanchez, S.A.",
        email: "ISABELLA@example.com",
      },
      set,
    });

    expect(set.status).toBe(201);
    expect(result.data).toEqual([
      { ...existingInvestor, nombre: "LPT Lopez Sanchez, S.A." },
    ]);
    expect(updateWasCalled).toBeTrue();
    expect(insertWasCalled).toBeFalse();
  });

  it("preserva descuenta_impuestos cuando el body no lo trae", async () => {
    selectResponses = [[existingInvestor]];
    const set = { status: 200 };

    await insertInvestor({
      body: {
        inversionista_id: existingInvestor.inversionista_id,
        nombre: "Isabella Sanchez",
        email: "isabella@example.com",
      },
      set,
    });

    expect(updateWasCalled).toBeTrue();
    expect(lastUpdateData).toBeDefined();
    expect("descuenta_impuestos" in lastUpdateData!).toBeFalse();
  });

  it("aplica descuenta_impuestos=false explícito en el upsert", async () => {
    selectResponses = [[existingInvestor]];
    const set = { status: 200 };

    await insertInvestor({
      body: {
        inversionista_id: existingInvestor.inversionista_id,
        nombre: "Isabella Sanchez",
        descuenta_impuestos: false,
      },
      set,
    });

    expect(updateWasCalled).toBeTrue();
    expect(lastUpdateData?.descuenta_impuestos).toBeFalse();
  });

  it("ignora descuenta_impuestos no booleano (null/string) en el upsert", async () => {
    selectResponses = [[existingInvestor]];
    const set = { status: 200 };

    await insertInvestor({
      body: {
        inversionista_id: existingInvestor.inversionista_id,
        nombre: "Isabella Sanchez",
        descuenta_impuestos: null,
      },
      set,
    });

    expect(updateWasCalled).toBeTrue();
    expect(lastUpdateData).toBeDefined();
    expect("descuenta_impuestos" in lastUpdateData!).toBeFalse();
  });

  it("no reescribe el email cuando el upsert legacy resolvió la fila por DPI", async () => {
    // El portal manda el DPI del representante legal junto al correo de la
    // empresa: la fila que resuelve es la de la persona, y su correo tiene que
    // quedar intacto.
    selectResponses = [[existingInvestor]];
    const set = { status: 200 };

    await insertInvestor({
      body: {
        dpi: existingInvestor.dpi,
        email: "cube@example.com",
        numero_cuenta: "  9876543210  ",
      },
      set,
    });

    expect(updateWasCalled).toBeTrue();
    expect(lastUpdateData).toBeDefined();
    expect("email" in lastUpdateData!).toBeFalse();
    expect(lastUpdateData?.numero_cuenta).toBe("9876543210");
  });

  it("no reescribe el email cuando el upsert legacy resolvió la fila por nombre", async () => {
    // Sin DPI: primero se busca por email (sin resultados) y después por
    // nombre. La fila encontrada por nombre conserva su correo.
    selectResponses = [[], [existingInvestor]];
    const set = { status: 200 };

    await insertInvestor({
      body: {
        nombre: existingInvestor.nombre,
        email: "otro@example.com",
      },
      set,
    });

    expect(updateWasCalled).toBeTrue();
    expect(lastUpdateData).toBeDefined();
    expect("email" in lastUpdateData!).toBeFalse();
  });

  it("sí normaliza el email cuando el upsert legacy resolvió por ese mismo email", async () => {
    selectResponses = [[existingInvestor]];
    const set = { status: 200 };

    await insertInvestor({
      body: {
        nombre: "LPT Lopez Sanchez, S.A.",
        email: "ISABELLA@example.com",
      },
      set,
    });

    expect(updateWasCalled).toBeTrue();
    expect(lastUpdateData?.email).toBe("isabella@example.com");
  });

  it("sí escribe el email cuando la edición viene dirigida por inversionista_id", async () => {
    selectResponses = [[existingInvestor]];
    const set = { status: 200 };

    await insertInvestor({
      body: {
        inversionista_id: existingInvestor.inversionista_id,
        nombre: "Isabella Sanchez",
        email: "NUEVO@example.com",
      },
      set,
    });

    expect(updateWasCalled).toBeTrue();
    expect(lastUpdateData?.email).toBe("nuevo@example.com");
  });

  it("mantiene la importación masiva: por nombre completa DPI y datos bancarios", async () => {
    // Forma del payload del script de Excel (migration/upsertInvestor.py): sin
    // email, sin id y sin operation. Resuelve por nombre y completa el resto.
    selectResponses = [[], [existingInvestor]];
    const set = { status: 200 };

    await insertInvestor({
      body: {
        nombre: existingInvestor.nombre,
        dpi: 5555555550101,
        emite_factura: false,
        tipo_reinversion: "sin_reinversion",
        tipo_cuenta: "MONETARIA",
        numero_cuenta: "1234567890",
      },
      set,
    });

    expect(updateWasCalled).toBeTrue();
    expect(lastUpdateData?.dpi).toBe(5555555550101);
    expect(lastUpdateData?.tipo_cuenta).toBe("MONETARIA");
    expect(lastUpdateData?.numero_cuenta).toBe("1234567890");
    expect(lastUpdateData?.emite_factura).toBeFalse();
  });

  it("acepta una edición dirigida por inversionista_id sin DPI ni nombre", async () => {
    // Es la forma del payload del portal: el id ya identifica la fila, así que
    // exigir además DPI o nombre solo servía para rechazar la petición.
    selectResponses = [[existingInvestor]];
    const set = { status: 200 };

    const result = await insertInvestor({
      body: {
        inversionista_id: existingInvestor.inversionista_id,
        numero_cuenta: "5520029868",
      },
      set,
    });

    expect(set.status).toBe(201);
    expect(result.errores).toBeUndefined();
    expect(updateWasCalled).toBeTrue();
    expect(lastUpdateData?.numero_cuenta).toBe("5520029868");
  });

  it("sigue exigiendo DPI o nombre cuando no viene inversionista_id", async () => {
    const set = { status: 200 };

    const result = await insertInvestor({
      body: { numero_cuenta: "5520029868" },
      set,
    });

    expect(set.status).toBe(400);
    expect(result.errores).toEqual([
      "Inversionista #1: debe proporcionar DPI o nombre",
    ]);
    expect(updateWasCalled).toBeFalse();
    expect(insertWasCalled).toBeFalse();
  });

  // `creado_por_usuario_portal` es la marca de procedencia del registro del
  // portal (migración 0033). Es lo único que prueba que una fila la creó una
  // cuenta concreta, así que solo puede escribirse al CREARLA.
  describe("creado_por_usuario_portal", () => {
    it("sella la fila en el mismo INSERT que la crea", async () => {
      selectResponses = [[], [], []];
      const set = { status: 200 };

      await insertInvestor({
        body: {
          operation: "CREATE",
          nombre: "Ana Pérez",
          dpi: 1234567890123,
          email: "ana@example.com",
          creado_por_usuario_portal: "usuario-portal-de-ana",
        },
        set,
      });

      expect(insertWasCalled).toBeTrue();
      expect(lastInsertData?.creado_por_usuario_portal).toBe(
        "usuario-portal-de-ana",
      );
    });

    it("deja la marca en NULL cuando el alta no viene del portal", async () => {
      selectResponses = [[], [], []];
      const set = { status: 200 };

      await insertInvestor({
        body: { operation: "CREATE", nombre: "Ana Pérez", dpi: 1234567890123 },
        set,
      });

      expect(lastInsertData?.creado_por_usuario_portal).toBeNull();
    });

    // Si un UPDATE pudiera escribirla, cualquiera capaz de editar una fila
    // podría sellarla a su nombre y reclamarla después: la marca dejaría de
    // probar la creación.
    it("nunca la escribe en un UPDATE, aunque venga en el cuerpo", async () => {
      selectResponses = [[existingInvestor]];
      const set = { status: 200 };

      await insertInvestor({
        body: {
          inversionista_id: existingInvestor.inversionista_id,
          numero_cuenta: "0011223344",
          creado_por_usuario_portal: "usuario-portal-de-un-atacante",
        },
        set,
      });

      expect(updateWasCalled).toBeTrue();
      expect(lastUpdateData).not.toHaveProperty("creado_por_usuario_portal");
    });

    it("descarta una marca que no es una cadena con contenido", async () => {
      selectResponses = [[], [], []];
      const set = { status: 200 };

      await insertInvestor({
        body: {
          operation: "CREATE",
          nombre: "Ana Pérez",
          dpi: 1234567890123,
          creado_por_usuario_portal: "   ",
        },
        set,
      });

      expect(lastInsertData?.creado_por_usuario_portal).toBeNull();
    });
  });
});

describe("lockPendingReturnCreditsForLiquidation", () => {
  it("ordena IDs y usa NO KEY UPDATE después de ORDER BY", async () => {
    const forLock = mock(() => Promise.resolve([]));
    const orderBy = mock(() => ({ for: forLock }));
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({ orderBy }),
        }),
      }),
    } as any;

    expect(orderUniqueCreditIds([9, 3, 9, 5])).toEqual([3, 5, 9]);
    await lockPendingReturnCreditsForLiquidation(tx, [9, 3, 9, 5]);

    expect(orderBy).toHaveBeenCalledTimes(1);
    expect(forLock).toHaveBeenCalledWith("no key update");
  });
});
