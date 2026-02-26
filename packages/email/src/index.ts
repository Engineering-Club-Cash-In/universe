import { Resend } from "resend";
import { LiquidationEmail } from "./templates/LiquidationTemplate";
import * as React from "react";

// The API key and domain should be picked up from environment variables.
const apiKey = process.env.RESEND_API_KEY;
if (!apiKey && process.env.NODE_ENV !== "test") {
  console.warn("⚠️ [Email Package] RESEND_API_KEY is not defined in environment variables.");
}

const resend = new Resend(apiKey || "dummy_key");
const domain = process.env.EMAIL_DOMAIN || "resend.dev"; 

export interface SendLiquidationEmailParams {
  to: string;
  investorName: string;
  amount: string;
  creditNumber: string;
  date: string;
  currencySymbol?: string;
  attachment?: {
    filename: string;
    content: Buffer;
  };
}

export const sendLiquidationEmail = async ({
  to,
  investorName,
  amount,
  creditNumber,
  date,
  currencySymbol,
  attachment,
}: SendLiquidationEmailParams) => {
  try {
    const { data, error } = await resend.emails.send({
      from: `Club Cash In <no-reply@${domain}>`,
      to: [to],
      subject: `Liquidación Procesada - Crédito ${creditNumber}`,
      react: React.createElement(LiquidationEmail, {
        investorName,
        amount,
        creditNumber,
        date,
        currencySymbol,
      }),
      attachments: attachment ? [attachment] : undefined,
    });

    if (error) {
      console.error("[sendLiquidationEmail] Resend API Error:", error);
      return { success: false, error };
    }

    console.log(`[sendLiquidationEmail] Liquidation email sent to ${to}. ID: ${data?.id}`);
    return { success: true, data };
  } catch (err) {
    console.error("[sendLiquidationEmail] Unexpected Error:", err);
    return { success: false, error: err };
  }
};

export const sendSimpleEmail = async (to: string, subject: string, message: string) => {
  try {
    const { data, error } = await resend.emails.send({
      from: `Club Cash In <no-reply@${domain}>`,
      to: [to],
      subject: subject,
      html: `<strong>${message}</strong>`,
    });

    if (error) {
       console.error("[sendSimpleEmail] Resend API Error:", error);
       return { success: false, error };
    }

    console.log(`[sendSimpleEmail] Test email sent to ${to}. ID: ${data?.id}`);
    return { success: true, data };
  } catch (err) {
    console.error("[sendSimpleEmail] Unexpected Error:", err);
    return { success: false, error: err };
  }
};
