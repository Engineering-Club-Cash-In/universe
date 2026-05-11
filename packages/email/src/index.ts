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

// ================================================================
// DEV MODE: redirige TODOS los correos a un solo destinatario.
// Controlado por la env SERVER (default: "DEV"):
//   - SERVER=DEV   → todos los correos van solo a EMAIL_DEV_RECIPIENT
//                    (default: jalvarado@clubcashin.com).
//   - SERVER=PROD  → envío normal con destinatarios originales.
// Por seguridad, el default es DEV: si la env no está seteada, NO se
// mandan correos a destinatarios reales.
// ================================================================
const SERVER = (process.env.SERVER ?? "DEV").toUpperCase();
const EMAIL_DEV_RECIPIENT =
  process.env.EMAIL_DEV_RECIPIENT ?? "jalvarado@clubcashin.com";

if (SERVER !== "PROD") {
  const originalSend = resend.emails.send.bind(resend.emails);
  resend.emails.send = (async (payload: any, options?: any) => {
    const original = { to: payload?.to, cc: payload?.cc, bcc: payload?.bcc };
    const overridden = {
      ...payload,
      to: [EMAIL_DEV_RECIPIENT],
      cc: undefined,
      bcc: undefined,
    };
    console.log(
      `[Email ${SERVER}] Redirigiendo correo a ${EMAIL_DEV_RECIPIENT}. Originales:`,
      original,
    );
    return originalSend(overridden, options);
  }) as typeof resend.emails.send;
}

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
    tipo_reinversion?:
      | "reinversion_capital"
      | "reinversion_interes"
      | "reinversion_total"
      | null;
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

    const modalidadLabel: Record<string, string> = {
      reinversion_capital: "Reinversión Capital",
      reinversion_interes: "Reinversión de Interés",
      reinversion_total: "Interés Compuesto",
    };

    const filas = creditos
      .map(
        (c) => `
          <tr>
            <td style="padding:8px;border:1px solid #e5e7eb;">${c.numero_credito_sifco}</td>
            <td style="padding:8px;border:1px solid #e5e7eb;text-align:right;">${currencySymbol}${c.monto_asignado}</td>
            <td style="padding:8px;border:1px solid #e5e7eb;text-align:center;">${
              c.tipo_reinversion ? modalidadLabel[c.tipo_reinversion] ?? c.tipo_reinversion : "Tradicional"
            }</td>
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
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:center;">Modalidad</th>
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
    numero_credito_sifco: string;
    cliente_nombre: string;
    tipo_reinversion?:
      | "sin_reinversion"
      | "reinversion_capital"
      | "reinversion_interes"
      | "reinversion_total"
      | "reinversion_variable"
      | "reinversion_combinada"
      | null;
    rows: Array<{
      inversionista_nombre: string;
      capital: string;
    }>;
  }>;
  operacionInfo?: {
    inversionistaNombre: string;
    monto: string;
    modalidad: string;
    factura: string;
    porcentajeInversionista: string;
    porcentajeCube: string;
  };
  currencySymbol?: string;
  usuarioNombre?: string;
  usuarioEmail?: string;
  notasAdicionales?: string;
  // Aviso de expiración por 3 días hábiles.
  // `fechaExpiraLabel`: último día hábil de vigencia (ej. "viernes 24 de abril de 2026").
  // `fechaBajaLabel`: día en que el job automático la dará de baja a las 00:00 (ej. "lunes 27 de abril de 2026").
  expiracion?: {
    fechaExpiraLabel: string;
    fechaBajaLabel: string;
  };
}

export const sendCompraCarteraAcceptedNotification = async ({
  to,
  cc,
  creditos,
  pool,
  operacionInfo,
  currencySymbol = "Q",
  usuarioNombre,
  usuarioEmail,
  notasAdicionales,
  expiracion,
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

    const modalidadLabelCreditos: Record<string, string> = {
      sin_reinversion: "Sin Reinversión",
      reinversion_capital: "Reinversión Capital",
      reinversion_interes: "Reinversión de Interés",
      reinversion_total: "Interés Compuesto",
      reinversion_variable: "Reinversión Variable",
      reinversion_combinada: "Reinversión Combinada",
    };

    // Una tabla por crédito: encabezado con cliente/SIFCO/capital/modalidad y filas de inversionistas.
    const poolsPorCredito = pool
      .map((grupo) => {
        const filas = grupo.rows
          .map(
            (p) => `
              <tr>
                <td style="padding:8px 12px;border:1px solid #f59e0b;background:#ffffff;">${p.inversionista_nombre}</td>
                <td style="padding:8px 12px;border:1px solid #f59e0b;background:#ffffff;text-align:right;">${currencySymbol} ${p.capital}</td>
              </tr>`
          )
          .join("");

        const modalidad = grupo.tipo_reinversion
          ? modalidadLabelCreditos[grupo.tipo_reinversion] ?? grupo.tipo_reinversion
          : "Tradicional";

        return `
          <p style="margin:12px 0 4px 0;font-size:13px;color:#374151;">
            <strong>${grupo.cliente_nombre}</strong>
            <span style="color:#6b7280;"> — ${grupo.numero_credito_sifco}</span>
            <span style="color:#6b7280;"> — Modalidad: ${modalidad}</span>
          </p>
          <table style="border-collapse:collapse;width:100%;font-size:14px;margin-top:0;margin-bottom:12px;">
            <thead>
              <tr>
                <th colspan="2" style="padding:8px 12px;border:1px solid #f59e0b;background:#fef3c7;color:#78350f;text-align:left;font-weight:600;">
                  Modalidad: ${modalidad}
                </th>
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>
        `;
      })
      .join("");

    // Observaciones por crédito (solo incluimos créditos que tengan obs)
    const creditosConObs = creditos.filter(
      (c) => (c.observaciones ?? "").trim().length > 0,
    );

    const filasObservaciones = creditosConObs
      .map(
        (c) => `
          <tr>
            <td style="padding:8px 12px;border:1px solid #f59e0b;background:#ffffff;vertical-align:top;">
              <strong>${c.cliente_nombre}</strong><br/>
              <span style="color:#6b7280;font-size:12px;">${c.numero_credito_sifco}</span>
            </td>
            <td style="padding:8px 12px;border:1px solid #f59e0b;background:#ffffff;">${(c.observaciones ?? "").trim()}</td>
          </tr>`
      )
      .join("");

    const headerBlock = operacionInfo
      ? `
        <h2 style="margin:8px 0 16px 0;color:#111827;">VENTA DE CARTERA ${operacionInfo.inversionistaNombre}</h2>
        <table style="border-collapse:collapse;font-size:14px;margin-bottom:16px;">
          <tr>
            <td style="padding:4px 12px 4px 0;"><strong>Monto:</strong></td>
            <td style="padding:4px 0;">${currencySymbol} ${operacionInfo.monto}</td>
          </tr>
          <tr>
            <td style="padding:4px 12px 4px 0;"><strong>Modalidad:</strong></td>
            <td style="padding:4px 0;">${operacionInfo.modalidad}</td>
          </tr>
          <tr>
            <td style="padding:4px 12px 4px 0;"><strong>Factura:</strong></td>
            <td style="padding:4px 0;">${operacionInfo.factura}</td>
          </tr>
        </table>

        <p style="margin:16px 0 4px 0;">Datos de Negociación son los siguientes.</p>
        <p style="margin:4px 0;"><strong>Repartición</strong></p>
        <p style="margin:2px 0;">* Inversionista&nbsp;&nbsp;${operacionInfo.porcentajeInversionista}%</p>
        <p style="margin:2px 0 16px 0;">* Cube&nbsp;&nbsp;${operacionInfo.porcentajeCube}%</p>
      `
      : "";

    const html = `
      <div style="font-family:Arial,sans-serif;color:#111827;max-width:720px;margin:0 auto;">
        <div style="background:#dcfce7;border-left:4px solid #16a34a;padding:12px 16px;border-radius:6px;margin-bottom:16px;">
          <strong style="color:#166534;">✓ Compra de Cartera aceptada</strong>
        </div>

        ${
          expiracion
            ? `
          <div style="background:#fef3c7;border-left:4px solid #d97706;padding:12px 16px;border-radius:6px;margin-bottom:16px;color:#78350f;">
            <p style="margin:0 0 6px 0;"><strong>⚠ Vigencia: 3 días hábiles</strong></p>
            <p style="margin:0;font-size:13px;">
              Esta compra tiene validez hasta el <strong>${expiracion.fechaExpiraLabel}</strong>.
              Si no se completa, será dada de baja automáticamente el
              <strong>${expiracion.fechaBajaLabel}</strong> a las 00:00 (GT).
            </p>
          </div>
        `
            : ""
        }

        ${headerBlock}

        <p>${intro}</p>

        <h3 style="margin-top:20px;background:#f59e0b;color:#ffffff;padding:8px 12px;border:1px solid #f59e0b;display:inline-block;margin-bottom:0;">Pool resultante por crédito</h3>
        ${poolsPorCredito}

        ${
          creditosConObs.length > 0
            ? `
          <h3 style="margin-top:24px;background:#f59e0b;color:#ffffff;padding:8px 12px;border:1px solid #f59e0b;display:inline-block;margin-bottom:0;">Observaciones</h3>
          <table style="border-collapse:collapse;width:100%;font-size:14px;margin-top:0;">
            <thead>
              <tr>
                <th style="padding:8px 12px;border:1px solid #f59e0b;background:#f59e0b;color:#ffffff;text-align:left;">Crédito</th>
                <th style="padding:8px 12px;border:1px solid #f59e0b;background:#f59e0b;color:#ffffff;text-align:left;">Observación</th>
              </tr>
            </thead>
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

    // El subject prioriza el nombre del inversionista (si viene).
    // Si no hay operacionInfo, cae al nombre del cliente o la cantidad.
    const subjectLabel =
      operacionInfo?.inversionistaNombre ??
      (creditos.length === 1
        ? creditos[0].cliente_nombre
        : `${creditos.length} créditos`);

    const validCc = (cc ?? []).filter((email) => {
      try { emailSchema.parse(email); return true; } catch { return false; }
    });

    const { data, error } = await resend.emails.send({
      from: `Club Cash In <no-reply@${domain}>`,
      to: validEmails,
      cc: validCc.length > 0 ? validCc : undefined,
      subject: `Compra de Cartera aceptada - ${subjectLabel}`,
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

// ================================================================
// NOTIFICACIÓN: COMPRA DE CARTERA EXPIRADA / CANCELADA AUTOMÁTICAMENTE
// Se dispara desde el job diario cuando una compra aceptada no se
// completó dentro de los 3 días hábiles de vigencia.
// ================================================================
export interface SendCompraCarteraExpiradaNotificationParams {
  to: string[];
  cc?: string[];
  // Cada inversionista cuya compra se canceló, con los créditos que afectaba.
  inversionistas: Array<{
    inversionista_nombre: string;
    creditos: Array<{
      numero_credito_sifco: string;
      cliente_nombre: string;
      monto_aportado: string;
    }>;
  }>;
  currencySymbol?: string;
  fechaEjecucionLabel?: string;
}

export const sendCompraCarteraExpiradaNotification = async ({
  to,
  cc,
  inversionistas,
  currencySymbol = "Q",
  fechaEjecucionLabel,
}: SendCompraCarteraExpiradaNotificationParams) => {
  try {
    const validEmails = to.filter((email) => {
      try { emailSchema.parse(email); return true; } catch { return false; }
    });

    if (validEmails.length === 0) {
      console.warn("[sendCompraCarteraExpiradaNotification] No valid admin emails found");
      return { success: false, error: "No valid emails" };
    }

    if (inversionistas.length === 0) {
      return { success: false, error: "No hay inversionistas para notificar" };
    }

    const bloqueInversionistas = inversionistas
      .map((inv) => {
        const filas = inv.creditos
          .map(
            (c) => `
              <tr>
                <td style="padding:8px 12px;border:1px solid #dc2626;background:#ffffff;">${c.numero_credito_sifco}</td>
                <td style="padding:8px 12px;border:1px solid #dc2626;background:#ffffff;">${c.cliente_nombre}</td>
                <td style="padding:8px 12px;border:1px solid #dc2626;background:#ffffff;text-align:right;">${currencySymbol} ${c.monto_aportado}</td>
              </tr>`,
          )
          .join("");

        return `
          <h3 style="margin-top:20px;background:#dc2626;color:#ffffff;padding:8px 12px;border:1px solid #dc2626;display:inline-block;margin-bottom:0;">
            ${inv.inversionista_nombre}
          </h3>
          <table style="border-collapse:collapse;width:100%;font-size:14px;margin-top:0;margin-bottom:12px;">
            <thead>
              <tr>
                <th style="padding:8px 12px;border:1px solid #dc2626;background:#dc2626;color:#ffffff;text-align:left;">Número SIFCO</th>
                <th style="padding:8px 12px;border:1px solid #dc2626;background:#dc2626;color:#ffffff;text-align:left;">Cliente</th>
                <th style="padding:8px 12px;border:1px solid #dc2626;background:#dc2626;color:#ffffff;text-align:right;">Monto aportado</th>
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>
        `;
      })
      .join("");

    const html = `
      <div style="font-family:Arial,sans-serif;color:#111827;max-width:720px;margin:0 auto;">
        <div style="background:#fee2e2;border-left:4px solid #dc2626;padding:12px 16px;border-radius:6px;margin-bottom:16px;">
          <strong style="color:#7f1d1d;">✕ Compra de Cartera cancelada por vencimiento</strong>
          ${fechaEjecucionLabel ? `<div style="margin-top:4px;color:#7f1d1d;font-size:12px;">Ejecutado el ${fechaEjecucionLabel}</div>` : ""}
        </div>

        <p>
          Los siguientes inversionistas no completaron su compra de cartera
          dentro de los <strong>3 días hábiles</strong> de vigencia. Su monto
          fue <strong>devuelto automáticamente a CUBE INVESTMENTS, S.A.</strong>
          y los créditos quedaron restituidos.
        </p>

        ${bloqueInversionistas}

        <p style="margin-top:24px;">Cualquier duda o consulta quedo a la orden,</p>
        <p>saludos cordiales</p>
      </div>
    `;

    const subjectLabel =
      inversionistas.length === 1
        ? inversionistas[0].inversionista_nombre
        : `${inversionistas.length} inversionistas`;

    const validCc = (cc ?? []).filter((email) => {
      try { emailSchema.parse(email); return true; } catch { return false; }
    });

    const { data, error } = await resend.emails.send({
      from: `Club Cash In <no-reply@${domain}>`,
      to: validEmails,
      cc: validCc.length > 0 ? validCc : undefined,
      subject: `Compra de Cartera cancelada por vencimiento - ${subjectLabel}`,
      html,
    });

    if (error) {
      console.error("[sendCompraCarteraExpiradaNotification] Resend API Error:", error);
      return { success: false, error };
    }

    console.log(
      `[sendCompraCarteraExpiradaNotification] Email sent to ${validEmails.length} admins. ID: ${data?.id}`,
    );
    return { success: true, data };
  } catch (err) {
    console.error("[sendCompraCarteraExpiradaNotification] Unexpected Error:", err);
    return { success: false, error: err };
  }
};

export interface SendSessionCancelledNotificationParams {
  to: string[];
  affectedInvestorNames: string;
  adminName: string;
  adminEmail?: string;
  credits: Array<{
    sifco: string;
    cliente: string;
    monto: string;
  }>;
  currencySymbol?: string;
}

export const sendSessionCancelledNotification = async ({
  to,
  affectedInvestorNames,
  adminName,
  adminEmail,
  credits,
  currencySymbol = "Q",
}: SendSessionCancelledNotificationParams) => {
  try {
    const validEmails = to.filter((email) => {
      try {
        emailSchema.parse(email);
        return true;
      } catch {
        return false;
      }
    });

    if (validEmails.length === 0) {
      console.warn("[sendSessionCancelledNotification] No valid emails found");
      return { success: false, error: "No valid emails" };
    }

    const nowGT = new Date().toLocaleString("es-GT", {
      timeZone: "America/Guatemala",
    });

    const rowsHtml = credits
      .map(
        (c) => `
      <tr>
        <td style="padding:10px;border:1px solid #e5e7eb;">${c.sifco}</td>
        <td style="padding:10px;border:1px solid #e5e7eb;">${c.cliente}</td>
        <td style="padding:10px;border:1px solid #e5e7eb;text-align:right;">${currencySymbol}${c.monto}</td>
      </tr>
    `,
      )
      .join("");

    const html = `
      <div style="font-family:Arial,sans-serif;color:#111827;max-width:640px;margin:0 auto;">
        <h2 style="color:#111827;margin-bottom:16px;">Sesión <span style="color:#dc2626;">CANCELADA</span> (Devuelta a Cube)</h2>
        <p style="color:#374151;line-height:1.5;">Los siguientes créditos tenían inversionistas pendientes que han sido <strong>removidos</strong> y su participación devuelta a Cube Investments S.A.</p>
        
        <table style="width:100%;margin-bottom:24px;font-size:14px;">
          <tr>
            <td style="padding:4px 0;width:180px;"><strong>Inversionista(s) afectados:</strong></td>
            <td style="padding:4px 0;">${affectedInvestorNames}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;"><strong>Créditos afectados:</strong></td>
            <td style="padding:4px 0;">${credits.length}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;"><strong>Fecha (GT):</strong></td>
            <td style="padding:4px 0;">${nowGT}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;"><strong>Cancelada por:</strong></td>
            <td style="padding:4px 0;">${adminName}${adminEmail ? ` &lt;${adminEmail}&gt;` : ""}</td>
          </tr>
        </table>

        <h3 style="margin-bottom:12px;font-size:16px;">Detalle de montos devueltos a Cube</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:10px;border:1px solid #e5e7eb;text-align:left;">SIFCO</th>
              <th style="padding:10px;border:1px solid #e5e7eb;text-align:left;">Cliente</th>
              <th style="padding:10px;border:1px solid #e5e7eb;text-align:right;">Monto a Cube</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

        <p style="margin-top:24px;color:#6b7280;font-size:11px;border-top:1px solid #eee;padding-top:12px;">
          Correo automático — Club Cash In / Cartera.
        </p>
      </div>
    `;

    const subject = `Sesión CANCELADA — ${affectedInvestorNames}`;

    return await sendPlainEmail(validEmails, subject, html);
  } catch (err) {
    console.error("[sendSessionCancelledNotification] Unexpected Error:", err);
    return { success: false, error: err };
  }
};

/**
 * Envía un correo con HTML arbitrario (sin envolver en <strong>).
 * Útil para mensajes editados por el usuario, donde el caller arma el HTML.
 */
export const sendPlainEmail = async (
  to: string | string[],
  subject: string,
  html: string,
) => {
  const recipients = Array.isArray(to) ? to : [to];
  recipients.forEach(email => emailSchema.parse(email));

  try {
    const { data, error } = await resend.emails.send({
      from: `Club Cash In <no-reply@${domain}>`,
      to: recipients,
      subject,
      html,
    });

    if (error) {
      console.error("[sendPlainEmail] Resend API Error:", error);
      return { success: false, error };
    }

    console.log(`[sendPlainEmail] Email sent to ${recipients.length} recipients. ID: ${data?.id}`);
    return { success: true, data };
  } catch (err) {
    console.error("[sendPlainEmail] Unexpected Error:", err);
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
