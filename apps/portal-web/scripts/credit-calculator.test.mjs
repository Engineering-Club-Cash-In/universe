import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
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

assertClose(getPublicAdjustmentFactor(50_000, 20, 48), 0.3, 0.000001, "factor Q50k");
assertClose(getPublicAdjustmentFactor(100_000, 20, 48), 0.205, 0.000001, "factor Q100k");
assertClose(getPublicAdjustmentFactor(200_000, 20, 48), 0.155, 0.000001, "factor Q200k");

assertClose(
  calculatePublicCredit({ vehicleAmount: 50_000, downPaymentPct: 20, termMonths: 48 }).monthlyPayment,
  1_586.82,
  0.01,
  "Q50k / 20% / 48 meses",
);
assertClose(
  calculatePublicCredit({ vehicleAmount: 100_000, downPaymentPct: 20, termMonths: 48 }).monthlyPayment,
  2_941.71,
  0.01,
  "Q100k / 20% / 48 meses",
);
assertClose(
  calculatePublicCredit({ vehicleAmount: 200_000, downPaymentPct: 20, termMonths: 48 }).monthlyPayment,
  5_639.30,
  0.01,
  "Q200k / 20% / 48 meses",
);

console.log("Pruebas de calculadora de crédito OK");
