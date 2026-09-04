import { describe, expect, it, mock, beforeEach } from "bun:test";

// Evita que database/index.ts abra la conexión al importar el controller.
// El mock sirve filas por tabla (identidad del objeto de schema) y captura
// los insert para afirmar sobre lo que se guardaría.
type MockRow = {
  inversionista_id?: number;
  tipo_reinversion?: string | null;
  id?: number;
  monto_desde?: string;
  monto_hasta?: string | null;
  modalidad?: "p2p_directa" | "factura_cube" | "factura_cube_pequeno";
  spread?: string;
  tasa?: string;
  created_at?: null;
};

let rowsPorTabla: Map<unknown, MockRow[]>;
let spreadQueryRows: MockRow[][] | undefined;
let spreadQueryIndex = 0;
const inserted: { table: unknown; values: Record<string, unknown>[] }[] = [];

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      const rows = () => Promise.resolve(
        table === modalidad_facturacion_spread && spreadQueryRows
          ? spreadQueryRows[spreadQueryIndex++] ?? []
          : rowsPorTabla.get(table) ?? [],
      );
      const query = Object.assign(rows(), {
        limit: rows,
        orderBy: rows,
      });
      return {
        where: () => query,
      };
    },
  }),
  insert: (table: unknown) => ({
    values: (vals: Record<string, unknown> | Record<string, unknown>[]) => {
      inserted.push({ table, values: Array.isArray(vals) ? vals : [vals] });
      return Promise.resolve();
    },
  }),
  delete: () => ({ where: () => Promise.resolve() }),
};
mock.module("../database", () => ({ db: dbMock, client: {}, lockPool: {} }));
mock.module("../services/sifcoIntegrations", () => ({
  consultarEstadoCuentaPrestamo: () => Promise.resolve(null),
}));

const {
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  compras_credito_inversionista,
  inversionistas,
  modalidad_facturacion_spread,
} = await import("../database/db");

const { validarInversionistasNuevos, registrarComprasInversionistasNuevos, updateInvestors } =
  await import("./updateCredit");

const CREDITO_ID = 123;

// Inversionista base del payload (los campos que mira la validación).
const invPayload = (
  id: number,
  extra?: Partial<{
    es_nuevo: boolean;
    tipo_operacion: "compra_cartera" | "reinversion";
    monto_aportado: number;
    porcentaje_cash_in: number;
    porcentaje_inversion: number;
    fecha_inicio_participacion: string;
    modalidad_facturacion: "p2p_directa" | "factura_cube" | "factura_cube_pequeno";
    modalidad_facturacion_spread_id: number;
    tipo_reinversion: "sin_reinversion" | "reinversion_capital" | "reinversion_interes" | "reinversion_total" | "reinversion_excedente" | "reinversion_variable";
  }>,
) => ({
  inversionista_id: id,
  monto_aportado: 5000,
  porcentaje_cash_in: 20,
  porcentaje_inversion: 80,
  tipo_reinversion: "reinversion_capital" as const,
  ...(extra?.tipo_operacion === "reinversion" ? {} : {
    modalidad_facturacion: "factura_cube" as const,
    modalidad_facturacion_spread_id: 1,
  }),
  ...extra,
});

const setRows = (opts?: {
  padre?: number[];
  espejo?: number[];
  /** Compras del crédito que siguen con pendiente_facturar = true. */
  comprasPendientes?: number[];
  tiposReinv?: Record<number, string>;
  spreads?: MockRow[];
  spreadQueries?: MockRow[][];
}) => {
  rowsPorTabla = new Map();
  spreadQueryRows = opts?.spreadQueries;
  spreadQueryIndex = 0;
  rowsPorTabla.set(
    creditos_inversionistas,
    (opts?.padre ?? []).map((id) => ({ inversionista_id: id })),
  );
  rowsPorTabla.set(
    creditos_inversionistas_espejo,
    (opts?.espejo ?? []).map((id) => ({ inversionista_id: id })),
  );
  rowsPorTabla.set(
    compras_credito_inversionista,
    (opts?.comprasPendientes ?? []).map((id) => ({ inversionista_id: id })),
  );
  rowsPorTabla.set(
    inversionistas,
    Object.entries(opts?.tiposReinv ?? {}).map(([id, tipo]) => ({
      inversionista_id: Number(id),
      tipo_reinversion: tipo,
    })),
  );
  rowsPorTabla.set(modalidad_facturacion_spread, opts?.spreads ?? [{
    id: 1,
    monto_desde: "1000",
    monto_hasta: null,
    modalidad: "factura_cube",
    spread: "80",
    tasa: "0",
    created_at: null,
  }]);
};

