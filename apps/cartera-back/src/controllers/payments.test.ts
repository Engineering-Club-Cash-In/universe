import { beforeEach, describe, expect, it, mock } from "bun:test";
import Big from "big.js";

// Let's create simple test flags/mocks we can dynamically adjust per test case
let mockCreditosInversionistaEspejo: any[] = [];
let mockCuotasCreditoWithPagos: any[] = [];
let mockPagosPendientesEspejo: any[] = [];
let mockHistoricoLiquidacionesEspejo: any[] = [];

// For compras_credito_inversionista mock
let mockComprasCreditoInversionista: any[] = [];

mock.module("../database/index", () => {
  const mockDrizzleSelectChain = (tableName: string, isMainQuery: boolean, isSelectNoFields: boolean) => {
    const limit = (limitNum: number) => {
      return Promise.resolve(mockHistoricoLiquidacionesEspejo);
    };

    const orderBy = (...orderArgs: any[]) => {
      const promise = Promise.resolve(mockHistoricoLiquidacionesEspejo);
      Object.assign(promise, { limit });
      return promise;
    };

    const where = (whereCond: any) => {
      if (isSelectNoFields) {
        return Promise.resolve(mockPagosPendientesEspejo);
      }
      if (tableName.includes("cuotas_credito") || tableName.includes("pagos_credito")) {
        const order = (...args: any[]) => Promise.resolve(mockCuotasCreditoWithPagos);
        const promise = Promise.resolve(mockCuotasCreditoWithPagos);
        Object.assign(promise, { orderBy: order });
        return promise;
      }
      
      // Explicitly return mockComprasCreditoInversionista
      if (tableName.includes("compras_credito_inversionista")) {
        return Promise.resolve(mockComprasCreditoInversionista);
      }

      const promise = Promise.resolve(mockHistoricoLiquidacionesEspejo);
      Object.assign(promise, { orderBy });
      return promise;
    };

    const innerJoin = (joinTable: any, cond: any) => {
      const innerWhere = (whereCond: any) => {
        const order = (...args: any[]) => {
          return Promise.resolve(mockCuotasCreditoWithPagos);
        };
        const promise = Promise.resolve(mockCuotasCreditoWithPagos);
        Object.assign(promise, { orderBy: order });
        return promise;
      };
      return { where: innerWhere };
    };

    const leftJoin = (joinTable: any, cond: any) => {
      return {
        where: () => ({
          limit: () => Promise.resolve([])
        })
      };
    };

    return { innerJoin, leftJoin, where };
  };

  return {
    db: {
      select: mock((fields: any) => {
        const isSelectNoFields = !fields || Object.keys(fields).length === 0;
        let isMainQuery = false;
        if (fields && typeof fields === "object" && "creditoId" in fields) {
          isMainQuery = true;
        }

        // Check if query selects fields from compras_credito_inversionista
        let detectedTableName = "";
        if (fields) {
          const keys = Object.keys(fields);
          for (const k of keys) {
            if (fields[k] && fields[k].table && fields[k].table.tableName) {
              detectedTableName = fields[k].table.tableName;
              break;
            }
          }
        }

        return {
          from: (table: any) => {
            if (isMainQuery) {
              const innerJoin = (joinTable: any, cond: any) => {
                const innerWhere = (whereCond: any) => {
                  return Promise.resolve(mockCreditosInversionistaEspejo);
                };
                return { where: innerWhere };
              };
              return { innerJoin };
            }
            const tableName = detectedTableName || table?.tableName || "";
            return mockDrizzleSelectChain(tableName, isMainQuery, isSelectNoFields);
          }
        };
      }),
      insert: mock(() => ({
        values: () => ({
          returning: () => Promise.resolve([{ id: 801 }])
        })
      })),
      update: mock(() => ({
        set: () => ({
          where: () => Promise.resolve()
        })
      })),
      query: {
        creditos_inversionistas_espejo: {
          findMany: mock(() => Promise.resolve(
            mockCreditosInversionistaEspejo.map(c => ({
              id: 1,
              credito_id: c.creditoId,
              inversionista_id: c.inversionistaId,
              monto_aportado: c.montoAportado,
              porcentaje_participacion_inversionista: c.porcentajeParticipacion,
              porcentaje_cash_in: "0.00",
              fecha_inicio_participacion: "2025-12-01",
              status: "completado"
            }))
          ))
        },
        pagos_credito: {
          findFirst: mock(() => Promise.resolve({
            pago_id: 301,
            cuota: "1000.00",
            abono_capital: "800.00",
            abono_interes: "200.00",
            abono_iva_12: "24.00",
          }))
        },
        creditos: {
          findFirst: mock(() => Promise.resolve({
            credito_id: 101,
            porcentaje_interes: "10.00",
            cuota_interes: "200.00",
            cuota: "1000.00",
            iva_12: "24.00",
          }))
        }
      }
    }
  };
});

