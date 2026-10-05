import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const outDir = join(tmpdir(), "portal-web-credit-calculator-test");
rmSync(outDir, { force: true, recursive: true });

execFileSync(
  "./node_modules/.bin/tsc",
  [
    "src/features/Marketplace/utils/creditCalculator.ts",
    "--target",
    "ES2022",
    "--module",
    "ES2022",
    "--moduleResolution",
    "bundler",
    "--outDir",
    outDir,
    "--skipLibCheck",
  ],
  { stdio: "inherit" },
);

const {
  calculatePublicCredit,
  getPublicAdjustmentFactor,
} = await import(`file://${outDir}/creditCalculator.js`);

function assertClose(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: esperado ${expected}, recibido ${actual}`,
  );
}

assertClose(getPublicAdjustmentFactor(50_000, 20, 48), 0.685776, 0.000001, "factor Q50k");
assertClose(getPublicAdjustmentFactor(100_000, 20, 48), 0.597379, 0.000001, "factor Q100k");
assertClose(getPublicAdjustmentFactor(200_000, 20, 48), 0.659823, 0.000001, "factor Q200k");

assertClose(
  calculatePublicCredit({ vehicleAmount: 50_000, downPaymentPct: 20, termMonths: 48 }).monthlyPayment,
  2_057.70,
  0.01,
  "Q50k / 20% / 48 meses",
);
assertClose(
  calculatePublicCredit({ vehicleAmount: 100_000, downPaymentPct: 20, termMonths: 48 }).monthlyPayment,
  3_899.61,
  0.01,
  "Q100k / 20% / 48 meses",
);
assertClose(
  calculatePublicCredit({ vehicleAmount: 200_000, downPaymentPct: 20, termMonths: 48 }).monthlyPayment,
  8_104.10,
  0.01,
  "Q200k / 20% / 48 meses",
);

assertClose(
  calculatePublicCredit({ vehicleAmount: 150_000, downPaymentPct: 10, termMonths: 60 }).monthlyPayment,
  6_037.65,
  0.01,
  "Q150k / 10% / 60 meses usado rodado particular",
);

const crmReferencePayment = 2_856.16;
const publicUsedRodadoPayment = calculatePublicCredit({
  vehicleAmount: 80_000,
  downPaymentPct: 20,
  termMonths: 60,
  vehicleCondition: "used",
}).monthlyPayment;
assert.ok(
  Math.abs(publicUsedRodadoPayment - crmReferencePayment) / crmReferencePayment <= 0.05,
  `La referencia pública usada/rodado debe quedar dentro de 5% del CRM: ${publicUsedRodadoPayment} vs ${crmReferencePayment}`,
);

const crmNewVehicleReferencePayment = 2_784.93;
const publicNewVehiclePayment = calculatePublicCredit({
  vehicleAmount: 80_000,
  downPaymentPct: 20,
  termMonths: 60,
  vehicleCondition: "new",
}).monthlyPayment;
assert.ok(
  Math.abs(publicNewVehiclePayment - crmNewVehicleReferencePayment) /
    crmNewVehicleReferencePayment <=
    0.05,
  `La referencia pública nueva debe quedar dentro de 5% del CRM: ${publicNewVehiclePayment} vs ${crmNewVehicleReferencePayment}`,
);

const beforeBoundary = calculatePublicCredit({
  vehicleAmount: 50_000,
  downPaymentPct: 20,
  termMonths: 48,
}).monthlyPayment;
const afterBoundary = calculatePublicCredit({
  vehicleAmount: 50_001,
  downPaymentPct: 20,
  termMonths: 48,
}).monthlyPayment;
assert.ok(
  afterBoundary >= beforeBoundary,
  `La cuota no debe bajar al cruzar Q50k: ${beforeBoundary} -> ${afterBoundary}`,
);

for (const termMonths of [12, 24, 36, 48, 60]) {
  for (const downPaymentPct of [10, 15, 20, 25, 30]) {
    let previousPayment = 0;
    for (let vehicleAmount = 25_000; vehicleAmount <= 500_000; vehicleAmount += 1_000) {
      const { monthlyPayment } = calculatePublicCredit({
        vehicleAmount,
        downPaymentPct,
        termMonths,
      });
      assert.ok(
        monthlyPayment >= previousPayment,
        `La cuota debe ser monotónica para Q${vehicleAmount}, ${downPaymentPct}%, ${termMonths} meses`,
      );
      previousPayment = monthlyPayment;
    }
  }
}

const calculatorSource = readFileSync(
  "src/features/Marketplace/Sections/CalculatorCredit.tsx",
  "utf8",
);
const calculadoraRouteSource = readFileSync("src/routes/calculadora.tsx", "utf8");

assert.match(calculatorSource, /standalone\?: boolean/);
assert.match(calculatorSource, /useState<VehicleCondition>\("used"\)/);
assert.match(calculatorSource, /useState<string>\("20"\)/);
assert.match(calculatorSource, /\{ value: "used", label: "Usado" \}/);
assert.match(calculatorSource, /\{ value: "new", label: "Nuevo" \}/);
assert.match(calculatorSource, /vehicleCondition === "used"/);
assert.match(calculatorSource, /\{ value: "60", label: "60 meses" \}/);
assert.match(calculatorSource, /\{ value: "72", label: "72 meses" \}/);
assert.match(calculatorSource, /\{ value: "84", label: "84 meses" \}/);
assert.match(calculatorSource, /setTiempo\("60"\)/);
assert.match(calculatorSource, /Define el plazo/);
assert.match(calculatorSource, /Según condición/);
assert.match(calculatorSource, /Condición: \$\{/);
assert.match(calculatorSource, /standalone \? "mt-4 lg:mt-8" : "mt-12 lg:mt-64"/);
assert.match(calculadoraRouteSource, /<CalculatorCredit standalone \/>/);

console.log("Pruebas de calculadora de crédito OK");