const makeSet = () => ({ status: 0 });

beforeEach(() => {
  inserted.length = 0;
  setRows();
});

describe("validarInversionistasNuevos — regla 1: nadie entra sin declararse", () => {
  it("rechaza un inversionista que no está en el crédito y no viene declarado como nuevo (el bug original)", async () => {
    setRows({ padre: [1], espejo: [1] });
    const set = makeSet();
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(99)], // 99 se coló sin declarar
      [invPayload(1)],
      set,
    );
    expect(res.success).toBe(false);
    expect(set.status).toBe(400);
    if (!res.success) expect(res.error.message).toContain("no participa en este crédito");
  });

  it("rechaza un espejo que no está en ninguna tabla ni viene declarado en el padre", async () => {
    setRows({ padre: [1], espejo: [1] });
    const set = makeSet();
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1)],
      [invPayload(1), invPayload(99)],
      set,
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.message).toContain("espejo");
  });

  it("acepta el backfill del espejo desde el padre (créditos importados sin espejo)", async () => {
    // processFromExcelFull deja inversionistas SOLO en el padre; el modal
    // sintetiza el espejo desde el padre para reconstruirlo al guardar. Ese
    // espejo "nuevo en tabla" NO es un colado: su ID ya participa en el
    // crédito vía padre. (Hallazgo P1 de Codex en el PR #1268.)
    setRows({ padre: [1, 2], espejo: [1] }); // el 2 no tiene espejo aún
    const set = makeSet();
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(2)],
      [invPayload(1), invPayload(2)], // backfill del 2 sintetizado por el modal
      set,
    );
    expect(res.success).toBe(true);
    if (res.success) expect(res.nuevos).toEqual([]);
  });

  it("rechaza inversionistas duplicados en el payload", async () => {
    setRows({ padre: [1] });
    const set = makeSet();
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(1)],
      [],
      set,
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.message).toContain("más de una vez");
  });
});

describe("validarInversionistasNuevos — regla 2: el nuevo no puede estar HOY en el crédito", () => {
  it("rechaza un es_nuevo que sigue en el padre (borrar y volver a agregar en la misma edición)", async () => {
    // El operador lo borró de la lista y lo re-agregó como nuevo, pero la DB
    // aún lo tiene: la validación corre ANTES del nuke & rebuild.
    setRows({ padre: [7], espejo: [7] });
    const set = makeSet();
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(7, { es_nuevo: true, tipo_operacion: "compra_cartera" })],
      [],
      set,
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.message).toContain("ya participa en este crédito");
  });

  it("rechaza un es_nuevo que solo está en el espejo", async () => {
    setRows({ padre: [1], espejo: [1, 7] });
    const set = makeSet();
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(7, { es_nuevo: true, tipo_operacion: "compra_cartera" })],
      [invPayload(1), invPayload(7, { es_nuevo: true, tipo_operacion: "compra_cartera" })],
      set,
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.message).toContain("ya participa en este crédito");
  });

  it("ACEPTA un es_nuevo que participó y ya salió del crédito (rotación de pool)", async () => {
    // Caso real: Cube salió del crédito cuando otro inversionista reinvirtió
    // sobre él y meses después vuelve a entrar. Tiene compras y pagos espejo
    // viejos, pero no está en padre ni en espejo → puede volver.
    setRows({ padre: [1], espejo: [1] });
    const set = makeSet();
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(86, { es_nuevo: true, tipo_operacion: "compra_cartera" })],
      [invPayload(1), invPayload(86, { es_nuevo: true, tipo_operacion: "compra_cartera" })],
      set,
    );
    expect(res.success).toBe(true);
    if (res.success) expect(res.nuevos.map((n) => n.inversionista_id)).toEqual([86]);
  });
});

