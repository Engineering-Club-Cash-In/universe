/**
 * Estado de facturación de un pago (migración 0014): qué se le muestra a conta
 * cuando un pago no se facturó o se facturó a medias.
 */
import { describe, expect, it } from "bun:test";

// El módulo importa `db`, y src/database/index.ts exige SUPABASE_DB_URL al
// cargar (los imports estáticos se evalúan ANTES de cualquier asignación, por
// eso el env se setea aquí y el import es dinámico). Solo se prueban funciones
// PURAS: el Pool de pg con URL dummy no conecta hasta el primer query.
process.env.SUPABASE_DB_URL ??=
  "postgresql://test:test@localhost:5432/test_no_conecta";
const { derivarEstadoFacturacion, tieneMontosFacturables } = await import(
  "./estadoFacturacionPago"
);

describe("derivarEstadoFacturacion", () => {
  it("todo emitido → OK", () => {
    expect(
      derivarEstadoFacturacion([{ tipo: "MORA" }, { tipo: "INTERESES" }]),
    ).toEqual({ estado: "OK", fallidos: [] });
  });

  it("nada que emitir (solo capital) → NO_APLICA", () => {
    expect(derivarEstadoFacturacion([])).toEqual({
      estado: "NO_APLICA",
      fallidos: [],
    });
  });

  it("algo emitido y algo caído → PARCIAL, con el rubro y el inversionista del que falta", () => {
    const resultado = derivarEstadoFacturacion([
      { tipo: "MORA" },
      {
        tipo: "ERROR",
        concepto: "INTERESES",
        inversionista: "Juan Pérez",
        inversionista_id: 42,
        error: "SAT timeout",
      },
    ]);
    expect(resultado.estado).toBe("PARCIAL");
    expect(resultado.fallidos).toEqual([
      {
        rubro: "INTERESES",
        inversionista: "Juan Pérez",
        inversionista_id: 42,
        error: "SAT timeout",
      },
    ]);
  });

  it("nada emitido y todo caído → FALLIDA", () => {
    expect(
      derivarEstadoFacturacion([
        { tipo: "ERROR", concepto: "MORA", error: "sin NIT" },
      ]).estado,
    ).toBe("FALLIDA");
  });

  it("un fallo de bookkeeping no vuelve PARCIAL el pago ni pide emitir nada (Codex)", () => {
    expect(
      derivarEstadoFacturacion([
        { tipo: "INTERESES" },
        {
          tipo: "ERROR",
          concepto: "MARCAR_PENDIENTE_FACTURAR",
          error: "deadlock",
        },
      ]),
    ).toEqual({ estado: "OK", fallidos: [] });
  });
});

describe("tieneMontosFacturables", () => {
  it("un pago solo de capital no genera DTE", () => {
    expect(tieneMontosFacturables({ abono_interes: "0", mora: "0" })).toBe(false);
    expect(tieneMontosFacturables({})).toBe(false);
  });

  it("cualquier rubro facturable cuenta", () => {
    expect(tieneMontosFacturables({ mora: "125.00" })).toBe(true);
    expect(tieneMontosFacturables({ abono_seguro: 447.62 })).toBe(true);
    expect(tieneMontosFacturables({ membresias_pago: "50" })).toBe(true);
  });
});

describe("IVA como monto facturable (Codex)", () => {
  it("un pago que solo trae abono_iva_12 sí requiere factura", () => {
    // El motor cobra interés antes que IVA: tras un parcial que cerró el
    // interés, el siguiente pago puede traer solo IVA — y va en el DTE.
    expect(tieneMontosFacturables({ abono_iva_12: "35.71" })).toBe(true);
    // *_ci NO cuenta en develop: la emisión no lee esas columnas — contarlas
    // dejaba pagos solo-CI como PENDIENTE que nada puede resolver (ver comment
    // en tieneMontosFacturables; divergencia deliberada vs COBROS-02).
    expect(tieneMontosFacturables({ abono_iva_ci: "12.00" })).toBe(false);
  });
});
