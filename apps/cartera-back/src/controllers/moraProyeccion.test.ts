import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// La proyección de mora del mes no puede contradecir al cron: estas guardas
// fijan de dónde saca cada cosa. El SQL corre de verdad en el arnés de
// integración; acá se cuida el cableado.
const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");
const controlador = leer("./moraProyeccion.ts");
const router = leer("../routers/credits.ts");
const horario = leer("../../schedule.ts");

describe("GET /credito/mora/proyeccion", () => {
  test("vive en el router del detalle del crédito, detrás del mismo authMiddleware", () => {
    const uso = router.indexOf(".use(authMiddleware)");
    const detalle = router.indexOf('.get("/credito",');
    const ruta = router.indexOf('.get("/credito/mora/proyeccion"');
    expect(uso).toBeGreaterThan(-1);
    expect(detalle).toBeGreaterThan(uso);
    expect(ruta).toBeGreaterThan(uso);
  });

  test("exige el número de crédito, contesta 404 si no existe y rechaza otro mes", () => {
    const cuerpo = router.slice(router.indexOf('.get("/credito/mora/proyeccion"'), router.indexOf('.get("/getAllCredits"'));
    expect(cuerpo).toContain("if (!numero_credito_sifco)");
    expect(cuerpo).toMatch(/"message" in result\) \{\s+set\.status = 404;/);
    expect(cuerpo).toMatch(/mes && mes !== result\.mes\) \{\s+set\.status = 400;/);
  });
});

describe("getProyeccionMoraMes", () => {
  test("los días futuros salen de la función pura, con el ledger y la cobertura por pagos", () => {
    expect(controlador).toContain("proyectarMoraDelMes({");
    expect(controlador).toContain("moraPagadaPorCuota(cuotas.map((c) => c.cuota_id), db)");
    expect(controlador).toContain("coberturaDeCuotaSql()");
    expect(controlador).toContain("eq(cuotas_credito.pagado, false)");
  });

  test("los días pasados salen de UNA consulta al historial, cortada por día de Guatemala", () => {
    expect((controlador.match(/cartera\.moras_historial/g) ?? []).length).toBe(1);
    expect(controlador).toContain("generate_series(0, ${diasPasados}::int)");
    // Sargable: el límite se lleva a UTC y la columna va cruda.
    expect(controlador).toContain("inicioDiaGTComoTimestampUTC(`${mes}-01`)");
  });

  test("el corte de cada día es la medianoche exacta de Guatemala, sin ventana de gracia", () => {
    // El cron corre a las 00:05 GT del día d y calcula con hoy = d: su evento
    // es del día d, igual que un pago de las 00:02. Nada de «origen» ni de
    // minutos de tolerancia.
    expect(controlador).toContain(
      "AND h.fecha < ${inicioMesUtc}::timestamp + make_interval(days => g.i::int)\n",
    );
    expect(controlador).not.toContain("h.origen");
    expect(controlador).not.toMatch(/interval '\d+ minutes'/);
    expect(horario).toMatch(/rule: '5 0 \* \* \*', tz: TZ_GUATEMALA \}, async \(\) => \{\s+await runScheduledJob\('process_late_fees'/);
  });

  test("desempata como Mora Histórica y una mora desactivada vale 0", () => {
    expect(controlador).toContain("ORDER BY h.fecha DESC, h.historial_id DESC");
    expect(controlador).toContain("WHEN h.tipo_evento = 'DESACTIVACION' THEN 0");
  });

  test("«mora hoy» es la mora activa del crédito", () => {
    expect(controlador).toContain("eq(moras_credito.activa, true)");
    expect(controlador).toContain("moraHoy: new Big(activa?.monto_mora ?? 0).toFixed(2)");
  });

  test("busca el crédito como el detalle (mismos estados)", () => {
    expect(controlador).toContain("inArray(creditos.statusCredit, [...CREDIT_DETAIL_STATUSES])");
  });
});
