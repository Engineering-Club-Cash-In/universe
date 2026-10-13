import { afterAll, expect } from "bun:test";
import { sql as dsql } from "drizzle-orm";
import {
  EMAIL_ASESOR, cerrarEsquemaBoletaTardia, condonarBT, integrationTest, levantarEsquemaBoletaTardia, uuidIntento,
} from "./boletaTardiaTestDb";

afterAll(cerrarEsquemaBoletaTardia);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const terminaAntesDe = async <T>(p: Promise<T>, ms = 5_000) =>
  Promise.race([p.then(() => "termino" as const), sleep(ms).then(() => "colgado" as const)]);

integrationTest("condona por intento: cola de auditoría completa, a nombre del asesor, con el origen nuevo", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  const r = await condonarBT(latefee, 1, uuidIntento(1));
  expect(r.kind).toBe("condonada");
  const [c] = await sql`SELECT c.intento_id, c.nexa_payment_event_id, c.monto_condonacion, c.anulada_at, u.email
    FROM cartera.moras_condonaciones c JOIN cartera.platform_users u ON u.id = c.usuario_id WHERE c.credito_id = 1`;
  expect(c).toMatchObject({ intento_id: uuidIntento(1), nexa_payment_event_id: null, monto_condonacion: "7.47", anulada_at: null, email: EMAIL_ASESOR });
  const [mora] = await sql`SELECT monto_mora, activa FROM cartera.moras_credito WHERE credito_id = 1`;
  expect(mora).toEqual({ monto_mora: "112.00", activa: true });
  const ledger = await sql`SELECT cuota_id, monto, tipo, pago_id FROM cartera.mora_pagada_cuota WHERE credito_id = 1`;
  expect([...ledger]).toEqual([{ cuota_id: 15, monto: "7.466667", tipo: "CONDONACION", pago_id: null }]);
  const hist = await sql`SELECT tipo_evento, origen, monto_anterior, monto_nuevo FROM cartera.moras_historial WHERE credito_id = 1`;
  expect([...hist]).toEqual([{ tipo_evento: "CONDONACION", origen: "CONDONACION_BOLETA_TARDIA", monto_anterior: "119.47", monto_nuevo: "112.00" }]);
});

integrationTest("el mismo intento (secuencial y concurrente) condona una sola vez", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  expect((await condonarBT(latefee, 2, uuidIntento(2))).kind).toBe("condonada");
  expect((await condonarBT(latefee, 2, uuidIntento(2), "112.00")).kind).toBe("ya_condonada");
  const paralelas = await Promise.all([condonarBT(latefee, 3, uuidIntento(3)), condonarBT(latefee, 3, uuidIntento(3))]);
  expect(paralelas.map((r) => r.kind).sort()).toEqual(["condonada", "ya_condonada"]);
  for (const credito of [2, 3]) {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM cartera.moras_condonaciones WHERE credito_id = ${credito}`;
    expect(n).toBe(1);
    const [m] = await sql`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id = ${credito}`;
    expect(m!.monto_mora).toBe("112.00");
  }
});

integrationTest("exige exactamente UNA llave y que el origen coincida con ella", async () => {
  const { latefee } = await levantarEsquemaBoletaTardia();
  const base = { credito_id: 4, montoMoraEsperado: "119.47", monto: "7.47", cuotas: [{ cuota_id: 45, monto: "7.466667" }], motivo: "m" };
  await expect(latefee.condonarMoraDeCuotas({ ...base, nexa_payment_event_id: 9, intento_id: uuidIntento(4), origen: "CONDONACION_BOLETA_TARDIA" } as never)).rejects.toThrow(/llave/);
  await expect(latefee.condonarMoraDeCuotas({ ...base, origen: "CONDONACION_BOLETA_TARDIA" } as never)).rejects.toThrow(/llave/);
  await expect(latefee.condonarMoraDeCuotas({ ...base, intento_id: uuidIntento(4) } as never)).rejects.toThrow(/llave/); // origen Nexa por defecto + intento_id
});

integrationTest("condona con el candado del binding sostenido (FOR KEY SHARE en otra conexión) sin colgarse", async () => {
  const { sql, latefee, lock } = await levantarEsquemaBoletaTardia();
  const trabajo = lock.withPaymentAdvisoryLock(5, (paymentLock) =>
    lock.withPaymentBindingLock(paymentLock, 5, async () => condonarBT(latefee, 5, uuidIntento(5))));
  const desenlace = await terminaAntesDe(trabajo);
  if (desenlace === "colgado") {
    await sql`SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    await trabajo.catch(() => undefined);
  }
  expect(desenlace).toBe("termino");
});

