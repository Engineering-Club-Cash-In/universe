import { describe, expect, it, mock, beforeEach } from "bun:test";

// Evita que database/index.ts abra la conexión al importar el controller.
// El mock sirve filas por tabla (identidad del objeto de schema) y captura
// los insert para afirmar sobre lo que se guardaría.
let rowsPorTabla: Map<unknown, { inversionista_id: number; tipo_reinversion?: string | null }[]>;
const inserted: { table: unknown; values: any[] }[] = [];

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      const rows = () => Promise.resolve(rowsPorTabla.get(table) ?? []);
      return {
        where: () => Object.assign(rows(), { limit: rows }),
      };
    },
  }),
  insert: (table: unknown) => ({
    values: (vals: any) => {
      inserted.push({ table, values: Array.isArray(vals) ? vals : [vals] });
      return Promise.resolve();
    },
  }),
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
} = await import("../database/db");

const { validarInversionistasNuevos, registrarComprasInversionistasNuevos } =
  await import("./updateCredit");

const CREDITO_ID = 123;

// Inversionista base del payload (los campos que mira la validación).
const invPayload = (
  id: number,
  extra?: Partial<{
    es_nuevo: boolean;
    tipo_operacion: "compra_cartera" | "reinversion";
    monto_aportado: number;
    fecha_inicio_participacion: string;
  }>,
) => ({
  inversionista_id: id,
  monto_aportado: 5000,
  porcentaje_cash_in: 20,
  porcentaje_inversion: 80,
  ...extra,
});

const setRows = (opts?: {
  padre?: number[];
  espejo?: number[];
  /** Compras del crédito que siguen con pendiente_facturar = true. */
  comprasPendientes?: number[];
  tiposReinv?: Record<number, string>;
}) => {
  rowsPorTabla = new Map();
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
      [],
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
      [],
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
      [],
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
      [],
      set,
      false,
    );
    expect(res.success).toBe(true);
    if (res.success) expect(res.nuevos.map((n) => n.inversionista_id)).toEqual([7]);
  });
});

describe("validarInversionistasNuevos — datos mínimos del nuevo", () => {
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
        fecha_inicio_participacion: "2026-08-01",
      },
    ]);

    expect(inserted.length).toBe(1);
    expect(inserted[0].table).toBe(compras_credito_inversionista);
    const row = inserted[0].values[0];
    expect(row.credito_id).toBe(CREDITO_ID);
    expect(row.inversionista_id).toBe(7);
    expect(row.monto_aportado).toBe("8000");
    expect(row.tipo_operacion).toBe("compra_cartera");
    expect(row.tipo_reinversion).toBe("reinversion_capital");
    expect(row.status).toBe("completado");
    expect(row.pendiente_facturar).toBe(true);
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
        fecha_inicio_participacion: "2026-05-01",
      },
    ]);

    const row = inserted[0].values[0];
    expect(row.tipo_operacion).toBe("reinversion");
    expect(row.status).toBe("completado");
    expect(row.pendiente_facturar).toBe(false);
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
