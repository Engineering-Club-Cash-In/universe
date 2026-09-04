import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

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
  updateInvestor,
  lockPendingReturnCreditsForLiquidation,
  orderUniqueCreditIds,
  condicionInversionistaPorEmail,
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

  it("no toca dpi_rep_legal cuando el body no lo trae (insertInvestor)", async () => {
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

  it("no revalida dpi_rep_legal cuando el valor no cambió (insertInvestor)", async () => {
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

// ============================================================================
// Idempotencia del alta que pide el registro del portal.
//
// El registro del portal toca dos sistemas (auth-google y cartera) y no es
// atómico: cartera puede insertar la fila y auth-google caerse antes de
// escribir el DPI y el rol de la cuenta. Con la creación estricta a secas, TODO
// reintento choca contra la fila que él mismo creó y la cuenta se queda
// incompleta para siempre.
//
// La decisión se toma AQUÍ, no en auth-google: cartera es quien tiene las
// restricciones de unicidad, así que es el único que puede resolver el choque y
// devolver la fila en una sola operación. Intentar hacerlo desde fuera obligaba
// a reconstruir la exclusión con reservas, liberaciones y compare-and-set, y ahí
// cayeron ocho hallazgos seguidos.
// ============================================================================
describe("insertInvestor · reintento del registro del portal", () => {
  const CUENTA_DE_ANA = "usuario-portal-de-ana";

  /** La fila que dejó el intento anterior de Ana, con su marca de procedencia. */
  const filaDeAna = {
    inversionista_id: 77,
    nombre: "Ana Pérez",
    dpi: 1234567890123,
    email: "ana@example.com",
    creado_por_usuario_portal: CUENTA_DE_ANA,
  };

  /** El alta que Ana reintenta: exactamente la misma que ya se ejecutó. */
  const altaDeAna = {
    operation: "CREATE",
    nombre: "Ana Pérez",
    dpi: 1234567890123,
    email: "ana@example.com",
    creado_por_usuario_portal: CUENTA_DE_ANA,
  };

  beforeEach(() => {
    selectResponses = [];
    updateWasCalled = false;
    insertWasCalled = false;
    lastUpdateData = undefined;
    lastInsertData = undefined;
  });

  it("devuelve la fila que creó ese mismo registro, sin escribir nada", async () => {
    // Los tres choques (email, DPI, nombre) apuntan a la fila de Ana.
    selectResponses = [[filaDeAna], [filaDeAna], [filaDeAna]];
    const set = { status: 200 };

    const result = await insertInvestor({ body: altaDeAna, set });

    expect(set.status).toBe(201);
    expect(result.data).toEqual([filaDeAna]);
    // Reconocer no es escribir: la fila se devuelve tal cual.
    expect(insertWasCalled).toBeFalse();
    expect(updateWasCalled).toBeFalse();
  });

  it("no reclama una fila sellada por otra cuenta del portal", async () => {
    const filaDeOtro = {
      ...filaDeAna,
      creado_por_usuario_portal: "usuario-portal-de-otro",
    };
    selectResponses = [[filaDeOtro], [filaDeOtro], [filaDeOtro]];
    const set = { status: 200 };

    const result = await insertInvestor({ body: altaDeAna, set });

    expect(set.status).toBe(409);
    expect(result.error).toBe("duplicate_email");
    expect(insertWasCalled).toBeFalse();
    expect(updateWasCalled).toBeFalse();
  });

  // Toda fila anterior a la migración 0033 tiene la marca en NULL, incluidas
  // las 10 filas de sociedad cuyo `dpi` es NULL y cuyo `dpi_rep_legal` sí
  // existe. Ese NULL es lo que impide que se reclamen.
  it("no reclama una fila sin marca de procedencia", async () => {
    const filaHeredada = { ...filaDeAna, creado_por_usuario_portal: null };
    selectResponses = [[filaHeredada], [filaHeredada], [filaHeredada]];
    const set = { status: 200 };

    const result = await insertInvestor({ body: altaDeAna, set });

    expect(set.status).toBe(409);
    expect(insertWasCalled).toBeFalse();
  });

  // La marca prueba de QUIÉN es la fila, no que el reintento pida lo mismo. El
  // DPI del reintento es el que auth-google escribe en la cuenta del portal:
  // aceptar la fila vieja dejaría cartera con un DPI y el portal con otro, y ese
  // otro puede pertenecer a un inversionista antiguo. Se falla cerrado.
  it("no reclama su propia fila si el reintento trae otro DPI", async () => {
    // El DPI nuevo está libre, así que solo chocan el correo y el nombre.
    selectResponses = [[filaDeAna], [], [filaDeAna]];
    const set = { status: 200 };

    const result = await insertInvestor({
      body: { ...altaDeAna, dpi: 9999999999999 },
      set,
    });

    expect(set.status).toBe(409);
    expect(insertWasCalled).toBeFalse();
    expect(updateWasCalled).toBeFalse();
  });

  // Si el correo casa con la fila propia pero el DPI casa con la de otro
  // inversionista, reconocer la propia daría por bueno un alta que deja los dos
  // sistemas apuntando a identidades distintas.
  it("no reclama nada si los choques apuntan a filas distintas", async () => {
    const filaAjena = {
      inversionista_id: 86,
      nombre: "Cube Investments",
      dpi: 1234567890123,
      email: "cube@example.com",
      creado_por_usuario_portal: null,
    };
    selectResponses = [[filaDeAna], [filaAjena], [filaDeAna]];
    const set = { status: 200 };

    const result = await insertInvestor({ body: altaDeAna, set });

    expect(set.status).toBe(409);
    expect(insertWasCalled).toBeFalse();
    expect(updateWasCalled).toBeFalse();
  });

  // Un alta que no viene del registro del portal no tiene nada que reclamar:
  // carteraFront, el CRM y las importaciones dejan la marca en NULL.
  it("un alta sin marca sigue chocando con 409", async () => {
    selectResponses = [[filaDeAna], [filaDeAna], [filaDeAna]];
    const set = { status: 200 };

    const { creado_por_usuario_portal: _sinMarca, ...altaAjena } = altaDeAna;
    const result = await insertInvestor({ body: altaAjena, set });

    expect(set.status).toBe(409);
    expect(result.error).toBe("duplicate_email");
    expect(insertWasCalled).toBeFalse();
  });

  it("sin choque ninguno crea la fila y la sella, como siempre", async () => {
    selectResponses = [[], [], []];
    const set = { status: 200 };

    await insertInvestor({ body: altaDeAna, set });

    expect(insertWasCalled).toBeTrue();
    expect(lastInsertData?.creado_por_usuario_portal).toBe(CUENTA_DE_ANA);
  });
});

// El correo es la identidad del inversionista en el portal: es lo que resuelve
// a quién se le escriben los datos de cobro. La columna guarda minúsculas —los
// INSERT de este mismo controller normalizan— pero la sesión de auth-google
// manda el correo tal cual lo escribió la persona, así que la búsqueda no puede
// distinguir mayúsculas o el titular no encuentra su propia fila.
describe("condicionInversionistaPorEmail", () => {
  const aSql = (condicion: unknown) =>
    new PgDialect().sqlToQuery(condicion as SQL);

  it("compara sin distinguir mayúsculas", () => {
    const consulta = aSql(condicionInversionistaPorEmail("Ana@Ejemplo.COM"));

    expect(consulta.sql.toLowerCase()).toContain("ilike");
    expect(consulta.params).toEqual(["ana@ejemplo.com"]);
  });

  it("da la misma condición sin importar cómo venga escrito el correo", () => {
    const comoLoEscribe = aSql(condicionInversionistaPorEmail("  Ana@Ejemplo.COM "));
    const comoEstaGuardado = aSql(condicionInversionistaPorEmail("ana@ejemplo.com"));

    expect(comoLoEscribe.sql).toBe(comoEstaGuardado.sql);
    expect(comoLoEscribe.params).toEqual(comoEstaGuardado.params);
  });
});
