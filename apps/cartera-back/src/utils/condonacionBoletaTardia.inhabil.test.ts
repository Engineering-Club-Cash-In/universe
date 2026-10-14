import { describe, expect, test } from "bun:test";
import { cuotasQueCalificanBoletaTardia, fechaLimiteBoletaTardia } from "./condonacionNexaATiempo";

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
  } as never);

describe("fechaLimiteBoletaTardia", () => {
  test.each([
    ["2026-09-30", "2026-09-30"], // miércoles hábil
    ["2026-10-03", "2026-10-05"], // sábado
    ["2026-10-04", "2026-10-05"], // domingo
    ["2026-09-15", "2026-09-16"], // feriado entre semana
    ["2026-11-01", "2026-11-02"], // feriado en domingo
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
  test("vence 1-nov domingo → boleta lunes 2-nov califica", () => {
    expect(califica("2026-11-01", "2026-11-02", "2026-11-04").calificadas).toHaveLength(1);
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
    const r = califica("2026-10-03", "2026-10-05", "2026-10-07", "2026-10-05");
    expect(r.razonSiNinguna).toBe("boleta_de_otro_periodo");
  });
});
