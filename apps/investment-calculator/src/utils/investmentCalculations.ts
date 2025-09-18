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

// Model 2: Traditional with monthly capital return (decreasing balance)
export function calculateTraditionalInvestment(params: InvestmentParams): InvestmentResult {
  const { capital, interestRate, termMonths, investorPercentage, vatRate } = params;
  
  // Calculate monthly payment using amortization formula
  const monthlyRate = (interestRate * (1 + vatRate)) / 100;
  const monthlyPayment = (capital * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) / 
                        (Math.pow(1 + monthlyRate, termMonths) - 1);
  
  let balance = capital;
  let totalInvestorInterestWithVat = 0; // For "Total Intereses" (with VAT)
  let totalToReceive = 0; // For "Total a Recibir" (sum of column)
  let totalInvestorNet = 0;
  let totalVatPaid = 0;
  
  // Calculate month by month with decreasing balance
  for (let month = 1; month <= termMonths; month++) {
    const interest = balance * (interestRate / 100);
    const vat = interest * vatRate;
    const interestPlusVat = interest + vat;
    const amortization = monthlyPayment - interestPlusVat;
    
    // For "Total Intereses" - should match frontend "Interés + IVA" column sum
    const monthlyInterestVatPayment = interestPlusVat * (investorPercentage / 100);
    totalInvestorInterestWithVat += monthlyInterestVatPayment;
    
    // For "Total a Recibir" - match frontend column logic (without VAT)
    const monthlyToReceive = amortization + (interest * (investorPercentage / 100));
    totalToReceive += monthlyToReceive;
    
    // For other calculations
    const investorInterest = interest * (investorPercentage / 100);
    const investorVat = vat * (investorPercentage / 100);
    totalInvestorNet += investorInterest;
    totalVatPaid += investorVat;
    
    balance = balance - amortization;
    if (balance < 0.01) balance = 0;
  }
  
  return {
    finalCapital: capital,
    grossProfit: totalInvestorInterestWithVat, // Frontend shows grossProfit + vatPaid, so put all in grossProfit
    vatPaid: 0, // Set to 0 since we put everything in grossProfit
    netProfit: totalInvestorNet,
    totalToReceive: totalToReceive // This matches column sum
  };
}

// Model 3: Interest-only until maturity (fixed interest on initial capital)
export function calculateInterestOnlyInvestment(params: InvestmentParams): InvestmentResult {
  const { capital, interestRate, termMonths, investorPercentage, vatRate } = params;
  
  // Fixed monthly interest on initial capital (no amortization)
  const monthlyInterest = capital * (interestRate / 100);
  const investorShare = investorPercentage / 100;
  
  // Calculate VAT on total interest, then take investor's portion
  const monthlyVatOnTotal = monthlyInterest * vatRate;
  
  // Net is the investor's portion minus the VAT portion
  const monthlyInvestorInterest = monthlyInterest * investorShare; // Investor's share of base interest
  const monthlyInvestorVat = monthlyVatOnTotal * investorShare;    // Investor's share of VAT
  
  // Calculate totals (same amount every month)
  const totalGrossProfit = monthlyInvestorInterest * termMonths;            // Investor's share of interest only
  const totalVatPaid = monthlyInvestorVat * termMonths;                     // Investor's share of VAT
  const totalNetProfit = totalGrossProfit;                                  // Net interest (before VAT)
  
  
  return {
    finalCapital: capital,
    grossProfit: totalGrossProfit,
    vatPaid: totalVatPaid,
    netProfit: totalNetProfit,
    totalToReceive: capital + totalNetProfit
  };
}