/// <reference types="node" />
import { Resend } from "resend";
import LiquidationEmail from "./templates/LiquidationTemplate";
import PasswordResetEmail from "./templates/PasswordResetTemplate";
import NewCreditEmail from "./templates/NewCreditTemplate";
import * as React from "react";

import { z } from "zod";

// Validaciones de variables de entorno
const apiKey = process.env.RESEND_API_KEY;
const domain = process.env.EMAIL_DOMAIN;

if (!apiKey) {
  throw new Error(
    "❌ [Email Package] RESEND_API_KEY is missing. Please add it to your environment variables."
  );
}

if (!domain) {
  throw new Error(
    "❌ [Email Package] EMAIL_DOMAIN is missing. Please add it to your environment variables (e.g., servicioscashin.com)."
  );
}

const resend = new Resend(apiKey);

// Schema para validación de correo
const emailSchema = z.string().email({ message: "Formato de correo electrónico inválido" });

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
  reportUrl?: string;
}


export const sendLiquidationEmail = async ({
  to,
  investorName,
  amount,
  creditNumber,
  date,
  currencySymbol,
  attachment,
  reportUrl,
}: SendLiquidationEmailParams) => {
  // Validar formato de correo antes de enviar
  emailSchema.parse(to);

  try {
    const { data, error } = await resend.emails.send({
      from: `Club Cash In <no-reply@${domain}>`,
      to: [to],
      subject: `Liquidación Procesada - ${new Date().toLocaleString("es-GT", { month: "long", year: "numeric" })}`,
      react: React.createElement(LiquidationEmail, {
        investorName,
        amount,
        creditNumber,
        date,
        currencySymbol,
        reportUrl,
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

export const sendPasswordResetEmail = async (to: string, resetUrl: string) => {
  emailSchema.parse(to);

  try {
    const { data, error } = await resend.emails.send({
      from: `Club Cash In <no-reply@${domain}>`,
      to: [to],
      subject: "Restablecer contraseña - CashIn",
      react: React.createElement(PasswordResetEmail, { resetUrl }),
    });

    if (error) {
      console.error("[sendPasswordResetEmail] Resend API Error:", error);
      return { success: false, error };
    }

    console.log(`[sendPasswordResetEmail] Password reset email sent to ${to}. ID: ${data?.id}`);
    return { success: true, data };
  } catch (err) {
    console.error("[sendPasswordResetEmail] Unexpected Error:", err);
    return { success: false, error: err };
  }
};

export interface SendNewCreditNotificationParams {
  to: string[];
  clientName: string;
  creditNumber: string;
  capital: string;
  plazo: number;
  cuota: string;
  interestRate: string;
  investors: string[];
  currencySymbol?: string;
  vehiculoMarca?: string;
  vehiculoLinea?: string;
  vehiculoModelo?: string;
  vehiculoPlaca?: string;
  vehiculoVin?: string;
  montoAsegurado?: number;
  opportunityId?: string;
}

export const sendNewCreditNotification = async ({
  to,
  clientName,
  creditNumber,
  capital,
  plazo,
  cuota,
  interestRate,
  investors,
  currencySymbol,
  vehiculoMarca,
  vehiculoLinea,
  vehiculoModelo,
  vehiculoPlaca,
  vehiculoVin,
  montoAsegurado,
  opportunityId,
}: SendNewCreditNotificationParams) => {
  try {
    const validEmails = to.filter((email) => {
      try { emailSchema.parse(email); return true; } catch { return false; }
    });

    if (validEmails.length === 0) {
      console.warn("[sendNewCreditNotification] No valid admin emails found");
      return { success: false, error: "No valid emails" };
    }

    const { data, error } = await resend.emails.send({
      from: `Club Cash In <no-reply@${domain}>`,
      to: validEmails,
      subject: `Nuevo Crédito Creado - ${creditNumber} | ${clientName}`,
      react: React.createElement(NewCreditEmail, {
        clientName,
        creditNumber,
        capital,
        plazo,
        cuota,
        interestRate,
        investors,
        currencySymbol,
        vehiculoMarca,
        vehiculoLinea,
        vehiculoModelo,
        vehiculoPlaca,
        vehiculoVin,
        montoAsegurado,
        opportunityId,
      }),
    });

    if (error) {
      console.error("[sendNewCreditNotification] Resend API Error:", error);
      return { success: false, error };
    }

    console.log(`[sendNewCreditNotification] Email sent to ${validEmails.length} admins. ID: ${data?.id}`);
    return { success: true, data };
  } catch (err) {
    console.error("[sendNewCreditNotification] Unexpected Error:", err);
    return { success: false, error: err };
  }
};

export interface SendInvestorAddedToCreditsNotificationParams {
  to: string[];
  cc?: string[];
  inversionistaNombre: string;
  tipoOperacion: "reinversion" | "compra_cartera";
  montoTotal: string;
  montoDistribuido: string;
  montoSinAsignar: string;
  creditos: Array<{
    numero_credito_sifco: string;
    monto_asignado: string;
    cube_eliminado: boolean;
  }>;
  currencySymbol?: string;
  usuarioNombre?: string;
  usuarioEmail?: string;
}

export const sendInvestorAddedToCreditsNotification = async ({
  to,
  cc,
  inversionistaNombre,
  tipoOperacion,
  montoTotal,
  montoDistribuido,
  montoSinAsignar,
  creditos,
  currencySymbol = "Q",
  usuarioNombre,
  usuarioEmail,
}: SendInvestorAddedToCreditsNotificationParams) => {
  try {
    const validEmails = to.filter((email) => {
      try { emailSchema.parse(email); return true; } catch { return false; }
    });

    if (validEmails.length === 0) {
      console.warn("[sendInvestorAddedToCreditsNotification] No valid admin emails found");
      return { success: false, error: "No valid emails" };
    }

    const operacionLabel =
      tipoOperacion === "compra_cartera" ? "Compra de Cartera" : "Reinversión";

    const filas = creditos
      .map(
        (c) => `
          <tr>
            <td style="padding:8px;border:1px solid #e5e7eb;">${c.numero_credito_sifco}</td>
            <td style="padding:8px;border:1px solid #e5e7eb;text-align:right;">${currencySymbol}${c.monto_asignado}</td>
            <td style="padding:8px;border:1px solid #e5e7eb;text-align:center;">
              <span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:9999px;font-size:12px;font-weight:600;">POR VALIDAR</span>
            </td>
            <td style="padding:8px;border:1px solid #e5e7eb;text-align:center;">${c.cube_eliminado ? "Sí" : "No"}</td>
          </tr>`
      )
      .join("");

    const html = `
      <div style="font-family:Arial,sans-serif;color:#111827;max-width:640px;margin:0 auto;">
        <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:6px;margin-bottom:16px;">
          <strong style="color:#92400e;">⚠ ${operacionLabel} pendiente de validación</strong>
        </div>
        <h2 style="color:#0f766e;margin:0 0 8px 0;">${operacionLabel} por validar</h2>
        <p style="color:#6b7280;margin-top:0;">Se registró una nueva operación que necesita ser validada por un administrador antes de quedar en firme.</p>
        ${
          usuarioNombre || usuarioEmail
            ? `<p><strong>Registrado por:</strong> ${usuarioNombre ?? usuarioEmail}${usuarioNombre && usuarioEmail ? ` &lt;${usuarioEmail}&gt;` : ""}</p>`
            : ""
        }
        <p><strong>Inversionista:</strong> ${inversionistaNombre}</p>
        <p><strong>Monto total:</strong> ${currencySymbol}${montoTotal}</p>
        <p><strong>Monto distribuido:</strong> ${currencySymbol}${montoDistribuido}</p>
        <p><strong>Monto sin asignar:</strong> ${currencySymbol}${montoSinAsignar}</p>
        <h3 style="margin-top:24px;">Créditos a validar</h3>
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Crédito</th>
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:right;">Monto asignado</th>
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:center;">Estado</th>
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:center;">CUBE eliminado</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
        <p style="margin-top:24px;color:#6b7280;font-size:12px;">Notificación automática generada por Cartera CCI. Ingrese al sistema para validar la operación.</p>
      </div>
    `;

    const validCc = (cc ?? []).filter((email) => {
      try { emailSchema.parse(email); return true; } catch { return false; }
    });

    const { data, error } = await resend.emails.send({
      from: `Club Cash In <no-reply@${domain}>`,
      to: validEmails,
      cc: validCc.length > 0 ? validCc : undefined,
      subject: `[POR VALIDAR] ${operacionLabel} - ${inversionistaNombre} (${currencySymbol}${montoDistribuido})`,
      html,
    });

    if (error) {
      console.error("[sendInvestorAddedToCreditsNotification] Resend API Error:", error);
      return { success: false, error };
    }

    console.log(
      `[sendInvestorAddedToCreditsNotification] Email sent to ${validEmails.length} admins. ID: ${data?.id}`
    );
    return { success: true, data };
  } catch (err) {
    console.error("[sendInvestorAddedToCreditsNotification] Unexpected Error:", err);
    return { success: false, error: err };
  }
};

export interface SendCompraCarteraAcceptedNotificationParams {
  to: string[];
  cc?: string[];
  creditos: Array<{
    numero_credito_sifco: string;
    cliente_nombre: string;
    capital: string;
    observaciones?: string;
  }>;
  pool: Array<{
    inversionista_nombre: string;
    capital: string;
  }>;
  currencySymbol?: string;
  usuarioNombre?: string;
  usuarioEmail?: string;
  notasAdicionales?: string;
}

export const sendCompraCarteraAcceptedNotification = async ({
  to,
  cc,
  creditos,
  pool,
  currencySymbol = "Q",
  usuarioNombre,
  usuarioEmail,
  notasAdicionales,
}: SendCompraCarteraAcceptedNotificationParams) => {
  try {
    const validEmails = to.filter((email) => {
      try { emailSchema.parse(email); return true; } catch { return false; }
    });

    if (validEmails.length === 0) {
      console.warn("[sendCompraCarteraAcceptedNotification] No valid admin emails found");
      return { success: false, error: "No valid emails" };
    }

    const intro =
      creditos.length === 1
        ? `Buen día, comparto información solicitada, el crédito de <strong>${creditos[0].cliente_nombre}</strong> se convertirá en pool quedando de la siguiente manera:`
        : `Buen día, comparto información solicitada, los siguientes créditos se convertirán en pool quedando de la siguiente manera:`;

    const filasPool = pool
      .map(
        (p) => `
          <tr>
            <td style="padding:8px 12px;border:1px solid #f59e0b;background:#ffffff;">${p.inversionista_nombre}</td>
            <td style="padding:8px 12px;border:1px solid #f59e0b;background:#ffffff;text-align:right;">${currencySymbol} ${p.capital}</td>
          </tr>`
      )
      .join("");

    const filasCreditos = creditos
      .map(
        (c) => `
          <tr>
            <td style="padding:8px 12px;border:1px solid #f59e0b;background:#ffffff;">${c.numero_credito_sifco}</td>
            <td style="padding:8px 12px;border:1px solid #f59e0b;background:#ffffff;">${c.cliente_nombre}</td>
            <td style="padding:8px 12px;border:1px solid #f59e0b;background:#ffffff;text-align:right;">${currencySymbol} ${c.capital}</td>
          </tr>`
      )
      .join("");

    const observacionesUnicas = Array.from(
      new Set(
        creditos
          .map((c) => (c.observaciones ?? "").trim())
          .filter((o) => o.length > 0)
      )
    );

    const filasObservaciones = observacionesUnicas
      .map(
        (o) => `
          <tr>
            <td style="padding:8px 12px;border:1px solid #f59e0b;background:#ffffff;">${o}</td>
          </tr>`
      )
      .join("");

    const html = `
      <div style="font-family:Arial,sans-serif;color:#111827;max-width:720px;margin:0 auto;">
        <div style="background:#dcfce7;border-left:4px solid #16a34a;padding:12px 16px;border-radius:6px;margin-bottom:16px;">
          <strong style="color:#166534;">✓ Compra de Cartera aceptada</strong>
        </div>

        <p>${intro}</p>

        <h3 style="margin-top:20px;background:#f59e0b;color:#ffffff;padding:8px 12px;border:1px solid #f59e0b;display:inline-block;margin-bottom:0;">Pool resultante</h3>
        <table style="border-collapse:collapse;width:100%;font-size:14px;margin-top:0;">
          <tbody>${filasPool}</tbody>
        </table>

        <h3 style="margin-top:24px;background:#f59e0b;color:#ffffff;padding:8px 12px;border:1px solid #f59e0b;display:inline-block;margin-bottom:0;">Créditos</h3>
        <table style="border-collapse:collapse;width:100%;font-size:14px;margin-top:0;">
          <thead>
            <tr>
              <th style="padding:8px 12px;border:1px solid #f59e0b;background:#f59e0b;color:#ffffff;text-align:left;">Número SIFCO</th>
              <th style="padding:8px 12px;border:1px solid #f59e0b;background:#f59e0b;color:#ffffff;text-align:left;">Nombre</th>
              <th style="padding:8px 12px;border:1px solid #f59e0b;background:#f59e0b;color:#ffffff;text-align:right;">Capital</th>
            </tr>
          </thead>
          <tbody>${filasCreditos}</tbody>
        </table>

        ${
          observacionesUnicas.length > 0
            ? `
          <h3 style="margin-top:24px;background:#f59e0b;color:#ffffff;padding:8px 12px;border:1px solid #f59e0b;display:inline-block;margin-bottom:0;">Observaciones</h3>
          <table style="border-collapse:collapse;width:100%;font-size:14px;margin-top:0;">
            <tbody>${filasObservaciones}</tbody>
          </table>
        `
            : ""
        }

        ${
          notasAdicionales
            ? `<p style="margin-top:20px;"><strong>Notas adicionales:</strong> ${notasAdicionales}</p>`
            : ""
        }

        <p style="margin-top:24px;">Cualquier duda o consulta quedo a la orden,</p>
        <p>saludos cordiales</p>

        ${
          usuarioNombre || usuarioEmail
            ? `<p style="margin-top:24px;color:#6b7280;font-size:12px;">Aceptada por: ${usuarioNombre ?? usuarioEmail}${usuarioNombre && usuarioEmail ? ` &lt;${usuarioEmail}&gt;` : ""}</p>`
            : ""
        }
      </div>
    `;

    const subjectCliente =
      creditos.length === 1
        ? creditos[0].cliente_nombre
        : `${creditos.length} créditos`;

    const validCc = (cc ?? []).filter((email) => {
      try { emailSchema.parse(email); return true; } catch { return false; }
    });

    const { data, error } = await resend.emails.send({
      from: `Club Cash In <no-reply@${domain}>`,
      to: validEmails,
      cc: validCc.length > 0 ? validCc : undefined,
      subject: `Compra de Cartera aceptada - ${subjectCliente}`,
      html,
    });

    if (error) {
      console.error("[sendCompraCarteraAcceptedNotification] Resend API Error:", error);
      return { success: false, error };
    }

    console.log(
      `[sendCompraCarteraAcceptedNotification] Email sent to ${validEmails.length} admins. ID: ${data?.id}`
    );
    return { success: true, data };
  } catch (err) {
    console.error("[sendCompraCarteraAcceptedNotification] Unexpected Error:", err);
    return { success: false, error: err };
  }
};

export const sendSimpleEmail = async (to: string, subject: string, message: string) => {
  // Validar formato de correo antes de enviar
  emailSchema.parse(to);

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
