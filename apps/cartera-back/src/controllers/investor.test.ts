import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

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
  // `paymentAdvisoryLock` importa `lockPool` de este módulo; sin él en el mock
  // el archivo entero de tests revienta al resolver los imports.
  lockPool: {},
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
            returning: () =>
              Promise.resolve([{ ...existingInvestor, ...data }]),
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
  updateInvestor,
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

  it("persiste dpi_rep_legal al crear un inversionista nuevo", async () => {
    // La 1ª respuesta es la de la búsqueda del representante: debe existir.
    selectResponses = [[{ inversionista_id: 1 }]];
    const set = { status: 200 };

    await insertInvestor({
      body: {
        operation: "CREATE",
        nombre: "Inversiones Monaco S.A.",
        dpi_rep_legal: "1852752810101",
      },
      set,
    });

    expect(insertWasCalled).toBeTrue();
    expect(lastInsertData?.dpi_rep_legal).toBe("1852752810101");
  });

  it("conserva los ceros a la izquierda del dpi_rep_legal", async () => {
    // El representante "04036613" existe como inversionista con dpi 4036613.
    selectResponses = [[{ inversionista_id: 1 }]];
    const set = { status: 200 };

    await insertInvestor({
      body: {
        operation: "CREATE",
        nombre: "Javier Camilo Kafie Guardado",
        dpi_rep_legal: "04036613",
      },
      set,
    });

    expect(lastInsertData?.dpi_rep_legal).toBe("04036613");
  });

  it("guarda null cuando dpi_rep_legal viene vacío al crear", async () => {
    const set = { status: 200 };

    await insertInvestor({
      body: {
        operation: "CREATE",
        nombre: "Sin Representante",
        dpi_rep_legal: "   ",
      },
      set,
    });

    expect(lastInsertData?.dpi_rep_legal).toBeNull();
  });

  it("actualiza dpi_rep_legal en el upsert de un inversionista existente", async () => {
    // 1ª: el inversionista a editar (su dpi_rep_legal guardado va vacío, así que
    // el valor cambia). 2ª: la búsqueda del representante, que sí existe.
    selectResponses = [[existingInvestor], [{ inversionista_id: 1 }]];
    const set = { status: 200 };

    await insertInvestor({
      body: {
        inversionista_id: existingInvestor.inversionista_id,
        nombre: "Isabella Sanchez",
        dpi_rep_legal: "2258055880102",
      },
      set,
    });

    expect(updateWasCalled).toBeTrue();
    expect(lastUpdateData?.dpi_rep_legal).toBe("2258055880102");
  });

  it("no toca dpi_rep_legal cuando el body no lo trae", async () => {
    selectResponses = [[existingInvestor]];
    const set = { status: 200 };

    await insertInvestor({
      body: {
        inversionista_id: existingInvestor.inversionista_id,
        nombre: "Isabella Sanchez",
      },
      set,
    });

    expect(updateWasCalled).toBeTrue();
    expect("dpi_rep_legal" in lastUpdateData!).toBeFalse();
  });

  it("borra dpi_rep_legal cuando viene vacío en el upsert", async () => {
    selectResponses = [[existingInvestor]];
    const set = { status: 200 };

    await insertInvestor({
      body: {
        inversionista_id: existingInvestor.inversionista_id,
        nombre: "Isabella Sanchez",
        dpi_rep_legal: "",
      },
      set,
    });

    // Contrato del que dependen los clientes (CRM incluido): la llave ausente
    // deja el valor intacto, la llave vacía lo borra.
    expect(updateWasCalled).toBeTrue();
    expect("dpi_rep_legal" in lastUpdateData!).toBeTrue();
    expect(lastUpdateData?.dpi_rep_legal).toBeNull();
  });

  it("rechaza un dpi_rep_legal que no existe como inversionista", async () => {
    // 1ª respuesta: la búsqueda de existencia del representante → vacía
    selectResponses = [[]];
    const set = { status: 200 };

    const result = await insertInvestor({
      body: {
        operation: "CREATE",
        nombre: "Empresa Nueva S.A.",
        dpi_rep_legal: "9999999999999",
      },
      set,
    });

    expect(set.status).toBe(400);
    expect(result.errores?.[0]).toContain("no existe como inversionista");
    // Código de máquina: el CRM lo traduce al campo culpable para marcar el
    // input. Sin él el error llega como texto suelto.
    expect(result.error).toBe("rep_legal_inexistente");
    expect(insertWasCalled).toBeFalse();
  });

  it("no manda el código de representante en errores de validación ajenos", async () => {
    const set = { status: 200 };

    const result = await insertInvestor({
      body: { operation: "CREATE", nombre: "", dpi: null },
      set,
    });

    expect(set.status).toBe(400);
    expect(result.errores?.[0]).toContain("debe proporcionar DPI o nombre");
    expect(result.error).toBeUndefined();
  });

  it("no revalida dpi_rep_legal cuando el valor no cambió", async () => {
    // Solo la respuesta del lookup del inversionista existente: si el código
    // intentara verificar al representante, consumiría otra y fallaría.
    selectResponses = [[{ ...existingInvestor, dpi_rep_legal: "04036613" }]];
    const set = { status: 200 };

    await insertInvestor({
      body: {
        inversionista_id: existingInvestor.inversionista_id,
        nombre: "Javier Camilo Kafie Guardado",
        dpi_rep_legal: "04036613",
      },
      set,
    });

    expect(set.status).toBe(201);
    expect(updateWasCalled).toBeTrue();
  });

  it("rechaza dpi_rep_legal que no sea solo dígitos", async () => {
    const set = { status: 200 };

    const result = await insertInvestor({
      body: {
        operation: "CREATE",
        nombre: "Con Guiones S.A.",
        dpi_rep_legal: "1852-7528-10101",
      },
      set,
    });

    expect(set.status).toBe(400);
    expect(result.errores?.[0]).toContain("DPI de representante legal");
    expect(insertWasCalled).toBeFalse();
  });

  it("rechaza dpi_rep_legal de más de 20 caracteres", async () => {
    const set = { status: 200 };

    const result = await insertInvestor({
      body: {
        operation: "CREATE",
        nombre: "Demasiado Largo S.A.",
        dpi_rep_legal: "123456789012345678901",
      },
      set,
    });

    expect(set.status).toBe(400);
    expect(result.errores?.[0]).toContain("DPI de representante legal");
    expect(insertWasCalled).toBeFalse();
  });

  // ── Quién puede hacer que salga un correo con contraseña ──────────────────
  //
  // `authMiddleware` solo verifica la firma del JWT (midleware.ts:16-22): no
  // mira el rol. Así que hasta aquí CUALQUIER token vivo de cartera podía
  // mandar `provisionar_portal` y provocar una cuenta del portal con la
  // contraseña al correo del payload — aunque la única pantalla que lo ofrece
  // sea solo-ADMIN (App.tsx:121) y la ruta hermana exija ADMIN
  // (otorgarAccesoPortal.ts:50).
  //
  // El discriminante de estas pruebas es el fail-closed de
  // `portalProvisioning`: sin AUTH_GOOGLE_URL/PORTAL_PROVISIONING_SECRET la
  // llamada ni sale a la red y devuelve `provisionamiento_no_configurado`. Ver
  // ese motivo prueba que SÍ se intentó; ver `origen_no_autorizado` prueba que
  // ni se intentó.
  describe("permiso de provisionamiento", () => {
    const authGoogleUrl = process.env.AUTH_GOOGLE_URL;
    const secreto = process.env.PORTAL_PROVISIONING_SECRET;

    beforeEach(() => {
      delete process.env.AUTH_GOOGLE_URL;
      delete process.env.PORTAL_PROVISIONING_SECRET;
    });

    afterAll(() => {
      if (authGoogleUrl === undefined) delete process.env.AUTH_GOOGLE_URL;
      else process.env.AUTH_GOOGLE_URL = authGoogleUrl;
      if (secreto === undefined) delete process.env.PORTAL_PROVISIONING_SECRET;
      else process.env.PORTAL_PROVISIONING_SECRET = secreto;
    });

    const altaConPortal = (user: unknown) =>
      insertInvestor({
        body: {
          operation: "CREATE",
          nombre: "Nueva Persona",
          email: "nueva@example.com",
          provisionar_portal: true,
        },
        set: { status: 200 },
        user,
      });

    it("un ASESOR no dispara el provisionamiento, y el alta NO se cae", async () => {
      const result = await altaConPortal({ role: "ASESOR" });

      // El inversionista SÍ queda creado: negar el permiso nunca puede
      // convertirse en un 500 sobre una fila que ya está escrita.
      expect(insertWasCalled).toBeTrue();
      expect(result.data).toHaveLength(1);
      expect(result.provisioning?.[0].estado).toBe("omitida");
      expect(result.provisioning?.[0].motivo).toBe("origen_no_autorizado");
    });

    it("un token sin rol tampoco", async () => {
      const result = await altaConPortal(undefined);

      expect(insertWasCalled).toBeTrue();
      expect(result.provisioning?.[0].motivo).toBe("origen_no_autorizado");
    });

    it("un ADMIN sí lo dispara", async () => {
      const result = await altaConPortal({ role: "ADMIN" });

      expect(insertWasCalled).toBeTrue();
      // Llegó hasta el cliente de provisionamiento: se frenó por
      // configuración, no por permiso.
      expect(result.provisioning?.[0].motivo).toBe("provisionamiento_no_configurado");
    });

    it("sin la llave en el payload el motivo sigue siendo `no_solicitado`", async () => {
      // No pedirlo no es un problema de permiso: si esto reportara
      // `origen_no_autorizado`, operaciones saldría a pedir accesos que no
      // le faltan.
      const result = await insertInvestor({
        body: {
          operation: "CREATE",
          nombre: "Nueva Persona",
          email: "nueva@example.com",
        },
        set: { status: 200 },
        user: { role: "ASESOR" },
      });

      expect(result.provisioning?.[0].motivo).toBe("no_solicitado");
    });
  });
});

