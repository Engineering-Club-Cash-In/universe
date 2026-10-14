import { afterAll, expect } from "bun:test";
import { sql as dsql } from "drizzle-orm";
import {
  EMAIL_ASESOR, cerrarEsquemaBoletaTardia, integrationTest, levantarEsquemaBoletaTardia, uuidIntento,
  type Entorno,
} from "./boletaTardiaTestDb";

// Pruebas exhaustivas de caja negra de la Tarea 3 (PR 3/13): condonar y anular condonaciones de mora por cuota,
// generalizado de Nexa a boleta tardía. Contra Postgres real (TEST_DATABASE_URL = cartera-local, base descartable).
// Todo crédito nuevo nace con mora activa 119.47; cada prueba usa créditos propios (no comparten estado).

afterAll(cerrarEsquemaBoletaTardia);

const EMAIL_OTRO = "otro.actor@clubcashin.test";
const EMAIL_SISTEMA = "sistema-nexa@clubcashin.local";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const terminaAntesDe = async <T>(p: Promise<T>, ms = 5_000) =>
  Promise.race([p.then(() => "termino" as const), sleep(ms).then(() => "colgado" as const)]);

let siguienteCredito = 1000;
let siguienteIntento = 5000;
let siguienteEvento = 70000;
const nuevoIntento = () => uuidIntento(siguienteIntento++);
const nuevoEvento = () => siguienteEvento++;

/** Crédito propio: MOROSO, cuotas id*10+4 y id*10+5, mora activa 119.47 (como los del fixture). */
async function nuevoCredito(env: Entorno, mora = "119.47"): Promise<number> {
  const id = siguienteCredito++;
  const { sql } = env;
  await sql`INSERT INTO cartera.creditos VALUES (${id}, ${`X-${id}`}, 'MOROSO', 10000)`;
  await sql`INSERT INTO cartera.cuotas_credito (cuota_id, credito_id, fecha_vencimiento)
    VALUES (${id * 10 + 4}, ${id}, current_date - 40), (${id * 10 + 5}, ${id}, current_date - 10)`;
  await sql`INSERT INTO cartera.nexa_credit_bindings VALUES (${id})`;
  await sql`INSERT INTO cartera.moras_credito (credito_id, monto_mora, cuotas_atrasadas) VALUES (${id}, ${mora}, 2)`;
  return id;
}

type ParamsBT = {
  esperado?: string; monto?: string; cuotas?: { cuota_id: number; monto: string }[];
  email?: string; motivo?: string; pagos_pendientes_ids?: number[];
};
const condonar = (env: Entorno, credito: number, intento: string, o: ParamsBT = {}) =>
  env.latefee.condonarMoraDeCuotas({
    credito_id: credito,
    montoMoraEsperado: o.esperado ?? "119.47",
    monto: o.monto ?? "7.47",
    cuotas: o.cuotas ?? [{ cuota_id: credito * 10 + 5, monto: o.monto === undefined ? "7.466667" : o.monto }],
    origen: "CONDONACION_BOLETA_TARDIA",
    intento_id: intento,
    usuario_email: o.email ?? EMAIL_ASESOR,
    motivo: o.motivo ?? "Boleta del 30-sep registrada el 03-oct, cuota 5",
    ...(o.pagos_pendientes_ids ? { pagos_pendientes_ids: o.pagos_pendientes_ids } : {}),
  });

const condonarNexa = (env: Entorno, credito: number, evento: number, esperado = "119.47", monto = "7.47") =>
  env.latefee.condonarMoraDeCuotas({
    credito_id: credito, montoMoraEsperado: esperado, monto,
    cuotas: [{ cuota_id: credito * 10 + 5, monto }], nexa_payment_event_id: evento, motivo: "NEXA_ACH_A_TIEMPO",
  });

type OpcionesAnular = { intento_id: string; motivo: string; reactivarMora?: boolean; usuario_email?: string; dbClient?: never };
/** Anula por intento con el crédito al que pertenece (contrato r1: el intento exige credito_id). */
async function anularPorIntento(env: Entorno, o: OpcionesAnular) {
  const [f] = await env.sql`SELECT credito_id FROM cartera.moras_condonaciones WHERE intento_id = ${o.intento_id}
    ORDER BY condonacion_id DESC LIMIT 1`;
  return env.latefee.anularCondonacionBoletaTardia({ ...o, credito_id: (f?.credito_id as number | undefined) ?? 0 });
}

const mora = async (env: Entorno, credito: number) => {
  const [m] = await env.sql`SELECT monto_mora::text, activa FROM cartera.moras_credito WHERE credito_id = ${credito}`;
  return m!;
};
const ledgerNeto = async (env: Entorno, credito: number) => {
  const filas = await env.sql`SELECT cuota_id, SUM(monto)::text AS neto FROM cartera.mora_pagada_cuota
    WHERE credito_id = ${credito} GROUP BY cuota_id ORDER BY cuota_id`;
  return filas.map((f) => [f.cuota_id as number, f.neto as string] as const);
};
const cuenta = async (env: Entorno, tabla: "moras_condonaciones" | "mora_pagada_cuota" | "moras_historial", credito: number) => {
  const [{ n }] = await env.sql`SELECT count(*)::int AS n FROM ${env.sql(`cartera.${tabla}`)} WHERE credito_id = ${credito}`;
  return n as number;
};
const usuarioId = async (env: Entorno, email: string) => {
  const [u] = await env.sql`SELECT id FROM cartera.platform_users WHERE email = ${email}`;
  return u!.id as number;
};
const asegurarUsuario = async (env: Entorno, email: string) => {
  await env.sql`INSERT INTO cartera.platform_users (email, password_hash, role, is_active)
    VALUES (${email}, '!sin-login', 'ASESOR', true) ON CONFLICT (email) DO NOTHING`;
};
const hayEsperaDeCandado = async (env: Entorno) => {
  const [{ n }] = await env.sql`SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'`;
  return n > 0;
};
/** Espera (máx. 4 s) a que alguna conexión esté bloqueada por un candado: prueba que de verdad hubo contención. */
async function esperarContencion(env: Entorno) {
  for (let i = 0; i < 160; i++) {
    if (await hayEsperaDeCandado(env)) return true;
    await sleep(25);
  }
  return false;
}
/** Abre una tx en OTRA conexión, ejecuta `trabajo` y la mantiene abierta hasta `soltar()`. */
function sostener(env: Entorno, trabajo: (tx: Entorno["sql"]) => Promise<unknown>) {
  let soltar!: () => void;
  const puerta = new Promise<void>((r) => { soltar = r; });
  let listo!: () => void;
  const preparado = new Promise<void>((r) => { listo = r; });
  const tx = env.sql.begin(async (t) => {
    await trabajo(t as never);
    listo();
    await puerta;
  });
  return { preparado, soltar, tx };
}

// ───────────────────────────── Concurrencia ─────────────────────────────

integrationTest("CONC: 5 condonaciones simultáneas con el MISMO intento en el mismo crédito: 1 condonada, 4 ya_condonada, mora rebajada una vez", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const intento = nuevoIntento();
  const rs = await Promise.all(Array.from({ length: 5 }, () => condonar(env, c, intento)));
  expect(rs.map((r) => r.kind).sort()).toEqual(["condonada", "ya_condonada", "ya_condonada", "ya_condonada", "ya_condonada"]);
  const ids = new Set(rs.map((r) => (r.kind === "sin_cambio" ? -1 : r.condonacion_id)));
  expect(ids.size).toBe(1); // todos apuntan a la misma condonación
  expect(await cuenta(env, "moras_condonaciones", c)).toBe(1);
  expect(await mora(env, c)).toEqual({ monto_mora: "112.00", activa: true });
  expect(await cuenta(env, "mora_pagada_cuota", c)).toBe(1);
  expect(await cuenta(env, "moras_historial", c)).toBe(1);
});

