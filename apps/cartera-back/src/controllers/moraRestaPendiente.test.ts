import "../utils/baseFalsaParaPruebas";
import { describe, it, expect } from "bun:test";
import Big from "big.js";
import {
  decidirMoraDelCron,
} from "./latefee";
import {
  moraPendientePorCuota,
  type CuotaParaPendiente,
} from "../utils/moraPendiente";
import { moraPagadaPorCuota } from "../utils/moraPagadaPorCuota";
import { calcularMoraProporcional } from "../utils/moraFormula";

describe("moraRestaPendiente — Con la tabla vacía, nada cambia", () => {
  it("Prueba 1.1: una cuota, sin pagado, da el mismo resultado que calcularMoraProporcional", () => {
    const capital = new Big(10_000);
    const diasAtraso = [5];

    // Resultado con la fórmula vieja (calcularMoraProporcional)
    const moraVieja = calcularMoraProporcional({
      capital,
      diasAtrasadosPorCuota: diasAtraso,
    });

    // Resultado con la nueva (usando moraPendientePorCuota con pagado = 0)
    const cuotasParaPendiente: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: diasAtraso[0]!, pagado: 0 },
    ];
    const moraNueva = moraPendientePorCuota({
      capital,
      cuotas: cuotasParaPendiente,
    });

    expect(moraNueva.total.toFixed(2)).toBe(moraVieja.toFixed(2));
  });

  it("Prueba 1.2: varias cuotas, topadas, sin pagado", () => {
    const capital = new Big(20_000);
    const diasAtraso = [45, 35, 25];

    const moraVieja = calcularMoraProporcional({
      capital,
      diasAtrasadosPorCuota: diasAtraso,
    });

    const cuotasParaPendiente: CuotaParaPendiente[] = diasAtraso.map(
      (dias, idx) => ({
        cuota_id: idx + 1,
        diasAtraso: dias,
        pagado: 0,
      })
    );
    const moraNueva = moraPendientePorCuota({
      capital,
      cuotas: cuotasParaPendiente,
    });

    expect(moraNueva.total.toFixed(2)).toBe(moraVieja.toFixed(2));
  });

  it("Prueba 1.3: capital cero", () => {
    const capital = new Big(0);
    const diasAtraso = [10];

    const moraVieja = calcularMoraProporcional({
      capital,
      diasAtrasadosPorCuota: diasAtraso,
    });

    const cuotasParaPendiente: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: diasAtraso[0]!, pagado: 0 },
    ];
    const moraNueva = moraPendientePorCuota({
      capital,
      cuotas: cuotasParaPendiente,
    });

    expect(moraNueva.total.toFixed(2)).toBe(moraVieja.toFixed(2));
    expect(moraVieja.toFixed(2)).toBe("0.00");
  });

  it("Prueba 1.4: cuota sin vencer (dias negativos)", () => {
    const capital = new Big(5_000);
    const diasAtraso = [-5];

    const moraVieja = calcularMoraProporcional({
      capital,
      diasAtrasadosPorCuota: diasAtraso,
    });

    const cuotasParaPendiente: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: diasAtraso[0]!, pagado: 0 },
    ];
    const moraNueva = moraPendientePorCuota({
      capital,
      cuotas: cuotasParaPendiente,
    });

    expect(moraNueva.total.toFixed(2)).toBe(moraVieja.toFixed(2));
    expect(moraNueva.total.toFixed(2)).toBe("0.00");
  });
});

