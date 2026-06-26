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

export function getPublicAdjustmentFactor(
  vehicleAmount: number,
  downPaymentPct: number,
  termMonths: number,
) {
  let baseFactor: number;
  if (vehicleAmount <= 25_000) baseFactor = 0.47;
  else if (vehicleAmount <= 50_000) baseFactor = 0.29;
  else if (vehicleAmount <= 75_000) baseFactor = 0.225;
  else if (vehicleAmount <= 100_000) baseFactor = 0.195;
  else if (vehicleAmount <= 150_000) baseFactor = 0.165;
  else if (vehicleAmount <= 200_000) baseFactor = 0.145;
  else if (vehicleAmount <= 300_000) baseFactor = 0.13;
  else if (vehicleAmount <= 400_000) baseFactor = 0.12;
  else baseFactor = 0.115;

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