integrationTest("anular por intento: restituye la mora, compensa el ledger, es idempotente y libera el intento", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  await condonarBT(latefee, 6, uuidIntento(6));
  const r = await latefee.anularCondonacionBoletaTardia({ intento_id: uuidIntento(6), credito_id: 6, motivo: "pago anulado" });
  expect(r).toMatchObject({ anulada: true, monto: "7.47" });
  const [mora] = await sql`SELECT monto_mora, activa FROM cartera.moras_credito WHERE credito_id = 6`;
  expect(mora).toEqual({ monto_mora: "119.47", activa: true });
  const [cond] = await sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE intento_id = ${uuidIntento(6)}`;
  expect(cond!.anulada_at).not.toBeNull();
  const tipos = await sql`SELECT tipo FROM cartera.mora_pagada_cuota WHERE credito_id = 6 ORDER BY id`;
  expect(tipos.map((t) => t.tipo)).toEqual(["CONDONACION", "ANULACION"]);
  const [{ saldo }] = await sql`SELECT COALESCE(SUM(monto),0)::text AS saldo FROM cartera.mora_pagada_cuota WHERE credito_id = 6`;
  expect(Number(saldo)).toBe(0);
  const hist = await sql`SELECT tipo_evento, origen FROM cartera.moras_historial WHERE credito_id = 6 ORDER BY historial_id`;
  expect(hist.map((h) => [h.tipo_evento, h.origen])).toEqual([["CONDONACION", "CONDONACION_BOLETA_TARDIA"], ["INCREMENTO", "CONDONACION_BOLETA_TARDIA"]]);
  // segunda anulación: nada
  expect(await latefee.anularCondonacionBoletaTardia({ intento_id: uuidIntento(6), credito_id: 6, motivo: "otra vez" })).toEqual({ anulada: false });
  // el intento anulado ya no ocupa el índice: puede volver a condonar
  expect((await condonarBT(latefee, 6, uuidIntento(6))).kind).toBe("condonada");
});

integrationTest("anular por condonacion_id equivale a anular por intento; sin llave o con las dos, lanza", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  const r = await condonarBT(latefee, 7, uuidIntento(7));
  if (r.kind === "sin_cambio") throw new Error("no condonó");
  const a = await latefee.anularCondonacionBoletaTardia({ condonacion_id: r.condonacion_id, motivo: "x" });
  expect(a).toMatchObject({ anulada: true, condonacion_id: r.condonacion_id });
  const [m] = await sql`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id = 7`;
  expect(m!.monto_mora).toBe("119.47");
  await expect(latefee.anularCondonacionBoletaTardia({ motivo: "x" } as never)).rejects.toThrow();
  await expect(latefee.anularCondonacionBoletaTardia({ intento_id: uuidIntento(7), credito_id: 7, condonacion_id: 1, motivo: "x" } as never)).rejects.toThrow();
});

integrationTest("no toca las condonaciones de Nexa (ni por condonacion_id) ni las ya anuladas", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  const nexa = await latefee.condonarMoraDeCuotas({
    credito_id: 9, montoMoraEsperado: "119.47", monto: "7.47", cuotas: [{ cuota_id: 95, monto: "7.466667" }],
    nexa_payment_event_id: 909, motivo: "NEXA_ACH_A_TIEMPO",
  });
  if (nexa.kind === "sin_cambio") throw new Error("no condonó");
  expect(await latefee.anularCondonacionBoletaTardia({ condonacion_id: nexa.condonacion_id, motivo: "x", reactivarMora: true }))
    .toEqual({ anulada: false });
  const [v] = await sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE condonacion_id = ${nexa.condonacion_id}`;
  expect(v!.anulada_at).toBeNull();
  const [m] = await sql`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id = 9`;
  expect(m!.monto_mora).toBe("112.00");
  // una BT ya anulada tampoco se anula otra vez, ni por condonacion_id
  const bt = await condonarBT(latefee, 8, uuidIntento(8));
  if (bt.kind === "sin_cambio") throw new Error("no condonó");
  await latefee.anularCondonacionBoletaTardia({ condonacion_id: bt.condonacion_id, motivo: "x" });
  expect(await latefee.anularCondonacionBoletaTardia({ condonacion_id: bt.condonacion_id, motivo: "otra vez" })).toEqual({ anulada: false });
  const [m8] = await sql`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id = 8`;
  expect(m8!.monto_mora).toBe("119.47");
});

