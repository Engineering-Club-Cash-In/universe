import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("../database", () => ({ db: {}, client: {} }));

const {
  formatearFechaBoleta,
  formatearMontoQ,
  generarBoletasNexa,
  ESTADOS_EVENTO_NEXA_APLICADO,
  htmlBoletaNexa,
  keyBoletaNexa,
} = await import("./nexaBoletaImagen");
type Deps = NonNullable<Parameters<typeof generarBoletasNexa>[1]>;
type Datos = Awaited<ReturnType<Deps["datos"]>>;

const datos = (pagoId: number, over: Partial<NonNullable<Datos>> = {}): NonNullable<Datos> => ({
  pagoId,
  numeroAutorizacion: "36418016",
  monto: "2500.5",
  fechaBoleta: "2026-10-01",
  numeroSifco: "01010203000123",
  cliente: "Cliente de Prueba",
  ...over,
});

/** La key es aleatoria: el pago de una subida se reconoce por el número de transferencia del motor (trf-<pago_id>). */
const pagoDelPng = (png: Buffer) => Number(/trf-(\d+)</.exec(png.toString())?.[1]);

/**
 * Motor fake con las mismas reglas que las consultas reales: un pago es
 * elegible si es Nexa con el evento aplicado, no está anulado (paymentFalse) y no tiene fila en
 * `boletas`. Las aserciones miran la TABLA resultante, no solo las llamadas.
 */
function motor(
  pagos: { pago_id: number; nexa: boolean; paymentFalse: boolean; evento?: string }[],
  boletasIniciales: number[] = [],
) {
  const boletas: { pago_id: number; url_boleta: string }[] = boletasIniciales.map((pago_id) => ({ pago_id, url_boleta: "manual" }));
  const subidas: { pagoId: number; key: string }[] = [];
  const borradas: string[] = [];
  const eventos: string[] = [];
  const elegible = (pagoId: number) => {
    const pago = pagos.find((p) => p.pago_id === pagoId);
    return !!pago && pago.nexa && !pago.paymentFalse && !boletas.some((b) => b.pago_id === pagoId)
      && (ESTADOS_EVENTO_NEXA_APLICADO as readonly string[]).includes(pago.evento ?? "billing_pending");
  };
  let candado = Promise.resolve();
  const deps: Deps = {
    pendientes: async (limite) => pagos.filter((p) => elegible(p.pago_id)).map((p) => p.pago_id).sort((a, b) => a - b).slice(0, limite),
    datos: async (pagoId) => (elegible(pagoId) ? datos(pagoId, { numeroAutorizacion: `trf-${pagoId}` }) : null),
    abrirRender: async () => {
      eventos.push("abrir");
      return {
        render: async (html) => Buffer.from(html),
        cerrar: async () => { eventos.push("cerrar"); },
      };
    },
    subir: async (key, png) => { subidas.push({ pagoId: pagoDelPng(png), key }); },
    borrar: async (key) => { borradas.push(key); },
    // Igual que el registro real: candado por pago y re-chequeo adentro.
    registrar: async (pagoId, url) => {
      const anterior = candado;
      let soltar!: () => void;
      candado = new Promise((r) => { soltar = r; });
      await anterior;
      try {
        await Promise.resolve();
        if (!elegible(pagoId)) return false;
        boletas.push({ pago_id: pagoId, url_boleta: url });
        return true;
      } finally {
        soltar();
      }
    },
    urlPublica: (key) => `https://r2.example/${key}`,
  };
  return { deps, boletas, subidas, borradas, eventos };
}

afterEach(() => {
  delete process.env.NEXA_BOLETA_IMAGEN_ENABLED;
});

describe("htmlBoletaNexa", () => {
  test("lleva el número de transferencia, el monto con miles y la fecha sin correr el día", () => {
    const html = htmlBoletaNexa(datos(1, { monto: "1234567.5", fechaBoleta: "2026-10-01" }));
    expect(html).toContain("36418016");
    expect(html).toContain("Q 1,234,567.50");
    expect(html).toContain("01/10/2026");
    expect(html).toContain("Comprobante de transferencia");
    expect(html).toContain("Transferencia ACH");
    expect(html).toContain("No es un documento emitido por el banco.");
  });

  test("escapa los valores", () => {
    const html = htmlBoletaNexa(datos(1, { cliente: "<script>alert(1)</script>", numeroAutorizacion: "a&b\"c" }));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("a&amp;b&quot;c");
  });

  test("sin logo cae al texto y con logo lo embebe", () => {
    expect(htmlBoletaNexa(datos(1))).toContain('class="logo-texto"');
    expect(htmlBoletaNexa(datos(1), "data:image/png;base64,AAAA")).toContain('src="data:image/png;base64,AAAA"');
  });

  test("formatos", () => {
    expect(formatearMontoQ("0.5")).toBe("Q 0.50");
    expect(formatearMontoQ("100")).toBe("Q 100.00");
    expect(formatearMontoQ(null)).toBe("—");
    expect(formatearFechaBoleta("2026-01-31")).toBe("31/01/2026");
    expect(formatearFechaBoleta(null)).toBe("—");
  });
});

describe("generarBoletasNexa", () => {
  test("una imagen por pago del evento, con un solo browser y key aleatoria sin el pago_id", async () => {
    const m = motor([
      { pago_id: 17, nexa: true, paymentFalse: false },
      { pago_id: 18, nexa: true, paymentFalse: false },
    ]);
    const r = await generarBoletasNexa([17, 18], m.deps);
    expect(r).toEqual({ generadas: [17, 18], omitidas: [], fallidas: [] });
    expect(m.subidas.map((s) => s.pagoId)).toEqual([17, 18]);
    expect(m.boletas).toEqual(m.subidas.map((s) => ({ pago_id: s.pagoId, url_boleta: `https://r2.example/${s.key}` })));
    // Como las boletas del front (uuid v4): no se adivina ni se recorre por pago_id.
    for (const { key } of m.subidas) expect(key).toMatch(/^boletas-nexa\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/);
    expect(keyBoletaNexa()).not.toBe(keyBoletaNexa());
    expect(m.borradas).toEqual([]);
    expect(m.eventos).toEqual(["abrir", "cerrar"]);
  });

});
