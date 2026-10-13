import { afterAll, expect } from "bun:test";
import {
  cerrarEsquemaBoletaTardia, condonarBT, integrationTest, levantarEsquemaBoletaTardia, uuidIntento, type Sql,
} from "./boletaTardiaTestDb";

afterAll(cerrarEsquemaBoletaTardia);
const barrido = async () => (await import("./barridoCondonacionesBoletaTardia"));
const envejecer = async (sql: Sql, intento: string, minutos: number) =>
  sql`UPDATE cartera.moras_condonaciones SET fecha = now() - make_interval(mins => ${minutos}) WHERE intento_id = ${intento}`;
const viva = async (sql: Sql, intento: string, credito?: number) =>
  ((await sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE intento_id = ${intento}
    AND (${credito ?? null}::int IS NULL OR credito_id = ${credito ?? null}) ORDER BY condonacion_id DESC`)[0] as { anulada_at: Date | null }).anulada_at === null;
const moraDe = async (sql: Sql, credito: number) =>
  ((await sql`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id = ${credito}`)[0] as { monto_mora: string }).monto_mora;
const filaViva = (sql: Sql, credito: number, intento: string, paymentFalse = false) =>
  sql`INSERT INTO cartera.pagos_credito (credito_id, validation_status, monto_aplicado, boleta_tardia_intento_id, "paymentFalse")
      VALUES (${credito}, 'pending', 500, ${intento}, ${paymentFalse})`;

integrationTest("anula la huérfana de más de 15 minutos: restituye la mora y compensa el ledger", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  const { barrerCondonacionesBoletaTardiaHuerfanas } = await barrido();
  await condonarBT(latefee, 30, uuidIntento(330));
  await envejecer(sql, uuidIntento(330), 20);
  const r = await barrerCondonacionesBoletaTardiaHuerfanas();
  expect(r.anuladas).toBeGreaterThanOrEqual(1);
  expect(await viva(sql, uuidIntento(330))).toBe(false);
  expect(await moraDe(sql, 30)).toBe("119.47");
  const tipos = await sql`SELECT tipo FROM cartera.mora_pagada_cuota WHERE credito_id = 30 ORDER BY id`;
  expect(tipos.map((t) => t.tipo)).toEqual(["CONDONACION", "ANULACION"]);
  expect((await barrerCondonacionesBoletaTardiaHuerfanas()).anuladas).toBe(0); // segunda corrida: nada
});

integrationTest("no toca: la de menos de 15 minutos, la que tiene filas vivas, las de Nexa ni las ya anuladas", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  const { barrerCondonacionesBoletaTardiaHuerfanas } = await barrido();
  await condonarBT(latefee, 31, uuidIntento(331)); // joven
  await condonarBT(latefee, 32, uuidIntento(332)); // con fila viva
  await envejecer(sql, uuidIntento(332), 60);
  await filaViva(sql, 32, uuidIntento(332));
  await latefee.condonarMoraDeCuotas({ credito_id: 33, montoMoraEsperado: "119.47", monto: "7.47", cuotas: [{ cuota_id: 335, monto: "7.466667" }], nexa_payment_event_id: 3301, motivo: "NEXA_ACH_A_TIEMPO" });
  await sql`UPDATE cartera.moras_condonaciones SET fecha = now() - interval '5 hours' WHERE nexa_payment_event_id = 3301`;
  await condonarBT(latefee, 34, uuidIntento(334));
  await latefee.anularCondonacionBoletaTardia({ intento_id: uuidIntento(334), credito_id: 34, motivo: "ya anulada" });
  await envejecer(sql, uuidIntento(334), 60);

  await barrerCondonacionesBoletaTardiaHuerfanas();
  expect(await viva(sql, uuidIntento(331))).toBe(true);
  expect(await viva(sql, uuidIntento(332))).toBe(true);
  const [nexa] = await sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE nexa_payment_event_id = 3301`;
  expect(nexa!.anulada_at).toBeNull();
  expect(await moraDe(sql, 34)).toBe("119.47"); // no se restituyó dos veces
});

