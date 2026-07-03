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

assertClose(getPublicAdjustmentFactor(50_000, 20, 48), 0.562737, 0.000001, "factor Q50k");
assertClose(getPublicAdjustmentFactor(100_000, 20, 48), 0.474328, 0.000001, "factor Q100k");
assertClose(getPublicAdjustmentFactor(200_000, 20, 48), 0.430124, 0.000001, "factor Q200k");

assertClose(
  calculatePublicCredit({ vehicleAmount: 50_000, downPaymentPct: 20, termMonths: 48 }).monthlyPayment,
  1_907.52,
  0.01,
  "Q50k / 20% / 48 meses",
);
assertClose(
  calculatePublicCredit({ vehicleAmount: 100_000, downPaymentPct: 20, termMonths: 48 }).monthlyPayment,
  3_599.21,
  0.01,
  "Q100k / 20% / 48 meses",
);
assertClose(
  calculatePublicCredit({ vehicleAmount: 200_000, downPaymentPct: 20, termMonths: 48 }).monthlyPayment,
  6_982.59,
  0.01,
  "Q200k / 20% / 48 meses",
);

assertClose(
  calculatePublicCredit({ vehicleAmount: 150_000, downPaymentPct: 10, termMonths: 60 }).monthlyPayment,
  5_199.94,
  0.01,
  "Q150k / 10% / 60 meses usado rodado particular",
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
assert.match(calculatorSource, /standalone \? "mt-4 lg:mt-8" : "mt-12 lg:mt-64"/);
assert.match(calculadoraRouteSource, /<CalculatorCredit standalone \/>/);

console.log("Pruebas de calculadora de crédito OK");
