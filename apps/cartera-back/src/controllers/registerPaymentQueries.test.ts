import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";

import { condicionUltimaCuotaPagada } from "./registerPaymentQueries";

const CREDITO_ID = 12345;

// Se renderiza la MISMA condición que `insertPayment` pasa a su `.where(...)`,
// no una reimplementación paralela. El último test amarra el call site para que
// la consulta de producción no pueda desengancharse del helper sin avisar.
const render = () =>
  new PgDialect().sqlToQuery(condicionUltimaCuotaPagada(CREDITO_ID)!);

describe("condicionUltimaCuotaPagada (ancla del abono directo a capital)", () => {
  it("exige plata APLICADA A LA CUOTA y ata la consulta al crédito pedido", () => {
    const { sql, params } = render();

    expect(sql).toContain('"cartera"."cuotas_credito"."credito_id" = ');
    expect(sql).toContain('"cartera"."cuotas_credito"."numero_cuota" > ');
    expect(sql).toContain('"cartera"."pagos_credito"."pagado" = ');
    expect(sql).toContain('"cartera"."pagos_credito"."monto_aplicado" > ');
    expect(sql).toContain('"cartera"."pagos_credito"."abono_capital" > ');
    expect(sql).toContain('"cartera"."pagos_credito"."abono_interes" > ');

    // Los valores, no sólo los nombres de columna: el crédito pedido, la cuota 0
    // excluida, `pagado = true` (no false) y el umbral de plata en cero.
    expect(params).toEqual([CREDITO_ID, 0, true, "0", "0", "0"]);
  });

  it("NO exige cuotas_credito.pagado — esa columna sólo la escribe conta", () => {
    // `insertPayment` nunca cierra la cuota (los dos update(cuotas_credito) del
    // archivo viven en la vía de validación). Exigirla dejaría fuera la cuota
    // recién pagada en este mismo request y el crédito se leería moroso hasta
    // que conta valide, días después.
    const { sql } = render();
    expect(sql).not.toContain('"cartera"."cuotas_credito"."pagado"');
  });

  it("NO cuenta monto_boleta como plata de la cuota", () => {
    // monto_boleta es el total de la boleta y se estampa igual en TODAS las
    // filas que crea un pago, incluidos los recibos de solo mora / solo otros
    // que tienen monto_aplicado = 0. Incluirlo volvería vacuo el filtro.
    const { sql } = render();
    expect(sql).not.toContain('"cartera"."pagos_credito"."monto_boleta"');
  });

  it("la consulta de producción sigue usando este helper", () => {
    const fuente = readFileSync(
      new URL("./registerPayment.ts", import.meta.url),
      "utf8"
    );
    expect(fuente).toContain(".where(condicionUltimaCuotaPagada(credito_id))");
  });
});
