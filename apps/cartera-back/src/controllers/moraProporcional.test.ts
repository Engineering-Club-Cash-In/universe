import { describe, expect, it, mock } from "bun:test";
import Big from "big.js";

// latefee.ts importa la conexión a la base al cargarse; estos tests solo ejercen
// helpers PUROS (sin DB), así que la conexión se reemplaza por un objeto vacío.
mock.module("../database", () => ({ db: {}, client: {} }));

const {
  calcularMoraProporcional,
  diasAtrasoMora,
  decidirMoraDelCron,
  decidirMoraTrasRomperConvenio,
  fechaCalendarioGT,
  hoyGuatemala,
  isOverdueInstallmentForMora,
  maximoMoraSinOverride,
  BASE_DIAS_MORA,
  TASA_MORA_MENSUAL,
} = await import("./latefee");

const mora = (capital: number | string, dias: number[]) =>
  calcularMoraProporcional({ capital, diasAtrasadosPorCuota: dias }).toFixed(2);

// Créditos reales: las cuotas son MENSUALES, así que si hay más de una vencida
// la anterior ya lleva ~30 días más de atraso que la siguiente. Capital 10,000
// → cargo mensual completo de Q112.00 por cuota.
describe("calcularMoraProporcional — créditos reales de cuotas mensuales", () => {
  it("crédito que recién cayó en mora: una sola cuota con 5 días de atraso", () => {
    expect(mora(10_000, [5])).toBe("18.67");
  });

  it("crédito que recién cayó en mora ayer: un día de atraso cobra 1/30 del cargo", () => {
    expect(mora(10_000, [1])).toBe("3.73");
  });

  it("dos cuotas vencidas: la vieja en el techo y la fresca proporcional", () => {
    // c9 con 35 días (ya topada) + c10 con 5 días
    expect(mora(10_000, [35, 5])).toBe("130.67");
  });

  it("tres cuotas vencidas: dos en el techo y la fresca proporcional", () => {
    // c8 con 65 días + c9 con 35 días + c10 con 5 días
    expect(mora(10_000, [65, 35, 5])).toBe("242.67");
  });

  it("cuatro cuotas vencidas: tres en el techo y la fresca proporcional", () => {
    // c7 con 95 días + c8 con 65 + c9 con 35 + c10 con 5
    expect(mora(10_000, [95, 65, 35, 5])).toBe("354.67");
  });

  it("cuota a media quincena de atraso cobra medio cargo", () => {
    expect(mora(10_000, [15])).toBe("56.00");
  });

  it("cuota vencida el mismo día no cobra mora", () => {
    expect(mora(10_000, [0])).toBe("0.00");
  });

  it("cuota abandonada hace un año cobra un solo cargo mensual, no doce", () => {
    expect(mora(10_000, [365])).toBe("112.00");
  });
});

describe("calcularMoraProporcional — bordes", () => {
  it("capital 0 → 0", () => {
    expect(mora(0, [30, 30])).toBe("0.00");
  });

  it("capital negativo → 0 (nunca acredita mora a favor)", () => {
    expect(mora(-5_000, [30])).toBe("0.00");
  });

  it("sin cuotas vencidas → 0", () => {
    expect(mora(10_000, [])).toBe("0.00");
  });

  it("días negativos (fecha futura) aportan 0, no restan", () => {
    expect(mora(10_000, [-10])).toBe("0.00");
    // La cuota futura no debe descontarle a la vencida.
    expect(mora(10_000, [-10, 15])).toBe("56.00");
  });

  it("29 / 30 / 31 días: el techo entra exactamente en 30", () => {
    const cargoMensual = new Big(10_000).times(TASA_MORA_MENSUAL);
    expect(mora(10_000, [29])).toBe(cargoMensual.times(29).div(30).toFixed(2));
    expect(mora(10_000, [30])).toBe("112.00");
    expect(mora(10_000, [31])).toBe("112.00");
    expect(BASE_DIAS_MORA).toBe(30);
  });

  it("cartera vieja: 5 cuotas de más de un año cobran 5 cargos, no 60", () => {
    expect(mora(10_000, [400, 370, 340, 310, 280])).toBe("560.00");
  });

  it("mezcla de antigüedades por encima y por debajo del techo", () => {
    // 90d → 1, 30d → 1, 10d → 1/3, 3d → 1/10
    // 112 × (1 + 1 + 0.3333… + 0.1) = 272.5333…
    expect(mora(10_000, [90, 30, 10, 3])).toBe("272.53");
  });

  it("no redondea factores intermedios: 3 cuotas de 10 días = 1 cargo completo", () => {
    expect(mora(10_000, [10, 10, 10])).toBe("112.00");
  });

  it("acepta capital como string o Big", () => {
    expect(mora("10000.00", [15])).toBe("56.00");
    expect(calcularMoraProporcional({ capital: new Big(10_000), diasAtrasadosPorCuota: [15] }).toFixed(2)).toBe("56.00");
  });

  it("idempotencia: dos llamadas con la misma entrada dan el mismo resultado", () => {
    const dias = [40, 5, 17];
    const primera = mora(10_000, dias);
    const segunda = mora(10_000, dias);
    expect(segunda).toBe(primera);
    // Y la entrada no se muta (el cron reusa el array del crédito).
    expect(dias).toEqual([40, 5, 17]);
  });
});

