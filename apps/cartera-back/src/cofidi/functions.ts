// src/utils/factura-html-generator.ts

interface DatosFactura {
  tipo: string;
  serie: string;
  numero: string;
  uuid: string;
  fechaEmision: string;
  fechaCertificacion: string;
  emisor: {
    nit: string;
    nombre: string;
    nombreComercial: string;
    direccion: any;
  };
  receptor: {
    nit: string;
    nombre: string;
    direccion?: string;
  };
  items: Array<{
    numeroLinea: string;
    cantidad: string;
    unidad: string;
    descripcion: string;
    precioUnitario: number;
    total: number;
  }>;
  totales: {
    iva: number;
    granTotal: number;
  };
  abonos: Array<{
    numero: string;
    fechaVencimiento: string;
    monto: number;
  }>;
  certificador: {
    nit: string;
    nombre: string;
  };
}

export function generarHTMLFacturaPro(
  datos: DatosFactura,
  logoUrl: string,
): string {
  const formatoMoneda = (valor: number) => {
    return `Q ${valor.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatoFecha = (fecha: string) => {
    return new Date(fecha).toLocaleDateString("es-GT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const calcularSubtotal = () => {
    return datos.totales.granTotal - datos.totales.iva;
  };

  return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Factura ${datos.serie}-${datos.numero}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #1e40af;
            --secondary: #3b82f6;
            --accent: #2563eb;
            --border: #bfdbfe;
            --bg-light: #eff6ff;
            --text-muted: #60a5fa;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            color: var(--primary);
            line-height: 1.5;
            background-color: #fff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        .container {
            max-width: 800px;
            margin: 0 auto;
            padding: 40px;
        }

        /* Header Layout */
        .header {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 48px;
            align-items: start;
        }

        .logo-container {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .logo {
            max-width: 160px;
            height: auto;
            transition: filter 0.3s ease;
        }

        .company-details {
            font-size: 12px;
            color: var(--secondary);
        }

        .company-name {
            font-size: 16px;
            font-weight: 700;
            color: var(--primary);
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.025em;
        }

        /* Invoice Info Box */
        .invoice-info {
            text-align: right;
        }

        .invoice-label {
            font-size: 32px;
            font-weight: 800;
            color: var(--primary);
            letter-spacing: -0.025em;
            margin-bottom: 8px;
            line-height: 1;
        }

        .invoice-type {
            font-size: 14px;
            font-weight: 600;
            color: var(--accent);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 24px;
        }

        .meta-grid {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 8px 16px;
            font-size: 13px;
            justify-content: end;
        }

        .meta-label {
            color: var(--text-muted);
            font-weight: 500;
        }

        .meta-value {
            font-weight: 600;
            color: var(--primary);
        }

        /* DTE Section */
        .dte-banner {
            background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 32px;
            color: white;
        }

        .dte-main {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .dte-title {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            opacity: 0.9;
        }

        .dte-number {
            font-size: 20px;
            font-weight: 700;
        }

        .dte-uuid {
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
            font-size: 10px;
            background: rgba(255,255,255,0.2);
            padding: 6px 10px;
            border-radius: 4px;
            word-break: break-all;
            margin-top: 8px;
        }

        /* Parties Section */
        .parties {
            margin-bottom: 40px;
        }

        .party-box {
            border-top: 2px solid var(--primary);
            padding-top: 12px;
        }

        .section-header {
            font-size: 11px;
            font-weight: 700;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 12px;
        }

        .party-name {
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 4px;
        }

        .party-details {
            font-size: 13px;
            color: var(--secondary);
        }

        /* Table Styles */
        .items-section {
            margin-bottom: 40px;
        }

        .items-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }

        .items-table th {
            text-align: left;
            padding: 12px 8px;
            border-bottom: 2px solid var(--primary);
            font-weight: 700;
            text-transform: uppercase;
            font-size: 11px;
            letter-spacing: 0.05em;
        }

        .items-table td {
            padding: 16px 8px;
            border-bottom: 1px solid var(--border);
            vertical-align: top;
        }

        .items-table tr:last-child td {
            border-bottom: 2px solid var(--primary);
        }

        .col-num {
            width: 40px;
            color: var(--text-muted);
        }

        .col-desc {
            font-weight: 500;
        }

        .col-qty {
            width: 60px;
            text-align: center;
        }

        .col-unit {
            width: 80px;
            text-align: center;
        }

        .col-price {
            width: 100px;
            text-align: right;
        }

        .col-total {
            width: 120px;
            text-align: right;
            font-weight: 600;
        }

        /* Abonos Section */
        .abonos-section {
            margin-bottom: 40px;
            background-color: var(--bg-light);
            padding: 24px;
            border-radius: 8px;
            border-left: 4px solid var(--primary);
        }

        .abonos-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            margin-top: 12px;
        }

        .abonos-table th {
            text-align: left;
            padding: 8px;
            color: var(--text-muted);
            font-weight: 600;
            border-bottom: 1px solid var(--border);
        }

        .abonos-table td {
            padding: 12px 8px;
            border-bottom: 1px solid var(--border);
        }

        .abonos-table td:last-child {
            text-align: right;
            font-weight: 600;
        }

        /* Totals Section */
        .summary-container {
            display: grid;
            grid-template-columns: 1fr 300px;
            gap: 40px;
        }

        .totals-box {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .total-row {
            display: flex;
            justify-content: space-between;
            font-size: 14px;
        }

        .total-row.grand-total {
            margin-top: 8px;
            padding-top: 16px;
            border-top: 2px solid var(--primary);
            font-size: 20px;
            font-weight: 800;
        }

        .total-label {
            color: var(--text-muted);
            font-weight: 500;
        }

        .grand-total .total-label {
            color: var(--primary);
        }

        /* Footer */
        .footer {
            margin-top: 64px;
            padding-top: 32px;
            border-top: 1px solid var(--border);
            text-align: center;
            font-size: 11px;
            color: var(--text-muted);
        }

        .cert-info {
            font-weight: 600;
            color: var(--secondary);
            margin-bottom: 8px;
        }

        .legal-notice {
            max-width: 500px;
            margin: 16px auto 0;
            line-height: 1.6;
            font-style: italic;
        }

        /* Print Adjustments */
        @media print {
            body {
                background: none;
            }

            .container {
                padding: 0;
                max-width: 100%;
            }
        }
    </style>
</head>

<body>
    <div class="container">
        <!-- HEADER -->
        <header class="header">
            <div class="logo-container">
                <img src="${logoUrl}" alt="Logo" class="logo" />
                <div class="company-details">
                    <h2 class="company-name">${datos.emisor.nombreComercial}</h2>
                    <p>${datos.emisor.nombre}</p>
                    <p>NIT: ${datos.emisor.nit}</p>
                    <p>${datos.emisor.direccion["dte:Direccion"]}</p>
                    <p>${datos.emisor.direccion["dte:Municipio"]}, ${datos.emisor.direccion["dte:Departamento"]}</p>
                </div>
            </div>

            <div class="invoice-info">
                <h1 class="invoice-label">FACTURA</h1>
                <p class="invoice-type"> Electrónica</p>

                <div class="meta-grid">
                    <span class="meta-label">Fecha de Emisión</span>
                    <span class="meta-value">${formatoFecha(datos.fechaEmision)}</span>

                    <span class="meta-label">Fecha de Certificación</span>
                    <span class="meta-value">${formatoFecha(datos.fechaCertificacion)}</span>
                </div>
            </div>
        </header>

        <!-- DTE INFO -->
        <div class="dte-banner">
            <div class="dte-main">
                <span class="dte-title">Documento Tributario Electrónico</span>
                <div class="dte-number">Serie ${datos.serie} — No. ${datos.numero}</div>
                <div class="dte-uuid">UUID: ${datos.uuid}</div>
            </div>
        </div>

        <!-- CLIENTE -->
        <section class="parties">
            <div class="party-box">
                <h3 class="section-header">Facturar a</h3>
                <div class="party-name">${datos.receptor.nombre}</div>
                <div class="party-details">
                    <p>NIT: ${datos.receptor.nit}</p>
                    <p>${datos.receptor.direccion || "Ciudad de Guatemala"}</p>
                </div>
            </div>
        </section>

        <!-- ITEMS -->
        <section class="items-section">
            <table class="items-table">
                <thead>
                    <tr>
                        <th class="col-num">#</th>
                        <th class="col-desc">Descripción</th>
                        <th class="col-qty">Cant.</th>
                        <th class="col-unit">Unidad</th>
                        <th class="col-price">Precio</th>
                        <th class="col-total">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${datos.items
                      .map(
                        (item) => `
                    <tr>
                        <td class="col-num">${item.numeroLinea}</td>
                        <td class="col-desc">${item.descripcion}</td>
                        <td class="col-qty">${item.cantidad}</td>
                        <td class="col-unit">${item.unidad}</td>
                        <td class="col-price">${formatoMoneda(item.precioUnitario)}</td>
                        <td class="col-total">${formatoMoneda(item.total)}</td>
                    </tr>
                    `,
                      )
                      .join("")}
                </tbody>
            </table>
        </section>

        <div class="summary-container">
            <!-- ABONOS / NOTES -->
            <div class="left-column">
                ${
                  datos.abonos.length > 0
                    ? `
                <div class="abonos-section">
                    <h3 class="section-header">Plan de Pagos</h3>
                    <table class="abonos-table">
                        <thead>
                            <tr>
                                <th>Cuota</th>
                                <th>Vencimiento</th>
                                <th style="text-align: right;">Monto</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${datos.abonos
                              .map(
                                (abono) => `
                            <tr>
                                <td>Cuota ${abono.numero}</td>
                                <td>${formatoFecha(abono.fechaVencimiento)}</td>
                                <td style="text-align: right;">${formatoMoneda(abono.monto)}</td>
                            </tr>
                            `,
                              )
                              .join("")}
                        </tbody>
                    </table>
                </div>
                `
                    : ""
                }
            </div>

            <!-- TOTALS -->
            <div class="totals-box">
                <div class="total-row">
                    <span class="total-label">Subtotal</span>
                    <span class="total-value">${formatoMoneda(calcularSubtotal())}</span>
                </div>
                <div class="total-row">
                    <span class="total-label">IVA (12%)</span>
                    <span class="total-value">${formatoMoneda(datos.totales.iva)}</span>
                </div>
                <div class="total-row grand-total">
                    <span class="total-label">TOTAL</span>
                    <span class="total-value">${formatoMoneda(datos.totales.granTotal)}</span>
                </div>
            </div>
        </div>

        <!-- FOOTER -->
        <footer class="footer">
            <div class="cert-info">
                Certificado por: ${datos.certificador.nombre} | NIT: ${datos.certificador.nit}
            </div>
            <p>Documento certificado electrónicamente por SAT Guatemala</p>
            <p class="legal-notice">
               Sujeto a retención definitiva ISR. Factura electrónica emitida en línea.
                Válida sin sello ni firma.
            </p>
        </footer>
    </div>
</body>
</html>
  `;
}
