import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { camposObligatoriosCondonacion, erroresUrlBoletasDelBucket } from "./registerPaymentPolicy";

const BASE = "https://pub-0000.r2.dev/payments-receipts/";
const U1 = "000d9d65-0bbf-4890-90d9-784fcc1e5a50.jpeg";
const U2 = "ABCDEF12-0bbf-4890-90d9-784fcc1e5a50.pdf";
const U3 = "000d9d65-0bbf-4890-90d9-784fcc1e5a50"; // archivo sin extensión
const MSG_BOLETA = ["La foto de la boleta debe subirse desde la pantalla de cobro (no se acepta un enlace o nombre escrito a mano). Vuelva a subir la foto y reintente."];
const MSG_CONFIG = ["No se puede condonar por boleta tardía: falta configurar la dirección pública de las boletas (URL_PUBLIC_R2). Avise a soporte."];
const pago = (url_boletas: string[]) => ({ url_boletas, numeroAutorizacion: "A-1", banco_id: 3 });

describe("condonación: la boleta debe ser un archivo del bucket de la app", () => {
  test("llaves que la subida genera (uuid, con y sin extensión)", () => {
    for (const k of [U1, U2, U3]) expect(erroresUrlBoletasDelBucket([k], BASE)).toEqual([]);
    expect(erroresUrlBoletasDelBucket([U1, U2, U3], BASE)).toEqual([]);
    expect(camposObligatoriosCondonacion(pago([U1]), BASE)).toEqual({});
  });

  const malas: [string, string][] = [
    ["texto suelto", "x"],
    ["nombre a mano", "boleta.jpg"],
    ["URL de otro host", `https://evil.example/${U1}`],
    ["URL del propio bucket completa (se concatenaría doble)", `${BASE}${U1}`],
    ["host parecido", `https://pub-0000.r2.dev.evil.com/payments-receipts/${U1}`],
    ["http", `http://pub-0000.r2.dev/payments-receipts/${U1}`],
    ["con usuario:clave@", `https://user:pass@pub-0000.r2.dev/payments-receipts/${U1}`],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>1</script>"],
    ["ruta fuera del prefijo", `/otra/${U1}`],
    ["con ..", `../${U1}`],
    ["uuid con subcarpeta", `a/${U1}`],
    ["uuid con espacio al final", `${U1} `],
    ["uuid con salto de línea", `${U1}\n`],
    ["extensión doble", `${U1}.jpg.html`],
    ["extensión con barra", `${U1}./x`],
    ["uuid con consulta", `${U1}?x=1`],
    ["uuid con fragmento", `${U1}#x`],
    ["uuid truncado", "000d9d65-0bbf-4890-90d9"],
    ["cadena vacía dentro de la lista", ""],
  ];
  for (const [nombre, k] of malas) {
    test(`rechaza: ${nombre}`, () => {
      expect(erroresUrlBoletasDelBucket([k], BASE)).toEqual(MSG_BOLETA);
      expect(erroresUrlBoletasDelBucket([U1, k], BASE)).toEqual(MSG_BOLETA); // una mala arruina la lista
    });
  }

  test("cadena vacía sola: sigue siendo 'obligatorio', no el mensaje del bucket", () => {
    expect(camposObligatoriosCondonacion(pago([""]), BASE)).toEqual({ url_boletas: ["url_boletas es obligatorio para condonar por boleta tardía"] });
    expect(camposObligatoriosCondonacion(pago([]), BASE)).toEqual({ url_boletas: ["url_boletas es obligatorio para condonar por boleta tardía"] });
  });
  test("una lista con una llave mala se rechaza entera", () => {
    expect(camposObligatoriosCondonacion(pago([U1, "x"]), BASE)).toEqual({ url_boletas: MSG_BOLETA });
  });
  test("valor no string (cruzado desde JSON) se rechaza", () => {
    expect(erroresUrlBoletasDelBucket([U1, 5 as any], BASE)).toEqual(MSG_BOLETA);
  });

  describe("URL_PUBLIC_R2 ausente o mal configurada: falla cerrado", () => {
    const sanas = ["https://pub-0000.r2.dev/", "https://pub-0000.r2.dev/payments-receipts/", "https://boletas.cashin.example/r/"];
    for (const b of sanas) test(`acepta base ${b}`, () => expect(erroresUrlBoletasDelBucket([U1], b)).toEqual([]));
    const rotas: [string, string][] = [
      ["vacía", ""],
      ["no es URL", "payments-receipts/"],
      ["http", "http://pub-0000.r2.dev/payments-receipts/"],
      ["con credenciales", "https://u:p@pub-0000.r2.dev/payments-receipts/"],
      ["sin barra final", "https://pub-0000.r2.dev/payments-receipts"],
      ["con consulta", "https://pub-0000.r2.dev/payments-receipts/?a=1"],
    ];
    for (const [nombre, b] of rotas) {
      test(`base ${nombre}: rechaza incluso una llave válida`, () => {
        expect(erroresUrlBoletasDelBucket([U1], b)).toEqual(MSG_CONFIG);
        expect(camposObligatoriosCondonacion(pago([U1]), b)).toEqual({ url_boletas: MSG_CONFIG });
      });
    }
    test("sin segundo argumento lee URL_PUBLIC_R2 del entorno", () => {
      const previo = process.env.URL_PUBLIC_R2;
      try {
        delete process.env.URL_PUBLIC_R2;
        expect(camposObligatoriosCondonacion(pago([U1]))).toEqual({ url_boletas: MSG_CONFIG });
        process.env.URL_PUBLIC_R2 = BASE;
        expect(camposObligatoriosCondonacion(pago([U1]))).toEqual({});
      } finally {
        if (previo === undefined) delete process.env.URL_PUBLIC_R2; else process.env.URL_PUBLIC_R2 = previo;
      }
    });
  });

  test("los demás faltantes se siguen reportando junto al de la boleta", () => {
    expect(camposObligatoriosCondonacion({ url_boletas: ["x"] }, BASE)).toEqual({
      url_boletas: MSG_BOLETA,
      numeroAutorizacion: ["numeroAutorizacion es obligatorio para condonar por boleta tardía"],
      banco_id: ["banco_id es obligatorio para condonar por boleta tardía"],
    });
  });

  test("pagos SIN el bloque no se validan: el camino normal (insertPayment) no usa esta regla", () => {
    const normal = readFileSync(new URL("./registerPayment.ts", import.meta.url), "utf8");
    expect(normal).not.toContain("camposObligatoriosCondonacion");
    expect(normal).not.toContain("erroresUrlBoletasDelBucket");
    const router = readFileSync(new URL("../routers/payments.ts", import.meta.url), "utf8");
    expect(router).toContain("if (!traeCondonacionBoletaTardia(ctx.body)) return insertPayment(ctx);");
  });
});
