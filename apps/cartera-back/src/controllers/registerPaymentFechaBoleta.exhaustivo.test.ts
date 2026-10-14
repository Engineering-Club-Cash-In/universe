import "../utils/baseFalsaParaPruebas";
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { db, lockPool } from "../database";
import { insertPayment } from "./registerPayment";
import { camposObligatoriosCondonacion } from "./registerPaymentPolicy";
import { validarFechaBoleta } from "../utils/fechaCalendarioGT";
process.env.URL_PUBLIC_R2 = "https://pub-test.r2.dev/payments-receipts/"; // la condonación exige que la boleta sea una llave del bucket

/**
 * Caja negra de 6.a. Reloj: `setSystemTime` (no es mock.module). Base: falsa; los contadores
 * sobre `lockPool.connect` y los métodos de `db` prueban que un 400 por fecha no toca nada.
 */

// 2026-10-13 12:00 GT (18:00 UTC)
const MEDIODIA_GT = new Date("2026-10-13T18:00:00Z");
// 23:30 GT del 13-oct = 05:30 UTC del 14-oct
const NOCHE_GT = new Date("2026-10-14T05:30:00Z");
const SENTINELA = "SENTINELA_LOCK";

const bodyBase = (extra: Record<string, unknown> = {}) => ({
  credito_id: 7,
  usuario_id: 5,
  monto_boleta: "100.00",
  fecha_pago: "2026-10-13",
  cuotaApagar: 1,
  url_boletas: [] as string[],
  registerBy: "asesor@x.com",
  fecha_boleta: "2026-10-13",
  ...extra,
});

let lockConnects = 0;
let escrituras: string[] = [];
const originales: Record<string, any> = {};

beforeEach(() => {
  lockConnects = 0;
  escrituras = [];
  originales.connect = (lockPool as any).connect;
  (lockPool as any).connect = async () => {
    lockConnects++;
    throw new Error(SENTINELA);
  };
  for (const m of ["insert", "update", "delete", "transaction", "execute", "select"]) {
    originales[m] = (db as any)[m];
    (db as any)[m] = (...a: unknown[]) => {
      escrituras.push(m);
      throw new Error(`db.${m} no debía llamarse`);
    };
  }
  setSystemTime(MEDIODIA_GT);
});

afterEach(() => {
  setSystemTime();
  (lockPool as any).connect = originales.connect;
  for (const m of ["insert", "update", "delete", "transaction", "execute", "select"]) (db as any)[m] = originales[m];
});

const llamar = async (body: unknown, opts: Parameters<typeof insertPayment>[1] = {}) => {
  const set: { status?: number } = {};
  const res: any = await insertPayment({ body, set }, opts);
  return { res, set };
};

const esRechazoDeFecha = ({ res, set }: { res: any; set: { status?: number } }) => {
  expect(set.status).toBe(400);
  expect(res.success).toBe(false);
  expect(Object.keys(res.errors)).toEqual(["fecha_boleta"]);
  expect(res.errors.fecha_boleta.length).toBeGreaterThan(0);
  expect(lockConnects).toBe(0);
  expect(escrituras).toEqual([]);
};

// Llegó más allá de la validación de fecha: intentó tomar el lock (la base falsa lo corta con la sentinela).
const llegoAlLock = ({ res, set }: { res: any; set: { status?: number } }) => {
  expect(lockConnects).toBe(1);
  expect(set.status).toBe(500);
  expect(res.error).toBe(SENTINELA);
};

describe("insertPayment: fechas válidas pasan la validación", () => {
  for (const [nombre, f] of [
    ["hoy GT", "2026-10-13"],
    ["ayer", "2026-10-12"],
    ["1 de enero", "2026-01-01"],
    ["29-feb bisiesto", "2024-02-29"],
  ] as const) {
    test(nombre, async () => {
      llegoAlLock(await llamar(bodyBase({ fecha_boleta: f })));
    });
  }
});

