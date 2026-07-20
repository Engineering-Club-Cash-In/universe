export interface MockCreditLedger {
  applyPayment(input: {
    creditoId: number;
    amount: number;
    reference: string;
  }): Promise<{
    paymentId: number;
    creditoId: number;
    currentBalance: number;
    totalPaid: number;
  }>;
}