integrationTest("CONC: 5 condonaciones simultáneas del mismo evento Nexa: 1 condonada (no regresión del candado)", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const evento = nuevoEvento();
  const rs = await Promise.all(Array.from({ length: 5 }, () => condonarNexa(env, c, evento)));
  expect(rs.filter((r) => r.kind === "condonada").length).toBe(1);
  expect(rs.filter((r) => r.kind === "ya_condonada").length).toBe(4);
  expect(await mora(env, c)).toEqual({ monto_mora: "112.00", activa: true });
  expect(await cuenta(env, "moras_condonaciones", c)).toBe(1);
});

integrationTest("CONC E-6: el mismo intento en 2 créditos distintos a la vez: una gana, la otra lanza y no deja rastro", async () => {
  const env = await levantarEsquemaBoletaTardia();
  for (let ronda = 0; ronda < 5; ronda++) {
    const a = await nuevoCredito(env);
    const b = await nuevoCredito(env);
    const intento = nuevoIntento();
    const rs = await Promise.allSettled([condonar(env, a, intento), condonar(env, b, intento)]);
    expect(rs.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(rs.filter((r) => r.status === "rejected").length).toBe(1);
    const ganador = rs[0]!.status === "fulfilled" ? a : b;
    const perdedor = ganador === a ? b : a;
    expect(await mora(env, ganador)).toEqual({ monto_mora: "112.00", activa: true });
    // La perdedora revirtió TODO: ni mora rebajada, ni condonación, ni ledger, ni historial.
    expect(await mora(env, perdedor)).toEqual({ monto_mora: "119.47", activa: true });
    expect(await cuenta(env, "moras_condonaciones", perdedor)).toBe(0);
    expect(await cuenta(env, "mora_pagada_cuota", perdedor)).toBe(0);
    expect(await cuenta(env, "moras_historial", perdedor)).toBe(0);
    const [{ n }] = await env.sql`SELECT count(*)::int AS n FROM cartera.moras_condonaciones WHERE intento_id = ${intento}`;
    expect(n).toBe(1);
  }
});

integrationTest("CONC: condonar mientras el cron tiene la mora actualizada sin commitear: mora_cambio y nada escrito", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const cron = sostener(env, async (t) => {
    await t`UPDATE cartera.moras_credito SET monto_mora = 130.00 WHERE credito_id = ${c}`;
  });
  await cron.preparado;
  const condonacion = condonar(env, c, nuevoIntento());
  expect(await esperarContencion(env)).toBe(true); // la condonación SÍ quedó esperando la fila de la mora
  cron.soltar();
  await cron.tx;
  expect(await condonacion).toEqual({ kind: "sin_cambio", razon: "mora_cambio" });
  expect(await mora(env, c)).toEqual({ monto_mora: "130.00", activa: true });
  expect(await cuenta(env, "moras_condonaciones", c)).toBe(0);
  expect(await cuenta(env, "mora_pagada_cuota", c)).toBe(0);
  expect(await cuenta(env, "moras_historial", c)).toBe(0);
});

integrationTest("CONC: condonar mientras el cron apaga la mora sin commitear: sin_mora y nada escrito", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const cron = sostener(env, async (t) => {
    await t`UPDATE cartera.moras_credito SET activa = false, monto_mora = 0 WHERE credito_id = ${c}`;
  });
  await cron.preparado;
  const condonacion = condonar(env, c, nuevoIntento());
  expect(await esperarContencion(env)).toBe(true);
  cron.soltar();
  await cron.tx;
  expect(await condonacion).toEqual({ kind: "sin_cambio", razon: "sin_mora" });
  expect(await mora(env, c)).toEqual({ monto_mora: "0.00", activa: false });
  expect(await cuenta(env, "moras_condonaciones", c)).toBe(0);
  expect(await cuenta(env, "mora_pagada_cuota", c)).toBe(0);
});

integrationTest("CONC: carrera libre condonar vs UPDATE de la mora: o mora_cambio con 120.47, o condonada con 113.00; jamás una pérdida de actualización", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const vistos = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const c = await nuevoCredito(env);
    const [r] = await Promise.all([
      condonar(env, c, nuevoIntento()),
      env.sql`UPDATE cartera.moras_credito SET monto_mora = monto_mora + 1 WHERE credito_id = ${c}`,
    ]);
    const m = await mora(env, c);
    if (r.kind === "condonada") {
      expect(m.monto_mora).toBe("113.00"); // condonó 7.47 sobre 119.47 y luego se sumó 1
      expect(await cuenta(env, "moras_condonaciones", c)).toBe(1);
    } else {
      expect(r).toEqual({ kind: "sin_cambio", razon: "mora_cambio" });
      expect(m.monto_mora).toBe("120.47");
      expect(await cuenta(env, "moras_condonaciones", c)).toBe(0);
      expect(await cuenta(env, "mora_pagada_cuota", c)).toBe(0);
    }
    vistos.add(r.kind);
  }
  expect(vistos.size).toBeGreaterThan(0);
});

integrationTest("CONC: 5 anulaciones simultáneas del mismo intento: una sola anula, la mora se restituye UNA vez", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const intento = nuevoIntento();
  await condonar(env, c, intento);
  const rs = await Promise.all(Array.from({ length: 5 }, () =>
    anularPorIntento(env, { intento_id: intento, motivo: "pago anulado", usuario_email: EMAIL_ASESOR })));
  expect(rs.filter((r) => r.anulada).length).toBe(1);
  expect(rs.filter((r) => !r.anulada).length).toBe(4);
  expect(await mora(env, c)).toEqual({ monto_mora: "119.47", activa: true });
  expect(await ledgerNeto(env, c)).toEqual([[c * 10 + 5, "0.000000"]]);
  const tipos = await env.sql`SELECT tipo FROM cartera.mora_pagada_cuota WHERE credito_id = ${c} ORDER BY id`;
  expect(tipos.map((t) => t.tipo)).toEqual(["CONDONACION", "ANULACION"]);
  const hist = await env.sql`SELECT tipo_evento FROM cartera.moras_historial WHERE credito_id = ${c} ORDER BY historial_id`;
  expect(hist.map((h) => h.tipo_evento)).toEqual(["CONDONACION", "INCREMENTO"]);
});

integrationTest("CONC: condonar y anular el mismo intento a la vez: el resultado final es coherente en todas las rondas", async () => {
  const env = await levantarEsquemaBoletaTardia();
  for (let ronda = 0; ronda < 10; ronda++) {
    const c = await nuevoCredito(env);
    const intento = nuevoIntento();
    await Promise.allSettled([
      condonar(env, c, intento),
      anularPorIntento(env, { intento_id: intento, motivo: "carrera" }),
    ]);
    const [{ vivas }] = await env.sql`SELECT count(*)::int AS vivas FROM cartera.moras_condonaciones
      WHERE credito_id = ${c} AND anulada_at IS NULL`;
    const m = await mora(env, c);
    const neto = await ledgerNeto(env, c);
    if (vivas === 1) {
      expect(m.monto_mora).toBe("112.00");
      expect(neto).toEqual([[c * 10 + 5, "7.466667"]]);
    } else {
      expect(m.monto_mora).toBe("119.47");
      expect(neto.every(([, n]) => Number(n) === 0)).toBe(true);
    }
  }
});

