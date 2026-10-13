import { afterAll, expect } from "bun:test";
import { sql as dsql } from "drizzle-orm";
import {
  cerrarEsquemaBoletaTardia, condonarBT, EMAIL_ASESOR, integrationTest, levantarEsquemaBoletaTardia, uuidIntento, type Entorno,
} from "./boletaTardiaTestDb";
import { anularCondonacionPorPagoInvalidado, emailVigenteDelActor } from "./condonacionBoletaTardiaAnulacion";

afterAll(cerrarEsquemaBoletaTardia);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const terminaAntesDe = async <T>(p: Promise<T>, ms = 5_000) =>
  Promise.race([p.then(() => "termino" as const), sleep(ms).then(() => "colgado" as const)]);

/** Lo que hacen anularPagoYRestituirMora / reversePayment: tx con creditos FOR UPDATE → restituir L → gancho. */
async function invalidar(env: Entorno, credito: number, intento: string | null, opciones: {
  restituirL?: string; accion?: "anulo" | "revirtio"; pago_id?: number; usuario_email?: string;
} = {}) {
  const { database, latefee, sql } = env;
  const trabajo = database.db.transaction(async (tx) => {
    await tx.execute(dsql`SELECT credito_id FROM cartera.creditos WHERE credito_id = ${credito} FOR UPDATE`);
    if (opciones.restituirL) {
      const r = await latefee.updateMora({ credito_id: credito, tipo: "INCREMENTO", activa: true, monto_cambio: opciones.restituirL,
        motivo: "restitución de la mora legítima", dbClient: tx as never });
      if (!r.success) throw new Error("no restituyó L");
    }
    return anularCondonacionPorPagoInvalidado({
      credito_id: credito, pago_id: opciones.pago_id ?? 900, accion: opciones.accion ?? "anulo", dbClient: tx as never,
      boleta_tardia_intento_id: intento, usuario_email: opciones.usuario_email,
    });
  });
  const desenlace = await terminaAntesDe(trabajo);
  if (desenlace === "colgado") {
    await sql`SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    await trabajo.catch(() => undefined);
  }
  expect(desenlace).toBe("termino");
  return trabajo;
}
const mora = async (env: Entorno, credito: number) =>
  (await env.sql`SELECT monto_mora, activa FROM cartera.moras_credito WHERE credito_id = ${credito}`)[0] as { monto_mora: string; activa: boolean };

integrationTest("L > 0: el pago cobró la legítima L (112.00) y se condonó X (7.47); al anularlo la mora vuelve a L + X UNA sola vez", async () => {
  const env = await levantarEsquemaBoletaTardia();
  await condonarBT(env.latefee, 20, uuidIntento(220));
  await env.latefee.updateMora({ credito_id: 20, tipo: "DECREMENTO", monto_cambio: "112.00", motivo: "cobro de mora legítima" });
  expect(await mora(env, 20)).toEqual({ monto_mora: "0.00", activa: false });

  const r = await invalidar(env, 20, uuidIntento(220), { restituirL: "112.00" });
  expect(r).toMatchObject({ anulada: true });
  expect(await mora(env, 20)).toEqual({ monto_mora: "119.47", activa: true });
  const tipos = await env.sql`SELECT tipo FROM cartera.mora_pagada_cuota WHERE credito_id = 20 ORDER BY id`;
  expect(tipos.map((t) => t.tipo)).toEqual(["CONDONACION", "ANULACION"]);
  const [{ neto }] = await env.sql`SELECT COALESCE(SUM(monto),0)::text AS neto FROM cartera.mora_pagada_cuota WHERE credito_id = 20`;
  expect(Number(neto)).toBe(0);
  const [c] = await env.sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE intento_id = ${uuidIntento(220)}`;
  expect(c!.anulada_at).not.toBeNull();
});

integrationTest("L = 0 (todo era retraso) y la mora ya estaba apagada: la anulación la REACTIVA con lo condonado", async () => {
  const env = await levantarEsquemaBoletaTardia();
  await env.sql`UPDATE cartera.moras_credito SET monto_mora = 7.47, cuotas_atrasadas = 1 WHERE credito_id = 21`;
  await condonarBT(env.latefee, 21, uuidIntento(221), "7.47");
  await env.sql`UPDATE cartera.moras_credito SET activa = false WHERE credito_id = 21`;
  await invalidar(env, 21, uuidIntento(221));
  expect(await mora(env, 21)).toEqual({ monto_mora: "7.47", activa: true });
});

