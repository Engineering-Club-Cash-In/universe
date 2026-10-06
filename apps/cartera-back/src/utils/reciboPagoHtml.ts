/**
 * HTML del recibo de pago que se le manda al cliente (PDF adjunto por
 * WhatsApp y descarga desde cartera). Función pura: `generateReciboPagoPDF`
 * trae los datos, esto arma el documento y Puppeteer lo imprime.
 *
 * Diseño de marca (violeta Cash-In). Sin desglose de capital/interés/IVA: el
 * cliente ve cuánto pagó, cuánto se aplicó y, solo si las hubo, la mora y los
 * otros cargos que incluyó el pago.
 */

import { LOGO_CASHIN_AZUL, LOGO_CASHIN_BLANCO } from "./logosCashin";

/** En qué quedó el pago: el recibo no puede decir "aplicado" si no lo está. */
export type EstadoReciboPago = "aplicado" | "en_validacion" | "anulado" | "registrado";

/**
 * `paymentFalse` = pago anulado (la reversa conserva la fila). `validated` y
 * `capital_validated` = aplicado. `pending`/`capital` = falta que conta lo
 * valide. `reset` = devuelto a revisión. `no_required` = fila sembrada que no
 * pasa por validación.
 */
export function estadoReciboPago(validationStatus: string | null | undefined, paymentFalse: boolean | null | undefined): EstadoReciboPago {
  if (paymentFalse) return "anulado";
  if (validationStatus === "validated" || validationStatus === "capital_validated") return "aplicado";
  if (validationStatus === "pending" || validationStatus === "capital" || validationStatus === "reset") return "en_validacion";
  return "registrado";
}

const BADGES: Record<EstadoReciboPago, { texto: string; color: string }> = {
  aplicado: { texto: "✓ Pago aplicado", color: "#22b55f" },
  en_validacion: { texto: "Pago en validación", color: "#d97706" },
  anulado: { texto: "Pago anulado", color: "#dc2626" },
  registrado: { texto: "Pago registrado", color: "#6b6b80" },
};

export type DatosReciboPago = {
  pagoId: number;
  estado: EstadoReciboPago;
  montoBoleta: number;
  montoAplicado: number;
  mora: number;
  otros: number;
  /** "YYYY-MM-DD..." en hora de Guatemala. */
  fechaPago: string | null;
  origenPago: string | null;
  referencia: string | null;
  clienteNombre: string;
  clienteNit: string | null;
  numeroCreditoSifco: string;
  numeroCuota: number | null;
  plazo: number | null;
  proximoPago: { fecha: string; monto: number; numeroCuota: number } | null;
  observaciones: string | null;
  /** Fecha y hora de generación ya formateadas. */
  generadoEl: string;
};

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-08-02" (o con hora) → "2 de agosto de 2026", sin pasar por zonas horarias. */
export function fechaLarga(valor: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor ?? "");
  if (!m) return "—";
  const mes = MESES[Number(m[2]) - 1];
  if (!mes) return "—";
  return `${Number(m[3])} de ${mes} de ${m[1]}`;
}

