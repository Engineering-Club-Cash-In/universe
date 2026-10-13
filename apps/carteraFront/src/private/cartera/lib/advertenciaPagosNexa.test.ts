import { describe, expect, it } from "bun:test";
import { debeAdvertirPagosNexa, textoAdvertenciaPagosNexa } from "./advertenciaPagosNexa";

describe("textoAdvertenciaPagosNexa", () => {
  it("varios pagos: plural y monto con formato", () => {
    expect(textoAdvertenciaPagosNexa({ cantidad: 5, montoTotal: "1600.5" }, "borrar")).toBe(
      "Este crédito tiene 5 pagos que entraron por Nexa (Q1,600.50). Esta operación los va a borrar. Nexa ya aprobó esas transferencias y no se pueden deshacer allá. ¿Continuar?",
    );
  });
  it("un pago: singular", () => {
    expect(textoAdvertenciaPagosNexa({ cantidad: 1, montoTotal: "300.00" }, "rehacer")).toContain(
      "1 pago que entró por Nexa (Q300.00). Esta operación los va a rehacer.",
    );
  });
  it("consulta fallida: texto genérico", () => {
    const t = textoAdvertenciaPagosNexa(null, "borrar");
    expect(t).toContain("No se pudo verificar");
    expect(t).toContain("¿Continuar?");
  });
});

describe("debeAdvertirPagosNexa", () => {
  it("cero no advierte; más de cero o consulta fallida sí", () => {
    expect(debeAdvertirPagosNexa({ cantidad: 0, montoTotal: "0" })).toBe(false);
    expect(debeAdvertirPagosNexa({ cantidad: 2, montoTotal: "10" })).toBe(true);
    expect(debeAdvertirPagosNexa(null)).toBe(true);
  });
});