integrationTest("E-10: la de más de 24 horas NO se toca (solo se cuenta/loguea)", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  const { barrerCondonacionesBoletaTardiaHuerfanas } = await barrido();
  await condonarBT(latefee, 29, uuidIntento(329));
  await envejecer(sql, uuidIntento(329), 25 * 60);
  await condonarBT(latefee, 28, uuidIntento(328));
  await envejecer(sql, uuidIntento(328), 23 * 60);
  await barrerCondonacionesBoletaTardiaHuerfanas();
  expect(await viva(sql, uuidIntento(329))).toBe(true);
  expect(await moraDe(sql, 29)).toBe("112.00");
  expect(await viva(sql, uuidIntento(328))).toBe(false); // la de 23 h sí
});

integrationTest("las filas ANULADAS (paymentFalse) no cuentan como pago vivo: la condonación sin pago vivo se barre", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  const { barrerCondonacionesBoletaTardiaHuerfanas } = await barrido();
  await condonarBT(latefee, 35, uuidIntento(335));
  await envejecer(sql, uuidIntento(335), 60);
  await filaViva(sql, 35, uuidIntento(335), true);
  await barrerCondonacionesBoletaTardiaHuerfanas();
  expect(await viva(sql, uuidIntento(335))).toBe(false);
});

integrationTest("E-12: intento usado en A con filas vivas y reusado en B sin filas: el barrido anula la de B", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  const { barrerCondonacionesBoletaTardiaHuerfanas } = await barrido();
  const x = uuidIntento(327);
  await condonarBT(latefee, 26, x);
  await filaViva(sql, 26, x);
  await latefee.anularCondonacionBoletaTardia({ intento_id: x, credito_id: 26, motivo: "pago de A invalidado" });
  await condonarBT(latefee, 27, x); // reuso en B, sin filas
  await envejecer(sql, x, 60);
  await barrerCondonacionesBoletaTardiaHuerfanas();
  expect(await viva(sql, x, 27)).toBe(false);
  expect(await moraDe(sql, 27)).toBe("119.47");
});

integrationTest("la ausencia de filas se RE-VERIFICA bajo el lock: si /newPayment escribe entre la lectura y el lock, se omite", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  const { barrerCondonacionesBoletaTardiaHuerfanas, depsBarridoReales } = await barrido();
  await condonarBT(latefee, 36, uuidIntento(336));
  await envejecer(sql, uuidIntento(336), 60);
  const reales = depsBarridoReales();
  const resultado = await barrerCondonacionesBoletaTardiaHuerfanas({
    ...reales,
    candidatas: async () => (await reales.candidatas()).filter((c) => c.credito_id === 36),
    conLock: ((id: number, fn: never) => filaViva(sql, 36, uuidIntento(336)).then(() => reales.conLock(id, fn))) as never,
  });
  expect(resultado).toMatchObject({ revisadas: 1, anuladas: 0, omitidas: 1 });
  expect(await viva(sql, uuidIntento(336))).toBe(true);
  expect(await moraDe(sql, 36)).toBe("112.00");
});

integrationTest("F1: con el lock de A ocupado el barrido NO espera: anula B, omite A por lock y termina rápido", async () => {
  const { sql, latefee, lock } = await levantarEsquemaBoletaTardia();
  const { barrerCondonacionesBoletaTardiaHuerfanas, depsBarridoReales } = await barrido();
  await condonarBT(latefee, 24, uuidIntento(324));
  await condonarBT(latefee, 25, uuidIntento(325));
  await envejecer(sql, uuidIntento(324), 60);
  await envejecer(sql, uuidIntento(325), 60);
  const reales = depsBarridoReales();
  const t0 = Date.now();
  const r = await lock.withPaymentAdvisoryLock(24, () => barrerCondonacionesBoletaTardiaHuerfanas({
    ...reales,
    candidatas: async () => (await reales.candidatas()).filter((c) => [24, 25].includes(c.credito_id)),
  }));
  expect(Date.now() - t0).toBeLessThan(3000);
  expect(r).toMatchObject({ anuladas: 1, omitidas_por_lock: 1, fallidas: 0 });
  expect(await viva(sql, uuidIntento(324))).toBe(true);
  expect(await viva(sql, uuidIntento(325))).toBe(false);
});