export function montoQ(n: number): string {
  return n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function escaparHtml(valor: string): string {
  return valor
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const MEDIOS: Record<string, string> = {
  transferencia: "Transferencia",
  cheque: "Cheque",
  boleta: "Depósito",
};

export function medioDePago(origen: string | null | undefined): string {
  if (!origen) return "—";
  return MEDIOS[origen] ?? origen.charAt(0).toUpperCase() + origen.slice(1);
}

export function htmlReciboPago(d: DatosReciboPago): string {
  const e = escaparHtml;
  const medio = medioDePago(d.origenPago);
  const cuota =
    d.numeroCuota != null ? (d.plazo ? `${d.numeroCuota} de ${d.plazo}` : String(d.numeroCuota)) : "—";

  // Solo lo que el cliente necesita ver además del monto aplicado.
  const cargos: string[] = [];
  if (d.mora > 0) cargos.push(`<div class="fila"><span>Mora</span><span>Q${montoQ(d.mora)}</span></div>`);
  if (d.otros > 0) cargos.push(`<div class="fila"><span>Otros cargos</span><span>Q${montoQ(d.otros)}</span></div>`);

  const badge = BADGES[d.estado];
  const aplicado = d.estado === "aplicado";

  const proximo = d.proximoPago
    ? `<div class="label-sm">Su próximo pago</div>
       <div class="proximo-fecha">${fechaLarga(d.proximoPago.fecha)}</div>
       <div class="proximo-det">Q${montoQ(d.proximoPago.monto)} · Cuota ${d.proximoPago.numeroCuota}${d.plazo ? ` de ${d.plazo}` : ""}</div>`
    : `<div class="proximo-fecha">Sin cuotas pendientes</div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: #1a1a2e; background: #fff; }
  .recibo { max-width: 560px; margin: 0 auto; border-radius: 20px; overflow: hidden; border: 1px solid #ececf3; }
  .header { position: relative; overflow: hidden; background: linear-gradient(135deg, #7a6bff 0%, #5260ff 55%, #4338ca 100%); color: #fff; padding: 28px 32px 26px; }
  .header::before, .header::after { content: ""; position: absolute; border-radius: 50%; background: rgba(255,255,255,0.08); }
  .header::before { width: 220px; height: 220px; right: -60px; top: -90px; }
  .header::after { width: 260px; height: 260px; right: 40px; bottom: -170px; }
  .logo { height: 34px; position: relative; }
  .titulo { font-family: 'Poppins', 'Inter', sans-serif; font-size: 30px; font-weight: 700; margin-top: 22px; position: relative; }
  .subtitulo { font-size: 12px; opacity: 0.85; margin-top: 6px; position: relative; }
  .pill { display: inline-block; margin-top: 16px; padding: 6px 14px; border-radius: 999px; background: rgba(255,255,255,0.18); font-size: 11px; font-weight: 600; position: relative; }
  .pill small { font-size: 8px; letter-spacing: 0.6px; text-transform: uppercase; opacity: 0.85; margin-right: 6px; }
  .franja { height: 4px; background: #b6e94b; }
  .cuerpo { padding: 24px 32px 28px; }
  .badge { display: inline-block; color: #fff; font-size: 10px; font-weight: 600; padding: 4px 10px; border-radius: 999px; }
  .label-sm { font-size: 9px; font-weight: 600; letter-spacing: 0.6px; text-transform: uppercase; color: #6b6b80; }
  .monto { font-family: 'Poppins', 'Inter', sans-serif; font-size: 34px; font-weight: 700; margin-top: 4px; }
  .monto small { font-size: 16px; margin-right: 4px; }
  .meta { font-size: 11px; color: #6b6b80; margin-top: 6px; padding-bottom: 18px; border-bottom: 1px solid #ececf3; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 18px; }
  .card { background: #f3f3f8; border-radius: 10px; padding: 10px 12px; }
  .card.full { grid-column: 1 / -1; }
  .card .valor { font-size: 12px; font-weight: 600; margin-top: 3px; word-break: break-all; }
  .cargos { margin-top: 16px; }
  .fila { display: flex; justify-content: space-between; font-size: 11px; color: #4a4a5e; padding: 3px 0; }
  .aplicado { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; padding: 16px 18px; border-radius: 12px; background: linear-gradient(135deg, #5260ff, #4338ca); color: #fff; }
  .aplicado .label-sm { color: rgba(255,255,255,0.85); }
  .aplicado .valor { font-family: 'Poppins', 'Inter', sans-serif; font-size: 20px; font-weight: 700; }
  .aplicado .valor small { font-size: 11px; margin-right: 3px; }
  .estado { margin-top: 16px; padding: 14px 16px; border-radius: 12px; background: #eef0ff; border: 1px solid #d9dcff; }
  .estado .label-sm:first-child { color: #5260ff; padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid #d9dcff; }
  .proximo-fecha { font-family: 'Poppins', 'Inter', sans-serif; font-size: 18px; font-weight: 700; color: #4338ca; margin-top: 2px; }
  .proximo-det { font-size: 11px; font-weight: 600; margin-top: 2px; }
  .obs { margin-top: 14px; padding: 10px 12px; border-radius: 8px; background: #fffbeb; border-left: 3px solid #f59e0b; font-size: 11px; color: #92400e; }
  .pie { background: #f7f7fb; padding: 18px 32px 20px; text-align: center; }
  .pie img { height: 26px; }
  .pie p { font-size: 9px; color: #6b6b80; margin-top: 8px; }
  .pie p.gen { color: #9a9aad; margin-top: 4px; }
  .web { display: inline-block; margin-top: 10px; padding: 4px 12px; border-radius: 999px; border: 1px solid #ececf3; background: #fff; font-size: 9px; font-weight: 600; color: #4338ca; }
</style>
</head>
<body>
  <div class="recibo">
    <div class="header">
      <img class="logo" src="${LOGO_CASHIN_BLANCO}" alt="Cash-In" />
      <div class="titulo">Recibo de pago</div>
      <div class="subtitulo">Comprobante de pago · Club Cash-In</div>
      <div class="pill"><small>Comprobante</small>No. ${d.pagoId}</div>
    </div>
    <div class="franja"></div>
    <div class="cuerpo">
      <span class="badge" style="background: ${badge.color};">${badge.texto}</span>
      <div class="label-sm" style="margin-top: 10px; text-transform: none; letter-spacing: 0; font-weight: 500;">Monto pagado</div>
      <div class="monto"><small>Q</small>${montoQ(d.montoBoleta)}</div>
      <div class="meta">${fechaLarga(d.fechaPago)} · ${e(medio)}</div>

      <div class="grid">
        <div class="card full"><div class="label-sm">Cliente</div><div class="valor">${e(d.clienteNombre)}</div></div>
        <div class="card"><div class="label-sm">NIT</div><div class="valor">${e(d.clienteNit || "C/F")}</div></div>
        <div class="card"><div class="label-sm">Crédito</div><div class="valor">${e(d.numeroCreditoSifco)}</div></div>
        <div class="card"><div class="label-sm">Cuota</div><div class="valor">${e(cuota)}</div></div>
      </div>

      ${cargos.length > 0 ? `<div class="cargos"><div class="label-sm" style="margin-bottom: 4px;">El pago incluye</div>${cargos.join("")}</div>` : ""}

      ${aplicado
        ? `<div class="aplicado">
        <span class="label-sm">Monto aplicado</span>
        <span class="valor"><small>Q</small>${montoQ(d.montoAplicado)}</span>
      </div>`
        : ""}

      <div class="estado">
        <div class="label-sm">Estado del crédito</div>
        ${proximo}
      </div>

      <div class="grid">
        <div class="card"><div class="label-sm">Medio de pago</div><div class="valor">${e(medio)}</div></div>
        <div class="card"><div class="label-sm">No. de referencia</div><div class="valor">${e(d.referencia || "—")}</div></div>
      </div>
      ${d.observaciones ? `<div class="obs">${e(d.observaciones)}</div>` : ""}
    </div>
    <div class="pie">
      <img src="${LOGO_CASHIN_AZUL}" alt="Cash-In" />
      <p>Este documento es un comprobante de pago generado por el sistema de Club Cash-In.</p>
      <p class="gen">Generado el ${e(d.generadoEl)}</p>
      <span class="web">www.clubcashin.com</span>
    </div>
  </div>
</body>
</html>`;
}
