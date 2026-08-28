import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

const previousDatabaseUrl = process.env.SUPABASE_DB_URL;
process.env.SUPABASE_DB_URL = "postgresql://127.0.0.1:1/synthetic";
const {
  decidirAjusteAlReconstruirCuota1,
  debeRestaurarTotalesBoletaAjuste,
  prepararAjusteFechaIdealParaReconstruccion,
  reattachAjusteFechaIdealReconstruido,
  seleccionarPagosCanonicosPorCuota,
} = await import("./ajusteFechaIdealPago");
if (previousDatabaseUrl === undefined) process.env.SUPABASE_DB_URL = undefined;
else process.env.SUPABASE_DB_URL = previousDatabaseUrl;

describe("decidirAjusteAlReconstruirCuota1", () => {
  it("no hace nada si la reconstrucción no llega a la cuota 1", () => {
    expect(
      decidirAjusteAlReconstruirCuota1({
        hastaCuota: 0,
        ajustePrevio: { id: 1, montoTotal: "30.00", fechaCobro: null },
      }),
    ).toEqual({ kind: "ninguna" });
  });

  it("no hace nada si el crédito no tiene ningún ajuste", () => {
    expect(
      decidirAjusteAlReconstruirCuota1({
        hastaCuota: 3,
        ajustePrevio: null,
      }),
    ).toEqual({ kind: "ninguna" });
  });

  it("reengancha si el ajuste ya tenía fecha_cobro (se cobró de verdad antes)", () => {
    expect(
      decidirAjusteAlReconstruirCuota1({
        hastaCuota: 1,
        ajustePrevio: { id: 7, montoTotal: "30.00", fechaCobro: new Date("2026-01-15") },
      }),
    ).toEqual({ kind: "reenganchar", ajusteId: 7, montoTotal: "30.00" });
  });

  it("reabre si el ajuste nunca se cobró (sin evidencia de que haya entrado)", () => {
    expect(
      decidirAjusteAlReconstruirCuota1({
        hastaCuota: 1,
        ajustePrevio: { id: 7, montoTotal: "30.00", fechaCobro: null },
      }),
    ).toEqual({ kind: "reabrir" });
  });

  it("reengancha aunque hastaCuota cubra más cuotas, mientras incluya la 1", () => {
    expect(
      decidirAjusteAlReconstruirCuota1({
        hastaCuota: 5,
        ajustePrevio: { id: 9, montoTotal: "12.34", fechaCobro: new Date() },
      }),
    ).toEqual({ kind: "reenganchar", ajusteId: 9, montoTotal: "12.34" });
  });

  it("no vuelve a sumar si el ajuste ya apunta al pago reconstruido de cuota 1", () => {
    expect(
      decidirAjusteAlReconstruirCuota1({
        hastaCuota: 1,
        ajustePrevio: {
          id: 9,
          montoTotal: "12.34",
          fechaCobro: new Date(),
          pagoId: 700,
        },
        pagoCuota1Id: 700,
      }),
    ).toEqual({ kind: "ya_reenganchado", montoTotal: "12.34" });
  });
});

describe("debeRestaurarTotalesBoletaAjuste", () => {
  const accion = { kind: "ya_reenganchado", montoTotal: "50" } as const;

  it("restaura solo si SIFCO reescribió ese pago en esta ejecución", () => {
    expect(
      debeRestaurarTotalesBoletaAjuste({
        accion,
        pagoCuota1Id: 101,
        pagosActualizados: [101],
      }),
    ).toBe(true);
  });

  it("no duplica totales al reejecutar sobre una fila pagada no modificada", () => {
    expect(
      debeRestaurarTotalesBoletaAjuste({
        accion,
        pagoCuota1Id: 101,
        pagosActualizados: [],
      }),
    ).toBe(false);
  });
});

describe("seleccionarPagosCanonicosPorCuota", () => {
  const rows = [
    { cuota_id: 51, numero_cuota: 1, pago_id: 900 },
    { cuota_id: 51, numero_cuota: 1, pago_id: 700 },
    { cuota_id: 52, numero_cuota: 2, pago_id: 800 },
    { cuota_id: 52, numero_cuota: 2, pago_id: 850 },
  ];

  it("prefiere en cuota 1 el pago vinculado aunque no sea el de mayor id", () => {
    expect(seleccionarPagosCanonicosPorCuota(rows, 700)).toEqual([
      rows[1],
      rows[3],
    ]);
  });

  it("sin vínculo disponible usa el pago más reciente por cuota", () => {
    expect(seleccionarPagosCanonicosPorCuota(rows, null)).toEqual([
      rows[0],
      rows[3],
    ]);
  });
});

