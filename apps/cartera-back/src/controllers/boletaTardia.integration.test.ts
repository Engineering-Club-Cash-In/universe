import { afterAll, expect } from "bun:test";
import {
  EMAIL_ASESOR, cerrarEsquemaBoletaTardia, condonarBT, integrationTest, levantarEsquemaBoletaTardia, uuidIntento, type Sql,
} from "./boletaTardiaTestDb";
import type { DepsBoletaTardia } from "./boletaTardia";
process.env.URL_PUBLIC_R2 = "https://pub-test.r2.dev/payments-receipts/"; // la condonación exige que la boleta sea una llave del bucket

afterAll(cerrarEsquemaBoletaTardia);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const terminaAntesDe = async <T>(p: Promise<T>, ms = 5_000) =>
  Promise.race([p.then(() => "termino" as const), sleep(ms).then(() => "colgado" as const)]);

const cuerpo = (credito: number, intento: string, montoAceptado = "7.47", extra: Record<string, unknown> = {}) => ({
  credito_id: credito, usuario_id: 1, monto_boleta: 1000, fecha_pago: "2026-10-03", cuotaApagar: 5, url_boletas: ["00000000-0000-4000-8000-000000000001.jpg"],
  banco_id: 1, numeroAutorizacion: `A-${intento.slice(-4)}`, registerBy: EMAIL_ASESOR, fecha_boleta: "2026-09-30",
  origen_pago: "boleta", condonacionBoletaTardia: { intentoId: intento, montoAceptado }, ...extra,
});

/** Decisión "aplica 7.47" leyendo la mora REAL (como la leería el cálculo de verdad). */
const decidirDesdeBd = (sql: Sql, opciones: { alLeer?: () => Promise<void>; aplica?: boolean } = {}): DepsBoletaTardia["decidir"] =>
  async (entrada) => {
    const [m] = await sql`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id = ${entrada.credito_id} AND activa`;
    await opciones.alLeer?.();
    const aplica = opciones.aplica ?? true;
    return {
      aplica, razon: aplica ? null : "no_queda_al_dia", fechaVencimiento: "2026-09-30", fechaBoleta: entrada.fecha_boleta, fechaRegistro: "2026-10-03",
      diasRetraso: 3, montoCondonar: aplica ? "7.47" : "0.00", moraACobrar: "112.00",
      porCuota: aplica ? [{ cuota_id: entrada.credito_id * 10 + 5, numero_cuota: 5, fecha_vencimiento: "2026-09-30", monto: "7.466667" }] : [],
      moraActiva: m ? String(m.monto_mora) : null,
    };
  };

type Escritura = { filas?: number; status?: number; respuesta?: object; lanza?: Error };
type Llamadas = { n: number; bodies: any[] };
/** insertPayment falso: exige el lock en mano, escribe N filas marcadas con el intento y responde como se le pida. */
const insertFalso = async (sql: Sql, o: Escritura = {}, llamadas: Llamadas = { n: 0, bodies: [] }): Promise<DepsBoletaTardia["insertPayment"]> => {
  const { holdsPaymentAdvisoryLock } = await import("../utils/paymentAdvisoryLock");
  return (async ({ body, set }: any, opts: any) => {
    llamadas.n++;
    llamadas.bodies.push(body);
    expect(holdsPaymentAdvisoryLock(opts?.paymentLock, body.credito_id)).toBe(true); // sin paymentLock se colgaría
    for (let i = 0; i < (o.filas ?? 2); i++) {
      await sql`INSERT INTO cartera.pagos_credito (credito_id, validation_status, monto_aplicado, boleta_tardia_intento_id)
        VALUES (${body.credito_id}, 'pending', 500, ${opts.boletaTardiaIntentoId})`;
    }
    if (o.lanza) throw o.lanza;
    if (o.status) set.status = o.status;
    return o.respuesta ?? { success: true, message: "Pago realizado exitosamente" };
  }) as never;
};

