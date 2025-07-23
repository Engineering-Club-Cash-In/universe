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

// Model 1: Compound interest with monthly reinvestment
// Reinvests only the investor's net portion (70% of net interest)
export function calculateCompoundInvestment(params: InvestmentParams): InvestmentResult {
  const { capital, interestRate, termMonths, investorPercentage, vatRate } = params;
  
  // Calculate compound growth month by month
  let balance = capital;
  let totalInvestorGross = 0;
  let totalInvestorNet = 0;
  
  for (let month = 1; month <= termMonths; month++) {
    // Monthly interest on current balance
    const monthlyInterest = balance * (interestRate / 100);
    
    // VAT on full interest
    const monthlyVat = monthlyInterest * vatRate;
    
    // Net interest after VAT
    const netMonthlyInterest = monthlyInterest - monthlyVat;
    
    // Investor's portion
    const investorGross = (monthlyInterest + monthlyVat) * (investorPercentage / 100);
    const investorNet = netMonthlyInterest * (investorPercentage / 100);
    
    // Add only investor's net portion to balance for compound effect
    balance += investorNet;
    
    totalInvestorGross += investorGross;
    totalInvestorNet += investorNet;
  }
  
  // Calculate gross profit and VAT from totals
  // totalInvestorGross includes VAT, so we need to extract the base amount
  const investorGrossProfit = totalInvestorGross / (1 + vatRate);
  const investorVatPaid = totalInvestorGross - investorGrossProfit;
  
  return {
    finalCapital: balance,
    grossProfit: investorGrossProfit,
    vatPaid: investorVatPaid,
    netProfit: totalInvestorNet,
    totalToReceive: capital + totalInvestorNet
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