integrationTest("anular por intento exige el crédito: el mismo intento pedido para otro crédito no anula nada", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  await condonarBT(latefee, 25, uuidIntento(25));
  expect(await latefee.anularCondonacionBoletaTardia({ intento_id: uuidIntento(25), credito_id: 26, motivo: "x" })).toEqual({ anulada: false });
  const [c] = await sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE intento_id = ${uuidIntento(25)}`;
  expect(c!.anulada_at).toBeNull();
  await expect(latefee.anularCondonacionBoletaTardia({ intento_id: uuidIntento(25), motivo: "x" } as never)).rejects.toThrow(/credito_id/);
});

integrationTest("crédito en estado protegido (CANCELADO): reactivarMora no reactiva la mora; ledger compensado y rastro en el motivo de la condonación", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  await condonarBT(latefee, 27, uuidIntento(27));
  await sql`UPDATE cartera.moras_credito SET activa = false, monto_mora = 0 WHERE credito_id = 27`;
  await sql`UPDATE cartera.creditos SET "statusCredit" = 'CANCELADO' WHERE credito_id = 27`;
  const r = await latefee.anularCondonacionBoletaTardia({ intento_id: uuidIntento(27), credito_id: 27, motivo: "pago anulado", reactivarMora: true });
  expect(r).toMatchObject({ anulada: true, restituida: false });
  const [m] = await sql`SELECT monto_mora, activa FROM cartera.moras_credito WHERE credito_id = 27`;
  expect(m).toEqual({ monto_mora: "0.00", activa: false });
  const [cr] = await sql`SELECT "statusCredit" FROM cartera.creditos WHERE credito_id = 27`;
  expect(cr!.statusCredit).toBe("CANCELADO");
  const tipos = await sql`SELECT tipo FROM cartera.mora_pagada_cuota WHERE credito_id = 27 ORDER BY id`;
  expect(tipos.map((t) => t.tipo)).toEqual(["CONDONACION", "ANULACION"]);
  const hist = await sql`SELECT tipo_evento FROM cartera.moras_historial WHERE credito_id = 27 ORDER BY historial_id`;
  expect(hist.map((h) => h.tipo_evento)).toEqual(["CONDONACION"]); // solo la condonación original: sin marcador
  const [c] = await sql`SELECT motivo FROM cartera.moras_condonaciones WHERE intento_id = ${uuidIntento(27)}`;
  expect(c!.motivo).toContain("SIN restituir la mora (estado protegido CANCELADO)");
});

integrationTest("la anulación firma con el actor: ledger e INCREMENTO a su nombre; un email inexistente lanza", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  await sql`INSERT INTO cartera.platform_users (email, password_hash, role) VALUES ('actor.f5@clubcashin.test', '!x', 'ADMIN')`;
  const [{ id: actor }] = await sql`SELECT id FROM cartera.platform_users WHERE email = 'actor.f5@clubcashin.test'`;
  await condonarBT(latefee, 28, uuidIntento(28));
  const r = await latefee.anularCondonacionBoletaTardia({ intento_id: uuidIntento(28), credito_id: 28, motivo: "m", usuario_email: "actor.f5@clubcashin.test" });
  expect(r).toMatchObject({ anulada: true, restituida: true });
  const [an] = await sql`SELECT usuario_id FROM cartera.mora_pagada_cuota WHERE credito_id = 28 AND tipo = 'ANULACION'`;
  const [inc] = await sql`SELECT usuario_id FROM cartera.moras_historial WHERE credito_id = 28 AND tipo_evento = 'INCREMENTO'`;
  expect([an!.usuario_id, inc!.usuario_id]).toEqual([actor, actor]);
  await condonarBT(latefee, 29, uuidIntento(29));
  await expect(latefee.anularCondonacionBoletaTardia({ intento_id: uuidIntento(29), credito_id: 29, motivo: "m", usuario_email: "nadie@x.test" })).rejects.toThrow(/nadie@x.test/);
  const [c] = await sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE intento_id = ${uuidIntento(29)}`;
  expect(c!.anulada_at).toBeNull();
});

