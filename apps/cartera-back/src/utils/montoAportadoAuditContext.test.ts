import { expect, test } from "bun:test";
import {
  buildMontoAportadoAuditSettings,
  getAuditableInvestorIds,
  getAdjustedExistingInvestorIds,
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

test("motivo scope covers modified and removed investors but not additions", () => {
  expect(
    getAdjustedExistingInvestorIds(
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

test("audit scope also covers additions so the mirror INSERT is recorded", () => {
  // Un alta no exige motivo, pero sí debe quedar en el historial ESPEJO:
  // verificarCuadreLiquidaciones descubre el crédito destino de una
  // reinversión solo por esas filas.
  expect(
    getAuditableInvestorIds(
      [{ inversionista_id: 12, monto_aportado: "100.00" }],
      [
        { inversionista_id: 12, monto_aportado: "100.00" },
        { inversionista_id: 77, monto_aportado: "5000.00" },
      ],
    ),
  ).toEqual([77]);
});

test("omitted investor list is not read as a full removal", () => {
  const persistidos = [
    { inversionista_id: 12, monto_aportado: "100.00" },
    { inversionista_id: 48, monto_aportado: "200.00" },
  ];

  // El body sin la lista llega como undefined: no hay nada que auditar ni
  // motivo que exigir. Con el default `[]` que existía en updateCredit, cada
  // participación persistida se leía como baja y el rebuild las borraba.
  expect(getAdjustedExistingInvestorIds(persistidos, undefined)).toEqual([]);

  // Una lista vacía explícita sí es una baja de todas las participaciones.
  expect(getAdjustedExistingInvestorIds(persistidos, [])).toEqual([12, 48]);
});
