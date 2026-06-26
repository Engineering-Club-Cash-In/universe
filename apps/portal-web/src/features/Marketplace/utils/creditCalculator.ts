export interface PublicCreditInput {
  vehicleAmount: number;
  downPaymentPct: number;
  termMonths: number;
}

export interface PublicCreditResult {
  interestPct: number;
  baseMonthlyPayment: number;
  adjustmentFactor: number;
  monthlyPayment: number;
}

const MONTHLY_INTEREST_PCT = 1.5;
const IVA_FACTOR = 1.12;

const BASE_ADJUSTMENT_POINTS = [
  { vehicleAmount: 25_000, factor: 0.47 },
  { vehicleAmount: 50_000, factor: 0.29 },
  { vehicleAmount: 75_000, factor: 0.225 },
  { vehicleAmount: 100_000, factor: 0.195 },
  { vehicleAmount: 150_000, factor: 0.165 },
  { vehicleAmount: 200_000, factor: 0.145 },
  { vehicleAmount: 300_000, factor: 0.13 },
  { vehicleAmount: 400_000, factor: 0.12 },
  { vehicleAmount: 500_000, factor: 0.115 },
] as const;

function getInterpolatedBaseFactor(vehicleAmount: number) {
  const firstPoint = BASE_ADJUSTMENT_POINTS[0];
  const lastPoint = BASE_ADJUSTMENT_POINTS[BASE_ADJUSTMENT_POINTS.length - 1];

  if (vehicleAmount <= firstPoint.vehicleAmount) return firstPoint.factor;
  if (vehicleAmount >= lastPoint.vehicleAmount) return lastPoint.factor;

  const upperIndex = BASE_ADJUSTMENT_POINTS.findIndex(
    (point) => vehicleAmount <= point.vehicleAmount,
  );
  const lowerPoint = BASE_ADJUSTMENT_POINTS[upperIndex - 1];
  const upperPoint = BASE_ADJUSTMENT_POINTS[upperIndex];
  const progress =
    (vehicleAmount - lowerPoint.vehicleAmount) /
    (upperPoint.vehicleAmount - lowerPoint.vehicleAmount);

  return lowerPoint.factor + (upperPoint.factor - lowerPoint.factor) * progress;
}

export function getPublicAdjustmentFactor(
  vehicleAmount: number,
  downPaymentPct: number,
  termMonths: number,
) {
  const baseFactor = getInterpolatedBaseFactor(vehicleAmount);

  const termAdjustment =
    termMonths <= 12 ? -0.035 :
    termMonths <= 24 ? -0.018 :
    termMonths <= 36 ? 0 :
    termMonths <= 48 ? 0.01 :
    0.02;

  const downPaymentAdjustment = (downPaymentPct - 20) / 1500;
  return Math.min(0.50, Math.max(0.07, baseFactor + termAdjustment + downPaymentAdjustment));
}

export function calculatePublicCredit({
  vehicleAmount,
  downPaymentPct,
  termMonths,
}: PublicCreditInput): PublicCreditResult {
  if (vehicleAmount <= 0 || downPaymentPct < 0 || termMonths <= 0) {
    return {
      interestPct: MONTHLY_INTEREST_PCT,
      baseMonthlyPayment: 0,
      adjustmentFactor: 0,
      monthlyPayment: 0,
    };
  }

  const amountToFinance = vehicleAmount - (vehicleAmount * downPaymentPct) / 100;
  const monthlyRate = (MONTHLY_INTEREST_PCT / 100) * IVA_FACTOR;
  const factor = (1 + monthlyRate) ** termMonths;
  const baseMonthlyPayment = (amountToFinance * monthlyRate * factor) / (factor - 1);
  const adjustmentFactor = getPublicAdjustmentFactor(vehicleAmount, downPaymentPct, termMonths);

  return {
    interestPct: MONTHLY_INTEREST_PCT,
    baseMonthlyPayment: Number.isNaN(baseMonthlyPayment) ? 0 : baseMonthlyPayment,
    adjustmentFactor,
    monthlyPayment: Number.isNaN(baseMonthlyPayment)
      ? 0
      : baseMonthlyPayment * (1 + adjustmentFactor),
  };
}