// ───────────────────── Anulación y candados (nada se cuelga) ─────────────────────

integrationTest("CANDADO: anular dentro de la tx del llamador que ya tiene creditos FOR UPDATE (por intento y por condonacion_id) termina en < 5 s", async () => {
  const env = await levantarEsquemaBoletaTardia();
  for (const por of ["intento", "condonacion"] as const) {
    const c = await nuevoCredito(env);
    const intento = nuevoIntento();
    const r = await condonar(env, c, intento);
    if (r.kind === "sin_cambio") throw new Error("no condonó");
    const trabajo = env.database.db.transaction(async (tx) => {
      await tx.execute(dsql`SELECT credito_id FROM cartera.creditos WHERE credito_id = ${c} FOR UPDATE`);
      return env.latefee.anularCondonacionBoletaTardia({
        ...(por === "intento" ? { intento_id: intento, credito_id: c } : { condonacion_id: r.condonacion_id }),
        motivo: "pago anulado", usuario_email: EMAIL_ASESOR, dbClient: tx as never,
      });
    });
    const desenlace = await terminaAntesDe(trabajo);
    if (desenlace === "colgado") {
      await env.sql`SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      await trabajo.catch(() => undefined);
    }
    expect(desenlace).toBe("termino");
    expect(await trabajo).toMatchObject({ anulada: true, monto: "7.47" });
    expect(await mora(env, c)).toEqual({ monto_mora: "119.47", activa: true });
  }
});

integrationTest("CANDADO: el llamador además ya tiene la fila de la mora bloqueada (UPDATE previo en su tx): sigue sin colgarse", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const intento = nuevoIntento();
  await condonar(env, c, intento);
  const trabajo = env.database.db.transaction(async (tx) => {
    await tx.execute(dsql`SELECT credito_id FROM cartera.creditos WHERE credito_id = ${c} FOR UPDATE`);
    await tx.execute(dsql`UPDATE cartera.moras_credito SET updated_at = now() WHERE credito_id = ${c}`);
    return anularPorIntento(env, { intento_id: intento, motivo: "x", dbClient: tx as never });
  });
  const desenlace = await terminaAntesDe(trabajo);
  if (desenlace === "colgado") {
    await env.sql`SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    await trabajo.catch(() => undefined);
  }
  expect(desenlace).toBe("termino");
});

integrationTest("CANDADO: anular fuera de transacción termina en < 5 s, también con otra conexión sosteniendo FOR KEY SHARE sobre el crédito", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const intento = nuevoIntento();
  await condonar(env, c, intento);
  const binding = sostener(env, async (t) => { await t`SELECT credito_id FROM cartera.creditos WHERE credito_id = ${c} FOR KEY SHARE`; });
  await binding.preparado;
  const trabajo = anularPorIntento(env, { intento_id: intento, motivo: "x" });
  const desenlace = await terminaAntesDe(trabajo);
  binding.soltar();
  await binding.tx;
  expect(desenlace).toBe("termino");
  expect(await trabajo).toMatchObject({ anulada: true });
});

integrationTest("CANDADO: otra conexión con creditos FOR UPDATE: la anulación espera y termina apenas se suelta (no queda colgada)", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const intento = nuevoIntento();
  await condonar(env, c, intento);
  const ajena = sostener(env, async (t) => { await t`SELECT credito_id FROM cartera.creditos WHERE credito_id = ${c} FOR UPDATE`; });
  await ajena.preparado;
  const trabajo = anularPorIntento(env, { intento_id: intento, motivo: "x" });
  expect(await esperarContencion(env)).toBe(true); // espera de verdad al candado del crédito
  ajena.soltar();
  await ajena.tx;
  expect(await terminaAntesDe(trabajo)).toBe("termino");
  expect(await mora(env, c)).toEqual({ monto_mora: "119.47", activa: true });
});

