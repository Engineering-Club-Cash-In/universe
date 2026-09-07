import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const controllerFile = new URL("./verificarCuadreLiquidaciones.ts", import.meta.url);

test("liquidation reconciliation reads only mirror amount history", () => {
  const controller = readFileSync(controllerFile, "utf8");
  // Cada lectura del historial debe filtrar por origen; se comparan cantidades
  // en vez de fijar un número, para que agregar una lectura legítima no rompa
  // el test sin que haya un filtro faltante.
  const lecturas =
    controller.match(/cartera\.historico_monto_aportado_espejo/g) ?? [];
  const mirrorFilters = controller.match(/hm\.origen\s*=\s*'ESPEJO'/g) ?? [];

  expect(lecturas.length).toBeGreaterThan(0);
  expect(mirrorFilters).toHaveLength(lecturas.length);
});
