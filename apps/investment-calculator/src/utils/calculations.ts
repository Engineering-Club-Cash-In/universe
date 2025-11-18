export interface AmortizationRow {
  month: number;
  initialBalance: number;
  interest: number;
  vat: number;
  interestPlusVat: number;
  payment: number;
  interestVatPayment: number;
  amortization: number;
  finalBalance: number;
}

export interface CalculationParams {
  principal: number;
  interestRate: number;
  termMonths: number;
  investorPercentage: number;
  vatRate: number;
}

// Standard amortization schedule (capital returned monthly)
export function calculateMonthlyPayment(
  principal: number,
  interestRate: number,
  termMonths: number,
  vatRate: number,
): number {
  const monthlyRate = (interestRate * (1 + vatRate)) / 100;
  return (
    (principal * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
    (Math.pow(1 + monthlyRate, termMonths) - 1)
  );
}

export function generateAmortizationSchedule(
  params: CalculationParams,
): AmortizationRow[] {
  const { principal, interestRate, termMonths, investorPercentage, vatRate } =
    params;
  const schedule: AmortizationRow[] = [];
  const monthlyPayment = calculateMonthlyPayment(
    principal,
    interestRate,
    termMonths,
    vatRate,
  );
  let balance = principal;

  for (let month = 1; month <= termMonths; month++) {
    const interest = balance * (interestRate / 100);
    const vat = interest * vatRate;
    const interestPlusVat = interest + vat;
    const amortization = monthlyPayment - interestPlusVat;
    const finalBalance = balance - amortization;

    schedule.push({
      month,
      initialBalance: balance,
      interest,
      vat,
      interestPlusVat,
      payment: monthlyPayment,
      interestVatPayment: interestPlusVat * (investorPercentage / 100),
      amortization,
      finalBalance: finalBalance < 0.01 ? 0 : finalBalance,
    });

    balance = finalBalance;
  }

  return schedule;
}

// Interest-only schedule (capital remains constant until the final month)
export function generateInterestOnlySchedule(
  params: CalculationParams,
): AmortizationRow[] {
  const { principal, interestRate, termMonths, investorPercentage, vatRate } =
    params;
  const schedule: AmortizationRow[] = [];

  for (let month = 1; month <= termMonths; month++) {
    const interest = principal * (interestRate / 100);
    const vat = interest * vatRate;
    const interestPlusVat = interest + vat;

    // Calculate investor's share of the total interest+vat
    const investorPayment = interestPlusVat * (investorPercentage / 100);

    if (month < termMonths) {
      schedule.push({
        month,
        initialBalance: principal,
        interest,
        vat,
        interestPlusVat,
        payment: investorPayment,
        interestVatPayment: investorPayment,
        amortization: 0,
        finalBalance: principal,
      });
    } else {
      schedule.push({
        month,
        initialBalance: principal,
        interest,
        vat,
        interestPlusVat,
        payment: investorPayment + principal,
        interestVatPayment: investorPayment,
        amortization: principal,
        finalBalance: 0,
      });
    }
  }

  return schedule;
}

// Compound interest schedule (investor's share of net interest is reinvested)
export function generateCompoundSchedule(
  params: CalculationParams,
): AmortizationRow[] {
  const { principal, interestRate, termMonths, investorPercentage, vatRate } =
    params;
  const schedule: AmortizationRow[] = [];
  let balance = principal;

  for (let month = 1; month <= termMonths; month++) {
    const interest = balance * (interestRate / 100);
    const vat = interest * vatRate;
    const investorInterest = interest * (investorPercentage / 100);
    const investorVat = investorInterest * vatRate;
    const investorGross = investorInterest + investorVat;
    const finalBalance = balance + investorGross;

    schedule.push({
      month,
      initialBalance: balance,
      interest,
      vat,
      interestPlusVat: interest + vat,
      payment: month === termMonths ? finalBalance : 0,
      interestVatPayment: (interest + vat) * (investorPercentage / 100),
      amortization: month === termMonths ? balance : 0,
      finalBalance: finalBalance,
    });

    balance = finalBalance;
  }

  return schedule;
}

// Calculate summary values
export interface CalculationSummary {
  totalInterest: number;
  totalVat: number;
  netProfit: number;
  totalToReceive: number;
  totalCompoundTaxes?: number;
}

export function calculateSummary(
  schedule: AmortizationRow[],
  principal: number,
  _investorPercentage: number,
  vatRate: number,
  type: "standard" | "interest-only" | "compound",
): CalculationSummary {
  const summaryTotalInterest = schedule.reduce(
    (sum, row) => sum + row.interestPlusVat,
    0,
  );
  const summaryTotalVat = schedule.reduce((sum, row) => sum + row.vat, 0);

  let totalToReceive: number;
  let netProfit: number;
  let totalCompoundTaxes = 0;

  if (type === "compound") {
    const finalBalance =
      schedule.length > 0
        ? schedule[schedule.length - 1].finalBalance
        : principal;
    totalToReceive = finalBalance;
    netProfit = totalToReceive - principal;
    totalCompoundTaxes = 0;
  } else if (type === "interest-only") {
    const totalPayments = schedule.reduce((sum, row) => sum + row.payment, 0);
    totalToReceive = totalPayments;
    netProfit = totalToReceive - principal;
  } else {
    // Standard amortization
    const totalInterestVatPayment = schedule.reduce(
      (sum, row) => sum + row.interestVatPayment,
      0,
    );
    netProfit = totalInterestVatPayment;
    // For standard amortization, VAT is already included in interestVatPayment
    // but we need to subtract it for the final total
    const vatOnProfit = totalInterestVatPayment * vatRate / (1 + vatRate);
    totalToReceive = principal + netProfit - vatOnProfit;
  }

  return {
    totalInterest: summaryTotalInterest,
    totalVat: summaryTotalVat,
    netProfit,
    totalToReceive,
    totalCompoundTaxes,
  };
}

// Inverse calculation functions
export function calculateRequiredCapitalForMonthly(
  desiredAmount: number,
  interestRate: number,
  investorPercentage: number,
  vatRate: number,
): number {
  const investorShare = investorPercentage / 100;
  const monthlyInterestRate = interestRate / 100;

  const interestPlusVat = desiredAmount / investorShare;
  const interest = interestPlusVat / (1 + vatRate);
  return interest / monthlyInterestRate;
}

export function calculateRequiredCapitalForCompound(
  desiredAmount: number,
  interestRate: number,
  termMonths: number,
  investorPercentage: number,
  vatRate: number,
): number {
  const monthlyInterestRate = interestRate / 100;
  const investorInterestRate = monthlyInterestRate * (investorPercentage / 100);
  const investorGrossRate = investorInterestRate * (1 + vatRate);

  return desiredAmount / Math.pow(1 + investorGrossRate, termMonths);
}

export function calculateRequiredCapitalForInterestOnly(
  desiredAmount: number,
  interestRate: number,
  investorPercentage: number,
  vatRate: number,
): number {
  const monthlyInterestRate = interestRate / 100;
  const investorShare = investorPercentage / 100;
  const finalPaymentFactor =
    1 + monthlyInterestRate * (1 + vatRate) * investorShare;

  return desiredAmount / finalPaymentFactor;
}