integrationTest("reactivarMora: con la mora apagada, la anulación la reactiva con lo condonado; sin la opción solo compensa el ledger", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  for (const id of [10, 11]) {
    await condonarBT(latefee, id, uuidIntento(id));
    await sql`UPDATE cartera.moras_credito SET activa = false, monto_mora = 0, cuotas_atrasadas = 0 WHERE credito_id = ${id}`; // el pago dejó al día y se apagó
    await sql`UPDATE cartera.creditos SET "statusCredit" = 'ACTIVO' WHERE credito_id = ${id}`;
  }
  await latefee.anularCondonacionBoletaTardia({ intento_id: uuidIntento(10), credito_id: 10, motivo: "pago anulado", reactivarMora: true });
  const [con] = await sql`SELECT monto_mora, activa FROM cartera.moras_credito WHERE credito_id = 10`;
  expect(con).toEqual({ monto_mora: "7.47", activa: true });
  // F6: las cuotas atrasadas se recalculan con el criterio del cron (2 vencidas impagas), no quedan en 0
  const [at] = await sql`SELECT cuotas_atrasadas FROM cartera.moras_credito WHERE credito_id = 10`;
  expect(at!.cuotas_atrasadas).toBe(2);
  // F7: el evento INCREMENTO y el estado del crédito
  const [ev] = await sql`SELECT tipo_evento, origen, monto_anterior, monto_nuevo, cuotas_atrasadas_nuevas FROM cartera.moras_historial
    WHERE credito_id = 10 AND tipo_evento = 'INCREMENTO'`;
  expect(ev).toEqual({ tipo_evento: "INCREMENTO", origen: "CONDONACION_BOLETA_TARDIA", monto_anterior: "0.00", monto_nuevo: "7.47", cuotas_atrasadas_nuevas: 2 });
  const [cr] = await sql`SELECT "statusCredit" FROM cartera.creditos WHERE credito_id = 10`;
  expect(cr!.statusCredit).toBe("MOROSO");
  await latefee.anularCondonacionBoletaTardia({ intento_id: uuidIntento(11), credito_id: 11, motivo: "pago anulado" });
  const [sin] = await sql`SELECT monto_mora, activa FROM cartera.moras_credito WHERE credito_id = 11`;
  expect(sin).toEqual({ monto_mora: "0.00", activa: false });
  const tipos = await sql`SELECT tipo FROM cartera.mora_pagada_cuota WHERE credito_id = 11 ORDER BY id`;
  expect(tipos.map((t) => t.tipo)).toEqual(["CONDONACION", "ANULACION"]); // el ledger sí queda compensado
});

