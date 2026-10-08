import { describe, expect, it } from "bun:test";
import {
  escapeHtml,
  formatQ,
  otrosParaCliente,
  renderEstadoCuentaCancelacionHTML,
  type DatosHtmlEstadoCuentaCancelacion,
} from "./estadoCuentaCancelacionHtml";
import {
  calcularDesgloseCancelacion,
  normalizarEntradaEstadoCuenta,
} from "./estadoCuentaCancelacionCalculo";

const entrada = normalizarEntradaEstadoCuenta({
  cuotasRestantes: 1,
  traspaso: 0,
  garantiaMobiliaria: 0,
  otros: 0,
  montosAdicionales: [{ concepto: `<img src=x onerror="alert(1)">`, monto: 10 }],
  motivo: "<script>alert('m')</script>",
  observaciones: "a & b",
});

const desglose = calcularDesgloseCancelacion(
  { capital: "1000", interes: "10", iva: "1.2", membresias: "0", seguro: "0", gps: "0", mora: "0" },
  entrada
);

const datos = (filasHtml: string[] = []): DatosHtmlEstadoCuentaCancelacion => ({
  documentoId: "6f1c1b7e-8a4d-4c1e-9a52-1b2c3d4e5f60",
  numeroCredito: "01010101",
  clienteNombre: `Juan <b>"Pérez"</b>`,
  generadoAt: new Date("2026-10-02T18:30:00Z"),
  fechaCorteGT: "2026-10-02",
  logoUrl: "https://logo.example/l.png",
  historial: {
    encabezadoHtml: "<tr><th>No.</th></tr>",
    filasHtml,
    totales: { capital: "0.00", interes: "0.00", iva: "0.00", servicios: "0.00", mora: "0.00", montoAplicado: "0.00" },
  },
  entrada,
  desglose,
});

describe("renderEstadoCuentaCancelacionHTML", () => {
  it("sin pagos elegibles muestra «Sin pagos realizados» y sí incluye el cálculo", () => {
    const html = renderEstadoCuentaCancelacionHTML(datos());
    expect(html).toContain("Sin pagos realizados");
    expect(html).toContain("TOTAL PARA CANCELAR");
    expect(html).toContain(formatQ(desglose.montoCancelacion));
  });

  it("con pagos muestra la tabla y los montos abonados", () => {
    const html = renderEstadoCuentaCancelacionHTML(datos(["<tr><td>1</td></tr>"]));
    expect(html).not.toContain("Sin pagos realizados");
    expect(html).toContain("TOTAL ABONADO");
    expect(html).toContain("<tr><td>1</td></tr>");
  });

  it("encabezado: crédito, folio, fecha de corte, GTQ y emisión solo con la fecha", () => {
    const html = renderEstadoCuentaCancelacionHTML(datos());
    expect(html).toContain("01010101");
    expect(html).toContain("6f1c1b7e-8a4d-4c1e-9a52-1b2c3d4e5f60");
    expect(html).toContain("2026-10-02");
    expect(html).toContain("GTQ");
    // 18:30 UTC = 12:30 en Guatemala: solo se muestra el día.
    expect(html).toContain("<strong>Emitido:</strong> 2 de octubre de 2026</span>");
    expect(html).not.toContain("12:30");
    expect(html).not.toContain("no acredita pago");
    // El encabezado identifica el documento por el crédito, una sola vez; sin «Folio».
    expect(html).not.toContain("Folio");
    expect(html.match(/<strong>Crédito:<\/strong>/g)?.length).toBe(1);
  });

  it("montos pendientes: solo Capital, Otros (el resto) y Total, sin desglose", () => {
    const html = renderEstadoCuentaCancelacionHTML(datos());
    const seccion = html.slice(html.indexOf("Montos pendientes para cancelar"), html.indexOf('<div class="motivo">'));
    // 1000 + 1×(10+1.2) + 10 de monto adicional = 1021.20 → Otros = 21.20
    expect(desglose.montoCancelacion).toBe("1021.20");
    expect(otrosParaCliente(desglose)).toBe("21.20");
    expect(seccion).toContain("<td>Capital</td><td class=\"money\">Q1,000.00</td>");
    expect(seccion).toContain("<td>Otros</td><td class=\"money\">Q21.20</td>");
    expect(seccion).toContain("TOTAL PARA CANCELAR");
    for (const oculto of ["Interés", "IVA", "Seguro", "GPS", "Membresía", "Mora", "Traspaso", "Garantía", "Cuotas restantes", "Monto adicional"]) {
      expect(seccion).not.toContain(oculto);
    }
  });

  it("escapa nombre, motivo, observaciones y conceptos", () => {
    const html = renderEstadoCuentaCancelacionHTML(datos());
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain(`<img src=x`);
    expect(html).not.toContain(`<b>"Pérez"</b>`);
    expect(html).toContain("&lt;script&gt;alert(&#39;m&#39;)&lt;/script&gt;");
    expect(html).toContain("a &amp; b");
    expect(html).toContain("Juan &lt;b&gt;&quot;Pérez&quot;&lt;/b&gt;");
  });
});

describe("formatQ / escapeHtml", () => {
  it("formatea con miles y conserva decimales extra del operador", () => {
    expect(formatQ("28653.45")).toBe("Q28,653.45");
    expect(formatQ("-990")).toBe("-Q990.00");
    expect(formatQ("10.555")).toBe("Q10.555");
    expect(formatQ("0")).toBe("Q0.00");
  });

  it("escapa los cinco caracteres especiales", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});