describe("insertPayment: fechas inválidas -> 400 sin tocar nada", () => {
  const casos: [string, unknown][] = [
    ["vacía", ""],
    ["undefined (ausente)", undefined],
    ["null", null],
    ["mes sin cero", "2026-9-30"],
    ["dd/mm/yyyy", "30/09/2026"],
    ["30-feb", "2026-02-30"],
    ["29-feb no bisiesto", "2026-02-29"],
    ["mes 13", "2026-13-01"],
    ["mes 00", "2026-00-10"],
    ["día 00", "2026-10-00"],
    ["ISO con hora", "2026-10-13T00:00:00Z"],
    ["con espacios", " 2026-10-13 "],
    ["con espacio y hora", "2026-10-13 00:00:00"],
    ["número", 20261013],
    ["objeto", { a: 1 }],
    ["arreglo", ["2026-10-13"]],
    ["basura", "basura"],
    ["año de 5 dígitos", "20260-10-13"],
  ];
  for (const [nombre, f] of casos) {
    test(nombre, async () => {
      const body: Record<string, unknown> = bodyBase();
      if (f === undefined) delete body.fecha_boleta;
      else body.fecha_boleta = f;
      esRechazoDeFecha(await llamar(body));
    });
  }
});

describe("insertPayment: futura contra hoyGuatemala (nunca UTC)", () => {
  test("mañana GT es futura", async () => {
    esRechazoDeFecha(await llamar(bodyBase({ fecha_boleta: "2026-10-14" })));
  });
  test("un año adelante es futura", async () => {
    esRechazoDeFecha(await llamar(bodyBase({ fecha_boleta: "2027-10-13" })));
  });
  test("borde de huso 23:30 GT (05:30 UTC del día siguiente): la fecha GT de hoy NO es futura", async () => {
    setSystemTime(NOCHE_GT);
    llegoAlLock(await llamar(bodyBase({ fecha_boleta: "2026-10-13" })));
  });
  test("borde de huso 23:30 GT: el día UTC (14) SÍ es futuro para Guatemala", async () => {
    setSystemTime(NOCHE_GT);
    esRechazoDeFecha(await llamar(bodyBase({ fecha_boleta: "2026-10-14" })));
  });
  test("00:30 GT del 14 (06:30 UTC): el 14 ya es hoy, el 15 es futuro", async () => {
    setSystemTime(new Date("2026-10-14T06:30:00Z"));
    llegoAlLock(await llamar(bodyBase({ fecha_boleta: "2026-10-14" })));
    lockConnects = 0;
    esRechazoDeFecha(await llamar(bodyBase({ fecha_boleta: "2026-10-15" })));
  });
});

describe("insertPayment: Nexa no se valida con esta regla", () => {
  test("Nexa con fecha_boleta futura (válida para z.string().date()) no recibe el 400 de fecha", async () => {
    const body = bodyBase({
      registerBy: "NEXA",
      fecha_pago: "2026-10-13T10:00:00Z",
      fecha_boleta: "2026-10-20",
    });
    llegoAlLock(await llamar(body, { nexaPaymentEventId: 99 }));
  });
  test("Nexa con fecha_boleta mal formada sigue rechazada por SU schema (400 en fecha_boleta)", async () => {
    const body = bodyBase({ registerBy: "NEXA", fecha_pago: "2026-10-13T10:00:00Z", fecha_boleta: "2026-9-30" });
    const r = await llamar(body, { nexaPaymentEventId: 99 });
    expect(r.set.status).toBe(400);
    expect(Object.keys(r.res.errors)).toEqual(["fecha_boleta"]);
    expect(lockConnects).toBe(0);
  });
  test("pago manual con la misma fecha futura SÍ se rechaza", async () => {
    esRechazoDeFecha(await llamar(bodyBase({ fecha_boleta: "2026-10-20" })));
  });
});

describe("validarFechaBoleta (util, mensajes en español)", () => {
  const msgs = (f: unknown) => validarFechaBoleta(f, "2026-10-13");
  test("válidas -> null", () => {
    for (const f of ["2026-10-13", "2026-10-12", "2026-01-01", "2024-02-29", "1999-12-31"]) expect(msgs(f)).toBeNull();
  });
  test("formato", () => {
    for (const f of ["", undefined, null, "2026-9-30", "30/09/2026", "2026-10-13T00:00:00Z", " 2026-10-13", 20261013, {}, []]) {
      expect(msgs(f)).toBe("fecha_boleta debe tener formato YYYY-MM-DD");
    }
  });
  test("imposibles", () => {
    for (const f of ["2026-02-30", "2026-13-01", "2026-00-10", "2026-02-29", "2026-10-00", "2026-04-31"]) {
      expect(msgs(f)).toBe("fecha_boleta no es una fecha real");
    }
  });
  test("futura por un día y por mucho", () => {
    expect(msgs("2026-10-14")).toBe("fecha_boleta es futura");
    expect(msgs("9999-12-31")).toBe("fecha_boleta es futura");
  });
});

