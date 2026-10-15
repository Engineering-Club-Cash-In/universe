import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./payments.ts", import.meta.url), "utf8");
const i = src.indexOf('.post("/pagos/boleta-tardia/preview"');

test("existe la ruta de vista previa, con rol ASESOR/ADMIN y body acotado", () => {
  expect(i).toBeGreaterThan(-1);
  const ruta = src.slice(i, i + 1400);
  expect(ruta).toContain('rechazoSiNoEsRolActivo(user, set, ["ASESOR", "ADMIN"])');
  expect(ruta).toContain("vistaPreviaBoletaTardia(body)");
  expect(ruta).toContain("credito_id: t.Integer({ minimum: 1 })");
  expect(ruta).toContain("otros: t.Optional(t.Number({ minimum: 0 }))");
  expect(ruta).toContain("abono_directo_capital: t.Optional(t.Number({ minimum: 0 }))");
  expect(ruta).toContain("fecha_boleta: t.String()");
});

test("la vista previa no escribe: el handler no llama a condonar, anular ni insertPayment", () => {
  const ruta = src.slice(i, i + 1400);
  for (const prohibido of ["condonarMoraDeCuotas", "anularCondonacion", "insertPayment("]) {
    expect(ruta).not.toContain(prohibido);
  }
});

test("el rechazo por rol lo pone el gate (rolCondonacionBoletaTardia.test.ts), 400 por monto inválido y el error se registra sin filtrar el mensaje interno", () => {
  const ruta = src.slice(i, i + 2200);
  expect(ruta).toContain("if (!sesion.ok) return sesion.body;");
  expect(ruta).toContain("EntradaBoletaTardiaInvalida");
  expect(ruta).toContain("set.status = 400");
  expect(ruta).toContain('console.error("[boleta-tardia/preview]"');
});
