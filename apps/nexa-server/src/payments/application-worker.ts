export type ApplicationClaim = {
  id: number;
  reference: string;
  attemptCount: number;
};

export type ApplicationWorkerRepository = {
  claimNextApplication(now: Date, leaseSeconds: number): Promise<ApplicationClaim | null>;
  markApplicationApplied(id: number, now: Date): Promise<void>;
  markApplicationFailed(id: number, reason: string, nextAttemptAt: Date | null, now: Date): Promise<void>;
};

export async function runApplicationWorkerOnce(options: {
  repository: ApplicationWorkerRepository;
  process: (claim: ApplicationClaim) => Promise<void>;
  now?: () => Date;
  leaseSeconds: number;
  maxAttempts: number;
  backoffSeconds: number;
  maxBackoffSeconds: number;
}) {
  const now = options.now?.() ?? new Date();
  const claim = await options.repository.claimNextApplication(now, options.leaseSeconds);
  if (!claim) return false;

  try {
    await options.process(claim);
  } catch {
    const nextAttemptAt = claim.attemptCount >= options.maxAttempts
      ? null
      : new Date(now.getTime() + Math.min(
        options.maxBackoffSeconds,
        options.backoffSeconds * 2 ** (claim.attemptCount - 1),
      ) * 1_000);
    await options.repository.markApplicationFailed(
      claim.id,
      "application_processing_failed",
      nextAttemptAt,
      now,
    );
    return true;
  }

  await options.repository.markApplicationApplied(claim.id, now);
  return true;
}
