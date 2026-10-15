import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/** El gancho debe estar al nivel de la tx, no dentro de un `if`: entre `desde` y el gancho las llaves quedan balanceadas. */
const fueraDeBloques = (src: string, desde: number, gancho: number) => {
  let nivel = 0;
  for (const c of src.slice(desde, gancho)) { if (c === "{") nivel++; else if (c === "}") nivel--; }
  return nivel;
};
const leer = (nombre: string) => readFileSync(new URL(`./${nombre}`, import.meta.url), "utf8");

describe("anularPagoMora.ts (falsePayment): la anulación va DESPUÉS de restituir L y sin condicionar al estado", () => {
  const src = leer("anularPagoMora.ts");
  const restitucion = src.indexOf("const resultadoMora = await deps.updateMora({");
  const gancho = src.indexOf("await deps.anularCondonacionBoletaTardia?.({");
  test("orden: restitución de la mora legítima → gancho", () => {
    expect(restitucion).toBeGreaterThan(-1);
    expect(gancho).toBeGreaterThan(restitucion);
  });
  test("lleva crédito, intento de la fila, acción, actor y la tx del llamador", () => {
    const bloque = src.slice(gancho, gancho + 420);
    expect(bloque).toContain("credito_id,");
    expect(bloque).toContain("boleta_tardia_intento_id: pagoPrevio?.boletaTardiaIntentoId");
    expect(bloque).toContain('accion: "anulo"');
    expect(bloque).toContain("usuario_email,");
    expect(bloque).toContain("dbClient: tx");
  });
  test("NO está condicionado a que el pago estuviera pending (también el validado)", () => {
    expect(src.slice(gancho - 140, gancho)).not.toContain('validationStatus === "pending"');
  });
  test("el gancho está FUERA del `if (pending)` de Nexa", () => {
    const nexa = src.indexOf('if (pagoPrevio?.validationStatus === "pending") {');
    expect(nexa).toBeGreaterThan(-1);
    expect(nexa).toBeLessThan(gancho);
    expect(fueraDeBloques(src, nexa, gancho)).toBe(0);
  });
  test("pagoPrevio lee boletaTardiaIntentoId", () => {
    expect(src).toContain("boletaTardiaIntentoId: pagos_credito.boletaTardiaIntentoId");
  });
});

describe("reversePayment.ts: la anulación va DESPUÉS de la restitución y del ledger", () => {
  const src = leer("reversePayment.ts");
  const restitucion = src.indexOf("const reverseMoraResult = await dependencies.restituirMora({");
  const ledger = src.indexOf('await revertirMoraPagadaDePago({ pago_id, tipo: "REVERSA" }, tx);');
  const gancho = src.indexOf("await dependencies.anularCondonacionBoletaTardia?.({");
  test("orden: restitución → ledger → gancho", () => {
    expect(restitucion).toBeGreaterThan(-1);
    expect(ledger).toBeGreaterThan(restitucion);
    expect(gancho).toBeGreaterThan(ledger);
  });
  test("lleva crédito, el intento de la fila leída al inicio, la acción, el actor y la tx", () => {
    const bloque = src.slice(gancho, gancho + 420);
    expect(bloque).toContain("credito_id,");
    expect(bloque).toContain("boleta_tardia_intento_id: pago.boletaTardiaIntentoId");
    expect(bloque).toContain('accion: "revirtio"');
    expect(bloque).toContain("usuario_email,");
    expect(bloque).toContain("dbClient: tx as unknown as typeof db");
  });
  test("NO está condicionado a que el pago estuviera pending", () => {
    expect(src.slice(gancho - 140, gancho)).not.toContain('validationStatus === "pending"');
  });
  test("el gancho está FUERA del `if (pending)` de Nexa", () => {
    const nexa = src.indexOf('if (pago.validationStatus === "pending") {');
    expect(nexa).toBeGreaterThan(-1);
    expect(nexa).toBeLessThan(gancho);
    expect(fueraDeBloques(src, nexa, gancho)).toBe(0);
  });
  test("los dos resets a no_required limpian la marca del intento (hueco 2 de T4)", () => {
    const n = src.split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l) && l.includes("boletaTardiaIntentoId: null")).length;
    expect(n).toBe(2);
  });
});

describe("revertPaymentToPending NO anula la condonación: el pago sigue vivo", () => {
  const src = leer("revertPaymentToPending.ts");
  test("no referencia la anulación de boleta tardía y lo deja documentado", () => {
    expect(src).not.toContain("anularCondonacionBoletaTardia");
    expect(src).not.toContain("condonacionBoletaTardiaAnulacion");
    expect(src).toContain("NO anula la condonación por boleta tardía");
  });
});
