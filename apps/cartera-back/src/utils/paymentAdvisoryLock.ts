export const PAYMENT_ADVISORY_LOCK_NAMESPACE = 8765;

export type PaymentAdvisoryLockConnection = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
  release: () => void;
};