describe("diasAtrasoMora", () => {
  // Medianoche de Guatemala (UTC-6) del día indicado.
  const gt = (iso: string) => new Date(`${iso}T06:00:00.000Z`);
  const hoy = gt("2026-09-21");

  it("vence hoy → 0 días", () => {
    expect(diasAtrasoMora(gt("2026-09-21"), hoy)).toBe(0);
  });

  it("venció ayer → 1 día", () => {
    expect(diasAtrasoMora(gt("2026-09-20"), hoy)).toBe(1);
  });

  it("venció hace 15 días → 15", () => {
    expect(diasAtrasoMora(gt("2026-09-06"), hoy)).toBe(15);
  });

  it("vence en el futuro → 0, nunca negativo", () => {
    expect(diasAtrasoMora(gt("2026-10-15"), hoy)).toBe(0);
  });

  it("la hora del día no mueve el conteo (se compara a medianoche)", () => {
    const vencTarde = new Date("2026-09-20T23:30:00.000Z"); // 17:30 GT del 20
    expect(diasAtrasoMora(vencTarde, new Date("2026-09-21T18:00:00.000Z"))).toBe(1);
  });

  it("acepta la fecha como string (como viene de la base)", () => {
    expect(diasAtrasoMora("2026-09-06T06:00:00.000Z", hoy)).toBe(15);
  });
});


// Instante fijo: 09:00 de Guatemala del 21-sep-2026. El "hoy" canónico del
// módulo sale SIEMPRE de hoyGuatemala(), así que los tests de calendario lo
// construyen igual que producción en vez de inventar un Date suelto.
const AHORA_GT = new Date("2026-09-21T15:00:00.000Z");
const HOY = hoyGuatemala(AHORA_GT);

const cuotaViva = (fecha_vencimiento: Date | string) => ({
  fecha_vencimiento,
  pagado: false,
  hasPaidPayment: false,
  statusCredit: "ACTIVO",
});

describe("fechaCalendarioGT — la fecha de vencimiento es CALENDARIO, no instante", () => {
  it("lee el string ISO que devuelve drizzle para la columna `date`", () => {
    expect(fechaCalendarioGT("2026-09-20")).toBe(Date.UTC(2026, 8, 20));
  });

  it("lee el literal crudo de Postgres sin zona", () => {
    expect(fechaCalendarioGT("2026-09-20 00:00:00")).toBe(Date.UTC(2026, 8, 20));
  });

  it("de un Date lee los campos LOCALES (los que deja pg), no los UTC", () => {
    // 20-sep a las 17:30 hora del proceso: sigue siendo el día 20.
    expect(fechaCalendarioGT(new Date(2026, 8, 20, 17, 30))).toBe(Date.UTC(2026, 8, 20));
    expect(fechaCalendarioGT(new Date(2026, 8, 20, 0, 0))).toBe(Date.UTC(2026, 8, 20));
  });

  it("string y Date del mismo día dan el mismo número", () => {
    expect(fechaCalendarioGT("2026-09-20 00:00:00")).toBe(fechaCalendarioGT(new Date(2026, 8, 20)));
  });

  it("la diferencia entre dos fechas es exacta en días (no hay residuo que redondear)", () => {
    const d = fechaCalendarioGT("2026-09-21") - fechaCalendarioGT("2026-09-06");
    expect(d % 86_400_000).toBe(0);
    expect(d / 86_400_000).toBe(15);
  });
});

