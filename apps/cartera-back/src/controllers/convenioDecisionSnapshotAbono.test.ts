import { describe, expect, mock, test } from "bun:test";

// El módulo importa la base al cargar; el snapshot es una función pura.
mock.module("../database", () => ({ db: {}, client: {}, lockPool: {} }));

const { construirSnapshot } = await import("./convenioDecision");

const convenio = (over: Record<string, unknown> = {}) =>
  ({
    convenio_id: 7,
    credito_id: 10,
    monto_total_convenio: "1000.00",
    numero_meses: 2,
    cuota_mensual: "500.00",
    monto_pagado: "0",
    monto_pendiente: "1000.00",
    pagos_realizados: 0,
    pagos_pendientes: 2,
    fecha_convenio: new Date("2026-10-09T12:00:00Z"),
    motivo: null,
    observaciones: null,
    cuotas_convenio: [1, 2],
    created_by: 3,
    created_at: new Date("2026-10-09T12:00:00Z"),
    abono_inicial_pago_id: null,
    ...over,
  }) as any;

describe("snapshot de la decisión del convenio: abono inicial (COBROS-02 W4)", () => {
  test("copia el pago del abono inicial, que el rechazo borra junto con la fila del convenio", () => {
    expect(construirSnapshot(convenio({ abono_inicial_pago_id: 30 }), [1, 2]).abono_inicial_pago_id).toBe(30);
  });

  test("sin abono inicial queda en null, no ausente", () => {
    expect(construirSnapshot(convenio(), [1, 2]).abono_inicial_pago_id).toBeNull();
  });
});
