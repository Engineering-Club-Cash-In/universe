import { describe, expect, test } from "bun:test";
import { proyectarMoraDelMes, ultimoDiaDelMes } from "./proyeccionMoraMes";

// Capital que genera Q1.00 por cuota por día: capital × 1.12% ÷ 30 = 1.
const CAPITAL_Q1_DIA = "2678.571428571428571428";
const base = { capital: CAPITAL_Q1_DIA, statusCredit: "MOROSO" };
const moras = (dias: { mora: string }[]) => dias.map((d) => d.mora);

describe("proyectarMoraDelMes", () => {
  test("va de hoy al último día del mes, sumando Q1 por día", () => {
    const dias = proyectarMoraDelMes({
      ...base,
      hoy: "2026-10-28",
      cuotas: [{ cuota_id: 1, fecha_vencimiento: "2026-10-20", pagado: 0 }],
    });
    expect(dias).toEqual([
      { fecha: "2026-10-28", mora: "8.00", cuotasSumando: 1 },
      { fecha: "2026-10-29", mora: "9.00", cuotasSumando: 1 },
      { fecha: "2026-10-30", mora: "10.00", cuotasSumando: 1 },
      { fecha: "2026-10-31", mora: "11.00", cuotasSumando: 1 },
    ]);
  });

  test("resta lo ya pagado: pagó Q4 el día 4 de atraso, el día 5 debe Q1", () => {
    const dias = proyectarMoraDelMes({
      ...base,
      hoy: "2026-10-05",
      cuotas: [{ cuota_id: 1, fecha_vencimiento: "2026-09-30", pagado: "4" }],
    });
    expect(moras(dias).slice(0, 3)).toEqual(["1.00", "2.00", "3.00"]);
  });

  test("lo abonado de más a una cuota no le descuenta a otra, ni la cuenta como «sumando»", () => {
    const dias = proyectarMoraDelMes({
      ...base,
      hoy: "2026-10-05",
      cuotas: [
        { cuota_id: 1, fecha_vencimiento: "2026-09-30", pagado: "20.50" },
        { cuota_id: 2, fecha_vencimiento: "2026-10-03", pagado: 0 },
      ],
    });
    expect(dias[0]).toEqual({ fecha: "2026-10-05", mora: "2.00", cuotasSumando: 1 });
    // La cuota 1 tiene Q20.50 abonados: recién el día 21 de atraso (21-oct)
    // vuelve a deber, así que el 20 es el primer día en que «mañana sube».
    expect(dias.find((d) => d.fecha === "2026-10-19")?.cuotasSumando).toBe(1);
    expect(dias.find((d) => d.fecha === "2026-10-20")?.cuotasSumando).toBe(2);
    expect(dias.find((d) => d.fecha === "2026-10-25")?.mora).toBe("26.50");
  });

  test("tope de 30 días por cuota: llega a Q30 y deja de subir", () => {
    const dias = proyectarMoraDelMes({
      ...base,
      hoy: "2026-10-28",
      cuotas: [{ cuota_id: 1, fecha_vencimiento: "2026-09-30", pagado: 0 }],
    });
    expect(dias).toEqual([
      { fecha: "2026-10-28", mora: "28.00", cuotasSumando: 1 },
      { fecha: "2026-10-29", mora: "29.00", cuotasSumando: 1 },
      { fecha: "2026-10-30", mora: "30.00", cuotasSumando: 0 },
      { fecha: "2026-10-31", mora: "30.00", cuotasSumando: 0 },
    ]);
  });

  test("la cuota que vence el 15 empieza a generar el 16", () => {
    const dias = proyectarMoraDelMes({
      ...base,
      hoy: "2026-10-13",
      cuotas: [{ cuota_id: 1, fecha_vencimiento: "2026-10-15", pagado: 0 }],
    });
    expect(dias.slice(0, 5)).toEqual([
      { fecha: "2026-10-13", mora: "0.00", cuotasSumando: 0 },
      { fecha: "2026-10-14", mora: "0.00", cuotasSumando: 0 },
      { fecha: "2026-10-15", mora: "0.00", cuotasSumando: 1 },
      { fecha: "2026-10-16", mora: "1.00", cuotasSumando: 1 },
      { fecha: "2026-10-17", mora: "2.00", cuotasSumando: 1 },
    ]);
  });

  test("un pago pendiente frena la cuota 7 días y el día 8 vuelve con todos sus días", () => {
    const dias = proyectarMoraDelMes({
      ...base,
      hoy: "2026-10-10",
      cuotas: [
        { cuota_id: 1, fecha_vencimiento: "2026-10-05", pagado: 0, fechasPagoPendiente: ["2026-10-10"] },
      ],
    });
    // Del 10 al 17 (fecha_pago + 7) la cubre el pendiente; el 18 ya no.
    expect(moras(dias).slice(0, 10)).toEqual([
      "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "13.00", "14.00",
    ]);
    expect(dias[7]).toEqual({ fecha: "2026-10-17", mora: "0.00", cuotasSumando: 1 });
  });

  test("un pendiente fechado mañana cubre hoy; fechado pasado mañana, no", () => {
    const con = (fecha: string) =>
      proyectarMoraDelMes({
        ...base,
        hoy: "2026-10-10",
        cuotas: [{ cuota_id: 1, fecha_vencimiento: "2026-10-05", pagado: 0, fechasPagoPendiente: [fecha] }],
      })[0].mora;
    expect(con("2026-10-11")).toBe("0.00");
    expect(con("2026-10-12")).toBe("5.00");
  });

  test("una cuota cubierta por un pago validado no genera nunca", () => {
    const dias = proyectarMoraDelMes({
      ...base,
      hoy: "2026-10-28",
      cuotas: [{ cuota_id: 1, fecha_vencimiento: "2026-10-05", pagado: 0, cubiertaPorPagoValidado: true }],
    });
    expect(new Set(moras(dias))).toEqual(new Set(["0.00"]));
  });

  test("estado excluido o sin capital: todo en cero", () => {
    const cuotas = [{ cuota_id: 1, fecha_vencimiento: "2026-09-01", pagado: 0 }];
    for (const caso of [
      { capital: CAPITAL_Q1_DIA, statusCredit: "EN_CONVENIO" },
      { capital: CAPITAL_Q1_DIA, statusCredit: "INCOBRABLE" },
      { capital: "0", statusCredit: "MOROSO" },
      { capital: null, statusCredit: "MOROSO" },
    ]) {
      const dias = proyectarMoraDelMes({ ...caso, hoy: "2026-10-29", cuotas });
      expect(dias).toEqual([
        { fecha: "2026-10-29", mora: "0.00", cuotasSumando: 0 },
        { fecha: "2026-10-30", mora: "0.00", cuotasSumando: 0 },
        { fecha: "2026-10-31", mora: "0.00", cuotasSumando: 0 },
      ]);
    }
  });

  test("redondea el TOTAL como el cron, no cada cuota", () => {
    // 10,000 × 1.12% ÷ 30 = 3.7333…: dos cuotas con 1 día son 7.4666… → 7.47
    // (redondeando cada una serían 3.73 + 3.73 = 7.46).
    const dias = proyectarMoraDelMes({
      capital: "10000",
      statusCredit: "ACTIVO",
      hoy: "2026-10-31",
      cuotas: [
        { cuota_id: 1, fecha_vencimiento: "2026-10-30", pagado: 0 },
        { cuota_id: 2, fecha_vencimiento: "2026-10-30", pagado: 0 },
      ],
    });
    expect(dias).toEqual([{ fecha: "2026-10-31", mora: "7.47", cuotasSumando: 2 }]);
  });
});

describe("ultimoDiaDelMes", () => {
  test("febrero, bisiesto y diciembre", () => {
    expect(ultimoDiaDelMes("2026-02-10")).toBe("2026-02-28");
    expect(ultimoDiaDelMes("2028-02-10")).toBe("2028-02-29");
    expect(ultimoDiaDelMes("2026-12-31")).toBe("2026-12-31");
  });
});
