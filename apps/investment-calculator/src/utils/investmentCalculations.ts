export interface InvestmentParams {
  capital: number;
  interestRate: number;
  termMonths: number;
  investorPercentage: number;
  vatRate: number;
}

export interface InvestmentResult {
  finalCapital: number;
  grossProfit: number;
  vatPaid: number;
  netProfit: number;
  totalToReceive: number;
}

// Model 1: Compound interest with monthly reinvestment (70% of gain)
export function calculateCompoundInvestment(params: InvestmentParams): InvestmentResult {
  const { capital, interestRate, termMonths, investorPercentage, vatRate } = params;
  
  // The effective rate for the investor after considering their 70% share
  const effectiveMonthlyRate = (interestRate / 100) * (investorPercentage / 100);
  
  // Calculate compound growth with the effective rate
  let balance = capital;
  for (let month = 1; month <= termMonths; month++) {
    balance = balance * (1 + effectiveMonthlyRate);
  }
  
  // The gross profit before VAT
  const grossProfit = balance - capital;
  
  // VAT is calculated on the gross profit
  const vatPaid = grossProfit * vatRate;
  
  // Net profit after VAT
  const netProfit = grossProfit - vatPaid;
  
  return {
    finalCapital: balance,
    grossProfit: grossProfit,
    vatPaid: vatPaid,
    netProfit: netProfit,
    totalToReceive: capital + netProfit
  };
}

// Model 2: Traditional without capital reinvestment
export function calculateTraditionalInvestment(params: InvestmentParams): InvestmentResult {
  const { capital, interestRate, termMonths, investorPercentage, vatRate } = params;
  
  const monthlyInterest = capital * (interestRate / 100);
  const investorShare = investorPercentage / 100;
  const monthlyInvestorInterest = monthlyInterest * investorShare;
  const monthlyVat = monthlyInvestorInterest * vatRate;
  const monthlyNetInterest = monthlyInvestorInterest - monthlyVat;
  
  const totalGrossProfit = monthlyInvestorInterest * termMonths;
  const totalVatPaid = monthlyVat * termMonths;
  const totalNetProfit = monthlyNetInterest * termMonths;
  
  return {
    finalCapital: capital,
    grossProfit: totalGrossProfit,
    vatPaid: totalVatPaid,
    netProfit: totalNetProfit,
    totalToReceive: capital + totalNetProfit
  };
}