import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DesgloseMoraPanel } from "./desgloseMora";

// El caso de la captura: 1 cuota atrasada a la vista, pero Q625.18 de mora,
// porque la cuota #41 tiene un pago en validación y el cron la sigue contando.
const desglose = {
  cargoMensual: "312.59",
  cargoDiario: "10.42",
  cuotas: [
    { numero_cuota: 41, fecha_vencimiento: "2026-08-23", dias_atraso: 38, topada: true, en_validacion: true, generado: "312.59", abonado: "0.00", pendiente: "312.59" },
    { numero_cuota: 42, fecha_vencimiento: "2026-09-23", dias_atraso: 7, topada: false, en_validacion: false, generado: "72.94", abonado: "20.84", pendiente: "52.10" },
  ],
  total: "364.69",
  ajusteRedondeo: "0.00",
  totalManana: "375.11",
};
const texto = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("DesgloseMoraPanel — el porqué de la mora para el asesor", () => {
  test("cerrado: solo el enlace con el monto registrado", () => {
    const t = texto(renderToStaticMarkup(<DesgloseMoraPanel desglose={desglose} moraRegistrada={625.18} capital={27909.73} />));
    expect(t).toContain("¿Por qué Q625.18 de mora?");
    expect(t).not.toContain("Total calculado hoy");
  });

  test("abierto: regla, cuotas, validación, mañana y diferencia con lo registrado", () => {
    const t = texto(renderToStaticMarkup(<DesgloseMoraPanel desglose={desglose} moraRegistrada={625.18} capital={27909.73} abiertoInicial />));
    expect(t).toContain("Q10.42 por día");
    expect(t).toContain("Q312.59 por cuota");
    expect(t).toContain("#41 venció 23/08/2026 ⏳ pago en validación: sigue generando mora 38 tope");
    expect(t).toContain("−Q20.84");
    expect(t).toContain("Total calculado hoy Q364.69");
    // Registrada Q625.18 ≠ calculada: el cierre la REEMPLAZA por el cálculo de mañana (baja).
    expect(t).toContain("Si no paga, con el próximo cierre la mora queda en Q375.11 (el cálculo de hoy más Q10.42 de un día más).");
    expect(t).not.toContain("sube al menos");
    // Condonar no es pagar: la columna es neutral.
    expect(t).toContain("Abonado");
    expect(t).toContain("pagado o condonado");
    expect(t).not.toContain("ya pagó");
    expect(t).toContain("La mora registrada (Q625.18) es la del cierre de anoche");
  });

  test("sin mora ni cuotas no se muestra nada", () => {
    expect(renderToStaticMarkup(<DesgloseMoraPanel desglose={{ ...desglose, cuotas: [], total: "0.00" }} moraRegistrada={0} capital={1} />)).toBe("");
  });
});

describe("DesgloseMoraPanel — centavos", () => {
  test("muestra el ajuste por redondeo cuando las filas no suman el total", () => {
    const t = texto(renderToStaticMarkup(<DesgloseMoraPanel desglose={{ ...desglose, ajusteRedondeo: "-0.01" }} moraRegistrada={625.18} capital={27909.73} abiertoInicial />));
    expect(t).toContain("Ajuste por redondeo −Q0.01");
  });
  test("sin totalManana (respuesta vieja) no promete cuánto sube mañana", () => {
    const { totalManana, ...viejo } = desglose;
    const t = texto(renderToStaticMarkup(<DesgloseMoraPanel desglose={viejo} moraRegistrada={625.18} capital={27909.73} abiertoInicial />));
    expect(t).not.toContain("mañana");
    expect(t).not.toContain("NaN");
  });
});

describe("DesgloseMoraPanel — mañana con cuotas que vencen hoy", () => {
  test("todas topadas + una que vence hoy: igual avisa que mañana sube", () => {
    const topadas = {
      ...desglose,
      cuotas: desglose.cuotas.map((c) => ({ ...c, topada: true })),
      total: "224.00",
      totalManana: "227.73",
      cuotasQueSubenManana: 1,
    };
    const t = texto(renderToStaticMarkup(<DesgloseMoraPanel desglose={topadas} moraRegistrada={224} capital={10000} abiertoInicial />));
    expect(t).toContain("mañana la mora sube al menos Q3.73 (1 cuota sigue sumando)");
  });

  test("avisa aunque la diferencia sea de un centavo (y no avisa si son iguales)", () => {
    const uno = texto(renderToStaticMarkup(<DesgloseMoraPanel desglose={{ ...desglose, total: "108.27" }} moraRegistrada={108.26} capital={27909.73} abiertoInicial />));
    expect(uno).toContain("La mora registrada (Q108.26) es la del cierre de anoche");
    const igual = texto(renderToStaticMarkup(<DesgloseMoraPanel desglose={{ ...desglose, total: "108.27" }} moraRegistrada={108.27} capital={27909.73} abiertoInicial />));
    expect(igual).not.toContain("es la del cierre de anoche");
  });

  test("registrada = calculada: dice cuánto sube mañana", () => {
    const t = texto(renderToStaticMarkup(<DesgloseMoraPanel desglose={desglose} moraRegistrada={364.69} capital={27909.73} abiertoInicial />));
    expect(t).toContain("mañana la mora sube al menos Q10.42 (1 cuota sigue sumando)");
    expect(t).not.toContain("con el próximo cierre la mora queda en");
  });
});