integrationTest("segunda invalidación de otra fila de la misma boleta (mismo intento): no restituye de nuevo", async () => {
  const env = await levantarEsquemaBoletaTardia();
  await condonarBT(env.latefee, 22, uuidIntento(222));
  await invalidar(env, 22, uuidIntento(222), { pago_id: 901 });
  const segunda = await invalidar(env, 22, uuidIntento(222), { pago_id: 902 });
  expect(segunda).toEqual({ anulada: false });
  expect(await mora(env, 22)).toEqual({ monto_mora: "119.47", activa: true });
});

integrationTest("una fila sin intento (pago normal) no toca la condonación viva del crédito", async () => {
  const env = await levantarEsquemaBoletaTardia();
  await condonarBT(env.latefee, 23, uuidIntento(223));
  expect(await invalidar(env, 23, null)).toEqual({ anulada: false });
  const [c] = await env.sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE intento_id = ${uuidIntento(223)}`;
  expect(c!.anulada_at).toBeNull();
});

integrationTest("un intento sin condonación, o la condonación Nexa del mismo crédito, quedan intactos", async () => {
  const env = await levantarEsquemaBoletaTardia();
  await env.latefee.condonarMoraDeCuotas({
    credito_id: 24, montoMoraEsperado: "119.47", monto: "7.47", cuotas: [{ cuota_id: 245, monto: "7.466667" }],
    nexa_payment_event_id: 2401, motivo: "NEXA_ACH_A_TIEMPO",
  });
  expect(await invalidar(env, 24, uuidIntento(224))).toEqual({ anulada: false });
  const [v] = await env.sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE nexa_payment_event_id = 2401`;
  expect(v!.anulada_at).toBeNull();
});

integrationTest("un intento reusado en OTRO crédito no anula la condonación del crédito que se invalida", async () => {
  const env = await levantarEsquemaBoletaTardia();
  await condonarBT(env.latefee, 26, uuidIntento(226));
  expect(await invalidar(env, 27, uuidIntento(226))).toEqual({ anulada: false });
  const [c] = await env.sql`SELECT anulada_at FROM cartera.moras_condonaciones WHERE intento_id = ${uuidIntento(226)}`;
  expect(c!.anulada_at).toBeNull();
});

integrationTest("revertir un pago (no solo anularlo): misma anulación, con el pago y el verbo en el historial", async () => {
  const env = await levantarEsquemaBoletaTardia();
  await condonarBT(env.latefee, 25, uuidIntento(225));
  await invalidar(env, 25, uuidIntento(225), { accion: "revirtio", pago_id: 777 });
  const [h] = await env.sql`SELECT motivo, origen FROM cartera.moras_historial WHERE credito_id = 25 AND tipo_evento = 'INCREMENTO'`;
  expect(h!.motivo).toContain("777");
  expect(h!.motivo).toContain("revirtió");
  expect(h!.origen).toBe("CONDONACION_BOLETA_TARDIA");
});

integrationTest("E-7: la anulación y el aumento de mora quedan a nombre del actor que invalidó el pago", async () => {
  const env = await levantarEsquemaBoletaTardia();
  await condonarBT(env.latefee, 28, uuidIntento(228));
  await invalidar(env, 28, uuidIntento(228), { usuario_email: EMAIL_ASESOR });
  const [h] = await env.sql`
    SELECT u.email FROM cartera.moras_historial h JOIN cartera.platform_users u ON u.id = h.usuario_id
    WHERE h.credito_id = 28 AND h.tipo_evento = 'INCREMENTO'`;
  expect(h!.email).toBe(EMAIL_ASESOR);
});

integrationTest("F3: un actor INACTIVO que existe en platform_users firma con su email; sin fila o sin id cae al sistema", async () => {
  const env = await levantarEsquemaBoletaTardia();
  // findSessionUser lee estas columnas, que el esquema mínimo del fixture no trae.
  await env.sql`ALTER TABLE cartera.platform_users ADD COLUMN IF NOT EXISTS admin_id integer, ADD COLUMN IF NOT EXISTS asesor_id integer, ADD COLUMN IF NOT EXISTS conta_id integer`;
  const [u] = await env.sql`INSERT INTO cartera.platform_users (email, password_hash, role, is_active)
    VALUES ('inactivo.t8@clubcashin.test', '!sin-login', 'ASESOR', false) RETURNING id`;
  expect(await emailVigenteDelActor({ id: u!.id })).toBe("inactivo.t8@clubcashin.test");
  expect(await emailVigenteDelActor({ id: 987654 })).toBeUndefined();
  expect(await emailVigenteDelActor(undefined)).toBeUndefined();
});