integrationTest("F1: una corrida que arranca mientras otra sigue sale sin hacer nada", async () => {
  await levantarEsquemaBoletaTardia();
  const { barrerCondonacionesBoletaTardiaHuerfanas, depsBarridoReales } = await barrido();
  let soltar!: () => void;
  const lenta = barrerCondonacionesBoletaTardiaHuerfanas({
    ...depsBarridoReales(),
    candidatas: () => new Promise((r) => { soltar = () => r([]); }),
  });
  const segunda = await barrerCondonacionesBoletaTardiaHuerfanas();
  expect(segunda).toMatchObject({ solapada: true, revisadas: 0 });
  soltar();
  expect((await lenta).solapada).toBe(false);
  expect((await barrerCondonacionesBoletaTardiaHuerfanas()).solapada).toBe(false); // la bandera se libera
});

integrationTest("F1: tryWithPaymentAdvisoryLock no espera, y libera el lock aunque la función lance", async () => {
  const { lock } = await levantarEsquemaBoletaTardia();
  await expect(lock.tryWithPaymentAdvisoryLock(23, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  const otra = await lock.tryWithPaymentAdvisoryLock(23, async () => "ok"); // quedó libre
  expect(otra).toEqual({ adquirido: true, valor: "ok" });
  const ocupado = await lock.withPaymentAdvisoryLock(23, () => lock.tryWithPaymentAdvisoryLock(23, async () => "x"));
  expect(ocupado).toEqual({ adquirido: false });
});

integrationTest("F2: filas vivas SIN marca creadas después de la condonación: no se anula, queda para revisión manual", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  const { barrerCondonacionesBoletaTardiaHuerfanas, depsBarridoReales } = await barrido();
  await condonarBT(latefee, 22, uuidIntento(322));
  await envejecer(sql, uuidIntento(322), 60);
  await sql`INSERT INTO cartera.pagos_credito (credito_id, validation_status, monto_aplicado, createdat) VALUES (22, 'pending', 500, now())`;
  await condonarBT(latefee, 21, uuidIntento(321));
  await envejecer(sql, uuidIntento(321), 60);
  await sql`INSERT INTO cartera.pagos_credito (credito_id, validation_status, monto_aplicado, createdat) VALUES (21, 'pending', 500, now() - interval '3 hours')`; // anterior: no cuenta
  const reales = depsBarridoReales();
  const warns: string[] = [];
  const w = console.warn; console.warn = (m: string) => { warns.push(String(m)); };
  let r;
  try {
    r = await barrerCondonacionesBoletaTardiaHuerfanas({ ...reales, candidatas: async () => (await reales.candidatas()).filter((c) => [21, 22].includes(c.credito_id)) });
  } finally { console.warn = w; }
  expect(r).toMatchObject({ revision_manual: 1, revision_manual_repetida: 1, revision_manual_nueva: 0, anuladas: 1 });
  expect(await viva(sql, uuidIntento(322))).toBe(true);
  expect(await viva(sql, uuidIntento(321))).toBe(false);
  expect(warns.some((m) => m.includes("condonacion_huerfana_revision_manual") && m.includes("322"))).toBe(true);
});

integrationTest("F3: la abandonada se avisa UNA vez (franja 24 h a 24 h 15 min) y cuenta en abandonadas_nuevas", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  const { barrerCondonacionesBoletaTardiaHuerfanas, depsBarridoReales } = await barrido();
  await condonarBT(latefee, 19, uuidIntento(319));
  await envejecer(sql, uuidIntento(319), 24 * 60 + 5); // en la franja
  await condonarBT(latefee, 20, uuidIntento(320));
  await envejecer(sql, uuidIntento(320), 30 * 60); // ya pasó la franja
  const reales = depsBarridoReales();
  const warns: string[] = [];
  const w = console.warn; console.warn = (m: string) => { warns.push(String(m)); };
  let r;
  try {
    r = await barrerCondonacionesBoletaTardiaHuerfanas({ ...reales, abandonadas: async () => (await reales.abandonadas()).filter((c) => [19, 20].includes(c.credito_id)) });
  } finally { console.warn = w; }
  expect(r!.abandonadas_nuevas).toBe(1);
  const avisos = warns.filter((m) => m.includes("condonacion_huerfana_abandonada"));
  expect(avisos).toHaveLength(1);
  expect(avisos[0]).toContain("319");
  expect(await viva(sql, uuidIntento(319))).toBe(true);
  expect(await viva(sql, uuidIntento(320))).toBe(true);
});