describe("moraRestaPendiente — La resta funciona", () => {
  it("Prueba 3.1: con pagado > 0, el resultado baja exactamente lo pagado", () => {
    const capital = new Big(10_000);

    // Devengado
    const cuotasConCero: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: 30, pagado: 0 },
    ];
    const devengado = moraPendientePorCuota({
      capital,
      cuotas: cuotasConCero,
    });

    // Pagado
    const pagado = new Big(50);

    // Pendiente
    const cuotasConPagado: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: 30, pagado },
    ];
    const pendiente = moraPendientePorCuota({
      capital,
      cuotas: cuotasConPagado,
    });

    // La resta debe ser exacta
    const diferencia = devengado.total.minus(pendiente.total);
    expect(diferencia.toFixed(2)).toBe(pagado.toFixed(2));
  });

  it("Prueba 3.2: pagado > devengado", () => {
    const capital = new Big(100);

    // Devengado con 1 día es muy poco
    const cuotasConCero: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: 1, pagado: 0 },
    ];
    const devengado = moraPendientePorCuota({
      capital,
      cuotas: cuotasConCero,
    });

    // Pagado es mayor
    const pagado = devengado.total.times(2);

    // Pendiente debe ser cero (max(0, devengado - pagado))
    const cuotasConPagado: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: 1, pagado },
    ];
    const pendiente = moraPendientePorCuota({
      capital,
      cuotas: cuotasConPagado,
    });

    expect(pendiente.total.toFixed(2)).toBe("0.00");
  });
});

describe("moraRestaPendiente — max(0) es por cuota, no global", () => {
  it("Prueba 4.1: una cuota sobrepagada NO reduce el pendiente de otra", () => {
    const capital = new Big(10_000);

    // Cuota 1: devengado poco, pagado mucho (sobrepagada)
    // Cuota 2: devengado normal, sin pagado
    const cuotasConSobrepago: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: 1, pagado: 200 }, // Sobrepagada
      { cuota_id: 2, diasAtraso: 30, pagado: 0 },
    ];
    const resultado = moraPendientePorCuota({
      capital,
      cuotas: cuotasConSobrepago,
    });

    // Cuota 1 debe tener pendiente 0 (sobrepagada)
    const pendiente1 = resultado.porCuota[0]!;
    expect(pendiente1.pendiente.toFixed(2)).toBe("0.00");

    // Cuota 2 debe tener su devengado completo (sin reducción por sobrepago de la otra)
    const pendiente2 = resultado.porCuota[1]!;
    expect(pendiente2.pendiente.gt(0)).toBe(true);

    // Total no debe restar el sobrante de la cuota 1 a la cuota 2
    const sumaIndividual = pendiente1.pendiente.plus(pendiente2.pendiente);
    expect(resultado.total.toFixed(2)).toBe(sumaIndividual.toFixed(2));
  });
});

describe("moraRestaPendiente — incremento diario (Task 2b verificación)", () => {
  it("Prueba 2b.1: con pagado=0 vs con pagado positivo, el incremento es IGUAL", () => {
    // El incremento es mora(mañana) - mora(hoy), y si ambas restan lo mismo (0),
    // la diferencia se cancela. El incremento no necesita la resta.
    const capital = new Big(10_000);

    // Mora hoy con pagado=0
    const cuotasHoy: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: 5, pagado: 0 },
    ];
    const moraHoy = moraPendientePorCuota({
      capital,
      cuotas: cuotasHoy,
    });

    // Mora mañana con pagado=0 (un día más de atraso)
    const cuotasManana: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: 6, pagado: 0 },
    ];
    const moraMañana = moraPendientePorCuota({
      capital,
      cuotas: cuotasManana,
    });

    const incrementoSinPago = moraMañana.total.minus(moraHoy.total);

    // Ahora con pagado positivo (pero sin cambiar hoy/mañana)
    const cuotasHoyConPago: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: 5, pagado: new Big(10) },
    ];
    const moraHoyConPago = moraPendientePorCuota({
      capital,
      cuotas: cuotasHoyConPago,
    });

    const cuotasMananaConPago: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: 6, pagado: new Big(10) },
    ];
    const moraMañanaConPago = moraPendientePorCuota({
      capital,
      cuotas: cuotasMananaConPago,
    });

    const incrementoConPago = moraMañanaConPago.total.minus(moraHoyConPago.total);

    // Son iguales: la resta se cancela
    expect(incrementoSinPago.toFixed(2)).toBe(incrementoConPago.toFixed(2));
  });

  it("Prueba 2b.2: BORDE — cuota con pagado > devengado, incremento es cero", () => {
    // Una cuota con poco devengado pero mucho pagado (sobrepagada).
    // Hoy: devengado < pagado → pendiente = 0
    // Mañana: devengado sigue siendo menor (con 1 día más) → pendiente = 0
    // Incremento = 0 - 0 = 0
    const capital = new Big(100);

    const cuotasHoy: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: 1, pagado: new Big(50) }, // devengado ≈ 3.73, pagado 50 → sobrepagada
    ];
    const moraHoy = moraPendientePorCuota({
      capital,
      cuotas: cuotasHoy,
    });

    const cuotasManana: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: 2, pagado: new Big(50) },
    ];
    const moraMañana = moraPendientePorCuota({
      capital,
      cuotas: cuotasManana,
    });

    const incremento = moraMañana.total.minus(moraHoy.total);

    // Ambos pendientes son 0, incremento es 0
    expect(moraHoy.total.toFixed(2)).toBe("0.00");
    expect(moraMañana.total.toFixed(2)).toBe("0.00");
    expect(incremento.toFixed(2)).toBe("0.00");
  });
});

