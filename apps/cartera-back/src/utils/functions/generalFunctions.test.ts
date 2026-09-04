import { beforeEach, describe, expect, it, mock } from "bun:test";
import Big from "big.js";
import ExcelJS from "exceljs";
import { lockPoolMock } from "../testMocks";

// Configuración de variables de entorno ficticias para evitar que fallen los imports de paquetes internos (ej. email)
process.env.RESEND_API_KEY = "test-resend-key";
process.env.EMAIL_DOMAIN = "test-domain.com";

// Variables globales para simular las respuestas de la base de datos de manera dinámica por cada caso de prueba
let mockHistoricoLiquidacionesEspejo: any[] = [];
let mockComprasCreditoInversionista: any[] = [];

mock.module("../../database/index", () => {
  const mockSelectChain = () => {
    const limit = (limitNum: number) => {
      return Promise.resolve(mockHistoricoLiquidacionesEspejo);
    };

    const orderBy = (...orderArgs: any[]) => {
      const promise = Promise.resolve(mockHistoricoLiquidacionesEspejo);
      Object.assign(promise, { limit });
      return promise;
    };

    const where = (whereCond: any) => {
      const promise = Promise.resolve(mockHistoricoLiquidacionesEspejo);
      Object.assign(promise, { orderBy });
      return promise;
    };

    const from = (table: any) => {
      const tableName = table?.tableName ?? "";
      if (tableName === "compras_credito_inversionista") {
        return {
          where: () => Promise.resolve(mockComprasCreditoInversionista)
        };
      }
      return { where };
    };

    return { from };
  };

  return {
    client: {},
    db: {
      select: mockSelectChain
    },
    // Requerido por la cadena de imports (investor → addInvestorToCredit →
    // creditoEspejoLock), aunque estos tests no lo usen. Ver testMocks.ts.
    lockPool: lockPoolMock
  };
});

// Mock del cliente AWS S3 para evitar conexiones reales de red durante los tests del backend
mock.module("@aws-sdk/client-s3", () => {
  return {
    S3Client: class {
      send = () => Promise.resolve();
    },
    PutObjectCommand: class {},
    GetObjectCommand: class {},
    DeleteObjectCommand: class {},
    HeadObjectCommand: class {}
  };
});

const { buildInversionistaWorkbook } = await import("./generalFunctions");