integrationTest("CANDADO: si la tx del llamador falla después de anular, TODO se deshace (la anulación corre en su savepoint)", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const intento = nuevoIntento();
  await condonar(env, c, intento);
  await expect(env.database.db.transaction(async (tx) => {
    const r = await anularPorIntento(env, { intento_id: intento, motivo: "x", dbClient: tx as never });
    expect(r.anulada).toBe(true);
    throw new Error("falla posterior del llamador");
  })).rejects.toThrow("falla posterior");
  expect(await mora(env, c)).toEqual({ monto_mora: "112.00", activa: true });
  const [v] = await env.sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE intento_id = ${intento}`;
  expect(v!.anulada_at).toBeNull();
  expect(await cuenta(env, "mora_pagada_cuota", c)).toBe(1);
  // y la anulación posterior sí funciona
  expect((await anularPorIntento(env, { intento_id: intento, motivo: "ahora sí" })).anulada).toBe(true);
});

// ───────────────────────────── Montos ─────────────────────────────

integrationTest("MONTO: la mora vuelve EXACTAMENTE a lo de antes (incluida una mora de 16 dígitos que Number() corrompería)", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const casos = [
    { mora: "119.47", monto: "7.47" },
    { mora: "0.02", monto: "0.01" },
    { mora: "999999999999.99", monto: "333333333333.33" }, // el ledger es numeric(18,6): tope < 10^12
    { mora: "12345678901234.56", monto: "0.07" }, // mora de 16 dígitos: Number() la corrompería
  ];
  for (const { mora: inicial, monto } of casos) {
    const c = await nuevoCredito(env, inicial);
    const intento = nuevoIntento();
    const r = await condonar(env, c, intento, { esperado: inicial, monto, cuotas: [{ cuota_id: c * 10 + 5, monto }] });
    expect(r.kind).toBe("condonada");
    const a = await anularPorIntento(env, { intento_id: intento, motivo: "x" });
    expect(a).toMatchObject({ anulada: true, monto });
    expect(await mora(env, c)).toEqual({ monto_mora: inicial, activa: true });
  }
});

integrationTest("MONTO: ledger neto 0 por cuota tras anular, con 3 cuotas de fracciones de 6 decimales", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  await env.sql`INSERT INTO cartera.cuotas_credito VALUES (${c * 10 + 6}, ${c})`;
  const intento = nuevoIntento();
  await condonar(env, c, intento, {
    monto: "7.47",
    cuotas: [{ cuota_id: c * 10 + 4, monto: "2.486667" }, { cuota_id: c * 10 + 5, monto: "2.486667" }, { cuota_id: c * 10 + 6, monto: "2.496666" }],
  });
  expect(await ledgerNeto(env, c)).toEqual([[c * 10 + 4, "2.486667"], [c * 10 + 5, "2.486667"], [c * 10 + 6, "2.496666"]]);
  await anularPorIntento(env, { intento_id: intento, motivo: "x" });
  expect(await ledgerNeto(env, c)).toEqual([[c * 10 + 4, "0.000000"], [c * 10 + 5, "0.000000"], [c * 10 + 6, "0.000000"]]);
  // cada ANULACION apunta (revierte_a) a su CONDONACION
  const [{ n }] = await env.sql`SELECT count(*)::int AS n FROM cartera.mora_pagada_cuota a
    JOIN cartera.mora_pagada_cuota o ON o.id = a.revierte_a AND o.tipo = 'CONDONACION' AND o.cuota_id = a.cuota_id AND o.monto = -a.monto
    WHERE a.credito_id = ${c} AND a.tipo = 'ANULACION'`;
  expect(n).toBe(3);
});

integrationTest("MONTO: dos condonaciones con intentos distintos y se anula una: queda solo la otra, con su mora y su ledger", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const [iA, iB] = [nuevoIntento(), nuevoIntento()];
  expect((await condonar(env, c, iA)).kind).toBe("condonada"); // 119.47 -> 112.00 (cuota 5)
  expect((await condonar(env, c, iB, { esperado: "112.00", monto: "3.00", cuotas: [{ cuota_id: c * 10 + 4, monto: "3.00" }] })).kind).toBe("condonada"); // -> 109.00
  expect((await mora(env, c)).monto_mora).toBe("109.00");
  expect((await anularPorIntento(env, { intento_id: iA, motivo: "x" })).anulada).toBe(true);
  expect(await mora(env, c)).toEqual({ monto_mora: "116.47", activa: true }); // 109.00 + 7.47: B sigue condonando 3.00
  expect(await ledgerNeto(env, c)).toEqual([[c * 10 + 4, "3.000000"], [c * 10 + 5, "0.000000"]]);
  const vivas = await env.sql`SELECT intento_id FROM cartera.moras_condonaciones WHERE credito_id = ${c} AND anulada_at IS NULL`;
  expect(vivas.map((v) => v.intento_id)).toEqual([iB]);
  // anular B deja todo en el origen
  expect((await anularPorIntento(env, { intento_id: iB, motivo: "x" })).anulada).toBe(true);
  expect(await mora(env, c)).toEqual({ monto_mora: "119.47", activa: true });
  expect((await ledgerNeto(env, c)).every(([, n]) => Number(n) === 0)).toBe(true);
});

integrationTest("MONTO: condonar TODA la mora la deja en 0.00 (sigue activa) y anular la devuelve completa", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const intento = nuevoIntento();
  const r = await condonar(env, c, intento, { monto: "119.47", cuotas: [{ cuota_id: c * 10 + 5, monto: "119.47" }] });
  expect(r.kind).toBe("condonada");
  expect(await mora(env, c)).toEqual({ monto_mora: "0.00", activa: true });
  await anularPorIntento(env, { intento_id: intento, motivo: "x" });
  expect(await mora(env, c)).toEqual({ monto_mora: "119.47", activa: true });
});

integrationTest("MONTO: entradas inválidas (monto 0, negativo, mayor que la mora, mora apagada, esperado distinto) no escriben nada", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const mal = [
    [await condonar(env, c, nuevoIntento(), { monto: "0", cuotas: [{ cuota_id: c * 10 + 5, monto: "1" }] }), "monto_invalido"],
    [await condonar(env, c, nuevoIntento(), { monto: "-5", cuotas: [{ cuota_id: c * 10 + 5, monto: "1" }] }), "monto_invalido"],
    [await condonar(env, c, nuevoIntento(), { monto: "119.48", cuotas: [{ cuota_id: c * 10 + 5, monto: "119.48" }] }), "monto_invalido"],
    [await condonar(env, c, nuevoIntento(), { esperado: "119.46" }), "mora_cambio"],
  ] as const;
  for (const [r, razon] of mal) expect(r).toEqual({ kind: "sin_cambio", razon });
  await env.sql`UPDATE cartera.moras_credito SET activa = false WHERE credito_id = ${c}`;
  expect(await condonar(env, c, nuevoIntento())).toEqual({ kind: "sin_cambio", razon: "sin_mora" });
  expect(await cuenta(env, "moras_condonaciones", c)).toBe(0);
  expect(await cuenta(env, "mora_pagada_cuota", c)).toBe(0);
  expect(await cuenta(env, "moras_historial", c)).toBe(0);
  expect((await mora(env, c)).monto_mora).toBe("119.47");
});

integrationTest("MONTO: un fallo a mitad de la condonación (cuota inexistente, FK) revierte TODO", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  await expect(condonar(env, c, nuevoIntento(), { cuotas: [{ cuota_id: 99999999, monto: "7.47" }] })).rejects.toThrow();
  expect(await mora(env, c)).toEqual({ monto_mora: "119.47", activa: true });
  expect(await cuenta(env, "moras_condonaciones", c)).toBe(0);
  expect(await cuenta(env, "mora_pagada_cuota", c)).toBe(0);
  expect(await cuenta(env, "moras_historial", c)).toBe(0);
});

integrationTest("MONTO (observación de diseño): una cuota con monto 0 o negativo se descarta en silencio del ledger (anotarMoraPagada); el resto sí entra", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  await env.sql`INSERT INTO cartera.cuotas_credito VALUES (${c * 10 + 6}, ${c})`;
  const r = await condonar(env, c, nuevoIntento(), {
    cuotas: [{ cuota_id: c * 10 + 4, monto: "0" }, { cuota_id: c * 10 + 6, monto: "-1" }, { cuota_id: c * 10 + 5, monto: "7.47" }],
  });
  expect(r.kind).toBe("condonada");
  expect(await ledgerNeto(env, c)).toEqual([[c * 10 + 5, "7.470000"]]);
});

// ───────────────────────────── reactivarMora ─────────────────────────────

integrationTest("REACTIVAR true: mora apagada con monto 0 -> activa con el monto condonado, y queda en el historial", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const intento = nuevoIntento();
  await condonar(env, c, intento);
  await env.sql`UPDATE cartera.moras_credito SET activa = false, monto_mora = 0 WHERE credito_id = ${c}`;
  const r = await anularPorIntento(env, { intento_id: intento, motivo: "pago anulado", reactivarMora: true, usuario_email: EMAIL_ASESOR });
  expect(r).toMatchObject({ anulada: true, monto: "7.47" });
  expect(await mora(env, c)).toEqual({ monto_mora: "7.47", activa: true });
  const hist = await env.sql`SELECT tipo_evento, origen, monto_anterior::text, monto_nuevo::text FROM cartera.moras_historial
    WHERE credito_id = ${c} ORDER BY historial_id DESC LIMIT 1`;
  expect(hist[0]).toMatchObject({ tipo_evento: "INCREMENTO", origen: "CONDONACION_BOLETA_TARDIA", monto_anterior: "0.00", monto_nuevo: "7.47" });
});

integrationTest("REACTIVAR true: mora apagada con residuo (monto 50) -> activa y 50 + 7.47", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const intento = nuevoIntento();
  await condonar(env, c, intento);
  await env.sql`UPDATE cartera.moras_credito SET activa = false, monto_mora = 50 WHERE credito_id = ${c}`;
  await anularPorIntento(env, { intento_id: intento, motivo: "x", reactivarMora: true });
  expect(await mora(env, c)).toEqual({ monto_mora: "57.47", activa: true });
});

integrationTest("REACTIVAR false (default): mora apagada NO se reactiva; anula, compensa el ledger, NO lanza y deja la mora en 0 apagada", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const intento = nuevoIntento();
  await condonar(env, c, intento);
  await env.sql`UPDATE cartera.moras_credito SET activa = false, monto_mora = 0 WHERE credito_id = ${c}`;
  const explicito = await nuevoCredito(env);
  const intento2 = nuevoIntento();
  await condonar(env, explicito, intento2);
  await env.sql`UPDATE cartera.moras_credito SET activa = false, monto_mora = 0 WHERE credito_id = ${explicito}`;

  expect(await anularPorIntento(env, { intento_id: intento, motivo: "x" })).toMatchObject({ anulada: true });
  expect(await anularPorIntento(env, { intento_id: intento2, motivo: "x", reactivarMora: false })).toMatchObject({ anulada: true });
  for (const k of [c, explicito]) {
    expect(await mora(env, k)).toEqual({ monto_mora: "0.00", activa: false });
    expect((await ledgerNeto(env, k)).every(([, n]) => Number(n) === 0)).toBe(true);
    const [v] = await env.sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE credito_id = ${k}`;
    expect(v!.anulada_at).not.toBeNull();
  }
});

