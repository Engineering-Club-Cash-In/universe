import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("payments.ts incluye el fragmento en el SELECT crudo y lo expone en cada pago", () => {
  const src = readFileSync(new URL("./payments.ts", import.meta.url), "utf8");
  expect(src).toContain('import { CONDONACION_BOLETA_TARDIA_SELECT_SQL } from "./condonacionBoletaTardiaSql";');
  const select = src.slice(src.indexOf('AS "nexaEventoFallido"'), src.indexOf('AS "nexaEventoFallido"') + 260);
  expect(select).toContain("${sql.raw(CONDONACION_BOLETA_TARDIA_SELECT_SQL)}");
  expect(src).toContain("condonacionBoletaTardia: r.condonacionBoletaTardia ?? null,");
});
