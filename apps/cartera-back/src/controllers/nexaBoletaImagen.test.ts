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

  test("no procesa el pago anulado, el que ya tiene boleta ni el que no es Nexa", async () => {
    const m = motor([
      { pago_id: 1, nexa: true, paymentFalse: true },
      { pago_id: 2, nexa: true, paymentFalse: false },
      { pago_id: 3, nexa: false, paymentFalse: false },
    ], [2]);
    const r = await generarBoletasNexa([1, 2, 3], m.deps);
    expect(r).toEqual({ generadas: [], omitidas: [1, 2, 3], fallidas: [] });
    expect(m.boletas).toEqual([{ pago_id: 2, url_boleta: "manual" }]);
    expect(m.subidas).toEqual([]);
    // Sin nada que dibujar ni se abre el browser.
    expect(m.eventos).toEqual([]);
  });

  test("un pago colgado se corta por tiempo y el siguiente sigue", async () => {
    const m = motor([
      { pago_id: 1, nexa: true, paymentFalse: false },
      { pago_id: 2, nexa: true, paymentFalse: false },
    ]);
    const subir = m.deps.subir;
    m.deps.subir = (key, png) => (pagoDelPng(png) === 1 ? new Promise<void>(() => undefined) : subir(key, png));
    const original = console.error;
    console.error = () => undefined;
    try {
      expect(await generarBoletasNexa([1, 2], m.deps, 20)).toEqual({ generadas: [2], omitidas: [], fallidas: [1] });
    } finally {
      console.error = original;
    }
    expect(m.eventos).toEqual(["abrir", "cerrar"]);
  });

  test("si Chromium no abre, corta en vez de reintentar pago por pago", async () => {
    const m = motor([1, 2, 3].map((pago_id) => ({ pago_id, nexa: true, paymentFalse: false })));
    let intentos = 0;
    m.deps.abrirRender = async () => { intentos += 1; throw new Error("Failed to launch the browser process"); };
    const original = console.error;
    console.error = () => undefined;
    try {
      expect(await generarBoletasNexa([1, 2, 3], m.deps)).toEqual({ generadas: [], omitidas: [], fallidas: [1, 2, 3] });
    } finally {
      console.error = original;
    }
    expect(intentos).toBe(1);
    expect(m.boletas).toEqual([]);
  });

  test("si Chromium abre después del tope, ese browser se cierra igual", async () => {
    const m = motor([{ pago_id: 1, nexa: true, paymentFalse: false }]);
    let cerrados = 0;
    m.deps.abrirRender = () => new Promise((resolve) => setTimeout(() => resolve({
      render: async () => Buffer.from(""),
      cerrar: async () => { cerrados += 1; },
    }), 40));
    const original = console.error;
    console.error = () => undefined;
    try {
      expect(await generarBoletasNexa([1], m.deps, 10)).toEqual({ generadas: [], omitidas: [], fallidas: [1] });
      expect(cerrados).toBe(0);
      await new Promise((r) => setTimeout(r, 80));
    } finally {
      console.error = original;
    }
    expect(cerrados).toBe(1);
  });

  test("dos generaciones del mismo pago dejan una boleta y borran el PNG que sobra", async () => {
    const m = motor([{ pago_id: 9, nexa: true, paymentFalse: false }]);
    const [a, b] = await Promise.all([generarBoletasNexa([9], m.deps), generarBoletasNexa([9], m.deps)]);
    expect([...a.generadas, ...b.generadas]).toEqual([9]);
    // Cada intento sube con key propia; el que no registró borra la suya, no la de la boleta.
    const keys = m.subidas.map((s) => s.key);
    expect(new Set(keys).size).toBe(2);
    expect(m.boletas).toHaveLength(1);
    const registrada = keys.find((k) => m.boletas[0]!.url_boleta === `https://r2.example/${k}`);
    expect(m.borradas).toEqual(keys.filter((k) => k !== registrada));
  });

  test("un pago que falla no frena a los demás y el browser se cierra", async () => {
    const m = motor([
      { pago_id: 1, nexa: true, paymentFalse: false },
      { pago_id: 2, nexa: true, paymentFalse: false },
    ]);
    const subir = m.deps.subir;
    m.deps.subir = async (key, png) => {
      if (pagoDelPng(png) === 1) throw new Error("R2 caído");
      return subir(key, png);
    };
    const errores: string[] = [];
    const original = console.error;
    console.error = (msg: string) => { errores.push(msg); };
    try {
      const r = await generarBoletasNexa([1, 2], m.deps);
      expect(r).toEqual({ generadas: [2], omitidas: [], fallidas: [1] });
    } finally {
      console.error = original;
    }
    expect(m.boletas.map((b) => b.pago_id)).toEqual([2]);
    expect(m.eventos).toEqual(["abrir", "cerrar"]);
    expect(JSON.parse(errores[0]!)).toMatchObject({ event: "nexa.boleta_imagen.error", pago_id: 1, error: "R2 caído" });
  });

  test("sin URL_PUBLIC_R2 no registra una URL rota", async () => {
    const m = motor([{ pago_id: 4, nexa: true, paymentFalse: false }]);
    m.deps.urlPublica = () => null;
    const original = console.error;
    console.error = () => undefined;
    try {
      expect(await generarBoletasNexa([4], m.deps)).toEqual({ generadas: [], omitidas: [4], fallidas: [] });
    } finally {
      console.error = original;
    }
    expect(m.boletas).toEqual([]);
  });

  test("si el registro no inserta (el pago dejó de ser elegible), borra el PNG que subió", async () => {
    const m = motor([{ pago_id: 5, nexa: true, paymentFalse: false }]);
    m.deps.registrar = async () => false;
    expect(await generarBoletasNexa([5], m.deps)).toEqual({ generadas: [], omitidas: [5], fallidas: [] });
    expect(m.borradas).toEqual([m.subidas[0]!.key]);
  });

  test("si el registro lanza, borra el PNG y el pago queda fallido", async () => {
    const m = motor([{ pago_id: 5, nexa: true, paymentFalse: false }]);
    m.deps.registrar = async () => { throw new Error("violates foreign key constraint"); };
    const original = console.error;
    console.error = () => undefined;
    try {
      expect(await generarBoletasNexa([5], m.deps)).toEqual({ generadas: [], omitidas: [], fallidas: [5] });
    } finally {
      console.error = original;
    }
    expect(m.borradas).toEqual([m.subidas[0]!.key]);
    expect(m.boletas).toEqual([]);
  });

  test("un trabajo que termina después del tope sin registrar también borra su PNG", async () => {
    const m = motor([{ pago_id: 5, nexa: true, paymentFalse: false }]);
    m.deps.registrar = () => new Promise((r) => setTimeout(() => r(false), 40));
    const original = console.error;
    console.error = () => undefined;
    try {
      expect(await generarBoletasNexa([5], m.deps, 10)).toEqual({ generadas: [], omitidas: [], fallidas: [5] });
      expect(m.borradas).toEqual([]);
      await new Promise((r) => setTimeout(r, 80));
    } finally {
      console.error = original;
    }
    expect(m.borradas).toEqual([m.subidas[0]!.key]);
  });

  test("si borrar el PNG falla, no lanza y queda en el log con la key", async () => {
    const m = motor([{ pago_id: 5, nexa: true, paymentFalse: false }]);
    m.deps.registrar = async () => false;
    m.deps.borrar = async () => { throw new Error("R2 caído"); };
    const errores: string[] = [];
    const original = console.error;
    console.error = (msg: string) => { errores.push(msg); };
    try {
      expect(await generarBoletasNexa([5], m.deps)).toEqual({ generadas: [], omitidas: [5], fallidas: [] });
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      console.error = original;
    }
    expect(errores.map((e) => JSON.parse(e))).toEqual([expect.objectContaining({
      event: "nexa.boleta_imagen.error", pago_id: 5, paso: "borrar_huerfana", key: m.subidas[0]!.key, error: "R2 caído",
    })]);
  });
});