integrationTest("REACTIVAR true sobre una mora que sigue activa: se comporta igual que false (solo suma el monto)", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const intento = nuevoIntento();
  await condonar(env, c, intento);
  await anularPorIntento(env, { intento_id: intento, motivo: "x", reactivarMora: true });
  expect(await mora(env, c)).toEqual({ monto_mora: "119.47", activa: true });
});

const historialMora = (env: Entorno, credito: number) =>
  env.sql`SELECT tipo_evento, origen, usuario_id, motivo, monto_anterior::text, monto_nuevo::text,
    cuotas_atrasadas_anterior, cuotas_atrasadas_nuevas FROM cartera.moras_historial WHERE credito_id = ${credito} ORDER BY historial_id`;

integrationTest("R1 (4) restituida: true cuando el INCREMENTO se aplicó; false (sin evento nuevo en moras_historial; rastro 'SIN restituir' en el motivo de la condonación) cuando la mora está apagada sin reactivar", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const a = await nuevoCredito(env);
  const ia = nuevoIntento();
  await condonar(env, a, ia);
  expect(await anularPorIntento(env, { intento_id: ia, motivo: "x" })).toMatchObject({ anulada: true, monto: "7.47", restituida: true });
  const b = await nuevoCredito(env);
  const ib = nuevoIntento();
  await condonar(env, b, ib);
  await env.sql`UPDATE cartera.moras_credito SET activa = false, monto_mora = 0 WHERE credito_id = ${b}`;
  const r = await anularPorIntento(env, { intento_id: ib, motivo: "pago anulado", usuario_email: EMAIL_ASESOR });
  expect(r).toMatchObject({ anulada: true, restituida: false });
  const h = await historialMora(env, b);
  expect(h.length).toBe(1); // solo la condonación original: ni INCREMENTO ni marcador
  const [cb] = await env.sql`SELECT motivo FROM cartera.moras_condonaciones WHERE intento_id = ${ib}`;
  expect(cb!.motivo).toContain("SIN restituir la mora (mora apagada)");
  expect(await mora(env, b)).toEqual({ monto_mora: "0.00", activa: false });
});

integrationTest("R1 (5) estados protegidos: con reactivarMora:true NO reactiva (anula, compensa, restituida:false, rastro) en cada STATUS_EXCLUIDOS_MORA", async () => {
  const env = await levantarEsquemaBoletaTardia();
  for (const estado of ["CANCELADO", "EN_CONVENIO", "INCOBRABLE", "PENDIENTE_CANCELACION", "CAIDO"]) {
    const c = await nuevoCredito(env);
    const intento = nuevoIntento();
    await condonar(env, c, intento);
    await env.sql`UPDATE cartera.moras_credito SET activa = false, monto_mora = 0 WHERE credito_id = ${c}`;
    await env.sql`UPDATE cartera.creditos SET "statusCredit" = ${estado} WHERE credito_id = ${c}`;
    const r = await anularPorIntento(env, { intento_id: intento, motivo: "x", reactivarMora: true });
    expect(r).toMatchObject({ anulada: true, restituida: false });
    expect(await mora(env, c)).toEqual({ monto_mora: "0.00", activa: false });
    expect((await ledgerNeto(env, c)).every(([, n]) => Number(n) === 0)).toBe(true);
    expect((await historialMora(env, c)).length).toBe(1);
    const [cm] = await env.sql`SELECT motivo FROM cartera.moras_condonaciones WHERE intento_id = ${intento}`;
    expect(cm!.motivo).toContain(`SIN restituir la mora (estado protegido ${estado})`);
    const [{ estadoFinal }] = await env.sql`SELECT "statusCredit" AS "estadoFinal" FROM cartera.creditos WHERE credito_id = ${c}`;
    expect(estadoFinal).toBe(estado); // el estado no se toca
  }
});

integrationTest("R1 (5b) un estado NO protegido (MOROSO, ACTIVO) sí reactiva con reactivarMora:true", async () => {
  const env = await levantarEsquemaBoletaTardia();
  for (const estado of ["MOROSO", "ACTIVO"]) {
    const c = await nuevoCredito(env);
    const intento = nuevoIntento();
    await condonar(env, c, intento);
    await env.sql`UPDATE cartera.moras_credito SET activa = false, monto_mora = 0 WHERE credito_id = ${c}`;
    await env.sql`UPDATE cartera.creditos SET "statusCredit" = ${estado} WHERE credito_id = ${c}`;
    expect(await anularPorIntento(env, { intento_id: intento, motivo: "x", reactivarMora: true })).toMatchObject({ anulada: true, restituida: true });
    expect(await mora(env, c)).toEqual({ monto_mora: "7.47", activa: true });
  }
});

integrationTest("R1 (6) al reactivar recalcula cuotas_atrasadas con el criterio del cron (2 vencidas impagas -> 2; 1 -> 1), no 0 fijo; con 0 vencidas no reactiva (F9)", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const casos: [string, number][] = [["ambas vencidas", 2], ["una pagada", 1], ["ninguna vencida", 0]];
  for (const [caso, esperadas] of casos) {
    const c = await nuevoCredito(env);
    const intento = nuevoIntento();
    await condonar(env, c, intento);
    await env.sql`UPDATE cartera.moras_credito SET activa = false, monto_mora = 0, cuotas_atrasadas = 0 WHERE credito_id = ${c}`;
    if (caso === "una pagada") await env.sql`UPDATE cartera.cuotas_credito SET pagado = true WHERE cuota_id = ${c * 10 + 4}`;
    if (caso === "ninguna vencida") await env.sql`UPDATE cartera.cuotas_credito SET fecha_vencimiento = current_date + 30 WHERE credito_id = ${c}`;
    await anularPorIntento(env, { intento_id: intento, motivo: "x", reactivarMora: true });
    const [m] = await env.sql`SELECT cuotas_atrasadas, activa FROM cartera.moras_credito WHERE credito_id = ${c}`;
    if (esperadas === 0) {
      // F9: sin cuotas vencidas no se reactiva
      expect({ caso, cuotas: m!.cuotas_atrasadas, activa: m!.activa }).toEqual({ caso, cuotas: 0, activa: false });
      continue;
    }
    expect({ caso, cuotas: m!.cuotas_atrasadas, activa: m!.activa }).toEqual({ caso, cuotas: esperadas, activa: true });
    const h = await historialMora(env, c);
    expect(h[h.length - 1]).toMatchObject({ tipo_evento: "INCREMENTO", cuotas_atrasadas_nuevas: esperadas });
  }
});