describe("decidirMoraDelCron — mora pagada no desactiva el crédito (ARREGLO 1)", () => {
  it("(a) una cuota con diasAtraso 40 y pagado == devengado → APLICAR '0.00'", () => {
    const capital = new Big(10_000);
    const diasAtraso = [40];

    // Calcular devengado (sin pagado)
    const cuotasConCero: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: diasAtraso[0]!, pagado: 0 },
    ];
    const devengado = moraPendientePorCuota({
      capital,
      cuotas: cuotasConCero,
    });

    // Cuota con pagado == devengado
    const cuotasConPagado: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: diasAtraso[0]!, pagado: devengado.total },
    ];
    const decision = decidirMoraDelCron({
      capital,
      cuotasParaPendiente: cuotasConPagado,
    });

    // Debe retornar APLICAR con "0.00" (no DESACTIVAR)
    if (decision.accion === "APLICAR") {
      expect(decision.montoStr).toBe("0.00");
    } else {
      throw new Error(`Expected APLICAR but got ${decision.accion}`);
    }
  });

  it("(b) sin cuotas → DESACTIVAR", () => {
    const capital = new Big(10_000);
    const cuotasParaPendiente: CuotaParaPendiente[] = [];

    const decision = decidirMoraDelCron({
      capital,
      cuotasParaPendiente,
    });

    if (decision.accion === "DESACTIVAR") {
      expect(decision.motivo).toBe("Mora proporcional menor a un centavo");
    } else {
      throw new Error(`Expected DESACTIVAR but got ${decision.accion}`);
    }
  });

  it("(b) todas las cuotas con diasAtraso ≤ 0 → DESACTIVAR", () => {
    const capital = new Big(10_000);
    const cuotasParaPendiente: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: -5, pagado: 0 },
      { cuota_id: 2, diasAtraso: 0, pagado: 0 },
    ];

    const decision = decidirMoraDelCron({
      capital,
      cuotasParaPendiente,
    });

    if (decision.accion === "DESACTIVAR") {
      expect(decision.motivo).toBe("Mora proporcional menor a un centavo");
    } else {
      throw new Error(`Expected DESACTIVAR but got ${decision.accion}`);
    }
  });

  it("(c) capital muy pequeño con poco atraso → devengado redondea a Q0.00 → DESACTIVAR", () => {
    const capital = new Big(10); // Capital muy pequeño
    const cuotasParaPendiente: CuotaParaPendiente[] = [
      { cuota_id: 1, diasAtraso: 1, pagado: 0 },
    ];

    const decision = decidirMoraDelCron({
      capital,
      cuotasParaPendiente,
    });

    // Con capital=10 y 1 día: 10 × 0.0112 × 1/30 ≈ 0.00373, redondea a 0.00
    if (decision.accion === "DESACTIVAR") {
      expect(decision.motivo).toBe("Mora proporcional menor a un centavo");
    } else {
      throw new Error(`Expected DESACTIVAR but got ${decision.accion}`);
    }
  });
});
