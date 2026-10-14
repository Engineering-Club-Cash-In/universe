import { describe, expect, test } from "bun:test";
import {
  cuotasQueCalificanBoletaTardia,
  decidirCondonacionBoletaTardia,
  fechaLimiteBoletaTardia,
  type ParamsBoletaTardia,
} from "./condonacionNexaATiempo";

const DIA = 86_400_000;
const dias = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DIA);
const resta = (f: string, n: number) => new Date(Date.parse(f) - n * DIA).toISOString().slice(0, 10);

const califica = (venc: string, boleta: string, hoy: string, anterior: string | null = resta(venc, 30)) =>
  cuotasQueCalificanBoletaTardia({
    cuotasConMora: [{ cuota_id: 1, diasAtraso: dias(venc, hoy), pagado: 0, fecha_vencimiento: venc }],
    cuotasAbiertas: [{ cuota_id: 1, numero_cuota: 5, fecha_vencimiento: venc, saldo: "1000" }],
    fechaBoleta: boleta,
    hoy,
    vencimientoCuotaAnterior: new Map([[1, anterior]]),
  } as Parameters<typeof cuotasQueCalificanBoletaTardia>[0]);

describe("fechaLimiteBoletaTardia", () => {
  test.each([
    ["2026-09-30", "2026-09-30"], // miércoles hábil
    ["2026-10-03", "2026-10-05"], // sábado
    ["2026-10-04", "2026-10-05"], // domingo
    ["2026-09-15", "2026-09-16"], // feriado entre semana
    ["2026-11-01", "2026-11-03"], // domingo + cierre trasladado del lunes 2-nov
    ["2026-06-28", "2026-06-30"], // domingo + 29-jun cerrado; 30-jun ya es hábil
    ["2026-06-30", "2026-06-30"],
    ["2026-10-31", "2026-11-03"],
    ["2026-10-12", "2026-10-13"],
    ["2026-12-24", "2026-12-28"], // 24 + 25 + fin de semana
    ["2026-12-25", "2026-12-28"],
    ["2026-12-31", "2027-01-04"], // 31 + 1-ene + fin de semana
    ["2026-04-02", "2026-04-06"], // Jueves Santo + Viernes Santo + fin de semana
    ["2027-03-25", "2027-03-29"],
  ])("vence %s → límite %s", (venc, limite) => {
    expect(fechaLimiteBoletaTardia(venc)).toBe(limite);
  });
});

describe("boleta tardía con vencimiento inhábil", () => {
  test("vence sábado, boleta lunes → califica", () => {
    expect(califica("2026-10-03", "2026-10-05", "2026-10-07").calificadas).toHaveLength(1);
  });
  test("vence domingo, boleta lunes → califica", () => {
    expect(califica("2026-10-04", "2026-10-05", "2026-10-07").calificadas).toHaveLength(1);
  });
  test("vence sábado, boleta martes → no", () => {
    const r = califica("2026-10-03", "2026-10-06", "2026-10-07");
    expect(r.calificadas).toHaveLength(0);
    expect(r.razonSiNinguna).toBe("fuera_de_ventana");
  });
  test("vence viernes (hábil), boleta lunes → no", () => {
    expect(califica("2026-10-02", "2026-10-05", "2026-10-07").razonSiNinguna).toBe("fuera_de_ventana");
  });
  test("vence feriado 20-oct, boleta del siguiente hábil califica; un día más no", () => {
    expect(califica("2026-10-20", "2026-10-21", "2026-10-23").calificadas).toHaveLength(1);
    expect(califica("2026-10-20", "2026-10-22", "2026-10-23").razonSiNinguna).toBe("fuera_de_ventana");
  });
  test("vence 1-nov domingo → boleta martes 3-nov califica (2-nov cerrado)", () => {
    expect(califica("2026-11-01", "2026-11-03", "2026-11-04").calificadas).toHaveLength(1);
  });
  test("vence Jueves Santo → boleta el lunes siguiente califica", () => {
    expect(califica("2026-04-02", "2026-04-06", "2026-04-07").calificadas).toHaveLength(1);
    expect(califica("2026-04-02", "2026-04-07", "2026-04-08").razonSiNinguna).toBe("fuera_de_ventana");
  });
  test("vence 24 y 31-dic", () => {
    expect(califica("2026-12-24", "2026-12-28", "2026-12-29").calificadas).toHaveLength(1);
    expect(califica("2026-12-31", "2027-01-04", "2027-01-05").calificadas).toHaveLength(1);
  });
  test("vence sábado y se registra el día 6 desde el vencimiento → fuera de tope", () => {
    const r = califica("2026-10-03", "2026-10-05", "2026-10-09");
    expect(r.calificadas).toHaveLength(0);
    expect(r.razonSiNinguna).toBe("fuera_de_tope");
  });
  test("vence sábado, día 5 exacto → califica", () => {
    expect(califica("2026-10-03", "2026-10-05", "2026-10-08").calificadas).toHaveLength(1);
  });
  test("anti boleta vieja: boleta ≤ vencimiento de la cuota anterior no califica", () => {
    // cuota vence sábado 03-oct; la anterior venció el 03-sep (jueves)
    expect(califica("2026-10-03", "2026-09-03", "2026-10-05", "2026-09-03").razonSiNinguna).toBe("boleta_de_otro_periodo");
    expect(califica("2026-10-03", "2026-09-04", "2026-10-05", "2026-09-03").calificadas).toHaveLength(1);
  });
  test("anti boleta vieja con cuota anterior inhábil: la boleta del siguiente hábil es la de N-1", () => {
    // N-1 vence sábado 03-oct, N vence 03-nov; boleta 05-oct (lunes) es el pago a tiempo de N-1
    expect(califica("2026-11-03", "2026-10-05", "2026-11-05", "2026-10-03").razonSiNinguna).toBe("boleta_de_otro_periodo");
    expect(califica("2026-11-03", "2026-10-06", "2026-11-05", "2026-10-03").calificadas).toHaveLength(1);
  });
});

describe("monto condonado con vencimiento inhábil", () => {
  test("vence sábado, boleta lunes, registrada el día 5 → condona la mora de 5 días", () => {
    const p: ParamsBoletaTardia = {
      statusCredit: "MOROSO", capital: "10000", rubrosPendientes: 0, ajusteFechaIdeal: null,
      moraActiva: "18.67",
      cuotasConMora: [{ cuota_id: 1, diasAtraso: 5, pagado: 0, fecha_vencimiento: "2026-10-03" }],
      cuotasAbiertas: [{ cuota_id: 1, numero_cuota: 5, fecha_vencimiento: "2026-10-03", saldo: "1000" }],
      hoy: "2026-10-08", fechaBoleta: "2026-10-05",
      vencimientoCuotaAnterior: new Map([[1, "2026-09-03"]]), monto: "1000.00",
    } as ParamsBoletaTardia;
    const d = decidirCondonacionBoletaTardia(p);
    expect(d.condonar).toBe(true);
    if (d.condonar) expect(d.monto.toFixed(2)).toBe("18.67"); // 10,000 × 1.12% × 5 / 30
  });
});
