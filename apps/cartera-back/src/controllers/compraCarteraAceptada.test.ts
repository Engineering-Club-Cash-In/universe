import { beforeEach, describe, expect, mock, test } from "bun:test";
import Big from "big.js";

/** Cola de resultados de `db.select().from().where()`, en orden de llamada. */
let resultadosDeSelect: unknown[][] = [];

mock.module("../database", () => ({
  client: {},
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(resultadosDeSelect.shift() ?? []),
      }),
    }),
  },
}));

/** Lo que se le mandó al CRM, una batería por llamada. */
const bateriasPedidas: Array<{
  inversionista: { id: number };
  compra: {
    creditos: Array<{ creditoId: number; monto: string }>;
    montoTotal: string;
    montoAportadoPrevio?: string | null;
  };
}> = [];

mock.module("../services/crm.service", () => ({
  abrirBateriaDeContratosEnCrm: async (payload: (typeof bateriasPedidas)[number]) => {
    bateriasPedidas.push(payload);
    return { success: true, batchId: `bateria-${payload.inversionista.id}` };
  },
  getVehicleDetailsBySifco: async () => ({ success: false }),
}));

const { abrirBateriasDeContratos, montoAportadoAntesDeLaCompra } = await import(
  "./compraCarteraAceptada"
);

const ANA = 10;
const BETO = 20;

const inversionista = (id: number, nombre: string) => ({
  inversionista_id: id,
  nombre,
  dpi: null,
  dpi_rep_legal: null,
  email: `${nombre.toLowerCase()}@ejemplo.com`,
  celular: null,
  tipo_reinversion: "sin_reinversion",
  emite_factura: false,
});

const fila = (inversionista_id: number, monto: string) => ({
  inversionista_id,
  inversionista_nombre: `inv-${inversionista_id}`,
  monto: new Big(monto),
  porcentajeInversion: new Big(50),
});

const terminos = { tipoReinversion: "sin_reinversion", modalidadFacturacion: null };

beforeEach(() => {
  bateriasPedidas.length = 0;
  resultadosDeSelect = [
    [inversionista(ANA, "Ana"), inversionista(BETO, "Beto")],
    // Sin cuotas: las fechas no importan acá.
    [],
  ];
});

describe("baterías de una aceptación con varios inversionistas", () => {
  test("cada uno se lleva sólo los créditos que compró, aunque tenga posición en otros", async () => {
    // Ana compra el crédito 1; Beto, el 2. Ana ya tenía parte del 2 de antes.
    await abrirBateriasDeContratos({
      targetIds: [ANA, BETO],
      creditosRows: [
        { credito_id: 1, numero_credito_sifco: "S1", cliente_nombre: "Cliente 1" },
        { credito_id: 2, numero_credito_sifco: "S2", cliente_nombre: "Cliente 2" },
      ],
      rowsPorCredito: new Map([
        [1, [fila(ANA, "5000")]],
        [2, [fila(ANA, "9000"), fila(BETO, "3000")]],
      ]),
      montoNuevoPorPar: new Map([
        [`1-${ANA}`, new Big("5000")],
        [`2-${BETO}`, new Big("3000")],
      ]),
      tipoReinversionPorCredito: new Map(),
      modalidadFacturacionPorCredito: new Map(),
      // Lo que pasó en el espejo en esta aceptación.
      terminosPorPar: new Map([
        [`1-${ANA}`, terminos],
        [`2-${BETO}`, terminos],
      ]),
      aceptadaEn: new Date("2026-09-24T15:00:00.000Z"),
    });

    const deAna = bateriasPedidas.find((b) => b.inversionista.id === ANA);
    const deBeto = bateriasPedidas.find((b) => b.inversionista.id === BETO);

    expect(deAna?.compra.creditos.map((c) => c.creditoId)).toEqual([1]);
    expect(deAna?.compra.montoTotal).toBe("5000.00");
    expect(deBeto?.compra.creditos.map((c) => c.creditoId)).toEqual([2]);
    expect(deBeto?.compra.montoTotal).toBe("3000.00");
  });
});