describe("camposObligatoriosCondonacion", () => {
  const MSG = (c: string) => [`${c} es obligatorio para condonar por boleta tardía`];
  const ok = { url_boletas: ["00000000-0000-4000-8000-000000000001.jpg"], numeroAutorizacion: "A-1", banco_id: 3 };
  const U = { url_boletas: MSG("url_boletas") };
  const N = { numeroAutorizacion: MSG("numeroAutorizacion") };
  const B = { banco_id: MSG("banco_id") };

  test("completo", () => expect(camposObligatoriosCondonacion(ok)).toEqual({}));

  // Las 8 combinaciones faltante/presente
  const combos: [string, any, Record<string, string[]>][] = [
    ["falta url", { ...ok, url_boletas: [] }, U],
    ["falta numero", { ...ok, numeroAutorizacion: undefined }, N],
    ["falta banco", { ...ok, banco_id: undefined }, B],
    ["faltan url+numero", { ...ok, url_boletas: [], numeroAutorizacion: undefined }, { ...U, ...N }],
    ["faltan url+banco", { ...ok, url_boletas: [], banco_id: undefined }, { ...U, ...B }],
    ["faltan numero+banco", { ...ok, numeroAutorizacion: undefined, banco_id: undefined }, { ...N, ...B }],
    ["faltan los tres", { url_boletas: [] }, { ...U, ...N, ...B }],
  ];
  for (const [nombre, p, esperado] of combos) test(nombre, () => expect(camposObligatoriosCondonacion(p)).toEqual(esperado));

  for (const v of ["", "   ", "\t", "\n", " \t\n "]) {
    test(`numeroAutorizacion en blanco ${JSON.stringify(v)} no cuenta`, () => {
      expect(camposObligatoriosCondonacion({ ...ok, numeroAutorizacion: v })).toEqual(N);
    });
  }
  test("banco_id 0 no cuenta", () => expect(camposObligatoriosCondonacion({ ...ok, banco_id: 0 })).toEqual(B));
  test("banco_id null (cruzado desde JSON) no cuenta", () =>
    expect(camposObligatoriosCondonacion({ ...ok, banco_id: null as any })).toEqual(B));
  test("numeroAutorizacion null no cuenta", () =>
    expect(camposObligatoriosCondonacion({ ...ok, numeroAutorizacion: null as any })).toEqual(N));
  test("varias boletas cuentan", () =>
    expect(camposObligatoriosCondonacion({ ...ok, url_boletas: ["00000000-0000-4000-8000-000000000001.jpg", "00000000-0000-4000-8000-000000000002.pdf"] })).toEqual({}));
  // Ruling F2: debe haber al menos una url no vacía tras trim.
  test("url_boletas [''] o ['  '] cuenta como ausente", () => {
    expect(camposObligatoriosCondonacion({ ...ok, url_boletas: [""] })).toEqual(U);
    expect(camposObligatoriosCondonacion({ ...ok, url_boletas: ["  "] })).toEqual(U);
    expect(camposObligatoriosCondonacion({ ...ok, url_boletas: ["", "00000000-0000-4000-8000-000000000001.jpg"] })).toEqual({ url_boletas: expect.any(Array) });
  });
  test("numeroAutorizacion con espacios alrededor y contenido sí cuenta", () =>
    expect(camposObligatoriosCondonacion({ ...ok, numeroAutorizacion: "  A-1 " })).toEqual({}));
  test("no muta la entrada", () => {
    const p = { url_boletas: [] as string[], numeroAutorizacion: " ", banco_id: 0 };
    const copia = JSON.stringify(p);
    camposObligatoriosCondonacion(p);
    expect(JSON.stringify(p)).toBe(copia);
  });
});
