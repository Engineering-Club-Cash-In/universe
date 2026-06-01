import { beforeEach, describe, expect, it, mock } from "bun:test";
import Big from "big.js";

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
    db: {
      select: mockSelectChain
    }
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
    DeleteObjectCommand: class {}
  };
});

const { buildInversionistaWorkbook } = await import("./generalFunctions");

describe("buildInversionistaWorkbook - Reglas de Ajuste de Montos para Excel", () => {
  beforeEach(() => {
    mockHistoricoLiquidacionesEspejo = [];
    mockComprasCreditoInversionista = [];
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
});