describe("diasAtrasoMora / isOverdueInstallmentForMora — calendario con el hoy canónico", () => {
  it("cuota que vence HOY: 0 días y NO vencida", () => {
    expect(diasAtrasoMora("2026-09-21", HOY)).toBe(0);
    expect(isOverdueInstallmentForMora(cuotaViva("2026-09-21"), HOY)).toBe(false);
  });

  it("cuota que venció AYER: 1 día y sí vencida", () => {
    expect(diasAtrasoMora("2026-09-20", HOY)).toBe(1);
    expect(isOverdueInstallmentForMora(cuotaViva("2026-09-20"), HOY)).toBe(true);
  });

  it("misma fecha como Date y como string cruda de Postgres dan lo mismo", () => {
    const comoDate = new Date(2026, 8, 20); // lo que construye pg
    const comoStringPg = "2026-09-20 00:00:00";
    const comoStringIso = "2026-09-20";
    expect(diasAtrasoMora(comoDate, HOY)).toBe(1);
    expect(diasAtrasoMora(comoStringPg, HOY)).toBe(1);
    expect(diasAtrasoMora(comoStringIso, HOY)).toBe(1);
    expect(isOverdueInstallmentForMora(cuotaViva(comoDate), HOY)).toBe(true);
    expect(isOverdueInstallmentForMora(cuotaViva(comoStringPg), HOY)).toBe(true);
    expect(isOverdueInstallmentForMora(cuotaViva(comoStringIso), HOY)).toBe(true);
  });

  it("la hora que traiga el Date no mueve el día", () => {
    expect(diasAtrasoMora(new Date(2026, 8, 20, 23, 59), HOY)).toBe(1);
    expect(diasAtrasoMora(new Date(2026, 8, 21, 23, 59), HOY)).toBe(0);
  });

  it("el conteo de días y el filtro de vencidas nunca se contradicen", () => {
    for (let i = -5; i <= 5; i++) {
      const fecha = new Date(2026, 8, 21 - i);
      const dias = diasAtrasoMora(fecha, HOY);
      const vencida = isOverdueInstallmentForMora(cuotaViva(fecha), HOY);
      // vencida ⇔ al menos un día de atraso.
      expect(vencida).toBe(dias > 0);
    }
  });
});