describe("updateInvestor", () => {
  beforeEach(() => {
    selectResponses = [];
    updateWasCalled = false;
    insertWasCalled = false;
    lastUpdateData = undefined;
    lastInsertData = undefined;
  });

  it("actualiza dpi_rep_legal", async () => {
    // 1ª: el inversionista a editar (sin dpi_rep_legal guardado, el valor
    // cambia). 2ª: la búsqueda del representante, que sí existe.
    selectResponses = [[existingInvestor], [{ inversionista_id: 76 }]];
    const set = { status: 200 };

    await updateInvestor({
      body: {
        inversionista_id: existingInvestor.inversionista_id,
        dpi_rep_legal: "1573661970101",
      },
      set,
    });

    expect(updateWasCalled).toBeTrue();
    expect(lastUpdateData?.dpi_rep_legal).toBe("1573661970101");
  });

  it("no toca dpi_rep_legal cuando el body no lo trae", async () => {
    const set = { status: 200 };

    await updateInvestor({
      body: {
        inversionista_id: existingInvestor.inversionista_id,
        nombre: "Isabella Sanchez",
      },
      set,
    });

    expect(updateWasCalled).toBeTrue();
    expect("dpi_rep_legal" in lastUpdateData!).toBeFalse();
  });

  it("rechaza en updateInvestor un dpi_rep_legal inexistente", async () => {
    selectResponses = [[]];
    const set = { status: 200 };

    const result = await updateInvestor({
      body: {
        inversionista_id: existingInvestor.inversionista_id,
        dpi_rep_legal: "9999999999999",
      },
      set,
    });

    expect(set.status).toBe(400);
    expect(result.message).toContain("no existe como inversionista");
    expect(result.error).toBe("rep_legal_inexistente");
    expect(updateWasCalled).toBeFalse();
  });

  it("no revalida dpi_rep_legal cuando el valor no cambió", async () => {
    // Solo la respuesta del inversionista guardado: si el código verificara al
    // representante consumiría otra, la vería vacía y rechazaría.
    selectResponses = [[{ ...existingInvestor, dpi_rep_legal: "04036613" }]];
    const set = { status: 200 };

    await updateInvestor({
      body: {
        inversionista_id: existingInvestor.inversionista_id,
        dpi_rep_legal: "04036613",
      },
      set,
    });

    expect(set.status).toBe(200);
    expect(updateWasCalled).toBeTrue();
  });

  it("rechaza dpi_rep_legal inválido sin escribir nada", async () => {
    const set = { status: 200 };

    const result = await updateInvestor({
      body: {
        inversionista_id: existingInvestor.inversionista_id,
        dpi_rep_legal: "1852-7528",
      },
      set,
    });

    expect(set.status).toBe(400);
    expect(result.message).toContain("DPI de representante legal");
    expect(updateWasCalled).toBeFalse();
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
