import { expect, test } from "bun:test";
import {
  buildMontoAportadoAuditSettings,
  getChangedExistingInvestorIds,
} from "./montoAportadoAuditContext";

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

test("includes modified and removed existing investors but not additions", () => {
  expect(
    getChangedExistingInvestorIds(
      [
        { inversionista_id: 12, monto_aportado: "100.00" },
        { inversionista_id: 48, monto_aportado: "200.00" },
      ],
      [
        { inversionista_id: 12, monto_aportado: "125.00" },
        { inversionista_id: 99, monto_aportado: "300.00" },
      ],
    ),
  ).toEqual([12, 48]);
});