integrationTest("F4: la anulada que no restituyó usa el evento _sin_restituir", async () => {
  await levantarEsquemaBoletaTardia();
  const { barrerCondonacionesBoletaTardiaHuerfanas, depsBarridoReales } = await barrido();
  const warns: string[] = [];
  const w = console.warn; console.warn = (m: string) => { warns.push(String(m)); };
  try {
    await barrerCondonacionesBoletaTardiaHuerfanas({
      ...depsBarridoReales(),
      candidatas: async () => [{ condonacion_id: 1, credito_id: 1, intento_id: uuidIntento(1) }],
      abandonadas: async () => [],
      sinFilasVivas: async () => true,
      filasSinMarca: async () => false,
      anular: (async () => ({ anulada: true, monto: "7.47", restituida: false })) as never,
    });
  } finally { console.warn = w; }
  expect(warns.some((m) => m.includes("condonacion_huerfana_anulada_sin_restituir"))).toBe(true);
});

integrationTest("un fallo en una candidata no detiene a las demás y se cuenta", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  const { barrerCondonacionesBoletaTardiaHuerfanas, depsBarridoReales } = await barrido();
  await condonarBT(latefee, 37, uuidIntento(337));
  await condonarBT(latefee, 38, uuidIntento(338));
  await envejecer(sql, uuidIntento(337), 60);
  await envejecer(sql, uuidIntento(338), 60);
  const reales = depsBarridoReales();
  const r = await barrerCondonacionesBoletaTardiaHuerfanas({
    ...reales,
    candidatas: async () => (await reales.candidatas()).filter((c) => [37, 38].includes(c.credito_id)),
    anular: (async (p: { condonacion_id: number }) => {
      const [c] = await sql`SELECT credito_id FROM cartera.moras_condonaciones WHERE condonacion_id = ${p.condonacion_id}`;
      if (c!.credito_id === 37) throw new Error("falla simulada");
      return latefee.anularCondonacionBoletaTardia(p as never);
    }) as never,
  });
  expect(r).toMatchObject({ revisadas: 2, anuladas: 1, fallidas: 1 });
  expect(await viva(sql, uuidIntento(337))).toBe(true);
  expect(await viva(sql, uuidIntento(338))).toBe(false);
});

integrationTest("FF2: primera_vez solo en la primera franja de 15 min tras el umbral; la repetida no", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  const { depsBarridoReales } = await barrido();
  await condonarBT(latefee, 39, uuidIntento(339));
  await envejecer(sql, uuidIntento(339), 20);
  await condonarBT(latefee, 40, uuidIntento(340));
  await envejecer(sql, uuidIntento(340), 45);
  const c = (await depsBarridoReales().candidatas()).filter((x) => [39, 40].includes(x.credito_id));
  expect(Object.fromEntries(c.map((x) => [x.credito_id, x.primera_vez]))).toEqual({ 39: true, 40: false });
});