// Mock @cci/email
mock.module("@cci/email", () => ({
  sendLiquidationEmail: mock(() => Promise.resolve()),
  sendPlainEmail: mock(() => Promise.resolve()),
  sendSimpleEmail: mock(() => Promise.resolve()),
  sendInvestorAddedToCreditsNotification: mock(() => Promise.resolve()),
  sendNewCreditNotification: mock(() => Promise.resolve()),
}));

// Mock updateMora
mock.module("./latefee", () => ({
  updateMora: mock(() => Promise.resolve()),
}));

// We can bypass calcularAjusteCompras entirely via mock.module for comprasAjuste
let mockMontoRestarValidacion = new Big(0);
let mockMontoRestarCalculo = new Big(0);
let mockSumaComprasPendientes = new Big(0);
let mockSumaComprasCompletadasMesActual = new Big(0);
mock.module("../utils/comprasAjuste", () => ({
  calcularAjusteCompras: mock(() => Promise.resolve({
    montoRestarValidacion: mockMontoRestarValidacion,
    montoRestarCalculo: mockMontoRestarCalculo
  })),
  obtenerSumaComprasMesAnterior: mock(() => Promise.resolve(new Big(0))),
  obtenerSumaComprasPendientes: mock(() => Promise.resolve(mockSumaComprasPendientes)),
  obtenerSumaComprasCompletadasMesActual: mock(() => Promise.resolve(mockSumaComprasCompletadasMesActual)),
}));

const { calcularYRegistrarPagosEspejo, armarInversionistasPago } = await import("./payments");