describe("lo aportado antes de la compra", () => {
  const par = (credito_id: number, inversionista_id: number, monto: string) => ({
    credito_id,
    inversionista_id,
    monto_aportado: monto,
  });

  test("sin otra posición que la de esta compra, es su primera: cero", () => {
    const antes = montoAportadoAntesDeLaCompra({
      posiciones: [par(1, ANA, "5000.00000000")],
      sinAceptar: [],
      montoNuevoPorPar: new Map([[`1-${ANA}`, new Big("5000")]]),
    });

    expect(antes.get(ANA)).toBeUndefined();
  });

  test("lo que ya tenía, en otros créditos o en el mismo, cuenta", () => {
    const antes = montoAportadoAntesDeLaCompra({
      posiciones: [par(1, ANA, "8000"), par(2, ANA, "12000")],
      sinAceptar: [],
      // Le metió 5000 más al crédito 1, donde ya tenía 3000.
      montoNuevoPorPar: new Map([[`1-${ANA}`, new Big("5000")]]),
    });

    expect(antes.get(ANA)?.toFixed(2)).toBe("15000.00");
  });

  test("otra compra suya que sigue sin aceptar no la hace inversionista", () => {
    const antes = montoAportadoAntesDeLaCompra({
      posiciones: [par(1, ANA, "5000"), par(2, ANA, "7000")],
      sinAceptar: [par(2, ANA, "7000")],
      montoNuevoPorPar: new Map([[`1-${ANA}`, new Big("5000")]]),
    });

    expect(antes.get(ANA)).toBeUndefined();
  });

  test("un abono a capital en el medio no deja un saldo negativo que reste", () => {
    const antes = montoAportadoAntesDeLaCompra({
      // Entró 5000 al 1, pero ya se abonó capital; en el 2 tenía 1000 de antes.
      posiciones: [par(1, ANA, "4800"), par(2, ANA, "1000")],
      sinAceptar: [],
      montoNuevoPorPar: new Map([[`1-${ANA}`, new Big("5000")]]),
    });

    expect(antes.get(ANA)?.toFixed(2)).toBe("1000.00");
  });

  test("cada batería le lleva al CRM lo de su inversionista", async () => {
    resultadosDeSelect = [
      [inversionista(ANA, "Ana"), inversionista(BETO, "Beto")],
      [],
      // Posiciones del padre: Ana es nueva; Beto ya tenía el crédito 3.
      [par(1, ANA, "5000"), par(2, BETO, "3000"), par(3, BETO, "20000")],
      // Nada más sin aceptar.
      [],
    ];

    await abrirBateriasDeContratos({
      targetIds: [ANA, BETO],
      creditosRows: [
        { credito_id: 1, numero_credito_sifco: "S1", cliente_nombre: "Cliente 1" },
        { credito_id: 2, numero_credito_sifco: "S2", cliente_nombre: "Cliente 2" },
      ],
      rowsPorCredito: new Map([
        [1, [fila(ANA, "5000")]],
        [2, [fila(BETO, "3000")]],
      ]),
      montoNuevoPorPar: new Map([
        [`1-${ANA}`, new Big("5000")],
        [`2-${BETO}`, new Big("3000")],
      ]),
      tipoReinversionPorCredito: new Map(),
      modalidadFacturacionPorCredito: new Map(),
      terminosPorPar: new Map([
        [`1-${ANA}`, terminos],
        [`2-${BETO}`, terminos],
      ]),
      aceptadaEn: new Date("2026-09-25T15:00:00.000Z"),
    });

    const previo = (id: number) =>
      bateriasPedidas.find((b) => b.inversionista.id === id)?.compra
        .montoAportadoPrevio;
    expect(previo(ANA)).toBe("0.00");
    expect(previo(BETO)).toBe("20000.00");
  });

  test("si no se puede calcular, la batería se abre igual y sin el dato", async () => {
    resultadosDeSelect = [
      [inversionista(ANA, "Ana")],
      [],
      // Un monto que no se puede leer hace fallar el cálculo.
      [par(1, ANA, "no es un monto")],
      [],
    ];

    await abrirBateriasDeContratos({
      targetIds: [ANA],
      creditosRows: [
        { credito_id: 1, numero_credito_sifco: "S1", cliente_nombre: "Cliente 1" },
      ],
      rowsPorCredito: new Map([[1, [fila(ANA, "5000")]]]),
      montoNuevoPorPar: new Map([[`1-${ANA}`, new Big("5000")]]),
      tipoReinversionPorCredito: new Map(),
      modalidadFacturacionPorCredito: new Map(),
      terminosPorPar: new Map([[`1-${ANA}`, terminos]]),
      aceptadaEn: new Date("2026-09-25T15:00:00.000Z"),
    });

    expect(bateriasPedidas).toHaveLength(1);
    // Vacío: el CRM lo trata como primera compra y pide selfie y DPI.
    expect(bateriasPedidas[0]?.compra.montoAportadoPrevio).toBeNull();
  });
});