describe("ajuste por fecha ideal durante reconstruccion", () => {
  it.each(["", "0"])(
    "preserva Q50 cobrados en otros=%p y cambia su pago_id al reconstruir cuota 1",
    async (otros) => {
    const updates: object[] = [];
    const executor = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: 7, monto_total: "50.00" }],
          }),
        }),
      }),
      update: () => ({
        set: (values: object) => {
          updates.push(values);
          return {
            where: () => ({
              returning: async () => [{ id: 7 }],
            }),
          };
        },
      }),
    } as unknown as Parameters<
      typeof prepararAjusteFechaIdealParaReconstruccion
    >[1];

    const ajusteId = await prepararAjusteFechaIdealParaReconstruccion(
      10,
      executor,
    );
    await reattachAjusteFechaIdealReconstruido(
      ajusteId,
      [
        { cuota_id: 50, numero_cuota: 0 },
        { cuota_id: 51, numero_cuota: 1 },
      ],
      [
        { pago_id: 100, cuota_id: 50, otros: "0" },
        {
          pago_id: 101,
          cuota_id: 51,
          otros,
          monto_boleta: "300.00",
          monto_boleta_cuota: "300.00",
        },
      ],
      executor,
    );

      expect(ajusteId).toEqual({ id: 7, monto_total: "50.00" });
      expect(updates).toEqual([
        { pago_id: 101 },
        {
          otros: "50",
          monto_boleta: "350",
          monto_boleta_cuota: "350",
        },
      ]);
    },
  );

  it("suma el ajuste a otros legitimos del pago reconstruido", async () => {
    const updates: object[] = [];
    const executor = {
      update: () => ({
        set: (values: object) => {
          updates.push(values);
          return {
            where: () => ({ returning: async () => [{ id: 7 }] }),
          };
        },
      }),
    } as unknown as Parameters<typeof reattachAjusteFechaIdealReconstruido>[3];

    await reattachAjusteFechaIdealReconstruido(
      { id: 7, monto_total: "50.00" },
      [{ cuota_id: 51, numero_cuota: 1 }],
      [
        {
          pago_id: 101,
          cuota_id: 51,
          otros: "20.00",
          monto_boleta: "320.00",
          monto_boleta_cuota: "320.00",
        },
      ],
      executor,
    );

    expect(updates).toEqual([
      { pago_id: 101 },
      {
        otros: "70",
        monto_boleta: "370",
        monto_boleta_cuota: "370",
      },
    ]);
  });

  it("no vuelve a sumar un ajuste que ya fue reenlazado", async () => {
    const updates: object[] = [];
    const executor = {
      update: () => ({
        set: (values: object) => {
          updates.push(values);
          return {
            where: () => ({
              returning: async () =>
                "pago_id" in values ? [] : [{ pago_id: 101 }],
            }),
          };
        },
      }),
    } as unknown as Parameters<typeof reattachAjusteFechaIdealReconstruido>[3];

    await expect(
      reattachAjusteFechaIdealReconstruido(
        { id: 7, monto_total: "50.00" },
        [{ cuota_id: 51, numero_cuota: 1 }],
        [{ pago_id: 101, cuota_id: 51, otros: "50.00" }],
        executor,
      ),
    ).rejects.toThrow("No se pudo reenlazar el ajuste 7");
    expect(updates).toEqual([{ pago_id: 101 }]);
  });

  it("no cambia pagos ni ajustes cuando no hay ajuste cobrado", async () => {
    const executor = {
      update: () => {
        throw new Error("no debe actualizar sin ajuste cobrado");
      },
    } as unknown as Parameters<typeof reattachAjusteFechaIdealReconstruido>[3];

    await expect(
      reattachAjusteFechaIdealReconstruido(
        null,
        [{ cuota_id: 51, numero_cuota: 1 }],
        [{ pago_id: 101, cuota_id: 51, otros: "20.00" }],
        executor,
      ),
    ).resolves.toBeUndefined();
  });

  it("mantiene el reset anterior cuando no hay ajuste cobrado enlazado", async () => {
    const updates: object[] = [];
    const executor = {
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [] }) }),
      }),
      update: () => ({
        set: (values: object) => {
          updates.push(values);
          return {
            where: () => ({ returning: async () => [] }),
          };
        },
      }),
    } as unknown as Parameters<
      typeof prepararAjusteFechaIdealParaReconstruccion
    >[1];

    expect(
      await prepararAjusteFechaIdealParaReconstruccion(10, executor),
    ).toBeNull();
    expect(updates).toEqual([{ fecha_cobro: null, pago_id: null }]);
  });

  it("falla dentro de la reconstruccion si no existe replacement para cuota 1", async () => {
    const executor = {
      update: () => {
        throw new Error("no debe actualizar sin pago de cuota 1");
      },
    } as unknown as Parameters<typeof reattachAjusteFechaIdealReconstruido>[3];

    expect(
      reattachAjusteFechaIdealReconstruido(
        { id: 7, monto_total: "50.00" },
        [{ cuota_id: 50, numero_cuota: 0 }],
        [{ pago_id: 100, cuota_id: 50, otros: "0" }],
        executor,
      ),
    ).rejects.toThrow("No se pudo reconstruir el pago de la cuota 1");
  });

  it("usa el helper compartido con tx en las tres reconstrucciones", async () => {
    const [excel, migration] = await Promise.all([
      readFile(new URL("./processFromExcelFull.ts", import.meta.url), "utf8"),
      readFile(new URL("../migration/migration.ts", import.meta.url), "utf8"),
    ]);

    expect(
      excel.match(
        /prepararAjusteFechaIdealParaReconstruccion\([\s\S]*?tx,\s*\)/g,
      ),
    ).toHaveLength(1);
    expect(
      excel.match(/reattachAjusteFechaIdealReconstruido\([\s\S]*?tx,\s*\)/g),
    ).toHaveLength(1);
    expect(
      migration.match(
        /prepararAjusteFechaIdealParaReconstruccion\([\s\S]*?tx,\s*\)/g,
      ),
    ).toHaveLength(2);
    expect(
      migration.match(
        /reattachAjusteFechaIdealReconstruido\([\s\S]*?tx,\s*\)/g,
      ),
    ).toHaveLength(2);
  });

});