// Regresión de zona horaria. La zona del proceso se fija al arrancar, así que
// no se puede cambiar dentro del test: se lanza una sonda hija bajo TZ=UTC
// (producción) y bajo TZ=America/Guatemala (desarrollo) y se exige que den el
// MISMO resultado. Si alguno de los helpers vuelve a depender de la zona del
// proceso —p. ej. pasando la fecha de vencimiento por `toZonedTime`, que sirve
// para instantes y no para una fecha de calendario— las dos corridas divergen.
describe("invariancia de zona horaria (prod corre en UTC, dev en America/Guatemala)", () => {
  const SONDA = new URL("./moraProporcional.probe.ts", import.meta.url).pathname;

  const correrEn = (tz: string) => {
    const r = Bun.spawnSync({
      cmd: ["bun", "run", SONDA],
      env: {
        ...process.env,
        TZ: tz,
        // La sonda no ejecuta queries; la URL de mentira es solo para que el
        // import de ../database no reviente por variable faltante, y apunta a
        // localhost para que ni por accidente pueda salir a producción.
        SUPABASE_DB_URL: "postgres://nadie:nadie@localhost:1/no-existe",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const salida = r.stdout.toString().trim();
    if (r.exitCode !== 0 || !salida) {
      throw new Error(`sonda TZ=${tz} falló (exit ${r.exitCode}): ${r.stderr.toString()}`);
    }
    // La sonda escribe antes un log del módulo de base de datos: el JSON es la
    // ÚLTIMA línea.
    const lineas = salida.split("\n");
    return JSON.parse(lineas[lineas.length - 1]);
  };

  const enUTC = correrEn("UTC");
  const enGT = correrEn("America/Guatemala");

  it("la sonda devuelve resultados (no se cayó)", () => {
    expect(Object.keys(enUTC).length).toBeGreaterThan(0);
  });

  it("TZ=UTC y TZ=America/Guatemala dan EXACTAMENTE el mismo resultado", () => {
    expect(enUTC).toEqual(enGT);
  });

  it("caso por caso: mismos días y misma decisión de vencida en ambas zonas", () => {
    for (const nombre of Object.keys(enGT)) {
      expect({ nombre, ...enUTC[nombre] }).toEqual({ nombre, ...enGT[nombre] });
    }
  });

  it("en AMBAS zonas la cuota que vence hoy no cobra mora y la de ayer cobra 1 día", () => {
    for (const r of [enUTC, enGT]) {
      expect(r["iso vence hoy"]).toEqual({ dias: 0, vencida: false, cal: Date.UTC(2026, 8, 21) });
      expect(r["iso ayer"]).toEqual({ dias: 1, vencida: true, cal: Date.UTC(2026, 8, 20) });
      expect(r["literal pg vence hoy"].vencida).toBe(false);
      expect(r["Date local vence hoy"].vencida).toBe(false);
      expect(r["Date local ayer"].dias).toBe(1);
      expect(r["Date local a media tarde"].dias).toBe(1);
      // El string con zona explícita no sale de la base, pero es la forma que
      // SÍ se corría de día con `toZonedTime` en un proceso UTC.
      expect(r["string con zona ayer"]).toEqual({ dias: 1, vencida: true, cal: Date.UTC(2026, 8, 20) });
      expect(r["string con zona vence hoy"].vencida).toBe(false);
    }
  });
});

// Guard de cordura de montos MANUALES (createMora). Se extrajo a función pura
// porque el guard vive detrás de dos queries; lo que importa acá es la BASE del
// umbral: anclarlo a la fórmula proporcional lo encogía ~30× con 1 día de atraso.
describe("maximoMoraSinOverride — el guard no puede estrecharse con la mora proporcional", () => {
  const capital = 10_000;
  const cargoMensual = new Big(capital).times(TASA_MORA_MENSUAL); // Q112.00

  it("una mora manual por el CARGO MENSUAL completo con 1 día de atraso ya NO se rechaza", () => {
    // Con el umbral anclado a la proporcional (112 × 1/30 = Q3.73), el máximo
    // sin override caía a Q37.33 y Q112.00 se rechazaba.
    const maximo = maximoMoraSinOverride(capital, 1);
    expect(maximo.toFixed(2)).toBe("1120.00");
    expect(new Big(cargoMensual.toFixed(2)).gt(maximo)).toBe(false);
  });

  it("es 10× la cota superior (capital × 1.12% × cuotas vencidas)", () => {
    expect(maximoMoraSinOverride(capital, 1).toFixed(2)).toBe("1120.00");
    expect(maximoMoraSinOverride(capital, 3).toFixed(2)).toBe("3360.00");
  });

  it("no depende de los días de atraso: la cota superior es la fórmula de bloque completo", () => {
    // Misma cuota, 1 día o 300 días: el techo del guard es el mismo.
    expect(maximoMoraSinOverride(capital, 2).toFixed(2)).toBe(
      new Big(capital).times(TASA_MORA_MENSUAL).times(2).times(10).toFixed(2),
    );
  });

  it("sigue atrapando el absurdo histórico: Q27,953.44 sobre Q40k y 1 cuota", () => {
    const maximo = maximoMoraSinOverride(40_000, 1); // Q4,480.00
    expect(new Big(27_953.44).gt(maximo)).toBe(true);
  });

  it("la mora proporcional SIEMPRE cabe bajo el máximo (el guard nunca rechaza la fórmula)", () => {
    for (const dias of [[1], [15], [30], [90, 30, 10, 3], [400, 370, 340]]) {
      const propuesta = calcularMoraProporcional({ capital, diasAtrasadosPorCuota: dias });
      expect(propuesta.gt(maximoMoraSinOverride(capital, dias.length))).toBe(false);
    }
  });

  it("sin base creíble (capital 0 o cero cuotas vencidas) devuelve 0 → todo exige override", () => {
    expect(maximoMoraSinOverride(0, 3).toFixed(2)).toBe("0.00");
    expect(maximoMoraSinOverride(-100, 3).toFixed(2)).toBe("0.00");
    expect(maximoMoraSinOverride(capital, 0).toFixed(2)).toBe("0.00");
  });
});

// Romper un convenio es destructivo y SIN rollback: borra el convenio, pone el
// crédito MOROSO y recrea la mora. Si createMora rechaza, el crédito queda sin
// convenio, sin mora y nunca MOROSO — una ventana huérfana.
describe("decidirMoraTrasRomperConvenio — nunca deja el crédito en tierra de nadie", () => {
  it("con mora cobrable pide CREAR_MORA con el monto redondeado", () => {
    // 10,000 × 1.12% × 1 cuota topada = Q112.00
    const d = decidirMoraTrasRomperConvenio({ capital: 10_000, factorDias: 1, numCuotasAtrasadas: 1 });
    expect(d.accion).toBe("CREAR_MORA");
    expect(d.accion === "CREAR_MORA" && d.montoMora).toBe(112);
  });

  it("capital chico con 1 día de atraso: la mora redondea a Q0.00 → ACTIVAR, no createMora", () => {
    // 13 × 1.12% × 1/30 = Q0.00485 → redondea a 0. createMora lo rechazaría
    // ("Monto de mora debe ser mayor a 0") con el convenio ya destruido.
    const factor = new Big(1).div(30);
    const d = decidirMoraTrasRomperConvenio({ capital: 13, factorDias: factor, numCuotasAtrasadas: 1 });
    expect(d.accion).toBe("ACTIVAR");
    expect(d.accion === "ACTIVAR" && d.motivo).toContain("redondea a Q0.00");
  });

  it("el borde está en medio centavo: Q0.005 redondea hacia arriba y sí crea mora", () => {
    const factor = new Big(1).div(30);
    // 14 × 1.12% × 1/30 = 0.005226… → Q0.01
    const sube = decidirMoraTrasRomperConvenio({ capital: 14, factorDias: factor, numCuotasAtrasadas: 1 });
    expect(sube.accion).toBe("CREAR_MORA");
    expect(sube.accion === "CREAR_MORA" && sube.montoMora).toBe(0.01);
    // 13.39 × 1.12% × 1/30 = 0.004998… → Q0.00
    const baja = decidirMoraTrasRomperConvenio({ capital: 13.39, factorDias: factor, numCuotasAtrasadas: 1 });
    expect(baja.accion).toBe("ACTIVAR");
  });

  it("sin cuotas atrasadas → ACTIVAR (camino de siempre)", () => {
    const d = decidirMoraTrasRomperConvenio({ capital: 10_000, factorDias: 0, numCuotasAtrasadas: 0 });
    expect(d.accion).toBe("ACTIVAR");
    expect(d.accion === "ACTIVAR" && d.motivo).toBe("sin cuotas atrasadas");
  });

  it("capital nulo, 0 o negativo → ACTIVAR, nunca una mora sin base", () => {
    const factor = new Big(1);
    for (const capital of [null, 0, -500]) {
      const d = decidirMoraTrasRomperConvenio({ capital, factorDias: factor, numCuotasAtrasadas: 2 });
      expect(d.accion).toBe("ACTIVAR");
    }
  });

  it("el monto que propone SIEMPRE pasa el guard de createMora (no se autorechaza)", () => {
    for (const cuotas of [1, 3, 12]) {
      const d = decidirMoraTrasRomperConvenio({ capital: 10_000, factorDias: cuotas, numCuotasAtrasadas: cuotas });
      expect(d.accion).toBe("CREAR_MORA");
      if (d.accion !== "CREAR_MORA") continue;
      expect(d.montoMora).toBeGreaterThan(0);
      expect(new Big(d.montoMora).gt(maximoMoraSinOverride(10_000, cuotas))).toBe(false);
    }
  });
});

// El chequeo viejo (`Number.isFinite` sobre los slices) era un guard MUERTO:
// `Number("")` es 0, así que un string truncado no fallaba nunca y "2026-09"
// devolvía en silencio el 31-ago-2026 — un mes entero de atraso inventado.
describe("fechaCalendarioGT — entradas malformadas no pueden devolver una fecha", () => {
  it('"2026-09" (truncado) no devuelve el 31-ago: no devuelve fecha', () => {
    expect(fechaCalendarioGT("2026-09")).toBeNaN();
    expect(fechaCalendarioGT("2026-09")).not.toBe(Date.UTC(2026, 7, 31));
  });

  it("string vacío no devuelve fecha", () => {
    expect(fechaCalendarioGT("")).toBeNaN();
  });

  it("otras formas rotas tampoco pasan", () => {
    for (const basura of ["2026", "2026-9-1", "ayer", "20/09/2026", "  2026-09-20"]) {
      expect(fechaCalendarioGT(basura)).toBeNaN();
    }
  });

  it("una fecha inválida no se cuenta como cuota vencida ni suma días", () => {
    const hoy = hoyGuatemala(new Date("2026-09-21T15:00:00.000Z"));
    expect(diasAtrasoMora("2026-09", hoy)).toBeNaN();
    expect(
      isOverdueInstallmentForMora(
        { fecha_vencimiento: "2026-09", pagado: false, hasPaidPayment: false, statusCredit: "ACTIVO" },
        hoy,
      ),
    ).toBe(false);
  });

  it("las formas BUENAS siguen leyéndose igual (el guard no estrechó el contrato)", () => {
    expect(fechaCalendarioGT("2026-09-20")).toBe(Date.UTC(2026, 8, 20));
    expect(fechaCalendarioGT("2026-09-20 00:00:00")).toBe(Date.UTC(2026, 8, 20));
    expect(fechaCalendarioGT("2026-09-20T06:00:00.000Z")).toBe(Date.UTC(2026, 8, 20));
  });
});

// Decisión del paso 5 del cron. Existe como función pura por la misma razón que
// decidirMoraTrasRomperConvenio: la regla vive detrás de tres writes a la base.
describe("decidirMoraDelCron — el cron nunca escribe una mora activa de Q0.00", () => {
  it("capital chico con 1 día de atraso: DESACTIVAR, con su motivo propio", () => {
    const d = decidirMoraDelCron({ capital: 10, diasAtrasadosPorCuota: [1] });
    expect(d.accion).toBe("DESACTIVAR");
    expect(d.accion === "DESACTIVAR" && d.motivo).toBe("Mora proporcional menor a un centavo");
  });

  it("el motivo de capital cero es OTRO (el historial tiene que decir la verdad)", () => {
    const d = decidirMoraDelCron({ capital: 0, diasAtrasadosPorCuota: [45] });
    expect(d.accion).toBe("DESACTIVAR");
    expect(d.accion === "DESACTIVAR" && d.motivo).toBe("Crédito sin capital — no aplica mora");
  });

  it("capital nulo o negativo tampoco genera mora", () => {
    for (const capital of [null, -500]) {
      expect(decidirMoraDelCron({ capital, diasAtrasadosPorCuota: [30] }).accion).toBe("DESACTIVAR");
    }
  });

  it("mora cobrable: APLICAR con el monto ya redondeado que se guarda", () => {
    const d = decidirMoraDelCron({ capital: 10_000, diasAtrasadosPorCuota: [35, 5] });
    expect(d.accion).toBe("APLICAR");
    expect(d.accion === "APLICAR" && d.montoStr).toBe("130.67");
  });

  it("el monto de APLICAR SIEMPRE es > 0 (lo que createMora exige)", () => {
    for (const capital of [10, 13.39, 13.4, 14, 100, 10_000]) {
      for (const dias of [[1], [2], [15], [30], [95, 65, 35, 5]]) {
        const d = decidirMoraDelCron({ capital, diasAtrasadosPorCuota: dias });
        if (d.accion !== "APLICAR") continue;
        expect(Number(d.montoStr)).toBeGreaterThan(0);
      }
    }
  });

  it("coincide con decidirMoraTrasRomperConvenio en el borde del medio centavo", () => {
    // 13.39 × 1.12% × 1/30 = 0.004998… → Q0.00; 13.40 → Q0.005 → Q0.01.
    expect(decidirMoraDelCron({ capital: 13.39, diasAtrasadosPorCuota: [1] }).accion).toBe("DESACTIVAR");
    expect(decidirMoraDelCron({ capital: 13.4, diasAtrasadosPorCuota: [1] }).accion).toBe("APLICAR");
  });
});
