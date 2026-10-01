import { describe, it, expect } from "bun:test";
import Big from "big.js";
import { moraPendientePorCuota, repartirPagoDeMora } from "./moraPendiente";

describe("moraPendientePorCuota", () => {
  // Capital = 3000
  // TASA_MORA_MENSUAL = 0.0112 = 1.12%
  // Cargo mensual = 3000 × 0.0112 = 33.6
  // Para 10 días: 33.6 × (10/30) = 11.2
  // Para 30 días (topado): 33.6
  // Para 60 días (topado): 33.6 (no crece más)

  it("1. Una cuota, 10 días, sin pagado → devengado y pendiente coinciden", () => {
    const result = moraPendientePorCuota({
      capital: 3000,
      cuotas: [{ cuota_id: 1, diasAtraso: 10, pagado: 0 }],
    });

    expect(result.porCuota).toHaveLength(1);
    expect(result.porCuota[0].devengado.toFixed(1)).toBe("11.2");
    expect(result.porCuota[0].pagado.toFixed(1)).toBe("0.0");
    expect(result.porCuota[0].pendiente.toFixed(1)).toBe("11.2");
    expect(result.total.toFixed(1)).toBe("11.2");
  });

  it("2. Una cuota topada (30 días): devengado es cargo mensual; 60 días da lo mismo", () => {
    // 30 días
    const result30 = moraPendientePorCuota({
      capital: 3000,
      cuotas: [{ cuota_id: 1, diasAtraso: 30, pagado: 0 }],
    });
    expect(result30.porCuota[0].devengado.toFixed(1)).toBe("33.6");

    // 60 días — tope de 1 cargo por cuota
    const result60 = moraPendientePorCuota({
      capital: 3000,
      cuotas: [{ cuota_id: 1, diasAtraso: 60, pagado: 0 }],
    });
    expect(result60.porCuota[0].devengado.toFixed(1)).toBe("33.6");

    // Son iguales
    expect(result30.porCuota[0].devengado.eq(result60.porCuota[0].devengado)).toBe(true);
  });

  it("3. Una cuota con pagado parcial → pendiente es la resta", () => {
    const result = moraPendientePorCuota({
      capital: 3000,
      cuotas: [{ cuota_id: 1, diasAtraso: 30, pagado: 10 }],
    });

    // Devengado = 33.6, pagado = 10
    // Pendiente = 33.6 - 10 = 23.6
    expect(result.porCuota[0].devengado.toFixed(1)).toBe("33.6");
    expect(result.porCuota[0].pagado.toFixed(1)).toBe("10.0");
    expect(result.porCuota[0].pendiente.toFixed(1)).toBe("23.6");
  });

  it("4. CRÍTICO: Cuota con pagado MAYOR que devengado → pendiente es CERO; el sobrante NO reduce otros pendientes", () => {
    // Cuota 1: 10 días, devengado 11.2, pagado 20 (sobrante 8.8)
    // Cuota 2: 30 días, devengado 33.6, pagado 0
    //
    // Resultado esperado:
    //   Cuota 1: pendiente = 0 (sobrante 8.8 se pierde, no se usa)
    //   Cuota 2: pendiente = 33.6 (sin beneficiarse del sobrante)
    //   Total = 33.6
    const result = moraPendientePorCuota({
      capital: 3000,
      cuotas: [
        { cuota_id: 1, diasAtraso: 10, pagado: 20 },
        { cuota_id: 2, diasAtraso: 30, pagado: 0 },
      ],
    });

    expect(result.porCuota).toHaveLength(2);

    // Cuota 1
    expect(result.porCuota[0].devengado.toFixed(1)).toBe("11.2");
    expect(result.porCuota[0].pagado.toFixed(1)).toBe("20.0");
    expect(result.porCuota[0].pendiente.toFixed(1)).toBe("0.0");

    // Cuota 2
    expect(result.porCuota[1].devengado.toFixed(1)).toBe("33.6");
    expect(result.porCuota[1].pagado.toFixed(1)).toBe("0.0");
    expect(result.porCuota[1].pendiente.toFixed(1)).toBe("33.6");

    // Total es la suma de pendientes: 0 + 33.6 = 33.6
    expect(result.total.toFixed(1)).toBe("33.6");
  });

  it("5. Cuota con diasAtraso 0 y negativo → devengado cero", () => {
    const resultCero = moraPendientePorCuota({
      capital: 3000,
      cuotas: [{ cuota_id: 1, diasAtraso: 0, pagado: 0 }],
    });
    expect(resultCero.porCuota[0].devengado.toFixed(1)).toBe("0.0");

    const resultNegativo = moraPendientePorCuota({
      capital: 3000,
      cuotas: [{ cuota_id: 1, diasAtraso: -10, pagado: 0 }],
    });
    expect(resultNegativo.porCuota[0].devengado.toFixed(1)).toBe("0.0");
  });

  it("6. Varias cuotas → total es suma de los pendientes", () => {
    const result = moraPendientePorCuota({
      capital: 3000,
      cuotas: [
        { cuota_id: 1, diasAtraso: 10, pagado: 0 },  // devengado 11.2
        { cuota_id: 2, diasAtraso: 20, pagado: 5 },  // devengado 22.4, pendiente 17.4
        { cuota_id: 3, diasAtraso: 30, pagado: 10 }, // devengado 33.6, pendiente 23.6
      ],
    });

    expect(result.porCuota).toHaveLength(3);

    const sum = result.porCuota[0].pendiente
      .plus(result.porCuota[1].pendiente)
      .plus(result.porCuota[2].pendiente);

    expect(result.total.eq(sum)).toBe(true);
  });
});

