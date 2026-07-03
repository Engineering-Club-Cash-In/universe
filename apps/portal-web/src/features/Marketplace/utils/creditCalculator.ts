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

const REFERENCE_USED_IMPORTED_PRIVATE_COSTS = {
  monthlyInsuranceAndMembershipPct: 0.00776,
  monthlyGpsCost: 148.2,
  transferCost: 545,
  mobileGuaranteeCost: 400,
  leasingContractCost: 400,
  fixedAdminCost: 600,
  royaltyPct: 4,
  upfrontInterestPct: 1.78,
} as const;

function calculateLevelPayment(
  principal: number,
  monthlyRate: number,
  termMonths: number,
) {
  if (monthlyRate === 0) return principal / termMonths;

  const factor = (1 + monthlyRate) ** termMonths;
  return (principal * monthlyRate * factor) / (factor - 1);
}

function calculateBaseMonthlyPayment(
  vehicleAmount: number,
  downPaymentPct: number,
  termMonths: number,
) {
  const amountToFinance = vehicleAmount - (vehicleAmount * downPaymentPct) / 100;
  const monthlyRate = (MONTHLY_INTEREST_PCT / 100) * IVA_FACTOR;

  return calculateLevelPayment(amountToFinance, monthlyRate, termMonths);
}

function calculateUsedImportedPrivateReferencePayment(
  vehicleAmount: number,
  downPaymentPct: number,
  termMonths: number,
) {
  const costs = REFERENCE_USED_IMPORTED_PRIVATE_COSTS;
  const amountToFinance = vehicleAmount - (vehicleAmount * downPaymentPct) / 100;
  const monthlyInsuranceAndMembership =
    vehicleAmount * costs.monthlyInsuranceAndMembershipPct;

  const intermediateBase =
    amountToFinance +
    costs.transferCost +
    costs.mobileGuaranteeCost +
    costs.leasingContractCost +
    costs.fixedAdminCost +
    costs.monthlyGpsCost +
    monthlyInsuranceAndMembership;

  const royalty = Math.ceil(intermediateBase * (costs.royaltyPct / 100));
  const upfrontInterest = Math.ceil(
    intermediateBase * (costs.upfrontInterestPct / 100),
  );

  const adminCost =
    costs.mobileGuaranteeCost +
    royalty +
    costs.leasingContractCost +
    costs.fixedAdminCost +
    upfrontInterest +
    costs.monthlyGpsCost +
    monthlyInsuranceAndMembership;

  const totalFinanced = amountToFinance + costs.transferCost + adminCost;
  const monthlyRate = (MONTHLY_INTEREST_PCT / 100) * IVA_FACTOR;

  return (
    calculateLevelPayment(totalFinanced, monthlyRate, termMonths) +
    monthlyInsuranceAndMembership +
    costs.monthlyGpsCost
  );
}

export function getPublicAdjustmentFactor(
  vehicleAmount: number,
  downPaymentPct: number,
  termMonths: number,
) {
  const baseMonthlyPayment = calculateBaseMonthlyPayment(
    vehicleAmount,
    downPaymentPct,
    termMonths,
  );

  if (!Number.isFinite(baseMonthlyPayment) || baseMonthlyPayment <= 0) return 0;

  const referenceMonthlyPayment = calculateUsedImportedPrivateReferencePayment(
    vehicleAmount,
    downPaymentPct,
    termMonths,
  );

  return referenceMonthlyPayment / baseMonthlyPayment - 1;
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

  const baseMonthlyPayment = calculateBaseMonthlyPayment(
    vehicleAmount,
    downPaymentPct,
    termMonths,
  );
  const adjustmentFactor = getPublicAdjustmentFactor(
    vehicleAmount,
    downPaymentPct,
    termMonths,
  );

  return {
    interestPct: MONTHLY_INTEREST_PCT,
    baseMonthlyPayment: Number.isNaN(baseMonthlyPayment) ? 0 : baseMonthlyPayment,
    adjustmentFactor,
    monthlyPayment: Number.isNaN(baseMonthlyPayment)
      ? 0
      : baseMonthlyPayment * (1 + adjustmentFactor),
  };
}
