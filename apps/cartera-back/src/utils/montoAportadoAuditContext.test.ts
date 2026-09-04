import { expect, test } from "bun:test";
import { buildMontoAportadoAuditSettings } from "./montoAportadoAuditContext";

test("builds independent parent audit settings with changed investor IDs", () => {
  expect(
    buildMontoAportadoAuditSettings("PADRE", "Corrección de saldo", [12, 48]),
  ).toEqual([
    { name: "app.monto_aportado_rebuild_padre", value: "true" },
    { name: "app.monto_aportado_ids_padre", value: "12,48" },
    {
      name: "app.monto_aportado_motivo_padre",
      value: "Corrección de saldo",
    },
  ]);
});

test("builds empty mirror context without reusing parent values", () => {
  expect(buildMontoAportadoAuditSettings("ESPEJO", undefined, [])).toEqual([
    { name: "app.monto_aportado_rebuild_espejo", value: "true" },
    { name: "app.monto_aportado_ids_espejo", value: "" },
    { name: "app.monto_aportado_motivo_espejo", value: "" },
  ]);
});
