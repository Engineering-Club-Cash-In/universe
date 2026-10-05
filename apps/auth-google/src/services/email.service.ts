import { sendPasswordResetEmail as sendResetEmail } from "@cci/email";

/**
 * Envía un email de reset de password
 */
export async function sendPasswordResetEmail(
  email: string,
  resetUrl: string,
  role?: "CLIENT" | "INVESTOR"
): Promise<void> {
  const result = await sendResetEmail(email, resetUrl, role);

  if (!result.success) {
    throw new Error(`Failed to send password reset email: ${JSON.stringify(result.error)}`);
  }
}
