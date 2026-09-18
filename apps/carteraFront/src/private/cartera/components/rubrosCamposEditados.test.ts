import { describe, it, expect } from "bun:test";
import { camposRealmenteEditados } from "./rubrosCamposEditados";

describe("camposRealmenteEditados", () => {
  const original = { monto: "500.00", descripcion: "Placas 2026" };

  it("🔴 si sólo cambió la descripción, el monto NO se manda", () => {
    // Dos admins sobre el mismo rubro: A lo abre en Q500, B lo sube a Q800, y A
    // cambia sólo la descripción. Mandando el formulario entero, A reenvía el
    // Q500 viejo y el backend lo guarda como una edición de monto real, que
    // deshace lo de B sin que nadie se entere.
    const r = camposRealmenteEditados({ monto: "500.00", descripcion: "Placas 2027" }, original);
    expect(r.monto).toBeUndefined();
    expect(r.descripcion).toBe("Placas 2027");
  });

  it("si sólo cambió el monto, la descripción no se manda", () => {
    const r = camposRealmenteEditados({ monto: "800", descripcion: "Placas 2026" }, original);
    expect(r.monto).toBe(800);
    expect(r.descripcion).toBeUndefined();
  });

  it("si cambiaron los dos, van los dos", () => {
    const r = camposRealmenteEditados({ monto: "800", descripcion: "Otra" }, original);
    expect(r.monto).toBe(800);
    expect(r.descripcion).toBe("Otra");
  });

  it("si no cambió nada, no va nada", () => {
    const r = camposRealmenteEditados({ monto: "500.00", descripcion: "Placas 2026" }, original);
    expect(r.monto).toBeUndefined();
    expect(r.descripcion).toBeUndefined();
  });

  it("`500` y `500.00` son el MISMO monto: la grafía no es una edición", () => {
    // El backend guarda numeric(18,2), así que la fila vuelve como "500.00".
    // Comparar el texto crudo marcaría una edición que nadie hizo.
    const r = camposRealmenteEditados({ monto: "500", descripcion: "Placas 2026" }, original);
    expect(r.monto).toBeUndefined();
  });

  it("los espacios alrededor de la descripción tampoco son una edición", () => {
    const r = camposRealmenteEditados({ monto: "500.00", descripcion: "  Placas 2026  " }, original);
    expect(r.descripcion).toBeUndefined();
  });
});
