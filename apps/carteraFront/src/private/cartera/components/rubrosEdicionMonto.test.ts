import { describe, expect, it } from "bun:test";
import { motivoMontoNoEditable } from "./rubrosEdicionMonto";

// ─────────────────────────────────────────────────────────────────────────────
// El backend rechaza con 409 si el monto nuevo es MENOR a lo ya abonado: bajarlo
// por debajo dejaría el rubro debiendo negativo. El formulario sólo pedía
// "mayor a cero", así que el admin llenaba el motivo, enviaba, y se comía el
// rechazo con el formulario lleno.
//
// Es el mismo patrón que el desplegable de tipos —la pantalla ofreciendo lo que
// el backend va a rechazar— y el dato ya está en la fila: `abonado` viene del
// GET de la lista.
// ─────────────────────────────────────────────────────────────────────────────

describe("motivoMontoNoEditable", () => {
  it("un monto por encima de lo abonado se puede guardar", () => {
    expect(motivoMontoNoEditable({ monto: "800", abonado: "200.00" })).toBeNull();
  });

  it("igual a lo abonado también: deja el rubro en cero, que es válido", () => {
    expect(motivoMontoNoEditable({ monto: "200", abonado: "200.00" })).toBeNull();
  });

  it("🔴 por debajo de lo abonado NO, y el motivo dice el piso", () => {
    const m = motivoMontoNoEditable({ monto: "150", abonado: "200.00" });
    expect(m).toContain("200.00");
    expect(m).toContain("abonado");
  });

  it("sin abonos, cualquier monto positivo sirve", () => {
    expect(motivoMontoNoEditable({ monto: "1", abonado: "0.00" })).toBeNull();
  });

  it("el cero y lo negativo se rechazan antes que el piso", () => {
    expect(motivoMontoNoEditable({ monto: "0", abonado: "0.00" })).toContain("mayor a cero");
    expect(motivoMontoNoEditable({ monto: "-5", abonado: "0.00" })).toContain("mayor a cero");
  });

  it("lo no numérico también", () => {
    expect(motivoMontoNoEditable({ monto: "", abonado: "0.00" })).toContain("mayor a cero");
    expect(motivoMontoNoEditable({ monto: "abc", abonado: "0.00" })).toContain("mayor a cero");
  });

  it("compara al centavo, como el backend", () => {
    // El backend redondea antes de comparar; 199.994 redondea a 199.99 y no
    // alcanza los 200 abonados.
    expect(motivoMontoNoEditable({ monto: "199.994", abonado: "200.00" })).not.toBeNull();
    expect(motivoMontoNoEditable({ monto: "199.996", abonado: "200.00" })).toBeNull();
  });

  it("un `abonado` que no llega se trata como cero, no bloquea", () => {
    // Ante la duda se OFRECE: el backend es la autoridad y su 409 viene
    // redactado. Bloquear con un dato que no tenemos deja al ADMIN sin salida.
    expect(motivoMontoNoEditable({ monto: "10", abonado: undefined })).toBeNull();
  });
});
