export function buildSamplePaymentTokenWebhookPayload(input: {
  id: string | number;
  reference: string;
  token: string;
  amount: number;
}) {
  return {
    id: input.id,
    reference: input.reference,
    token: input.token,
    amount: input.amount,
    originAccount: "19451958",
    originBank: "INDLGTGC",
    comments: "Test transaction",
    currency: "GTQ" as const,
    originAccountName: "Cuenta origen",
  };
}