integrationTest("R1 (1) el intento EXIGE credito_id: sin él lanza; con el de OTRO crédito no anula y la condonación viva sigue; con el correcto anula", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const a = await nuevoCredito(env);
  const b = await nuevoCredito(env);
  const intento = nuevoIntento();
  await condonar(env, a, intento);
  await expect(env.latefee.anularCondonacionBoletaTardia({ intento_id: intento, motivo: "x" } as never)).rejects.toThrow(/credito_id/);
  expect(await env.latefee.anularCondonacionBoletaTardia({ intento_id: intento, credito_id: b, motivo: "x" })).toEqual({ anulada: false });
  expect(await mora(env, a)).toEqual({ monto_mora: "112.00", activa: true });
  expect(await mora(env, b)).toEqual({ monto_mora: "119.47", activa: true });
  const [v] = await env.sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE intento_id = ${intento}`;
  expect(v!.anulada_at).toBeNull();
  expect(await env.latefee.anularCondonacionBoletaTardia({ intento_id: intento, credito_id: a, motivo: "x" })).toMatchObject({ anulada: true, restituida: true });
  // con condonacion_id y un credito_id no hace falta (y el tipo lo prohíbe)
  const c = await nuevoCredito(env);
  const rc = await condonar(env, c, nuevoIntento());
  if (rc.kind !== "condonada") throw new Error("no condonó");
  expect(await env.latefee.anularCondonacionBoletaTardia({ condonacion_id: rc.condonacion_id, motivo: "x" })).toMatchObject({ anulada: true });
});

integrationTest("R1 (E-12) intento X anulado en A y reusado en B: anular(X, A) no toca la viva de B, anular(X, B) sí", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const a = await nuevoCredito(env);
  const b = await nuevoCredito(env);
  const x = nuevoIntento();
  await condonar(env, a, x);
  await env.latefee.anularCondonacionBoletaTardia({ intento_id: x, credito_id: a, motivo: "x" });
  await condonar(env, b, x);
  expect(await env.latefee.anularCondonacionBoletaTardia({ intento_id: x, credito_id: a, motivo: "otra" })).toEqual({ anulada: false });
  expect(await mora(env, b)).toEqual({ monto_mora: "112.00", activa: true });
  expect(await env.latefee.anularCondonacionBoletaTardia({ intento_id: x, credito_id: b, motivo: "x" })).toMatchObject({ anulada: true });
});

// ───────────────────────────── Idempotencia ─────────────────────────────

integrationTest("IDEM: anular dos veces (por intento y luego por condonacion_id): la segunda no hace nada ni duplica historial, ledger ni mora", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const intento = nuevoIntento();
  const r = await condonar(env, c, intento);
  if (r.kind === "sin_cambio") throw new Error("no condonó");
  expect((await anularPorIntento(env, { intento_id: intento, motivo: "1" })).anulada).toBe(true);
  const antes = [await cuenta(env, "moras_historial", c), await cuenta(env, "mora_pagada_cuota", c), (await mora(env, c)).monto_mora];
  expect(await anularPorIntento(env, { intento_id: intento, motivo: "2" })).toEqual({ anulada: false });
  expect(await env.latefee.anularCondonacionBoletaTardia({ condonacion_id: r.condonacion_id, motivo: "3" })).toEqual({ anulada: false });
  const despues = [await cuenta(env, "moras_historial", c), await cuenta(env, "mora_pagada_cuota", c), (await mora(env, c)).monto_mora];
  expect(despues).toEqual(antes);
  expect(despues).toEqual([2, 2, "119.47"]);
});

integrationTest("IDEM: anular algo que nunca existió (intento o condonacion_id desconocidos) devuelve { anulada: false } sin lanzar", async () => {
  const env = await levantarEsquemaBoletaTardia();
  expect(await anularPorIntento(env, { intento_id: nuevoIntento(), motivo: "x" })).toEqual({ anulada: false });
  expect(await env.latefee.anularCondonacionBoletaTardia({ condonacion_id: 987654321, motivo: "x" })).toEqual({ anulada: false });
});

integrationTest("IDEM: tras anular, el MISMO intento puede condonar de nuevo (índice parcial, brief): nueva condonación, mora rebajada otra vez, anulable otra vez", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const intento = nuevoIntento();
  const r1 = await condonar(env, c, intento);
  await anularPorIntento(env, { intento_id: intento, motivo: "x" });
  const r2 = await condonar(env, c, intento);
  expect(r1.kind).toBe("condonada");
  expect(r2.kind).toBe("condonada");
  if (r1.kind !== "condonada" || r2.kind !== "condonada") throw new Error("no condonó");
  expect(r2.condonacion_id).not.toBe(r1.condonacion_id);
  expect(await mora(env, c)).toEqual({ monto_mora: "112.00", activa: true });
  const filas = await env.sql`SELECT condonacion_id, anulada_at IS NULL AS viva FROM cartera.moras_condonaciones WHERE credito_id = ${c} ORDER BY condonacion_id`;
  expect(filas.map((f) => f.viva)).toEqual([false, true]);
  // la anulación nueva toca SOLO la viva
  expect(await anularPorIntento(env, { intento_id: intento, motivo: "y" })).toMatchObject({ anulada: true, condonacion_id: r2.condonacion_id });
  expect(await mora(env, c)).toEqual({ monto_mora: "119.47", activa: true });
  expect((await ledgerNeto(env, c)).every(([, n]) => Number(n) === 0)).toBe(true);
});

integrationTest("IDEM: reusar un intento ya anulado en OTRO crédito sí se permite (E-6 solo mira condonaciones vivas)", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const a = await nuevoCredito(env);
  const b = await nuevoCredito(env);
  const intento = nuevoIntento();
  await condonar(env, a, intento);
  await anularPorIntento(env, { intento_id: intento, motivo: "x" });
  expect((await condonar(env, b, intento)).kind).toBe("condonada");
  expect(await mora(env, a)).toEqual({ monto_mora: "119.47", activa: true });
  expect(await mora(env, b)).toEqual({ monto_mora: "112.00", activa: true });
});

integrationTest("IDEM: repetir el mismo intento viejo con otros datos devuelve ya_condonada con el monto ORIGINAL y no toca nada", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const intento = nuevoIntento();
  const r1 = await condonar(env, c, intento);
  if (r1.kind !== "condonada") throw new Error("no condonó");
  const r2 = await condonar(env, c, intento, { esperado: "9999.99", monto: "50", cuotas: [{ cuota_id: c * 10 + 4, monto: "50" }] });
  expect(r2).toEqual({ kind: "ya_condonada", condonacion_id: r1.condonacion_id, monto: "7.47" });
  expect(await mora(env, c)).toEqual({ monto_mora: "112.00", activa: true });
  expect(await cuenta(env, "mora_pagada_cuota", c)).toBe(1);
});

integrationTest("IDEM: el mismo intento vivo en OTRO crédito lanza /otro crédito/ aunque los datos del segundo sean inválidos", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const a = await nuevoCredito(env);
  const b = await nuevoCredito(env);
  const intento = nuevoIntento();
  await condonar(env, a, intento);
  await expect(condonar(env, b, intento, { esperado: "1.00" })).rejects.toThrow(/otro crédito/);
  expect(await mora(env, b)).toEqual({ monto_mora: "119.47", activa: true });
});

integrationTest("IDEM: anular por condonacion_id dentro de la tx de otro crédito no cruza créditos", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const a = await nuevoCredito(env);
  const b = await nuevoCredito(env);
  const ra = await condonar(env, a, nuevoIntento());
  await condonar(env, b, nuevoIntento());
  if (ra.kind !== "condonada") throw new Error("no condonó");
  await env.latefee.anularCondonacionBoletaTardia({ condonacion_id: ra.condonacion_id, motivo: "x" });
  expect(await mora(env, a)).toEqual({ monto_mora: "119.47", activa: true });
  expect(await mora(env, b)).toEqual({ monto_mora: "112.00", activa: true }); // la de B intacta
});

// ───────────────────────────── Rastro ─────────────────────────────

integrationTest("RASTRO: la condonación deja historial BT firmado por el asesor (E-7), moras_condonaciones.usuario_id, motivo y pagos_pendientes_ids", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const intento = nuevoIntento();
  const motivo = "Boleta del 30-sep registrada el 03-oct, cuota 5, aceptada por asesor";
  await condonar(env, c, intento, { motivo, pagos_pendientes_ids: [11, 12] });
  const asesor = await usuarioId(env, EMAIL_ASESOR);
  const [cond] = await env.sql`SELECT usuario_id, motivo, intento_id, nexa_payment_event_id, monto_condonacion::text, pagos_pendientes_ids
    FROM cartera.moras_condonaciones WHERE credito_id = ${c}`;
  expect(cond).toMatchObject({ usuario_id: asesor, motivo, intento_id: intento, nexa_payment_event_id: null, monto_condonacion: "7.47", pagos_pendientes_ids: [11, 12] });
  const hist = await env.sql`SELECT tipo_evento, origen, usuario_id, motivo FROM cartera.moras_historial WHERE credito_id = ${c}`;
  expect(hist.length).toBe(1);
  expect(hist[0]).toMatchObject({ tipo_evento: "CONDONACION", origen: "CONDONACION_BOLETA_TARDIA", usuario_id: asesor });
  expect(hist[0]!.motivo).toContain(motivo);
  expect(hist[0]!.motivo).toContain(intento);
  const [led] = await env.sql`SELECT usuario_id, motivo, tipo, condonacion_id FROM cartera.mora_pagada_cuota WHERE credito_id = ${c}`;
  expect(led).toMatchObject({ usuario_id: asesor, motivo, tipo: "CONDONACION" });
});

integrationTest("RASTRO: la condonación con un email que no existe en platform_users lanza y no escribe nada", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  await expect(condonar(env, c, nuevoIntento(), { email: "fantasma@nadie.test" })).rejects.toThrow(/fantasma@nadie.test/);
  expect(await cuenta(env, "moras_condonaciones", c)).toBe(0);
  expect((await mora(env, c)).monto_mora).toBe("119.47");
});

integrationTest("RASTRO E-7: la anulación firma el ANULACION del ledger Y el historial con el email del actor (no con el usuario de sistema)", async () => {
  const env = await levantarEsquemaBoletaTardia();
  await asegurarUsuario(env, EMAIL_OTRO);
  const c = await nuevoCredito(env);
  const intento = nuevoIntento();
  await condonar(env, c, intento);
  await anularPorIntento(env, { intento_id: intento, motivo: "pago anulado por supervisor", usuario_email: EMAIL_OTRO });
  const otro = await usuarioId(env, EMAIL_OTRO);
  const [anul] = await env.sql`SELECT usuario_id, motivo FROM cartera.mora_pagada_cuota WHERE credito_id = ${c} AND tipo = 'ANULACION'`;
  expect(anul).toMatchObject({ usuario_id: otro, motivo: "pago anulado por supervisor" });
  const inc = await env.sql`SELECT usuario_id, origen, motivo FROM cartera.moras_historial WHERE credito_id = ${c} AND tipo_evento = 'INCREMENTO'`;
  expect(inc.length).toBe(1);
  expect(inc[0]).toMatchObject({ origen: "CONDONACION_BOLETA_TARDIA" });
  expect(inc[0]!.motivo).toContain(intento);
  expect(inc[0]!.usuario_id).toBe(otro); // E-7: "usuario = el email del actor"
});

integrationTest("RASTRO: sin usuario_email la anulación firma ANULACION e INCREMENTO con el usuario de sistema; con un email explícito inexistente LANZA y no escribe nada", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c1 = await nuevoCredito(env);
  const c2 = await nuevoCredito(env);
  const [i1, i2] = [nuevoIntento(), nuevoIntento()];
  await condonar(env, c1, i1);
  await condonar(env, c2, i2);
  await anularPorIntento(env, { intento_id: i1, motivo: "barrido" });
  const sistema = await usuarioId(env, EMAIL_SISTEMA);
  const [a1] = await env.sql`SELECT usuario_id FROM cartera.mora_pagada_cuota WHERE credito_id = ${c1} AND tipo = 'ANULACION'`;
  const [h1] = await env.sql`SELECT usuario_id FROM cartera.moras_historial WHERE credito_id = ${c1} AND tipo_evento = 'INCREMENTO'`;
  expect(a1!.usuario_id).toBe(sistema);
  expect(h1!.usuario_id).toBe(sistema);
  await expect(anularPorIntento(env, { intento_id: i2, motivo: "x", usuario_email: "fantasma@nadie.test" })).rejects.toThrow(/fantasma@nadie.test/);
  expect((await mora(env, c2)).monto_mora).toBe("112.00");
  const [v] = await env.sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE intento_id = ${i2}`;
  expect(v!.anulada_at).toBeNull();
  expect(await cuenta(env, "mora_pagada_cuota", c2)).toBe(1);
});

