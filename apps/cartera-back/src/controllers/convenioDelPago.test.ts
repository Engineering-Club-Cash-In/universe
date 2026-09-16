import { describe, expect, it } from "bun:test";
import { convenios_pago, convenios_pagos_resume } from "../database/db/schema";
import { convenioQueRecibioElPago } from "./convenioDelPago";

/**
 * A QUÉ CONVENIO se le descuenta un pago revertido.
 *
 * La ronda anterior buscaba por el pivot `convenios_pagos_resume` y caía a "el
 * convenio vigente del crédito". Codex (P1) mostró —y el sandbox confirmó: 196
 * de 204— que el pivot solo tiene las filas pre-sembradas al crear el convenio,
 * así que casi nunca acertaba; y el respaldo excluía los anulados, que es
 * justo cuando la reversa tiene que encontrarlos.
 *
 * El doble registra de qué tabla lee cada consulta y responde en orden: acá no
 * se prueba SQL, se prueba el orden de los criterios.
 */
function ejecutorFalso(respuestas: unknown[][]) {
  const tablas: unknown[] = [];
  let i = 0;
  const cadena = (tabla: unknown) => {
    tablas.push(tabla);
    const filas = respuestas[i++] ?? [];
    const fin = { limit: async () => filas };
    return { where: () => ({ ...fin, orderBy: () => fin }) };
  };
  return {
    tablas,
    ejecutor: { select: () => ({ from: (t: unknown) => cadena(t) }) },
  };
}

const convenio = (convenio_id: number, extra: Record<string, unknown> = {}) => ({
  convenio_id,
  credito_id: 659,
  ...extra,
});

describe("convenioQueRecibioElPago", () => {
  it("usa el sello de la fila y no mira nada más", async () => {
    const { tablas, ejecutor } = ejecutorFalso([[convenio(98)]]);
    const r = await convenioQueRecibioElPago(
      { credito_id: 659, pago_id: 1, convenio_id: 98 },
      ejecutor as never,
    );
    expect(r?.convenio_id).toBe(98);
    expect(tablas).toEqual([convenios_pago]);
  });

  it("encuentra el convenio sellado aunque esté ANULADO", async () => {
    const anulado = convenio(98, { activo: false, anulado_at: new Date() });
    const { ejecutor } = ejecutorFalso([[anulado]]);
    const r = await convenioQueRecibioElPago(
      { credito_id: 659, pago_id: 1, convenio_id: 98 },
      ejecutor as never,
    );
    expect(r as unknown).toBe(anulado);
  });

  it("sin sello, prueba el pivot antes que el respaldo", async () => {
    const { tablas, ejecutor } = ejecutorFalso([
      [{ convenio_id: 70 }],
      [convenio(70)],
    ]);
    const r = await convenioQueRecibioElPago(
      { credito_id: 659, pago_id: 1, convenio_id: null },
      ejecutor as never,
    );
    expect(r?.convenio_id).toBe(70);
    expect(tablas).toEqual([convenios_pagos_resume, convenios_pago]);
  });

  it("sin sello ni pivot cae al más reciente del crédito, anulados incluidos", async () => {
    const anulado = convenio(98, { activo: false, anulado_at: new Date() });
    const { tablas, ejecutor } = ejecutorFalso([[], [anulado]]);
    const r = await convenioQueRecibioElPago(
      { credito_id: 659, pago_id: 1 },
      ejecutor as never,
    );
    expect(r as unknown).toBe(anulado);
    expect(tablas).toEqual([convenios_pagos_resume, convenios_pago]);
  });

  it("un sello que apunta a un convenio inexistente no deja la reversa sin respuesta", async () => {
    const { ejecutor } = ejecutorFalso([[], [], [convenio(12)]]);
    const r = await convenioQueRecibioElPago(
      { credito_id: 659, pago_id: 1, convenio_id: 999 },
      ejecutor as never,
    );
    expect(r?.convenio_id).toBe(12);
  });
});