const correr = async (deps: DepsBoletaTardia, credito: number, intento: string, montoAceptado?: string, extra?: Record<string, unknown>, email = EMAIL_ASESOR) => {
  const { registrarPagoConBoletaTardia } = await import("./boletaTardia");
  const set: { status?: number } = {};
  const r = await registrarPagoConBoletaTardia({ body: cuerpo(credito, intento, montoAceptado, extra), set }, { usuarioEmail: email }, deps) as any;
  return { r, status: set.status };
};
const estado = async (sql: Sql, credito: number) => {
  const [mora] = await sql`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id = ${credito}`;
  const conds = await sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE credito_id = ${credito} ORDER BY condonacion_id`;
  const [{ filas }] = await sql`SELECT count(*)::int AS filas FROM cartera.pagos_credito WHERE credito_id = ${credito} AND "paymentFalse" = false`;
  const tipos = await sql`SELECT tipo FROM cartera.mora_pagada_cuota WHERE credito_id = ${credito} ORDER BY id`;
  return { mora: mora!.monto_mora as string, condonaciones: conds.length, vivas: conds.filter((c) => c.anulada_at === null).length, filas: filas as number, ledger: tipos.map((t) => t.tipo as string) };
};
const armar = async (sql: Sql, o: Escritura = {}, d: Partial<DepsBoletaTardia> = {}): Promise<DepsBoletaTardia> => {
  const { depsReales } = await import("./boletaTardia");
  return { ...depsReales(), decidir: decidirDesdeBd(sql), insertPayment: await insertFalso(sql, o), evaluarAlDia: (async () => ({ desactivarMora: true })) as never, verificarFoto: async () => null, ...d };
};

integrationTest("camino feliz: condona, registra con el lock en mano (no se cuelga) y deja la condonación vigente", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const deps = await armar(sql);
  const corrida = correr(deps, 1, uuidIntento(101));
  expect(await terminaAntesDe(corrida)).toBe("termino");
  const { r } = await corrida;
  expect(r.success).toBe(true);
  expect(r.condonacionBoletaTardia).toMatchObject({ monto: "7.47", estado: "vigente" });
  expect(await estado(sql, 1)).toEqual({ mora: "112.00", condonaciones: 1, vivas: 1, filas: 2, ledger: ["CONDONACION"] });
});

integrationTest("a) doble clic secuencial con el mismo intento: un solo pago, respuesta idempotente", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const llamadas = { n: 0, bodies: [] };
  const deps = await armar(sql, {}, { insertPayment: await insertFalso(sql, {}, llamadas) });
  await correr(deps, 2, uuidIntento(102));
  const segundo = await correr(deps, 2, uuidIntento(102));
  expect(segundo.r).toMatchObject({ success: true, idempotent: true, message: "El pago ya estaba registrado" });
  expect(segundo.r.pago_ids).toHaveLength(2);
  expect(segundo.r.condonacionBoletaTardia).toMatchObject({ monto: "7.47", estado: "vigente" });
  expect(llamadas.n).toBe(1);
  expect((await estado(sql, 2)).filas).toBe(2);
});

integrationTest("c) doble clic CONCURRENTE: el lock serializa, uno registra y el otro ve las filas", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const llamadas = { n: 0, bodies: [] };
  const deps = await armar(sql, {}, { insertPayment: await insertFalso(sql, {}, llamadas) });
  const trabajo = Promise.all([correr(deps, 3, uuidIntento(103)), correr(deps, 3, uuidIntento(103))]);
  expect(await terminaAntesDe(trabajo)).toBe("termino");
  const [a, b] = await trabajo;
  expect([a.r.idempotent === true, b.r.idempotent === true].sort()).toEqual([false, true]);
  expect(llamadas.n).toBe(1);
  expect(await estado(sql, 3)).toMatchObject({ vivas: 1, filas: 2, mora: "112.00" });
});

integrationTest("e) el registro falla SIN filas (freno de boleta duplicada, 409): la condonación se anula y la mora vuelve", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const deps = await armar(sql, { filas: 0, status: 409, respuesta: { success: false, message: "Una o más boletas ya fueron registradas previamente" } });
  const { r, status } = await correr(deps, 4, uuidIntento(104));
  expect(status).toBe(409);
  expect(r.message).toContain("ya fueron registradas");
  expect(await estado(sql, 4)).toEqual({ mora: "119.47", condonaciones: 1, vivas: 0, filas: 0, ledger: ["CONDONACION", "ANULACION"] });
});

integrationTest("f) respuesta de error CON filas escritas (RubroError: 'la boleta SÍ quedó registrada'): la condonación se mantiene", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const deps = await armar(sql, { filas: 2, status: 409, respuesta: { success: false, message: "la boleta SÍ quedó registrada" } });
  const { r, status } = await correr(deps, 5, uuidIntento(105));
  expect(status).toBe(409);
  expect(r.success).toBe(false);
  expect(r.condonacionBoletaTardia).toMatchObject({ estado: "vigente" });
  expect(await estado(sql, 5)).toEqual({ mora: "112.00", condonaciones: 1, vivas: 1, filas: 2, ledger: ["CONDONACION"] });
});

integrationTest("f2) una sola fila escrita (solo la fila especial) también cuenta como pago registrado", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  await correr(await armar(sql, { filas: 1 }), 6, uuidIntento(106));
  expect(await estado(sql, 6)).toMatchObject({ vivas: 1, filas: 1, mora: "112.00" });
});

integrationTest("g) insertPayment LANZA sin filas: se anula y se relanza el mismo error", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const deps = await armar(sql, { filas: 0, lanza: new Error("db blip") });
  await expect(correr(deps, 7, uuidIntento(107))).rejects.toThrow("db blip");
  expect(await estado(sql, 7)).toEqual({ mora: "119.47", condonaciones: 1, vivas: 0, filas: 0, ledger: ["CONDONACION", "ANULACION"] });
});

integrationTest("g2) insertPayment LANZA después de escribir filas: la condonación se mantiene y se relanza", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const deps = await armar(sql, { filas: 2, lanza: new Error("se cayó al final") });
  await expect(correr(deps, 8, uuidIntento(108))).rejects.toThrow("se cayó al final");
  expect(await estado(sql, 8)).toMatchObject({ vivas: 1, filas: 2, mora: "112.00" });
});

integrationTest("h) el crédito no quedó al día tras registrar: la condonación se anula, el pago queda", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const deps = await armar(sql, {}, { evaluarAlDia: (async () => ({ desactivarMora: false })) as never });
  const { r } = await correr(deps, 9, uuidIntento(109));
  expect(r.condonacionBoletaTardia).toMatchObject({ estado: "anulada_no_quedo_al_dia" });
  expect(await estado(sql, 9)).toEqual({ mora: "119.47", condonaciones: 1, vivas: 0, filas: 2, ledger: ["CONDONACION", "ANULACION"] });
});

integrationTest("h2) si la verificación misma falla, la condonación se mantiene (no se adivina)", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const deps = await armar(sql, {}, { evaluarAlDia: (async () => { throw new Error("verificación caída"); }) as never });
  const { r } = await correr(deps, 10, uuidIntento(110));
  expect(r.condonacionBoletaTardia).toMatchObject({ estado: "vigente" });
  expect(await estado(sql, 10)).toMatchObject({ vivas: 1, filas: 2 });
});

integrationTest("i) montoAceptado distinto del recalculado: 409 mora_cambio, no condona ni registra", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const llamadas = { n: 0, bodies: [] };
  const deps = await armar(sql, {}, { insertPayment: await insertFalso(sql, {}, llamadas) });
  const { r, status } = await correr(deps, 11, uuidIntento(111), "7.00");
  expect(status).toBe(409);
  expect(r.code).toBe("mora_cambio");
  expect(llamadas.n).toBe(0);
  expect(await estado(sql, 11)).toEqual({ mora: "119.47", condonaciones: 0, vivas: 0, filas: 0, ledger: [] });
});

integrationTest("j) la decisión ya no aplica: 409 ya_no_aplica, nada se escribe", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const deps = await armar(sql, {}, { decidir: decidirDesdeBd(sql, { aplica: false }) });
  const { r, status } = await correr(deps, 12, uuidIntento(112));
  expect(status).toBe(409);
  expect(r.code).toBe("ya_no_aplica");
  expect(await estado(sql, 12)).toMatchObject({ condonaciones: 0, filas: 0, mora: "119.47" });
});

integrationTest("k) carrera con procesarMoras: la mora cambió entre la decisión y la condonación → 409 mora_cambio, nada se registra", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const llamadas = { n: 0, bodies: [] };
  const deps = await armar(sql, {}, {
    insertPayment: await insertFalso(sql, {}, llamadas),
    decidir: decidirDesdeBd(sql, { alLeer: async () => { await sql`UPDATE cartera.moras_credito SET monto_mora = 123.20 WHERE credito_id = 13`; } }),
  });
  const { r, status } = await correr(deps, 13, uuidIntento(113));
  expect(status).toBe(409);
  expect(r.code).toBe("mora_cambio");
  expect(llamadas.n).toBe(0);
  expect(await estado(sql, 13)).toMatchObject({ condonaciones: 0, mora: "123.20" });
});

integrationTest("l) un intento anterior murió entre condonar y registrar (condonación viva sin filas): se deshace y se recalcula", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  await condonarBT(latefee, 14, uuidIntento(114)); // el pod murió acá
  expect((await estado(sql, 14)).mora).toBe("112.00");
  const { r } = await correr(await armar(sql), 14, uuidIntento(114));
  expect(r.success).toBe(true);
  expect(await estado(sql, 14)).toEqual({ mora: "112.00", condonaciones: 2, vivas: 1, filas: 2, ledger: ["CONDONACION", "ANULACION", "CONDONACION"] });
});

integrationTest("m) la condonación falla (el usuario no existe): 500, el pago NO se registra y no queda nada escrito", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const llamadas = { n: 0, bodies: [] };
  const deps = await armar(sql, {}, { insertPayment: await insertFalso(sql, {}, llamadas) });
  const { r, status } = await correr(deps, 16, uuidIntento(116), undefined, undefined, "no.existe@clubcashin.test");
  expect(status).toBe(500);
  expect(r.success).toBe(false);
  expect(r.message).toContain("el pago NO se registró");
  expect(llamadas.n).toBe(0);
  expect(await estado(sql, 16)).toEqual({ mora: "119.47", condonaciones: 0, vivas: 0, filas: 0, ledger: [] });
});

integrationTest("E-9) la condonación queda a nombre del usuario verificado aunque el body traiga otro registerBy, con el motivo de la spec", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  await correr(await armar(sql), 15, uuidIntento(115), undefined, { registerBy: "otro@x.com" });
  const [c] = await sql`SELECT c.motivo, u.email FROM cartera.moras_condonaciones c JOIN cartera.platform_users u ON u.id = c.usuario_id WHERE c.credito_id = 15`;
  expect(c).toEqual({ motivo: "Boleta del 30-sep registrada el 03-oct, cuota 5, aceptada por " + EMAIL_ASESOR, email: EMAIL_ASESOR });
});

integrationTest("E-14) numeroAutorizacion se recorta antes de llegar a insertPayment (' A-1 ' y 'A-1' son la misma boleta)", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const llamadas: { n: number; bodies: any[] } = { n: 0, bodies: [] };
  const deps = await armar(sql, {}, { insertPayment: await insertFalso(sql, {}, llamadas) });
  await correr(deps, 17, uuidIntento(117), undefined, { numeroAutorizacion: "  A-117 " });
  expect(llamadas.bodies[0].numeroAutorizacion).toBe("A-117");
});

integrationTest("E-14) fecha_boleta futura: 400 y no se condona nada", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const { status } = await correr(await armar(sql), 18, uuidIntento(118), undefined, { fecha_boleta: "2999-01-01" });
  expect(status).toBe(400);
  expect(await estado(sql, 18)).toMatchObject({ condonaciones: 0, filas: 0, mora: "119.47" });
});

integrationTest("E-12) intento reusado en OTRO crédito tras anularse en el primero: la compensación del segundo NO ve las filas del primero y anula", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  const X = uuidIntento(120);
  await correr(await armar(sql), 20, X); // A: filas vivas + condonación viva
  // la condonación de A se anula pero sus filas siguen vivas (p. ej. "no quedó al día")
  await latefee.anularCondonacionBoletaTardia({ intento_id: X, credito_id: 20, motivo: "prueba" });
  // B reutiliza el mismo intento y su registro no escribe nada
  const deps = await armar(sql, { filas: 0, status: 409, respuesta: { success: false, message: "boleta duplicada" } });
  const { status } = await correr(deps, 21, X);
  expect(status).toBe(409);
  expect(await estado(sql, 21)).toEqual({ mora: "119.47", condonaciones: 1, vivas: 0, filas: 0, ledger: ["CONDONACION", "ANULACION"] });
});

integrationTest("E-12) filas vivas del intento en OTRO crédito no hacen idempotente al segundo, y su condonación viva no se toca", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  const X = uuidIntento(122);
  await correr(await armar(sql), 22, X); // A viva con filas
  const llamadas = { n: 0, bodies: [] };
  const { r, status } = await correr(await armar(sql, {}, { insertPayment: await insertFalso(sql, {}, llamadas) }), 23, X);
  expect(r.idempotent).toBeUndefined();
  expect(status).toBe(500); // condonarMoraDeCuotas lanza: el intento ya condonó en otro crédito
  expect(llamadas.n).toBe(0);
  expect(await estado(sql, 22)).toMatchObject({ vivas: 1, filas: 2, mora: "112.00" });
  expect(await estado(sql, 23)).toEqual({ mora: "119.47", condonaciones: 0, vivas: 0, filas: 0, ledger: [] });
  void latefee;
});

// 1ª lectura: reintento fuera del candado; 2ª: dentro; 3ª: tras registrar.
integrationTest("F2) filasVivas falla después de un registro exitoso: se devuelve el éxito con estado sin_verificar y la condonación se mantiene", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const base = await armar(sql);
  let n = 0;
  const deps = { ...base, filasVivas: async (c: number, i: string) => { if (++n >= 3) throw new Error("lectura caída"); return base.filasVivas(c, i); } };
  const { r } = await correr(deps, 24, uuidIntento(124));
  expect(r.success).toBe(true);
  expect(r.condonacionBoletaTardia).toMatchObject({ monto: "7.47", estado: "sin_verificar" });
  expect(await estado(sql, 24)).toMatchObject({ vivas: 1, filas: 2, mora: "112.00" });
});

integrationTest("F3) reintento idempotente reporta el estado REAL: anulada_no_quedo_al_dia, o null si nunca hubo condonación", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const deps = await armar(sql, {}, { evaluarAlDia: (async () => ({ desactivarMora: false })) as never });
  await correr(deps, 25, uuidIntento(125));
  const otra = await correr(deps, 25, uuidIntento(125));
  expect(otra.r).toMatchObject({ idempotent: true, condonacionBoletaTardia: { monto: "7.47", estado: "anulada_no_quedo_al_dia" } });
  await sql`INSERT INTO cartera.pagos_credito (credito_id, validation_status, monto_aplicado, boleta_tardia_intento_id)
    VALUES (26, 'pending', 500, ${uuidIntento(126)})`;
  const sin = await correr(await armar(sql), 26, uuidIntento(126));
  expect(sin.r).toMatchObject({ idempotent: true, condonacionBoletaTardia: null });
});

// ───────────── P1-2: dos créditos con la MISMA foto al mismo tiempo (antes el candado era solo por crédito) ─────────────
const BASE_R2 = "https://pub-test.r2.dev/payments-receipts/";
/** Verificación de foto con la consulta de reuso REAL contra la base; R2 (HEAD y primeros bytes) falso y siempre bueno. */
const fotoConReusoReal = async (): Promise<DepsBoletaTardia["verificarFoto"]> => {
  const { verificarFotoBoleta, depsFotoReales } = await import("./boletaTardiaFoto");
  const head = async () => ({ ContentLength: 10, ContentType: "image/jpeg", LastModified: new Date() });
  return (e) => verificarFotoBoleta(e, { ...depsFotoReales(), head, inicio: async () => new Uint8Array([0xff, 0xd8, 0xff]) });
};
/** insertPayment falso que, como el real, escribe las filas y DESPUÉS las `boletas` (autocommit) antes de devolver. */
const insertConBoletas = (sql: Sql, llamadas: { n: number }, barrera?: { tomada: () => void; esperar: Promise<void> }): DepsBoletaTardia["insertPayment"] =>
  (async ({ body }: any, opts: any) => {
    llamadas.n++;
    barrera?.tomada();
    await barrera?.esperar;
    const [{ pago_id }] = await sql`INSERT INTO cartera.pagos_credito (credito_id, validation_status, monto_aplicado, boleta_tardia_intento_id)
      VALUES (${body.credito_id}, 'pending', 500, ${opts.boletaTardiaIntentoId}) RETURNING pago_id`;
    for (const llave of body.url_boletas) await sql`INSERT INTO cartera.boletas (pago_id, url_boleta) VALUES (${pago_id}, ${BASE_R2 + llave})`;
    return { success: true, message: "Pago realizado exitosamente" };
  }) as never;
const boletasVivas = async (sql: Sql, llave: string) => (await sql`SELECT count(*)::int AS n FROM cartera.boletas b
  JOIN cartera.pagos_credito p ON p.pago_id = b.pago_id WHERE b.url_boleta = ${BASE_R2 + llave} AND NOT p."paymentFalse"`)[0]!.n as number;
const ganadorYPerdedor = (a: { r: any; status?: number }, b: { r: any; status?: number }) => {
  const ganadores = [a, b].filter((x) => x.r?.success === true);
  const perdedores = [a, b].filter((x) => x.status === 400);
  expect([ganadores.length, perdedores.length]).toEqual([1, 1]);
  expect(perdedores[0]!.r.errors.url_boletas).toHaveLength(1);
  return ganadores[0]!;
};

integrationTest("P1-2) misma llave en dos créditos, B llega mientras A ya registra: exactamente uno registra y condona", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const llave = "00000000-0000-4000-8000-000000001201.jpg";
  let soltar!: () => void, avisar!: () => void;
  const esperar = new Promise<void>((r) => { soltar = r; });
  const aTomo = new Promise<void>((r) => { avisar = r; });
  const llamadas = { n: 0 };
  const verificarFoto = await fotoConReusoReal();
  const depsA = await armar(sql, {}, { verificarFoto, insertPayment: insertConBoletas(sql, llamadas, { tomada: avisar, esperar }) });
  const depsB = await armar(sql, {}, { verificarFoto, insertPayment: insertConBoletas(sql, llamadas) });
  const a = correr(depsA, 30, uuidIntento(130), undefined, { url_boletas: [llave] });
  await aTomo; // A ya tiene la llave y está por escribir `boletas`
  const b = correr(depsB, 31, uuidIntento(131), undefined, { url_boletas: [llave] });
  const bAntes = await terminaAntesDe(b, 3_000); // B no se queda esperando a A
  soltar();
  const [ra, rb] = await Promise.all([a, b]);
  expect(bAntes).toBe("termino");
  ganadorYPerdedor(ra, rb);
  expect(ra.r.condonacionBoletaTardia).toMatchObject({ estado: "vigente" });
  expect(llamadas.n).toBe(1);
  expect(await boletasVivas(sql, llave)).toBe(1);
  const [{ vivas }] = await sql`SELECT count(*)::int AS vivas FROM cartera.moras_condonaciones WHERE credito_id IN (30, 31) AND anulada_at IS NULL`;
  expect(vivas).toBe(1);
});

integrationTest("P1-2) misma llave en dos créditos a la vez, 20 veces: siempre exactamente uno registra", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const verificarFoto = await fotoConReusoReal();
  let cond = 0;
  for (let i = 0; i < 20; i++) {
    const llave = `00000000-0000-4000-8000-${String(1300 + i).padStart(12, "0")}.jpg`;
    const llamadas = { n: 0 };
    // condonar falso: lo que se prueba es el candado y el reuso contra la base real, no el ledger (ya probado arriba).
    const deps = await armar(sql, {}, {
      verificarFoto, insertPayment: insertConBoletas(sql, llamadas),
      condonar: (async () => ({ kind: "condonada", condonacion_id: ++cond, monto: "7.47" })) as never,
    });
    const [ra, rb] = await Promise.all([
      correr(deps, 32, uuidIntento(1300 + 2 * i), undefined, { url_boletas: [llave] }),
      correr(deps, 33, uuidIntento(1301 + 2 * i), undefined, { url_boletas: [llave] }),
    ]);
    ganadorYPerdedor(ra, rb);
    expect([i, llamadas.n, await boletasVivas(sql, llave)]).toEqual([i, 1, 1]);
  }
});

integrationTest("P1-2 B1) N condonaciones simultáneas con un pool de candados de N conexiones terminan todas (una conexión por pago)", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const { sql } = env;
  const N = 3;
  // `lockPool` es un pg.Pool: uno igual pero con max N, inyectado al candado del crédito.
  const Pool = env.database.lockPool.constructor;
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: N });
  let llegaron = 0;
  let todos!: () => void;
  const juntos = new Promise<void>((r) => { todos = r; });
  // Barrera: los N piden el candado del crédito al mismo tiempo (peor caso: nadie avanzó antes de que los demás llegaran).
  const conLock = (async (id: number, fn: never) => {
    if (++llegaron === N) todos();
    await juntos;
    return env.lock.withPaymentAdvisoryLock(id, fn, pool);
  }) as never;
  const llamadas = { n: 0 };
  const deps = await armar(sql, {}, { conLock, insertPayment: insertConBoletas(sql, llamadas) });
  try {
    const trabajo = Promise.all([34, 35, 36].map((c) => correr(deps, c, uuidIntento(c * 10), undefined, { url_boletas: [`00000000-0000-4000-8000-${String(c * 10).padStart(12, "0")}.jpg`] })));
    expect(await terminaAntesDe(trabajo, 5_000)).toBe("termino");
    expect((await trabajo).map((x) => x.r.success)).toEqual([true, true, true]);
    expect(llamadas.n).toBe(N);
  } finally {
    if (pool.waitingCount === 0) await pool.end();
  }
});

integrationTest("P1-2 I1) B leyó el reuso antes de que A escribiera y llega cuando A ya soltó la llave: el re-chequeo bajo los candados lo frena", async () => {
  const { sql } = await levantarEsquemaBoletaTardia();
  const llave = "00000000-0000-4000-8000-000000001202.jpg";
  const llamadas = { n: 0 };
  const verificarReal = await fotoConReusoReal();
  let bLeyo!: () => void, soltarB!: () => void;
  const bLeyoP = new Promise<void>((r) => { bLeyo = r; });
  const soltarBP = new Promise<void>((r) => { soltarB = r; });
  // B: el chequeo de afuera REAL (no ve nada: A no escribió) y después se detiene.
  const verificarB: DepsBoletaTardia["verificarFoto"] = async (e) => { const r = await verificarReal(e); bLeyo(); await soltarBP; return r; };
  const depsA = await armar(sql, {}, { verificarFoto: verificarReal, insertPayment: insertConBoletas(sql, llamadas) });
  const depsB = await armar(sql, {}, { verificarFoto: verificarB, insertPayment: insertConBoletas(sql, llamadas) });
  const b = correr(depsB, 37, uuidIntento(137), undefined, { url_boletas: [llave] });
  await bLeyoP;
  const a = await correr(depsA, 38, uuidIntento(138), undefined, { url_boletas: [llave] }); // A completo: `boletas` escrita y llave suelta
  expect(a.r.success).toBe(true);
  soltarB();
  const rb = await b;
  expect(rb.status).toBe(400);
  expect(rb.r.errors.url_boletas).toEqual(["Esta boleta ya está asociada a otro pago; verifique la boleta antes de condonar."]);
  expect(llamadas.n).toBe(1);
  expect(await boletasVivas(sql, llave)).toBe(1);
  expect((await estado(sql, 37)).condonaciones).toBe(0);
});