integrationTest("RASTRO: la condonación original no se pierde al anular (sigue en moras_condonaciones con anulada_at, ledger y historial intactos)", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const intento = nuevoIntento();
  await condonar(env, c, intento);
  await anularPorIntento(env, { intento_id: intento, motivo: "x" });
  const [cond] = await env.sql`SELECT monto_condonacion::text, anulada_at, intento_id FROM cartera.moras_condonaciones WHERE credito_id = ${c}`;
  expect(cond).toMatchObject({ monto_condonacion: "7.47", intento_id: intento });
  expect(cond!.anulada_at).not.toBeNull();
  const hist = await env.sql`SELECT tipo_evento, monto_anterior::text, monto_nuevo::text FROM cartera.moras_historial WHERE credito_id = ${c} ORDER BY historial_id`;
  expect(hist.map((h) => [h.tipo_evento, h.monto_anterior, h.monto_nuevo])).toEqual([
    ["CONDONACION", "119.47", "112.00"], ["INCREMENTO", "112.00", "119.47"],
  ]);
});

// ───────────────────────────── No regresión Nexa ─────────────────────────────

integrationTest("NEXA: condonar por evento deja origen CONDONACION_NEXA_A_TIEMPO, usuario de sistema, intento_id NULL; el origen explícito es equivalente", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const e1 = nuevoEvento();
  expect((await condonarNexa(env, c, e1)).kind).toBe("condonada");
  const sistema = await usuarioId(env, EMAIL_SISTEMA);
  const [cond] = await env.sql`SELECT usuario_id, intento_id, nexa_payment_event_id, motivo FROM cartera.moras_condonaciones WHERE credito_id = ${c}`;
  expect(cond).toMatchObject({ usuario_id: sistema, intento_id: null, nexa_payment_event_id: e1, motivo: "NEXA_ACH_A_TIEMPO" });
  const [h] = await env.sql`SELECT origen, usuario_id FROM cartera.moras_historial WHERE credito_id = ${c}`;
  expect(h).toMatchObject({ origen: "CONDONACION_NEXA_A_TIEMPO", usuario_id: sistema });
  // explícito
  const c2 = await nuevoCredito(env);
  const r = await env.latefee.condonarMoraDeCuotas({
    credito_id: c2, montoMoraEsperado: "119.47", monto: "7.47", cuotas: [{ cuota_id: c2 * 10 + 5, monto: "7.47" }],
    origen: "CONDONACION_NEXA_A_TIEMPO", nexa_payment_event_id: nuevoEvento(), motivo: "NEXA_ACH_A_TIEMPO",
  });
  expect(r.kind).toBe("condonada");
  // idempotencia por evento
  expect((await condonarNexa(env, c, e1, "112.00")).kind).toBe("ya_condonada");
  expect((await mora(env, c)).monto_mora).toBe("112.00");
});