describe("validarInversionistasNuevos — regla 3: una sola compra pendiente por crédito", () => {
  it("rechaza dos compra_cartera en la misma edición (cofidi prorratea una sola fecha de corte)", async () => {
    setRows({ padre: [1], espejo: [1] });
    const set = makeSet();
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [
        invPayload(1),
        invPayload(7, { es_nuevo: true, tipo_operacion: "compra_cartera" }),
        invPayload(8, { es_nuevo: true, tipo_operacion: "compra_cartera" }),
      ],
      [],
      set,
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.message).toContain("una compra de cartera a la vez");
      expect(res.error.inversionistas_ids).toEqual([7, 8]);
    }
  });

  it("rechaza una compra_cartera si el crédito ya tiene otra pendiente de facturar", async () => {
    setRows({ padre: [1], espejo: [1], comprasPendientes: [5] });
    const set = makeSet();
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(7, { es_nuevo: true, tipo_operacion: "compra_cartera" })],
      [],
      set,
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.message).toContain("compra pendiente de facturar");
      expect(res.error.compra_pendiente_inversionista_id).toBe(5);
    }
  });

  it("acepta varias reinversiones juntas (nacen sin pendiente_facturar)", async () => {
    setRows({ padre: [1], espejo: [1], comprasPendientes: [5] });
    const set = makeSet();
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [
        invPayload(1),
        invPayload(7, { es_nuevo: true, tipo_operacion: "reinversion" }),
        invPayload(8, { es_nuevo: true, tipo_operacion: "reinversion" }),
      ],
      [
        invPayload(1),
        invPayload(7, { es_nuevo: true, tipo_operacion: "reinversion" }),
        invPayload(8, { es_nuevo: true, tipo_operacion: "reinversion" }),
      ],
      set,
    );
    expect(res.success).toBe(true);
    if (res.success) expect(res.nuevos.map((n) => n.inversionista_id)).toEqual([7, 8]);
  });
});

describe("validarInversionistasNuevos — regla 4: crédito excluido de compras", () => {
  it("rechaza una compra_cartera si el crédito está excluido de compras", async () => {
    setRows({ padre: [1], espejo: [1] });
    const set = makeSet();
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(7, { es_nuevo: true, tipo_operacion: "compra_cartera" })],
      [invPayload(1), invPayload(7, { es_nuevo: true, tipo_operacion: "compra_cartera" })],
      set,
      true,
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.message).toContain("excluido de las compras");
      expect(res.error.inversionistas_ids).toEqual([7]);
    }
  });

  it("rechaza también una reinversión: un es_nuevo puede ser capital entrando de cero", async () => {
    setRows({ padre: [1], espejo: [1] });
    const set = makeSet();
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(7, { es_nuevo: true, tipo_operacion: "reinversion" })],
      [],
      set,
      true,
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.message).toContain("excluido de las compras");
      expect(res.error.inversionistas_ids).toEqual([7]);
    }
  });

  it("no estorba cuando la edición no trae inversionistas nuevos", async () => {
    setRows({ padre: [1, 7], espejo: [1, 7] });
    const set = makeSet();
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(7)],
      [],
      set,
      true,
    );
    expect(res.success).toBe(true);
    if (res.success) expect(res.nuevos).toEqual([]);
  });

  it("permite la compra_cartera si el crédito no está excluido", async () => {
    setRows({ padre: [1], espejo: [1] });
    const set = makeSet();
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(7, { es_nuevo: true, tipo_operacion: "compra_cartera" })],
      [invPayload(1), invPayload(7, { es_nuevo: true, tipo_operacion: "compra_cartera" })],
      set,
      false,
    );
    expect(res.success).toBe(true);
    if (res.success) expect(res.nuevos.map((n) => n.inversionista_id)).toEqual([7]);
  });
});