describe("repartirPagoDeMora", () => {
  // Reutilizamos el cálculo de arriba: capital 3000
  // Cuota 1: 10 días → pendiente 11.2
  // Cuota 2: 30 días → pendiente 33.6
  // Cuota 3: 30 días → pendiente 33.6
  // Total pendiente: 78.4

  it("7. Monto que cubre todo → reparto completo, sobrante cero", () => {
    const pendientes = moraPendientePorCuota({
      capital: 3000,
      cuotas: [
        { cuota_id: 1, diasAtraso: 10, pagado: 0 },
        { cuota_id: 2, diasAtraso: 30, pagado: 0 },
      ],
    });

    // Total pendiente = 11.2 + 33.6 = 44.8
    const result = repartirPagoDeMora({
      monto: pendientes.total,
      porCuota: pendientes.porCuota,
    });

    expect(result.reparto).toHaveLength(2);
    expect(result.reparto[0].cuota_id).toBe(1);
    expect(result.reparto[0].monto.toFixed(1)).toBe("11.2");
    expect(result.reparto[1].cuota_id).toBe(2);
    expect(result.reparto[1].monto.toFixed(1)).toBe("33.6");
    expect(result.sobrante.toFixed(1)).toBe("0.0");
  });

  it("8. Monto que alcanza solo para la primera y parte de la segunda → el pusho", () => {
    const pendientes = moraPendientePorCuota({
      capital: 3000,
      cuotas: [
        { cuota_id: 1, diasAtraso: 10, pagado: 0 },  // pendiente 11.2
        { cuota_id: 2, diasAtraso: 30, pagado: 0 },  // pendiente 33.6
      ],
    });

    // Monto: 20 (cubre cuota 1 = 11.2, y 8.8 de cuota 2)
    const result = repartirPagoDeMora({
      monto: 20,
      porCuota: pendientes.porCuota,
    });

    expect(result.reparto).toHaveLength(2);
    expect(result.reparto[0].cuota_id).toBe(1);
    expect(result.reparto[0].monto.toFixed(1)).toBe("11.2");
    expect(result.reparto[1].cuota_id).toBe(2);
    expect(result.reparto[1].monto.toFixed(1)).toBe("8.8");
    expect(result.sobrante.toFixed(1)).toBe("0.0");
  });

  it("9. Monto mayor que el total → sobrante positivo", () => {
    const pendientes = moraPendientePorCuota({
      capital: 3000,
      cuotas: [
        { cuota_id: 1, diasAtraso: 10, pagado: 0 },
        { cuota_id: 2, diasAtraso: 30, pagado: 0 },
      ],
    });

    // Total pendiente = 44.8, monto 100
    const result = repartirPagoDeMora({
      monto: 100,
      porCuota: pendientes.porCuota,
    });

    expect(result.reparto).toHaveLength(2);
    expect(result.sobrante.toFixed(1)).toBe("55.2");
  });

  it("10. Monto cero → reparto vacío", () => {
    const pendientes = moraPendientePorCuota({
      capital: 3000,
      cuotas: [{ cuota_id: 1, diasAtraso: 10, pagado: 0 }],
    });

    const result = repartirPagoDeMora({
      monto: 0,
      porCuota: pendientes.porCuota,
    });

    expect(result.reparto).toHaveLength(0);
    expect(result.sobrante.toFixed(1)).toBe("0.0");
  });

  it("11. Una cuota con pendiente cero no aparece en el reparto", () => {
    const pendientes = moraPendientePorCuota({
      capital: 3000,
      cuotas: [
        { cuota_id: 1, diasAtraso: 10, pagado: 20 }, // pendiente = 0 (sobrepagado)
        { cuota_id: 2, diasAtraso: 30, pagado: 0 },  // pendiente = 33.6
      ],
    });

    // Repartimos todo lo pendiente disponible
    const result = repartirPagoDeMora({
      monto: 50,
      porCuota: pendientes.porCuota,
    });

    // Reparto debe tener SOLO cuota 2, NO cuota 1 (su pendiente es 0)
    expect(result.reparto).toHaveLength(1);
    expect(result.reparto[0].cuota_id).toBe(2);
    expect(result.reparto[0].monto.toFixed(1)).toBe("33.6");
    expect(result.sobrante.toFixed(1)).toBe("16.4");
  });
});

describe("moraPendientePorCuota — con lo pagado en 0, el total es el de siempre (Codex #1786)", () => {
  it("capital Q73.66, dos cuotas de 1 día: Q0.05, no Q0.06", () => {
    const { total } = moraPendientePorCuota({
      capital: "73.66",
      cuotas: [
        { cuota_id: 1, diasAtraso: 1, pagado: 0 },
        { cuota_id: 2, diasAtraso: 1, pagado: 0 },
      ],
    });
    expect(total.toFixed(2)).toBe("0.05");
  });
});
