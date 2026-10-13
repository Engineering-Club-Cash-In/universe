import { expect, it } from "bun:test";
import { resolverPreflightCaido } from "./guardaCaidoNexa";

// Simula el modal: consulta pendiente -> el operador cierra -> la consulta resuelve con 0 pagos.
function simular(cerrarAntes: boolean, pagos: any) {
  let intento = 0;
  const mutacionCaido = { llamadas: 0 };
  let resolver!: (v: any) => void;
  const consulta = new Promise((r) => (resolver = r));
  const mio = ++intento;
  const corrida = consulta.then((p) => {
    const r = resolverPreflightCaido(p as any, () => mio === intento);
    if (r === "marcar") mutacionCaido.llamadas++;
    return r;
  });
  if (cerrarAntes) intento++; // handleClose
  resolver(pagos);
  return corrida.then((r) => ({ r, mutacionCaido }));
}

it("cerrar con la consulta pendiente: resolver con 0 pagos NO marca CAÍDO", async () => {
  const { r, mutacionCaido } = await simular(true, { cantidad: 0, montoTotal: "0" });
  expect(r).toBe("cancelado");
  expect(mutacionCaido.llamadas).toBe(0);
});

it("cerrar con la consulta pendiente: tampoco abre la advertencia", async () => {
  const { r } = await simular(true, { cantidad: 3, montoTotal: "300" });
  expect(r).toBe("cancelado");
});

it("sin cerrar, 0 pagos marca (camino normal)", async () => {
  const { r, mutacionCaido } = await simular(false, { cantidad: 0, montoTotal: "0" });
  expect(r).toBe("marcar");
  expect(mutacionCaido.llamadas).toBe(1);
});