describe("validarInversionistasNuevos — datos mínimos del nuevo", () => {
  it("rechaza una compra nueva si falta del espejo que se va a reconstruir", async () => {
    setRows({ padre: [1], espejo: [1] });
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(7, { es_nuevo: true, tipo_operacion: "compra_cartera" })],
      [invPayload(1)],
      makeSet(),
    );

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.message).toContain("espejo");
  });

  it("rechaza una compra nueva cuando no se declaró una lista espejo", async () => {
    setRows({ padre: [1], espejo: [1] });
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(7, { es_nuevo: true, tipo_operacion: "compra_cartera" })],
      undefined,
      makeSet(),
    );

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.message).toContain("espejo");
  });

  it("normaliza los porcentajes de una compra nueva al spread seleccionado", async () => {
    setRows({ padre: [1], espejo: [1] });
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [
        invPayload(1),
        invPayload(7, {
          es_nuevo: true,
          tipo_operacion: "compra_cartera",
          porcentaje_cash_in: 99,
          porcentaje_inversion: 1,
        }),
      ],
      [invPayload(1), invPayload(7, { es_nuevo: true, tipo_operacion: "compra_cartera" })],
      makeSet(),
    );

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.nuevos[0]).toMatchObject({
        porcentaje_cash_in: 20,
        porcentaje_inversion: 80,
      });
    }
  });

  it("rechaza compra_cartera sin modalidad y spread juntos", async () => {
    setRows({ padre: [1] });
    const set = makeSet();
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(7, { es_nuevo: true, tipo_operacion: "compra_cartera", modalidad_facturacion: undefined, modalidad_facturacion_spread_id: undefined })],
      [],
      set,
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.message).toContain("modalidad_facturacion");
  });

  it("rechaza compra_cartera sin tipo_reinversion", async () => {
    setRows({ padre: [1] });
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(7, { es_nuevo: true, tipo_operacion: "compra_cartera", tipo_reinversion: undefined })],
      [],
      makeSet(),
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.message).toContain("tipo_reinversion");
  });

  it("rechaza reinversion nueva sin tipo_reinversion", async () => {
    setRows({ padre: [1], espejo: [1] });
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(7, { es_nuevo: true, tipo_operacion: "reinversion", tipo_reinversion: undefined })],
      [invPayload(1), invPayload(7, { es_nuevo: true, tipo_operacion: "reinversion", tipo_reinversion: undefined })],
      makeSet(),
    );

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.message).toContain("tipo_reinversion");
  });

  it("rechaza el spread inexistente", async () => {
    setRows({ padre: [1], spreads: [] });
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(7, { es_nuevo: true, tipo_operacion: "compra_cartera", tipo_reinversion: "reinversion_capital" })],
      [],
      makeSet(),
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.message).toContain("No existe un bracket");
  });

  it("rechaza un spread de otra modalidad", async () => {
    setRows({ padre: [1], spreads: [{ id: 1, modalidad: "p2p_directa" }] });
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(7, { es_nuevo: true, tipo_operacion: "compra_cartera", tipo_reinversion: "reinversion_capital" })],
      [],
      makeSet(),
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.message).toContain("pertenece a la modalidad");
  });

  it("rechaza una compra cuyo monto no tiene bracket", async () => {
    const spread: MockRow = { id: 1, modalidad: "factura_cube" };
    setRows({ padre: [1], spreadQueries: [[spread], []] });
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(7, { es_nuevo: true, tipo_operacion: "compra_cartera", tipo_reinversion: "reinversion_capital" })],
      [],
      makeSet(),
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.message).toContain("monto Q5000");
  });

  it("rechaza campos de facturación en reinversión", async () => {
    setRows({ padre: [1] });
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(7, {
        es_nuevo: true,
        tipo_operacion: "reinversion",
        modalidad_facturacion: "factura_cube",
      })],
      [],
      makeSet(),
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.message).toContain("solo aplica");
  });

  it("rechaza un es_nuevo sin tipo_operacion", async () => {
    setRows({ padre: [1] });
    const set = makeSet();
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(7, { es_nuevo: true })],
      [],
      set,
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.message).toContain("tipo de operación");
  });

  it("rechaza un es_nuevo con monto 0", async () => {
    setRows({ padre: [1] });
    const set = makeSet();
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [
        invPayload(1),
        invPayload(7, { es_nuevo: true, tipo_operacion: "compra_cartera", monto_aportado: 0 }),
      ],
      [],
      set,
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.message).toContain("monto aportado mayor a 0");
  });
});

describe("validarInversionistasNuevos — caso feliz", () => {
  it("acepta un nuevo limpio y lo devuelve normalizado para registrar la compra", async () => {
    setRows({ padre: [1], espejo: [1] });
    const set = makeSet();
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [
        invPayload(1),
        invPayload(7, {
          es_nuevo: true,
          tipo_operacion: "compra_cartera",
          monto_aportado: 8000,
          fecha_inicio_participacion: "2026-08-01",
          modalidad_facturacion: "factura_cube",
          modalidad_facturacion_spread_id: 4,
          tipo_reinversion: "reinversion_capital",
        }),
      ],
      [invPayload(1), invPayload(7, { es_nuevo: true, tipo_operacion: "compra_cartera" })],
      set,
    );
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.nuevos).toEqual([
        {
          inversionista_id: 7,
          monto_aportado: 8000,
          tipo_operacion: "compra_cartera",
          fecha_inicio_participacion: "2026-08-01",
          porcentaje_cash_in: 20,
          porcentaje_inversion: 80,
          modalidad_facturacion: "factura_cube",
          modalidad_facturacion_spread_id: 4,
          tipo_reinversion: "reinversion_capital",
          tipo_compra: "nueva_posicion",
        },
      ]);
    }
  });

  it("sin nuevos declarados ni colados, pasa sin consultar historial", async () => {
    setRows({ padre: [1, 2], espejo: [1, 2] });
    const set = makeSet();
    const res = await validarInversionistasNuevos(
      CREDITO_ID,
      [invPayload(1), invPayload(2)],
      [invPayload(1), invPayload(2)],
      set,
    );
    expect(res.success).toBe(true);
    if (res.success) expect(res.nuevos).toEqual([]);
  });
});