integrationTest("NEXA: anular por evento restituye la mora con origen Nexa, es idempotente y deja el evento reutilizable", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const e = nuevoEvento();
  await condonarNexa(env, c, e);
  expect(await env.latefee.anularCondonacionNexaATiempo({ nexa_payment_event_id: e, motivo: "rechazo" })).toEqual({ anulada: true, monto: "7.47", restituida: true });
  expect(await env.latefee.anularCondonacionNexaATiempo({ nexa_payment_event_id: e, motivo: "otra vez" })).toEqual({ anulada: false });
  expect(await mora(env, c)).toEqual({ monto_mora: "119.47", activa: true });
  const hist = await env.sql`SELECT origen FROM cartera.moras_historial WHERE credito_id = ${c} ORDER BY historial_id`;
  expect(hist.map((h) => h.origen)).toEqual(["CONDONACION_NEXA_A_TIEMPO", "CONDONACION_NEXA_A_TIEMPO"]);
  expect((await condonarNexa(env, c, e)).kind).toBe("condonada");
});

integrationTest("NEXA: la guarda 'pago posterior no vinculado' sigue; un pago anulado (paymentFalse) o vinculado al mismo evento NO la dispara; porPagoPendienteRevertido la salta", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const { sql, latefee } = env;
  // a) pago posterior no vinculado: conserva
  const a = await nuevoCredito(env);
  const ea = nuevoEvento();
  await condonarNexa(env, a, ea);
  const [{ pago_id }] = await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, validation_status, monto_aplicado)
    VALUES (${a}, ${a * 10 + 5}, 'VALIDATED', 100) RETURNING pago_id`;
  const r = await latefee.anularCondonacionNexaATiempo({ nexa_payment_event_id: ea, motivo: "rechazo" });
  expect(r).toMatchObject({ anulada: false, motivo: "pago_posterior_no_vinculado", credito_id: a, pago_id });
  expect(await mora(env, a)).toEqual({ monto_mora: "112.00", activa: true });
  const [mc] = await sql`SELECT motivo, anulada_at FROM cartera.moras_condonaciones WHERE credito_id = ${a}`;
  expect(mc!.anulada_at).toBeNull();
  expect(mc!.motivo.length).toBeGreaterThan("NEXA_ACH_A_TIEMPO".length); // quedó la marca
  // a2) con porPagoPendienteRevertido la guarda no aplica
  expect(await latefee.anularCondonacionNexaATiempo({ nexa_payment_event_id: ea, motivo: "pendiente caído", porPagoPendienteRevertido: true }))
    .toEqual({ anulada: true, monto: "7.47", restituida: true });
  expect(await mora(env, a)).toEqual({ monto_mora: "119.47", activa: true });
  // b) pago posterior pero anulado (paymentFalse): no cuenta
  const b = await nuevoCredito(env);
  const eb = nuevoEvento();
  await condonarNexa(env, b, eb);
  await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, validation_status, monto_aplicado, "paymentFalse") VALUES (${b}, ${b * 10 + 5}, 'VALIDATED', 100, true)`;
  expect(await latefee.anularCondonacionNexaATiempo({ nexa_payment_event_id: eb, motivo: "x" })).toEqual({ anulada: true, monto: "7.47", restituida: true });
  // c) pago vinculado al MISMO evento: no cuenta
  const c = await nuevoCredito(env);
  const ec = nuevoEvento();
  await condonarNexa(env, c, ec);
  await sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, validation_status, monto_aplicado, nexa_payment_event_id) VALUES (${c}, ${c * 10 + 5}, 'VALIDATED', 100, ${ec})`;
  expect(await latefee.anularCondonacionNexaATiempo({ nexa_payment_event_id: ec, motivo: "x" })).toEqual({ anulada: true, monto: "7.47", restituida: true });
});

integrationTest("NEXA vs BT: la boleta tardía NUNCA aplica la guarda de pago posterior (anula aunque haya pagos posteriores)", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const intento = nuevoIntento();
  await condonar(env, c, intento);
  await env.sql`INSERT INTO cartera.pagos_credito (credito_id, cuota_id, validation_status, monto_aplicado) VALUES (${c}, ${c * 10 + 5}, 'VALIDATED', 100)`;
  expect(await anularPorIntento(env, { intento_id: intento, motivo: "x" })).toMatchObject({ anulada: true, monto: "7.47" });
  expect(await mora(env, c)).toEqual({ monto_mora: "119.47", activa: true });
});

integrationTest("AISLAMIENTO: cada anulación toca solo lo suyo: BT no anula Nexa (ni por intento ni por condonacion_id) y Nexa no anula BT; conviven en el mismo crédito", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const evento = nuevoEvento();
  const intento = nuevoIntento();
  const rn = await condonarNexa(env, c, evento); // 119.47 -> 112.00
  const rb = await condonar(env, c, intento, { esperado: "112.00", monto: "3.00", cuotas: [{ cuota_id: c * 10 + 4, monto: "3.00" }] }); // -> 109.00
  if (rn.kind !== "condonada" || rb.kind !== "condonada") throw new Error("no condonó");
  expect(await env.latefee.anularCondonacionBoletaTardia({ condonacion_id: rn.condonacion_id, motivo: "x" })).toEqual({ anulada: false });
  expect(await anularPorIntento(env, { intento_id: nuevoIntento(), motivo: "x" })).toEqual({ anulada: false });
  expect((await mora(env, c)).monto_mora).toBe("109.00");
  // Nexa anula la suya sin afectar la BT
  expect(await env.latefee.anularCondonacionNexaATiempo({ nexa_payment_event_id: evento, motivo: "rechazo" })).toEqual({ anulada: true, monto: "7.47", restituida: true });
  expect((await mora(env, c)).monto_mora).toBe("116.47");
  const vivas = await env.sql`SELECT condonacion_id FROM cartera.moras_condonaciones WHERE credito_id = ${c} AND anulada_at IS NULL`;
  expect(vivas.map((v) => v.condonacion_id)).toEqual([rb.condonacion_id]);
  // el evento Nexa no puede anular nada de la BT (no tiene nexa_payment_event_id)
  expect(await env.latefee.anularCondonacionNexaATiempo({ nexa_payment_event_id: nuevoEvento(), motivo: "x" })).toEqual({ anulada: false });
  expect(await anularPorIntento(env, { intento_id: intento, motivo: "x" })).toMatchObject({ anulada: true });
  expect((await mora(env, c)).monto_mora).toBe("119.47");
});

integrationTest("LLAVES: nexa_payment_event_id sin origen + intento_id, o BT con nexa_payment_event_id, o ninguna llave: lanzan y no escriben", async () => {
  const env = await levantarEsquemaBoletaTardia();
  const c = await nuevoCredito(env);
  const base = { credito_id: c, montoMoraEsperado: "119.47", monto: "7.47", cuotas: [{ cuota_id: c * 10 + 5, monto: "7.47" }], motivo: "m" };
  await expect(env.latefee.condonarMoraDeCuotas({ ...base, nexa_payment_event_id: 1, intento_id: nuevoIntento() } as never)).rejects.toThrow(/llave/);
  await expect(env.latefee.condonarMoraDeCuotas({ ...base, origen: "CONDONACION_BOLETA_TARDIA", intento_id: nuevoIntento(), nexa_payment_event_id: 1 } as never)).rejects.toThrow(/llave/);
  await expect(env.latefee.condonarMoraDeCuotas({ ...base } as never)).rejects.toThrow(/llave/);
  await expect(env.latefee.condonarMoraDeCuotas({ ...base, origen: "CONDONACION_NEXA_A_TIEMPO" } as never)).rejects.toThrow(/llave/);
  expect((await mora(env, c)).monto_mora).toBe("119.47");
  expect(await cuenta(env, "moras_condonaciones", c)).toBe(0);
});