integrationTest("anular dentro de la transacción de quien llama (que ya tiene creditos FOR UPDATE) no se cuelga", async () => {
  const { latefee, database, sql } = await levantarEsquemaBoletaTardia();
  await condonarBT(latefee, 12, uuidIntento(12));
  const trabajo = database.db.transaction(async (tx) => {
    await tx.execute(dsql`SELECT credito_id FROM cartera.creditos WHERE credito_id = 12 FOR UPDATE`);
    return latefee.anularCondonacionBoletaTardia({ intento_id: uuidIntento(12), credito_id: 12, motivo: "pago anulado", dbClient: tx as never });
  });
  const desenlace = await terminaAntesDe(trabajo);
  if (desenlace === "colgado") {
    await sql`SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    await trabajo.catch(() => undefined);
  }
  expect(desenlace).toBe("termino");
  const [m] = await sql`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id = 12`;
  expect(m!.monto_mora).toBe("119.47");
});

integrationTest("Nexa sigue igual: condona por evento y anula por evento", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  const c = await latefee.condonarMoraDeCuotas({
    credito_id: 13, montoMoraEsperado: "119.47", monto: "7.47", cuotas: [{ cuota_id: 135, monto: "7.466667" }],
    nexa_payment_event_id: 1301, motivo: "NEXA_ACH_A_TIEMPO",
  });
  expect(c.kind).toBe("condonada");
  expect(await latefee.anularCondonacionNexaATiempo({ nexa_payment_event_id: 1301, motivo: "rechazo" })).toEqual({ anulada: true, monto: "7.47" });
  const [m] = await sql`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id = 13`;
  expect(m!.monto_mora).toBe("119.47");
  const hist = await sql`SELECT origen FROM cartera.moras_historial WHERE credito_id = 13 ORDER BY historial_id`;
  expect(hist.map((h) => h.origen)).toEqual(["CONDONACION_NEXA_A_TIEMPO", "CONDONACION_NEXA_A_TIEMPO"]);
});

integrationTest("un intento vivo en otro crédito no se reusa: lanza y no toca la mora del segundo", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  expect((await condonarBT(latefee, 20, uuidIntento(20))).kind).toBe("condonada");
  await expect(condonarBT(latefee, 21, uuidIntento(20))).rejects.toThrow(/otro crédito/);
  const [m] = await sql`SELECT monto_mora FROM cartera.moras_credito WHERE credito_id = 21`;
  expect(m!.monto_mora).toBe("119.47");
});

integrationTest("el ledger conserva el reparto por cuota SIN redondear a centavos (6 decimales, como Nexa; no lo 'arreglen')", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  await sql`INSERT INTO cartera.cuotas_credito VALUES (2301, 23), (2302, 23)`;
  const r = await latefee.condonarMoraDeCuotas({
    credito_id: 23, montoMoraEsperado: "119.47", monto: "7.47",
    cuotas: [{ cuota_id: 234, monto: "2.486667" }, { cuota_id: 2301, monto: "2.486667" }, { cuota_id: 2302, monto: "2.496666" }],
    origen: "CONDONACION_BOLETA_TARDIA", intento_id: uuidIntento(23), usuario_email: EMAIL_ASESOR, motivo: "m",
  });
  expect(r.kind).toBe("condonada");
  const filas = await sql`SELECT monto::text FROM cartera.mora_pagada_cuota WHERE credito_id = 23 ORDER BY id`;
  expect(filas.map((f) => f.monto)).toEqual(["2.486667", "2.486667", "2.496666"]);
});

integrationTest("reactivarMora sin cuotas vencidas (criterio del cron): no reactiva, restituida:false y razón en el motivo", async () => {
  const { sql, latefee } = await levantarEsquemaBoletaTardia();
  await condonarBT(latefee, 30, uuidIntento(30));
  await sql`UPDATE cartera.moras_credito SET activa = false, monto_mora = 0, cuotas_atrasadas = 0 WHERE credito_id = 30`;
  await sql`UPDATE cartera.cuotas_credito SET pagado = true WHERE credito_id = 30`;
  const r = await latefee.anularCondonacionBoletaTardia({ intento_id: uuidIntento(30), credito_id: 30, motivo: "x", reactivarMora: true });
  expect(r).toMatchObject({ anulada: true, restituida: false });
  const [m] = await sql`SELECT monto_mora, activa FROM cartera.moras_credito WHERE credito_id = 30`;
  expect(m).toEqual({ monto_mora: "0.00", activa: false });
  const [c] = await sql`SELECT motivo FROM cartera.moras_condonaciones WHERE intento_id = ${uuidIntento(30)}`;
  expect(c!.motivo).toContain("(sin cuotas vencidas)");
});
