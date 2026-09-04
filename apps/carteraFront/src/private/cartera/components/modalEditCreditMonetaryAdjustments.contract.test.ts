import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const modalFile = new URL("./ModalEditCredit.tsx", import.meta.url);
const investorsFile = new URL("./InvestorsList.tsx", import.meta.url);
const serviceFile = new URL("../services/services.ts", import.meta.url);

test("credit edit renders and submits separate reason for changed investor amounts", () => {
  const modal = readFileSync(modalFile, "utf8");
  const investors = readFileSync(investorsFile, "utf8");
  const service = readFileSync(serviceFile, "utf8");

  expect(modal).toContain("Motivo del ajuste de monto aportado");
  expect(modal).toContain("Motivo del ajuste de monto aportado (padre)");
  expect(modal).toContain("Motivo del ajuste de monto aportado (espejo)");
  expect(modal).toContain("motivo_ajuste_monto_aportado_padre");
  expect(modal).toContain("motivo_ajuste_monto_aportado_espejo");
  expect(modal).toContain("Ingresá el motivo del ajuste de monto aportado del padre.");
  expect(modal).toContain("Ingresá el motivo del ajuste de monto aportado del espejo.");
  expect(modal).toContain("hasMontoAportadoChanged");
  expect(modal).not.toContain("values.investors.some((inversionista) => {");
  expect(modal).not.toContain("formik.values.investors.some((inversionista) => {");
  expect(modal).toContain('name === "capital"');
  expect(modal).toContain("Math.max(1, val)");
  expect(modal).toContain("? 1");
  expect(service).toContain("motivo_ajuste_monto_aportado_padre?: string");
  expect(service).toContain("motivo_ajuste_monto_aportado_espejo?: string");
  expect(investors).toContain("min={0}");
  expect(investors).toContain("newValue < 0");
  expect(investors).toContain("investorsMirror.${index}.monto_aportado");
  expect(investors).not.toContain("montoEspejoActual + deltaMonto");
});

test("credit editor keeps cartera styling in a responsive four-column workspace", () => {
  const modal = readFileSync(modalFile, "utf8");

  expect(modal).toContain('width: "min(96vw, 80rem)"');
  expect(modal).toContain('maxWidth: "calc(100vw - 2rem)"');
  expect(modal).not.toContain("w-[calc(100vw-2rem)]");
  expect(modal).not.toContain("sm:w-[calc(100vw-3rem)]");
  expect(modal).toContain("xl:grid-cols-4");
  expect(modal).toContain("Condiciones del crédito");
  expect(modal).toContain("Contrato y referencia");
  expect(modal).toContain("Cargos mensuales");
  expect(modal).toContain("Opciones del crédito");
  expect(modal).not.toContain("grid-cols-1 gap-4 xl:grid-cols-3");
  expect(modal).not.toContain('from "@/components/ui/tabs"');
});
