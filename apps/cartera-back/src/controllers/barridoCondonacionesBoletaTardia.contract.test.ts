import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const raiz = new URL("../../", import.meta.url);
const leer = (ruta: string) => readFileSync(new URL(ruta, raiz), "utf8");

test("schedule.ts agenda el barrido cada 15 min en hora de Guatemala con el job_name nuevo", () => {
  const src = leer("schedule.ts");
  const i = src.indexOf("'sweep_late_slip_waivers'");
  expect(i).toBeGreaterThan(-1);
  const antes = src.slice(Math.max(0, i - 260), i);
  expect(antes).toContain("rule: '*/15 * * * *', tz: TZ_GUATEMALA");
  const despues = src.slice(i, i + 600);
  expect(despues).toContain("barrerCondonacionesBoletaTardiaHuerfanas()");
  expect(despues).toContain("r.fallidas > 0 || r.abandonadas_nuevas > 0 || r.revision_manual > 0");
  expect(despues).toContain("throw new Error(\"scheduled job reported failure\")");
});

test("el catálogo del logger conoce el job (catálogo y lista de nombres)", () => {
  expect(leer("../../packages/structured-logger/src/cartera-catalog.ts")).toContain("'sweep_late_slip_waivers'");
  expect(leer("../../packages/structured-logger/src/logger.ts")).toContain("'sweep_late_slip_waivers'");
  expect(leer("../../packages/structured-logger/CATALOG.generated.md")).toContain("sweep_late_slip_waivers");
});