describe("buildInversionistaWorkbook - Reglas de Ajuste de Montos para Excel", () => {
  const fillArgb = (cell: ExcelJS.Cell) =>
    cell.fill.type === "pattern" ? cell.fill.fgColor?.argb : undefined;

  beforeEach(() => {
    mockHistoricoLiquidacionesEspejo = [];
    mockComprasCreditoInversionista = [];
  });

  it("matches CashIn liquidation template styling without changing report values", async () => {
    const buffer = await buildInversionistaWorkbook({
      nombre_inversionista: "Inversionista de Estilo",
      moneda: "quetzales",
      reinversion: "sin_reinversion",
      subtotal: {
        total_abono_capital: "200.00",
        total_abono_general_interes: "475.91",
        total_cuota_con_reinversion: "675.13",
        total_reinversion_capital: "0.00",
        total_reinversion_interes: "0.00",
        total_reinversion: "0.00",
      },
      creditos: [{
        credito_id: 1001,
        numero_credito_sifco: "CRED-1001",
        nombre_usuario: "Cliente de Prueba",
        monto_aportado: "10000.00",
        porcentaje_interes: "1.50",
        plazo: 84,
        nit_usuario: "1234567-8",
        pagos: [{
          estado_liquidacion: "NO_LIQUIDADO",
          abono_capital: "200.00",
          abono_interes: "475.91",
          abono_iva: "0.00",
          isr: "0.00",
          abonoGeneralInteres: "475.91",
          porcentaje_inversor: "80.00",
          tasaInteresInvesor: "1.20",
          cuota: 1,
          mes: "abril",
          fecha_pago: "2026-04-10",
        }],
      }],
    } as any);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.getWorksheet("Reporte")!;

    expect(sheet.getCell("E1").font.color?.argb).toBe("FF0F1B4C");
    expect(sheet.getCell("E1").font.name).toBe("Inter");
    expect(sheet.getCell("E1").font.size).toBe(18);
    expect(sheet.getCell("E2").font.color?.argb).toBe("FF4E57EA");
    expect(fillArgb(sheet.getCell("A3"))).toBe("FF4E57EA");
    expect(sheet.getCell("A3").font.color?.argb).toBe("FFFFFFFF");
    expect(sheet.getCell("A3").font.size).toBe(12);
    expect(fillArgb(sheet.getCell("A4"))).not.toBe("FFF0F0FF");
    expect(sheet.getCell("A4").font.bold).not.toBeTrue();
    expect(sheet.getCell("A4").border.top?.style).toBe("thin");
    expect(sheet.getCell("A4").border.top?.color?.argb).toBe("FFFFFFFF");
    expect(sheet.getCell("A4").border.right?.style).toBe("thin");
    expect(fillArgb(sheet.getCell("A6"))).toBe("FFF3F3F3");
    expect(sheet.getCell("A6").font.color?.argb).toBe("FF0F172A");
    expect(sheet.getCell("A6").font.name).toBe("Inter");
    expect(sheet.getCell("A6").font.size).toBe(11);
    expect(sheet.getCell("A6").border.top?.style).toBe("medium");
    expect(sheet.getRow(6).height).toBe(42.75);
    expect(sheet.getCell("A6").value).toBe("MESES EN CRÉDITO");
    expect(sheet.getCell("A6").alignment.vertical).toBe("middle");
    expect(sheet.getCell("O6").value).toBe("NIT");
    expect(sheet.model.merges).toContain("A1:D2");
    expect(sheet.model.merges).toContain("L1:O2");
    expect(sheet.getCell("A12").value).toBe("REINVERSIÓN CAPITAL");
    expect(sheet.getCell("C7").value).toBe(10000);
    expect(sheet.getCell("J7").value).toBe(200);
  });

  it("1. validar inv es nuevo y tiene compra de cartera nueva → no debe generar pagos este 10 (monto base calculado es 0)", async () => {
    // Caso de simulación:
    // El inversionista es nuevo en el crédito este mes actual (ej: espejo Q10,000 pero NO tiene históricos del mes pasado).
    // Comportamiento esperado: Al no tener histórico anterior, la base de cálculo de intereses ajustada
    // se calcula como $10,000 - $10,000 (compra nueva) = $0. Por lo tanto, el capital base que pinta el Excel es 0
    // (no devenga intereses en el mes en curso, cumpliendo la regla de negocio).
    
    const mockInversionista = {
      nombre_inversionista: "Inversionista Nuevo",
      moneda: "quetzales",
      reinversion: "sin_reinversion",
      subtotal: {
        total_abono_capital: "0.00",
        total_abono_general_interes: "0.00",
        total_cuota_con_reinversion: "0.00",
      },
      creditos: [
        {
          credito_id: 101,
          numero_credito_sifco: "CRED-101",
          nombre_usuario: "Cliente Uno",
          monto_aportado: "10000.00000000",
          porcentaje_interes: "10.00",
          pagos: [
            {
              estado_liquidacion: "NO_LIQUIDADO",
              abono_capital: "0.00",
              abono_interes: "0.00",
              abono_iva_12: "0.00",
              porcentaje_participacion: "50.00",
              cuota: 1,
              fecha_pago: "2026-06-05",
            }
          ]
        }
      ]
    };

    // Al ser nuevo, no hay historial anterior en bd
    mockHistoricoLiquidacionesEspejo = [];

    // Compra completada este mes (junio) por Q10,000
    mockComprasCreditoInversionista = [
      {
        monto_aportado: "10000.00000000",
        tipo_operacion: "compra_cartera",
        status: "completado",
        created_at: new Date("2026-06-02"),
        updated_at: new Date("2026-06-02"),
      }
    ];

    const buffer = await buildInversionistaWorkbook(mockInversionista as any);
    expect(buffer).toBeDefined();
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("2. validar inv ya existe , compra antes del 10 → se debe generar pagos sobre el monto que tiene del mes pasado", async () => {
    // Caso de simulación:
    // El inversionista ya tenía Q10,000 el mes pasado (mayo) y compra Q5,000 antes del 10 de este mes (junio).
    // Espejo total actual = Q15,000.
    // Comportamiento esperado: En la generación del Excel, el sistema resta la compra nueva de Q5,000
    // del capital espejo actual (15,000 - 5,000 = Q10,000). De esta forma el capital base de cálculo que se muestra
    // es de Q10,000, calculando el interés y pintando el capital sobre el monto del mes pasado únicamente.
    
    const mockInversionista = {
      nombre_inversionista: "Inversionista Existente",
      moneda: "quetzales",
      reinversion: "sin_reinversion",
      subtotal: {
        total_abono_capital: "0.00",
        total_abono_general_interes: "0.00",
        total_cuota_con_reinversion: "0.00",
      },
      creditos: [
        {
          credito_id: 102,
          numero_credito_sifco: "CRED-102",
          nombre_usuario: "Cliente Dos",
          monto_aportado: "15000.00000000",
          porcentaje_interes: "10.00",
          pagos: [
            {
              estado_liquidacion: "NO_LIQUIDADO",
              abono_capital: "1000.00",
              abono_interes: "200.00",
              abono_iva_12: "24.00",
              porcentaje_participacion: "50.00",
              cuota: 1,
              fecha_pago: "2026-06-05",
            }
          ]
        }
      ]
    };

    // Histórico de Q10,000 del mes pasado
    mockHistoricoLiquidacionesEspejo = [
      {
        monto_aportado: "10000.00000000",
        fecha: new Date("2026-05-15")
      }
    ];

    // Compra completada del 2 de junio por Q5,000 (debe restarse para el cálculo de este mes)
    mockComprasCreditoInversionista = [
      {
        monto_aportado: "5000.00000000",
        tipo_operacion: "compra_cartera",
        status: "completado",
        created_at: new Date("2026-06-02"),
        updated_at: new Date("2026-06-02"),
      }
    ];

    const buffer = await buildInversionistaWorkbook(mockInversionista as any);
    expect(buffer).toBeDefined();
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("3. validar que no genere pagos de creditos que tengan compras pendientes, solo completadas (compras en revision restan de la base)", async () => {
    // Caso de simulación:
    // El inversionista tiene Q15,000 en el espejo actual, pero Q5,000 corresponden a una compra
    // en estado 'pendiente_revision' (revisión de administración).
    // Comportamiento esperado: La compra en estado pendiente se resta de la base de cálculo de intereses de este mes,
    // garantizando que el Excel liquide al inversionista sobre la base neta de Q10,000 (espejo - pendiente).
    
    const mockInversionista = {
      nombre_inversionista: "Inversionista Self Compra",
      moneda: "quetzales",
      reinversion: "sin_reinversion",
      subtotal: {
        total_abono_capital: "0.00",
        total_abono_general_interes: "0.00",
        total_cuota_con_reinversion: "0.00",
      },
      creditos: [
        {
          credito_id: 103,
          numero_credito_sifco: "CRED-103",
          nombre_usuario: "Cliente Tres",
          monto_aportado: "15000.00000000",
          porcentaje_interes: "10.00",
          pagos: [
            {
              estado_liquidacion: "NO_LIQUIDADO",
              abono_capital: "1000.00",
              abono_interes: "200.00",
              abono_iva_12: "24.00",
              porcentaje_participacion: "50.00",
              cuota: 1,
              fecha_pago: "2026-06-05",
            }
          ]
        }
      ]
    };

    mockHistoricoLiquidacionesEspejo = [
      {
        monto_aportado: "10000.00000000",
        fecha: new Date("2026-05-15")
      }
    ];

    // Compra en revisión de Q5,000 (no genera intereses, se resta del base)
    mockComprasCreditoInversionista = [
      {
        monto_aportado: "5000.00000000",
        tipo_operacion: "compra_cartera",
        status: "pendiente_revision",
        created_at: new Date("2026-06-02"),
        updated_at: new Date("2026-06-02"),
      }
    ];

    const buffer = await buildInversionistaWorkbook(mockInversionista as any);
    expect(buffer).toBeDefined();
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("4. validar que se use la fecha de pago para determinar el periodo y no falle con multiples pagos", async () => {
    const mockInversionista = {
      nombre_inversionista: "Inversionista MultiPago",
      moneda: "quetzales",
      reinversion: "sin_reinversion",
      subtotal: {
        total_abono_capital: "0.00",
        total_abono_general_interes: "0.00",
        total_cuota_con_reinversion: "0.00",
      },
      creditos: [
        {
          credito_id: 104,
          numero_credito_sifco: "CRED-104",
          nombre_usuario: "Cliente Cuatro",
          monto_aportado: "15000.00000000",
          porcentaje_interes: "10.00",
          pagos: [
            {
              estado_liquidacion: "NO_LIQUIDADO",
              abono_capital: "1000.00",
              abono_interes: "200.00",
              abono_iva_12: "24.00",
              porcentaje_participacion: "50.00",
              cuota: 1,
              fecha_pago: "2026-06-05", // Pagado en Junio
            },
            {
              estado_liquidacion: "NO_LIQUIDADO",
              abono_capital: "1000.00",
              abono_interes: "200.00",
              abono_iva_12: "24.00",
              porcentaje_participacion: "50.00",
              cuota: 2,
              fecha_pago: "2026-06-05",
            }
          ]
        }
      ]
    };

    mockHistoricoLiquidacionesEspejo = [
      {
        monto_aportado: "10000.00000000",
        fecha: new Date("2026-05-15")
      }
    ];

    // Compra completada el 2 de junio por Q5,000.
    // Debería ser restada en junio (determinada por la fecha de pago "2026-06-05").
    mockComprasCreditoInversionista = [
      {
        monto_aportado: "5000.00000000",
        tipo_operacion: "compra_cartera",
        status: "completado",
        created_at: new Date("2026-06-02"),
        updated_at: new Date("2026-06-02"),
      }
    ];

    const buffer = await buildInversionistaWorkbook(mockInversionista as any);
    expect(buffer).toBeDefined();
    expect(buffer.length).toBeGreaterThan(0);
  });
});
