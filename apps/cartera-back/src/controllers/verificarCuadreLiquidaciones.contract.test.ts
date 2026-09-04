import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const controllerFile = new URL("./verificarCuadreLiquidaciones.ts", import.meta.url);

test("liquidation reconciliation reads only mirror amount history", () => {
  const controller = readFileSync(controllerFile, "utf8");
  const mirrorFilters = controller.match(/hm\.origen\s*=\s*'ESPEJO'/g) ?? [];

  expect(mirrorFilters).toHaveLength(5);
});