describe("Pruebas Unitarias - Reglas de Negocio de Pagos Espejo", () => {
  beforeEach(() => {
    mockCreditosInversionistaEspejo = [];
    mockCuotasCreditoWithPagos = [];
    mockPagosPendientesEspejo = [];
    mockHistoricoLiquidacionesEspejo = [];
    mockComprasCreditoInversionista = [];
    mockMontoRestarValidacion = new Big(0);
    mockMontoRestarCalculo = new Big(0);
    mockSumaComprasPendientes = new Big(0);
    mockSumaComprasCompletadasMesActual = new Big(0);
  });

  it("1. Nuevo inversionista con compra de cartera en mes actual → sin pagos", async () => {
    // Comportamiento esperado: la participación inicia este mes (junio 2026) y TODO su
    // monto_aportado proviene de la compra del mes (no hay monto viejo). El gate de
    // "monto viejo" debe omitir el crédito → totalCreditosProcesados = 0.
    mockCreditosInversionistaEspejo = [
      {
        creditoId: 101,
        inversionistaId: 99,
        montoAportado: "5000.00000000",
        porcentajeParticipacion: "50.00",
        fechaInicioParticipacion: "2026-06-07", // mes en curso (compra lo re-selló)
        numeroCreditoSifco: "CRED-101",
        capital: "20000.00",
        deudaTotal: "22000.00",
        statusCredit: "ACTIVO",
        cuota: "1000.00",
      }
    ];
    // Toda la participación es compra de cartera completada este mes → monto viejo = 0.
    mockSumaComprasCompletadasMesActual = new Big(5000);
    mockPagosPendientesEspejo = [];

    const result = await calcularYRegistrarPagosEspejo(99, new Date("2026-06-10T12:00:00.000Z"));
    expect(result.success).toBeTrue();
    expect(result.totalCreditosProcesados).toBe(0);
  });

  it("2. Inversionista existente con compra en mes anterior (ej. mayo) → genera pagos", async () => {
    // Comportamiento esperado: Al ser un crédito que inició en el mes anterior (mayo),
    // califica para recibir pagos. Como el monto_aportado coincide con el histórico (10,000),
    // no hay inconsistencias y debe generar exitosamente 1 pago espejo (totalCreditosProcesados = 1).
    mockCreditosInversionistaEspejo = [
      {
        creditoId: 101,
        inversionistaId: 99,
        montoAportado: "10000.00000000",
        porcentajeParticipacion: "50.00",
        fechaInicioParticipacion: "2026-05-15", // mes anterior → no entra al gate, procesa normal
        numeroCreditoSifco: "CRED-101",
        capital: "20000.00",
        deudaTotal: "22000.00",
        statusCredit: "ACTIVO",
        cuota: "1000.00",
      }
    ];

    mockCuotasCreditoWithPagos = [
      {
        cuotaId: 501,
        numeroCuota: 1,
        fechaVencimiento: "2026-06-15",
        pagadoCuota: false,
        liquidadoInversionistas: false,
        pagoId: 301,
        fechaPago: new Date("2026-06-05"),
        montoBoleta: "1000.00",
        abonoCapital: "800.00",
        abonoInteres: "200.00",
        abonoIva: "24.00",
        validationStatus: "validated",
        numeroCuotaPrev: 1,
      }
    ];

    mockHistoricoLiquidacionesEspejo = [
      {
        monto_aportado: "10000.00000000",
        fecha: new Date("2026-05-15")
      }
    ];

    mockPagosPendientesEspejo = [];

    const result = await calcularYRegistrarPagosEspejo(99, new Date("2026-06-10T12:00:00.000Z"));
    expect(result.success).toBeTrue();
    expect(result.totalCreditosProcesados).toBe(1);
  });

  it("3. Self-compra (compras pendientes) → paga sobre monto ajustado", async () => {
    // Comportamiento esperado: El inversionista tiene un espejo actual de 15,000, pero su histórico es de 10,000.
    // Hay una compra pendiente de revisión por 5,000. El código debe restar esa compra del espejo,
    // ajustando la base de validación y cálculo a 10,000. Así, coincide con el histórico
    // evitando el error [MONTO_ESPEJO_INCONSISTENTE] y procesando el crédito sobre la base ajustada de 10,000.
    mockCreditosInversionistaEspejo = [
      {
        creditoId: 101,
        inversionistaId: 99,
        montoAportado: "15000.00000000",
        porcentajeParticipacion: "75.00",
        fechaInicioParticipacion: "2026-05-15", // pendiente NO re-sella la fecha → mes anterior
        numeroCreditoSifco: "CRED-101",
        capital: "20000.00",
        deudaTotal: "22000.00",
        statusCredit: "ACTIVO",
        cuota: "1000.00",
      }
    ];

    mockCuotasCreditoWithPagos = [
      {
        cuotaId: 501,
        numeroCuota: 1,
        fechaVencimiento: "2026-06-15",
        pagadoCuota: false,
        liquidadoInversionistas: false,
        pagoId: 301,
        fechaPago: new Date("2026-06-05"),
        montoBoleta: "1000.00",
        abonoCapital: "800.00",
        abonoInteres: "200.00",
        abonoIva: "24.00",
        validationStatus: "validated",
        numeroCuotaPrev: 1,
      }
    ];

    mockHistoricoLiquidacionesEspejo = [
      {
        monto_aportado: "10000.00000000",
        fecha: new Date("2026-05-15")
      }
    ];

    // Simulamos que la compra pendiente reduce la base de cálculo de 15000 a 10000
    mockMontoRestarValidacion = new Big(5000);
    mockMontoRestarCalculo = new Big(5000);

    mockPagosPendientesEspejo = []; 

    const result = await calcularYRegistrarPagosEspejo(99, new Date("2026-06-10T12:00:00.000Z"));
    expect(result.success).toBeTrue();
    expect(result.totalCreditosProcesados).toBe(1);
  });

  it("4. No genera pagos si el crédito tiene pagos pendientes de liquidar (NO_LIQUIDADO)", async () => {
    // Comportamiento esperado: Si el inversionista ya posee un pago espejo pendiente de liquidar
    // (estado_liquidacion = 'NO_LIQUIDADO'), el crédito debe ser omitido en esta ejecución
    // para evitar pagos duplicados, resultando en totalCreditosProcesados = 0.
    mockCreditosInversionistaEspejo = [
      {
        creditoId: 101,
        inversionistaId: 99,
        montoAportado: "10000.00000000",
        porcentajeParticipacion: "50.00",
        numeroCreditoSifco: "CRED-101",
        capital: "20000.00",
        deudaTotal: "22000.00",
        statusCredit: "ACTIVO",
        cuota: "1000.00",
      }
    ];

    mockPagosPendientesEspejo = [
      {
        id: 999,
        credito_id: 101,
        inversionista_id: 99,
        estado_liquidacion: "NO_LIQUIDADO"
      }
    ];

    const result = await calcularYRegistrarPagosEspejo(99, new Date("2026-06-10T12:00:00.000Z"));
    expect(result.success).toBeTrue();
    expect(result.totalCreditosProcesados).toBe(0);
  });

  it("5. Partícipe viejo + compra del mes actual → procesa el monto viejo (no lo pierde)", async () => {
    // Comportamiento esperado: el inversionista YA participaba con X=10,000 y compró
    // Y=15,000 el 7-jun; la compra le re-selló fecha_inicio_participacion a junio.
    // Antes, el filtro SQL botaba el crédito entero y X se perdía. Ahora:
    //   monto viejo = 25,000 − 15,000 (compra completada del mes) = 10,000 > 0 → procesa.
    // La compra del mes se excluye en el cálculo (Caso 3) y X cobra mes completo.
    mockCreditosInversionistaEspejo = [
      {
        creditoId: 101,
        inversionistaId: 99,
        montoAportado: "25000.00000000",
        porcentajeParticipacion: "50.00",
        fechaInicioParticipacion: "2026-06-07", // re-sellada por la compra al mes en curso
        numeroCreditoSifco: "CRED-101",
        capital: "20000.00",
        deudaTotal: "22000.00",
        statusCredit: "ACTIVO",
        cuota: "1000.00",
      }
    ];

    mockCuotasCreditoWithPagos = [
      {
        cuotaId: 501,
        numeroCuota: 1,
        fechaVencimiento: "2026-06-15",
        pagadoCuota: false,
        liquidadoInversionistas: false,
        pagoId: 301,
        fechaPago: new Date("2026-06-05"),
        montoBoleta: "1000.00",
        abonoCapital: "800.00",
        abonoInteres: "200.00",
        abonoIva: "24.00",
        validationStatus: "validated",
        numeroCuotaPrev: 1,
      }
    ];

    mockHistoricoLiquidacionesEspejo = [
      {
        monto_aportado: "10000.00000000",
        fecha: new Date("2026-05-15")
      }
    ];

    // La compra del mes (15,000): completada del mes actual + se resta del cálculo (Caso 3)
    // y de la validación (creada después del histórico) para cuadrar contra X=10,000.
    mockSumaComprasCompletadasMesActual = new Big(15000);
    mockMontoRestarValidacion = new Big(15000);
    mockMontoRestarCalculo = new Big(15000);
    mockPagosPendientesEspejo = [];

    const result = await calcularYRegistrarPagosEspejo(99, new Date("2026-06-10T12:00:00.000Z"));
    expect(result.success).toBeTrue();
    expect(result.totalCreditosProcesados).toBe(1);
  });

  it("6. Participación que empieza en un mes FUTURO al período → sin pagos", async () => {
    // Comportamiento esperado: se calcula junio (2026-06) pero la fecha_inicio del
    // crédito es de julio (mes posterior). No corresponde liquidar este período —
    // el corte por mes futuro debe omitirlo, igual que el filtro SQL viejo (< inicio).
    // Sin ese corte, al no tener compras del mes en curso, montoViejo daría el monto
    // completo y lo procesaría por error.
    mockCreditosInversionistaEspejo = [
      {
        creditoId: 101,
        inversionistaId: 99,
        montoAportado: "10000.00000000",
        porcentajeParticipacion: "50.00",
        fechaInicioParticipacion: "2026-07-15", // mes posterior al período (junio)
        numeroCreditoSifco: "CRED-101",
        capital: "20000.00",
        deudaTotal: "22000.00",
        statusCredit: "ACTIVO",
        cuota: "1000.00",
      }
    ];
    mockPagosPendientesEspejo = [];

    const result = await calcularYRegistrarPagosEspejo(99, new Date("2026-06-10T12:00:00.000Z"));
    expect(result.success).toBeTrue();
    expect(result.totalCreditosProcesados).toBe(0);
  });

  it("7. Participación nueva DIRECTA del mes (sin compra) → sin pagos", async () => {
    // Comportamiento esperado: el inversionista se agregó directo este mes (fecha_inicio
    // del período) pero SIN compra_cartera. No hay compra que justifique un monto viejo,
    // así que es una participación nueva → se omite (paga desde el mes siguiente), igual
    // que el filtro SQL viejo. Sin este corte, montoViejo daría el monto completo y se
    // procesaría por error.
    mockCreditosInversionistaEspejo = [
      {
        creditoId: 101,
        inversionistaId: 99,
        montoAportado: "8000.00000000",
        porcentajeParticipacion: "40.00",
        fechaInicioParticipacion: "2026-06-07", // mes en curso, alta directa
        numeroCreditoSifco: "CRED-101",
        capital: "20000.00",
        deudaTotal: "22000.00",
        statusCredit: "ACTIVO",
        cuota: "1000.00",
      }
    ];
    // SIN compras del mes ni pendientes → no hay nada que justifique monto viejo.
    mockSumaComprasCompletadasMesActual = new Big(0);
    mockSumaComprasPendientes = new Big(0);
    mockPagosPendientesEspejo = [];

    const result = await calcularYRegistrarPagosEspejo(99, new Date("2026-06-10T12:00:00.000Z"));
    expect(result.success).toBeTrue();
    expect(result.totalCreditosProcesados).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// armarInversionistasPago: arma el array `inversionistas` de un pago en el
// reporte getPagosConInversionistas reflejando el interés COMPLETO (facturación):
//   • pago con pci real → usa pci + residuo de CUBE
//   • pago sin pci (parcial) → simula con creditoInvs + residuo de CUBE
//   • CUBE ausente → crea la línea CUBE con el residuo
// Invariante central: Σ(inversionistas.abonoInteres) === round2(pago.abono_interes)
// ────────────────────────────────────────────────────────────────────────────
const round2Num = (n: number) => Number(new Big(n).round(2).toString());
const sumInteres = (arr: any[]) =>
  arr.reduce((acc, r) => acc.plus(new Big(r.abonoInteres ?? 0)), new Big(0));

describe("armarInversionistasPago (residuo CUBE + simulación de parciales)", () => {
  it("caso 1: pago CON pci real → usa pci y le suma el residuo a CUBE", () => {
    // Pago con interés 683.82. pci real reparte Brenda 266.80 + CUBE 302.66 (Σ=569.46),
    // residuo (30% cash_in de Brenda) = 114.36 va a CUBE.
    const pago = { abono_interes: "683.82", abono_iva_12: "0", cuota: "1000.00" };
    const pciRows = [
      {
        inversionistaId: 1,
        nombreInversionista: "Brenda",
        emiteFactura: false,
        abonoCapital: "500.00",
        abonoInteres: "266.80",
        abonoIva: "0",
        isr: "13.34",
        cuotaPago: "1000.00",
        montoAportado: "25324.90",
        porcentajeParticipacion: "70",
      },
      {
        inversionistaId: 86,
        nombreInversionista: "Cube Investments S.A.",
        emiteFactura: false,
        abonoCapital: "300.00",
        abonoInteres: "302.66",
        abonoIva: "0",
        isr: "15.13",
        cuotaPago: "1000.00",
        montoAportado: "20108.92",
        porcentajeParticipacion: "100",
      },
    ];

    const out = armarInversionistasPago({
      pago,
      pciRows,
      creditoInvs: [],
      cubeId: 86,
    });

    // Brenda NO se toca (su parte queda igual)
    const brenda = out.find((r: any) => r.inversionistaId === 1)!;
    expect(round2Num(Number(brenda.abonoInteres))).toBe(266.80);

    // CUBE recibe su parte + el residuo
    const cube = out.find((r: any) => r.inversionistaId === 86)!;
    expect(round2Num(Number(cube.abonoInteres))).toBeCloseTo(417.02, 2); // 302.66 + 114.36

    // INVARIANTE: Σ abonoInteres === round2(pago.abono_interes)
    expect(round2Num(Number(sumInteres(out).toString()))).toBe(683.82);
  });

  it("caso 2: pago SIN pci (parcial) → simula con creditoInvs y aplica residuo", () => {
    // No hay filas pci (cuota incompleta) pero el pago SÍ se facturó (abono_interes>0).
    // Se simula con los creditos_inversionistas del crédito + residuo de CUBE.
    const pago = { abono_interes: "683.82", abono_iva_12: "0", cuota: "1000.00" };
    const creditoInvs = [
      {
        inversionista_id: 1,
        nombre: "Brenda",
        emite_factura: false,
        porcentaje_participacion_inversionista: 70,
        porcentaje_cash_in: 30,
        monto_aportado: "25324.90",
      },
      {
        inversionista_id: 86,
        nombre: "Cube Investments S.A.",
        emite_factura: false,
        porcentaje_participacion_inversionista: 0,
        porcentaje_cash_in: 100,
        monto_aportado: "20108.92",
      },
    ];

    const out = armarInversionistasPago({
      pago,
      pciRows: null,
      creditoInvs,
      cubeId: 86,
    });

    // Aparecen ambos inversionistas simulados
    expect(out.find((r: any) => r.inversionistaId === 1)).toBeDefined();
    expect(out.find((r: any) => r.inversionistaId === 86)).toBeDefined();

    // En parciales no hay capital pci → abonoCapital = 0
    const brenda = out.find((r: any) => r.inversionistaId === 1)!;
    expect(round2Num(Number(brenda.abonoCapital))).toBe(0);

    // INVARIANTE: Σ abonoInteres === round2(pago.abono_interes)
    expect(round2Num(Number(sumInteres(out).toString()))).toBe(683.82);
  });

  it("caso 3: CUBE ausente del split → crea la línea CUBE con el residuo", () => {
    // pci real sin CUBE; el residuo del interés debe crear una fila CUBE nueva.
    const pago = { abono_interes: "572.96", abono_iva_12: "0", cuota: "1000.00" };
    const pciRows = [
      {
        inversionistaId: 20,
        nombreInversionista: "Inversor X",
        emiteFactura: false,
        abonoCapital: "400.00",
        abonoInteres: "458.37",
        abonoIva: "0",
        isr: "22.92",
        cuotaPago: "1000.00",
        montoAportado: "10000.00",
        porcentajeParticipacion: "80",
      },
    ];

    const out = armarInversionistasPago({
      pago,
      pciRows,
      creditoInvs: [],
      cubeId: 86,
    });

    // Se crea la línea de CUBE con el residuo (572.96 - 458.37 = 114.59)
    const cube = out.find((r: any) => r.inversionistaId === 86)!;
    expect(cube).toBeDefined();
    expect(cube.nombreInversionista.toLowerCase()).toContain("cube");
    expect(round2Num(Number(cube.abonoInteres))).toBeCloseTo(114.59, 2);

    // INVARIANTE: Σ abonoInteres === round2(pago.abono_interes)
    expect(round2Num(Number(sumInteres(out).toString()))).toBe(572.96);
  });
});