describe("registrarComprasInversionistasNuevos", () => {
  it("compra_cartera: nace completada, con fecha anclada a la participación a mediodía UTC y pendiente de facturar", async () => {
    setRows({ tiposReinv: { 7: "reinversion_capital" } });
    await registrarComprasInversionistasNuevos(CREDITO_ID, [
      {
        inversionista_id: 7,
        monto_aportado: 8000,
        tipo_operacion: "compra_cartera",
        modalidad_facturacion: "factura_cube",
        modalidad_facturacion_spread_id: 4,
        fecha_inicio_participacion: "2026-08-01",
        tipo_reinversion: "reinversion_total",
        tipo_compra: "nueva_posicion",
      },
    ]);

    expect(inserted.length).toBe(1);
    expect(inserted[0].table).toBe(compras_credito_inversionista);
    const row = inserted[0].values[0];
    expect(row.credito_id).toBe(CREDITO_ID);
    expect(row.inversionista_id).toBe(7);
    expect(row.monto_aportado).toBe("8000");
    expect(row.tipo_operacion).toBe("compra_cartera");
    expect(row.tipo_reinversion).toBe("reinversion_total");
    expect(row.modalidad_facturacion).toBe("factura_cube");
    expect(row.modalidad_facturacion_spread_id).toBe(4);
    expect(row.tipo_compra).toBe("nueva_posicion");
    expect(row.status).toBe("completado");
    expect(row.pendiente_facturar).toBe(true);
    expect(row.fecha_completada).toBeInstanceOf(Date);
    if (!(row.fecha_completada instanceof Date)) throw new Error("fecha_completada inválida");
    // Mismo anclaje que completeEspejo: mediodía UTC para que en hora GT
    // (UTC-6) siga siendo el mismo día/mes que eligió el operador.
    expect(row.fecha_completada.toISOString()).toBe("2026-08-01T12:00:00.000Z");
  });

  it("reinversion: nace completada al instante y sin factura", async () => {
    setRows({ tiposReinv: { 9: "sin_reinversion" } });
    const antes = Date.now();
    await registrarComprasInversionistasNuevos(CREDITO_ID, [
      {
        inversionista_id: 9,
        monto_aportado: 3000,
        tipo_operacion: "reinversion",
        tipo_reinversion: "reinversion_interes",
        fecha_inicio_participacion: "2026-05-01",
        tipo_compra: "sin_clasificar",
      },
    ]);

    const row = inserted[0].values[0];
    expect(row.tipo_operacion).toBe("reinversion");
    expect(row.tipo_reinversion).toBe("reinversion_interes");
    expect(row.status).toBe("completado");
    expect(row.pendiente_facturar).toBe(false);
    expect(row.fecha_completada).toBeInstanceOf(Date);
    if (!(row.fecha_completada instanceof Date)) throw new Error("fecha_completada inválida");
    // La reinversión no se ancla a la fecha de participación: se data al
    // instante real, igual que completeEspejo.
    expect(row.fecha_completada.getTime()).toBeGreaterThanOrEqual(antes);
    expect(row.fecha_completada.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("sin nuevos, no inserta nada", async () => {
    await registrarComprasInversionistasNuevos(CREDITO_ID, []);
    expect(inserted.length).toBe(0);
  });
});

describe("updateInvestors — espejo de inversionista nuevo", () => {
  it("persiste spread, modalidad y porcentajes autoritativos en padre y espejo", async () => {
    setRows({ espejo: [1] });
    const inversionistas = [
      invPayload(1),
      invPayload(7, {
        es_nuevo: true,
        tipo_operacion: "compra_cartera",
        porcentaje_cash_in: 99,
        porcentaje_inversion: 1,
        tipo_reinversion: "reinversion_total",
        modalidad_facturacion: "factura_cube",
        modalidad_facturacion_spread_id: 1,
      }),
    ];
    const args = [
      { cuota: "100", porcentaje_interes: "10" },
      { cuota: "100", capital: "10000", porcentaje_interes: "10" },
      "SIFCO-1",
      0,
      0,
      0,
    ] as const;
    await updateInvestors(CREDITO_ID, inversionistas, ...args, creditos_inversionistas);
    await updateInvestors(CREDITO_ID, inversionistas, ...args, creditos_inversionistas_espejo);

    for (const insert of inserted) {
      expect(insert.values[1]).toMatchObject({
        inversionista_id: 7,
        porcentaje_cash_in: "20",
        porcentaje_participacion_inversionista: "80",
      });
    }
    expect(inserted[1].values[1]).toMatchObject({
      tipo_reinversion: "reinversion_total",
      modalidad_facturacion: "factura_cube",
      modalidad_facturacion_spread_id: 1,
    });
  });
});
