// CB-033 — Tests de integración de `decidirConvenio` contra PostgreSQL real
// (no mocks). Las garantías que se prueban acá —`ON CONFLICT` como candado,
// visibilidad transaccional, rollback, CHECK de la DB— son comportamiento
// del motor: un mock las daría por buenas sin probar nada.
//
// ⚠️ ESTA SUITE ESCRIBE EN LA DB: crea créditos y convenios, DESACTIVA UN
// TRIGGER de `creditos` mientras siembra, y borra filas al terminar. Corre
// contra la DB de SUPABASE_DB_URL, que es un `.env` que cualquiera puede
// apuntar a dev o prod sin darse cuenta (pasó: el archivo tiene las tres
// URLs y se cambia comentando líneas). Un comentario que diga "solo local"
// no protege nada, así que `assertDbEsLocal()` lo verifica de verdad y
// aborta ANTES de la primera escritura.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../database";
import {
  convenioDecisiones,
  convenioOperaciones,
  convenio_cuotas,
  convenios_pago,
  creditos,
  moras_credito,
  moras_historial,
  SQL_CARTERA_SCHEMA,
} from "../database/db/schema";
import { ConvenioDecisionError, decidirConvenio } from "./convenioDecision";

/**
 * Aborta si SUPABASE_DB_URL no es inequívocamente una base local de
 * pruebas. Se comprueba el HOST (no el nombre de la base): un host remoto
 * es remoto aunque la base se llame "local", y es el único dato que no se
 * puede falsear sin salir de la máquina.
 *
 * Se ejecuta en `beforeAll` para que la suite entera falle con un mensaje
 * legible en vez de empezar a escribir y reventar a mitad de camino.
 */
function assertDbEsLocal(): void {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "[CB-033 tests] SUPABASE_DB_URL no está definida. Esta suite escribe en la DB: " +
        "apuntá a la base local de pruebas antes de correrla.",
    );
  }

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("[CB-033 tests] SUPABASE_DB_URL no es una URL válida.");
  }

  const HOSTS_LOCALES = ["localhost", "127.0.0.1", "::1"];
  if (!HOSTS_LOCALES.includes(host)) {
    throw new Error(
      `[CB-033 tests] ABORTADO: SUPABASE_DB_URL apunta a "${host}", que no es una base local.\n` +
        "Esta suite CREA y BORRA filas y desactiva un trigger de `creditos` — nunca debe correr " +
        "contra dev ni prod. Apuntá el .env a la base local de pruebas (localhost) y reintentá.",
    );
  }
}

// Usuario ADMIN sembrado en el sandbox (ver docker cb114-local-pg). Si no
// existe en el ambiente donde corre esto, los tests que lo usan fallan con
// un mensaje claro de FK en vez de un 500 opaco.
const ADMIN_ID = 1;

// operacion_id que generó ESTA corrida. La limpieza borra solo estos — nunca
// "todas las operaciones en_curso", que en una base compartida se llevaría
// por delante operaciones ajenas en vuelo.
const operacionesCreadas = new Set<string>();
// Crédito real sembrado en el sandbox, usado como plantilla: `creditos`
// tiene ~30 columnas NOT NULL sin default (usuario_id, asesor_id, plazo,
// membresías, etc.) que no son relevantes para estos tests — clonar una
// fila real es más simple y representativo que rellenarlas todas a mano.
const CREDITO_PLANTILLA_ID = 3;

// Base aleatoria (no fija en 900000): si una corrida anterior murió sin
// llegar al afterAll, sus filas TEST-CB033-900xxx quedan en la DB y un
// contador fijo choca con ellas por la UNIQUE de numero_credito_sifco.
let creditoIdCounter = 900000 + Math.floor(Math.random() * 90000);

async function crearCreditoDePrueba(
  overrides: { capital?: string; statusCredit?: string } = {},
) {
  creditoIdCounter += 1;
  const nuevoId = creditoIdCounter;
  const capital = overrides.capital ?? "10000.00";
  const statusCredit = overrides.statusCredit ?? "EN_CONVENIO";

  // trg_historial_capital_credito referencia `cartera.historial_capital_credito`
  // con schema fijo (no respeta search_path); en este sandbox (schema
  // cartera_cobros2, sin schema `cartera`) esa tabla no existe y el trigger
  // revienta cualquier INSERT/UPDATE de `capital`. Es una limitación del
  // sandbox ajena a CB-033 — se deshabilita el trigger solo para sembrar el
  // dato de prueba, no para el flujo real bajo prueba (decidirConvenio no
  // toca `creditos.capital`, solo lo lee).
  await db.execute(sql`ALTER TABLE ${SQL_CARTERA_SCHEMA}.creditos DISABLE TRIGGER trg_historial_capital_credito`);
  try {
    await db.execute(sql`
      INSERT INTO ${SQL_CARTERA_SCHEMA}.creditos
      SELECT
        ${nuevoId} AS credito_id,
        usuario_id, fecha_creacion,
        ${`TEST-CB033-${nuevoId}`} AS numero_credito_sifco,
        ${capital} AS capital,
        porcentaje_interes, deudatotal, cuota_interes, cuota, iva_12,
        seguro_10_cuotas, gps, observaciones, no_poliza, como_se_entero,
        asesor_id, plazo, membresias_pago, membresias, formato_credito,
        porcentaje_royalti, tipo_credito, royalti, paymentfalse,
        ${statusCredit} AS "statusCredit",
        otros, permite_abono_capital, is_vehiculo_propio, bandera_reinversion,
        estado_devolucion, no_amortiza_capital, aseguradora_id, excluir_compras
      FROM ${SQL_CARTERA_SCHEMA}.creditos
      WHERE credito_id = ${CREDITO_PLANTILLA_ID}
    `);
  } finally {
    await db.execute(sql`ALTER TABLE ${SQL_CARTERA_SCHEMA}.creditos ENABLE TRIGGER trg_historial_capital_credito`);
  }

  const [credito] = await db.select().from(creditos).where(eq(creditos.credito_id, nuevoId));
  return credito;
}

async function crearConvenioDePrueba(
  creditoId: number,
  overrides: Partial<typeof convenios_pago.$inferInsert> = {},
) {
  const [convenio] = await db
    .insert(convenios_pago)
    .values({
      credito_id: creditoId,
      monto_total_convenio: "3000.00",
      numero_meses: 3,
      cuota_mensual: "1000.00",
      fecha_convenio: new Date(),
      monto_pendiente: "3000.00",
      pagos_pendientes: 3,
      activo: false,
      completado: false,
      created_by: ADMIN_ID,
      ...overrides,
    } as typeof convenios_pago.$inferInsert)
    .returning();
  return convenio;
}

async function limpiarCredito(creditoId: number) {
  // Dos FKs cruzadas entre estas tablas (ver la migración):
  //   convenio_decisiones.operacion_id -> convenio_operaciones (normal)
  //   convenio_operaciones.decision_id -> convenio_decisiones (DEFERRABLE)
  // TRUNCATE ... CASCADE ignora ambas de una vez — más simple y correcto
  // para limpieza de test que orquestar el orden a mano.
  const operacionIds = (
    await db
      .select({ operacionId: convenioDecisiones.operacionId })
      .from(convenioDecisiones)
      .where(eq(convenioDecisiones.creditoId, creditoId))
  ).map((d) => d.operacionId);
  for (const opId of operacionIds) {
    // Soltar la referencia inversa antes: estado vuelve a 'en_curso' porque
    // el CHECK ck_convenio_operaciones_completa exige decision_id NOT NULL
    // cuando estado='completada' — no se puede dejar decision_id NULL con
    // estado sin cambiar.
    await db
      .update(convenioOperaciones)
      .set({ estado: "en_curso", decisionId: null, resultado: null, completadaEn: null })
      .where(eq(convenioOperaciones.operacionId, opId));
  }
  await db.delete(convenioDecisiones).where(eq(convenioDecisiones.creditoId, creditoId));
  for (const opId of operacionIds) {
    await db.delete(convenioOperaciones).where(eq(convenioOperaciones.operacionId, opId));
  }
  const convenios = await db
    .select({ convenio_id: convenios_pago.convenio_id })
    .from(convenios_pago)
    .where(eq(convenios_pago.credito_id, creditoId));
  for (const c of convenios) {
    await db.delete(convenio_cuotas).where(eq(convenio_cuotas.convenio_id, c.convenio_id));
    await db.delete(convenios_pago).where(eq(convenios_pago.convenio_id, c.convenio_id));
  }
  await db.delete(moras_historial).where(eq(moras_historial.credito_id, creditoId));
  await db.delete(moras_credito).where(eq(moras_credito.credito_id, creditoId));
  const { cuotas_credito } = await import("../database/db/schema");
  await db.delete(cuotas_credito).where(eq(cuotas_credito.credito_id, creditoId));
  await db.delete(creditos).where(eq(creditos.credito_id, creditoId));
}

const creditosCreados: number[] = [];

beforeAll(() => {
  assertDbEsLocal();
});

afterAll(async () => {
  for (const id of creditosCreados) {
    await limpiarCredito(id);
  }
  // Operaciones que quedaron 'en_curso' sin completar (p.ej. el segundo
  // intento de los tests de conflicto, que falla antes de llegar al INSERT
  // de la decisión). Se borran SOLO las de esta corrida: filtrar por
  // `estado='en_curso'` a secas borraría operaciones ajenas que estuvieran
  // en vuelo en ese momento.
  for (const operacionId of operacionesCreadas) {
    await db
      .delete(convenioOperaciones)
      .where(eq(convenioOperaciones.operacionId, operacionId));
  }
});

function inputBase(overrides: Partial<Parameters<typeof decidirConvenio>[0]> = {}) {
  const operacionId = overrides.operacionId ?? crypto.randomUUID();
  operacionesCreadas.add(operacionId);
  return {
    convenioId: 0,
    decision: "aprobado" as const,
    origen: "crm" as const,
    actuadoPor: ADMIN_ID,
    actuadoPorEmail: "admin@test.local",
    decididoPorEmail: "supervisor@test.local",
    ...overrides,
    operacionId,
  };
}

describe("decidirConvenio — integración contra Postgres real (cb114_local)", () => {
  it("aprobar deja el convenio activo=true y una fila de bitácora", async () => {
    const credito = await crearCreditoDePrueba();
    creditosCreados.push(credito.credito_id);
    const convenio = await crearConvenioDePrueba(credito.credito_id);

    const resultado = await decidirConvenio(
      inputBase({ convenioId: convenio.convenio_id, decision: "aprobado" }),
    );

    expect(resultado.idempotente).toBe(false);
    expect(resultado.decision).toBe("aprobado");
    expect(resultado.snapshot.convenio_id).toBe(convenio.convenio_id);

    const [fila] = await db
      .select()
      .from(convenios_pago)
      .where(eq(convenios_pago.convenio_id, convenio.convenio_id));
    expect(fila.activo).toBe(true);

    const [decisionRow] = await db
      .select()
      .from(convenioDecisiones)
      .where(eq(convenioDecisiones.decisionId, resultado.decisionId));
    expect(decisionRow.decision).toBe("aprobado");
    expect(decisionRow.decididoPorEmail).toBe("supervisor@test.local");
  });

  it("rechazar borra el convenio, saca el crédito de EN_CONVENIO y la bitácora conserva el snapshot", async () => {
    // Sin cuotas vencidas: `decidirConvenio` toma la rama "sin mora" y deja
    // el crédito ACTIVO. La recreación de mora (la otra rama) se prueba
    // aparte, en el test que siembra cuotas vencidas de verdad.
    const credito = await crearCreditoDePrueba({ statusCredit: "EN_CONVENIO", capital: "20000.00" });
    creditosCreados.push(credito.credito_id);
    const convenio = await crearConvenioDePrueba(credito.credito_id, {
      monto_total_convenio: "5000.00",
      cuota_mensual: "2500.00",
      numero_meses: 2,
    });

    const resultado = await decidirConvenio(
      inputBase({
        convenioId: convenio.convenio_id,
        decision: "rechazado",
        motivo: "Cliente no acordó estos términos",
      }),
    );

    expect(resultado.decision).toBe("rechazado");
    // El convenio ya no existe — el snapshot es la única evidencia.
    const restante = await db
      .select()
      .from(convenios_pago)
      .where(eq(convenios_pago.convenio_id, convenio.convenio_id));
    expect(restante.length).toBe(0);

    // El crédito salió de EN_CONVENIO: sin cuotas vencidas queda ACTIVO.
    const [creditoTrasRechazo] = await db
      .select({ statusCredit: creditos.statusCredit })
      .from(creditos)
      .where(eq(creditos.credito_id, credito.credito_id));
    expect(creditoTrasRechazo.statusCredit).toBe("ACTIVO");

    const [decisionRow] = await db
      .select()
      .from(convenioDecisiones)
      .where(eq(convenioDecisiones.decisionId, resultado.decisionId));
    expect(decisionRow.motivo).toBe("Cliente no acordó estos términos");
    expect((decisionRow.snapshot as any).monto_total_convenio).toBe("5000.00");
    expect(decisionRow.creditoId).toBe(credito.credito_id); // sobrevive al borrado del convenio
  });

  it("rechazo sin motivo se rechaza ANTES de tocar la DB (validación de la app)", async () => {
    const credito = await crearCreditoDePrueba();
    creditosCreados.push(credito.credito_id);
    const convenio = await crearConvenioDePrueba(credito.credito_id);

    await expect(
      decidirConvenio(inputBase({ convenioId: convenio.convenio_id, decision: "rechazado" })),
    ).rejects.toThrow(ConvenioDecisionError);

    const [fila] = await db
      .select()
      .from(convenios_pago)
      .where(eq(convenios_pago.convenio_id, convenio.convenio_id));
    expect(fila).toBeTruthy(); // sigue existiendo — no se ejecutó nada
  });

  it("CHECK de motivo: la DB también lo frena (bypaseando la validación de la app)", async () => {
    // Inserta directo en convenio_decisiones para probar que el CHECK de
    // Postgres, no solo el guard de la app, impide un rechazo sin motivo.
    const credito = await crearCreditoDePrueba();
    creditosCreados.push(credito.credito_id);
    const opId = crypto.randomUUID();
    operacionesCreadas.add(opId);
    await db.insert(convenioOperaciones).values({
      operacionId: opId,
      requestFingerprint: "test-fingerprint",
      estado: "en_curso",
    });

    const insertar = async () =>
      db.insert(convenioDecisiones).values({
        operacionId: opId,
        convenioId: 1,
        creditoId: credito.credito_id,
        decision: "rechazado",
        motivo: null,
        snapshot: { x: 1 },
        origen: "crm",
        actuadoPor: ADMIN_ID,
        actuadoPorEmail: "a@test.local",
        decididoPorEmail: "b@test.local",
      } as any);

    await expect(insertar()).rejects.toThrow();

    await db.delete(convenioOperaciones).where(eq(convenioOperaciones.operacionId, opId));
  });

  it("mismo operacion_id dos veces (secuencial) → segunda es idempotente, sin segundo efecto", async () => {
    const credito = await crearCreditoDePrueba();
    creditosCreados.push(credito.credito_id);
    const convenio = await crearConvenioDePrueba(credito.credito_id);
    const operacionId = crypto.randomUUID();

    const primero = await decidirConvenio(
      inputBase({ convenioId: convenio.convenio_id, decision: "aprobado", operacionId }),
    );
    const segundo = await decidirConvenio(
      inputBase({ convenioId: convenio.convenio_id, decision: "aprobado", operacionId }),
    );

    expect(primero.idempotente).toBe(false);
    expect(segundo.idempotente).toBe(true);
    expect(segundo.decisionId).toBe(primero.decisionId);

    const filas = await db
      .select()
      .from(convenioDecisiones)
      .where(eq(convenioDecisiones.operacionId, operacionId));
    expect(filas.length).toBe(1); // un solo INSERT, pese a dos llamadas
  });

  it("mismo operacion_id EN PARALELO (Promise.all) → un solo efecto real", async () => {
    const credito = await crearCreditoDePrueba();
    creditosCreados.push(credito.credito_id);
    const convenio = await crearConvenioDePrueba(credito.credito_id);
    const operacionId = crypto.randomUUID();

    const [r1, r2] = await Promise.allSettled([
      decidirConvenio(inputBase({ convenioId: convenio.convenio_id, decision: "aprobado", operacionId })),
      decidirConvenio(inputBase({ convenioId: convenio.convenio_id, decision: "aprobado", operacionId })),
    ]);

    // Ambos deben resolver a ALGO válido (uno ejecuta, el otro recibe el
    // resultado confirmado) — ninguno debe fallar con un error de estado.
    const resultados = [r1, r2].filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<typeof decidirConvenio>>
    >[];
    expect(resultados.length).toBe(2);

    const decisionIds = new Set(resultados.map((r) => r.value.decisionId));
    expect(decisionIds.size).toBe(1); // mismo decisionId en ambas respuestas

    const filas = await db
      .select()
      .from(convenioDecisiones)
      .where(eq(convenioDecisiones.operacionId, operacionId));
    expect(filas.length).toBe(1); // un solo efecto, pese a la carrera
  });

  it("mismo operacion_id con distinto motivo → 409 por fingerprint", async () => {
    const credito = await crearCreditoDePrueba();
    creditosCreados.push(credito.credito_id);
    const convenio = await crearConvenioDePrueba(credito.credito_id);
    const operacionId = crypto.randomUUID();

    await decidirConvenio(
      inputBase({ convenioId: convenio.convenio_id, decision: "aprobado", operacionId }),
    );

    await expect(
      decidirConvenio(
        inputBase({
          convenioId: convenio.convenio_id,
          decision: "aprobado",
          operacionId,
          decididoPorEmail: "otro-supervisor@test.local",
        }),
      ),
    ).rejects.toThrow(ConvenioDecisionError);
  });

  it("dos decisiones distintas (operacion_id distinto) sobre el mismo convenio → solo la primera gana", async () => {
    const credito = await crearCreditoDePrueba();
    creditosCreados.push(credito.credito_id);
    const convenio = await crearConvenioDePrueba(credito.credito_id);

    await decidirConvenio(
      inputBase({ convenioId: convenio.convenio_id, decision: "aprobado" }),
    );

    await expect(
      decidirConvenio(
        inputBase({
          convenioId: convenio.convenio_id,
          decision: "rechazado",
          motivo: "intento tardío",
        }),
      ),
    ).rejects.toThrow(ConvenioDecisionError);

    // El convenio sigue activo=true (de la primera decisión), no se tocó.
    const [fila] = await db
      .select()
      .from(convenios_pago)
      .where(eq(convenios_pago.convenio_id, convenio.convenio_id));
    expect(fila.activo).toBe(true);
  });

  it("convenio ya completado=true no se puede reactivar (regresión: inactive ≠ pendiente)", async () => {
    const credito = await crearCreditoDePrueba();
    creditosCreados.push(credito.credito_id);
    const convenio = await crearConvenioDePrueba(credito.credito_id, {
      activo: false,
      completado: true, // ya se pagó completo — NO es "pendiente de aprobación"
    });

    await expect(
      decidirConvenio(inputBase({ convenioId: convenio.convenio_id, decision: "aprobado" })),
    ).rejects.toThrow(ConvenioDecisionError);

    const [fila] = await db
      .select()
      .from(convenios_pago)
      .where(eq(convenios_pago.convenio_id, convenio.convenio_id));
    expect(fila.activo).toBe(false); // no se reactivó
    expect(fila.completado).toBe(true);
  });

  it("COBERTURA PENDIENTE: la rama de recreación de mora no es ejercitable mientras viva el bug del EXISTS", async () => {
    // Este test NO prueba `decidirConvenio`: documenta —de forma que falle
    // sola cuando deje de ser cierto— por qué la rama "rechazo CON cuotas
    // vencidas → createMora" no tiene cobertura.
    //
    // `contarCuotasVencidasReales` arma un EXISTS que pretende ser
    // correlacionado (`pc.cuota_id = cuotas_credito.cuota_id`), pero Drizzle
    // emite la columna sin calificar (`"cuota_id"`) y Postgres la resuelve
    // contra `pc` — queda `pc.cuota_id = pc.cuota_id`, un InitPlan que se
    // evalúa UNA vez para toda la query. Con cualquier pago válido en la
    // tabla, TODA cuota se marca como pagada y el conteo da 0 siempre.
    //
    // Es un bug preexistente de latefee.ts, ajeno a CB-033 (afecta el
    // cálculo de mora del sistema entero, no solo a este flujo), y por eso
    // no se corrigió acá. Cuando se arregle, este test falla y hay que
    // reemplazarlo por la prueba real de la rama financiera.
    const credito = await crearCreditoDePrueba();
    creditosCreados.push(credito.credito_id);

    const { cuotas_credito } = await import("../database/db/schema");
    await db.insert(cuotas_credito).values({
      credito_id: credito.credito_id,
      numero_cuota: 1,
      fecha_vencimiento: "2020-01-01", // vencida hace años
      pagado: false, // e impaga
    } as any);

    const { contarCuotasVencidasReales } = await import("./latefee");
    const contadas = await contarCuotasVencidasReales(
      credito.credito_id,
      "MOROSO",
    );

    expect(contadas).toBe(0); // ← debería ser 1; da 0 por el bug descrito
  });

  it("rollback: si algo falla tras borrar el convenio, NADA queda comiteado", async () => {
    // Esta es LA garantía del diseño: el rechazo borra el convenio, sus
    // cuotas y su pivot, y recrea la mora — si algo revienta a mitad, el
    // crédito no puede quedar huérfano (sin convenio y sin mora). Antes de
    // CB-033 `updateConvenioStatus` no era transaccional y ese estado sí
    // ocurría (bug documentado en paymentAgreement.ts, PR #1234).
    //
    // El fallo se provoca con un dato que la propia DB rechaza al escribir
    // la bitácora (paso 5), DESPUÉS de que la transacción ya borró el
    // convenio (paso 4): un `decidido_por_email` que excede varchar(150).
    // Es determinista —lo impone el esquema, no la lógica de negocio— y no
    // depende de `contarCuotasVencidasReales`, que en esta base siempre
    // devuelve 0 por un bug preexistente del EXISTS de `hasPaidPayment`
    // (ajeno a CB-033: la subquery no queda correlacionada y Postgres la
    // resuelve como InitPlan, marcando toda cuota como pagada).
    const credito = await crearCreditoDePrueba();
    creditosCreados.push(credito.credito_id);
    const convenio = await crearConvenioDePrueba(credito.credito_id);

    let error: unknown;
    try {
      await decidirConvenio(
        inputBase({
          convenioId: convenio.convenio_id,
          decision: "rechazado",
          motivo: "forzar rollback de prueba",
          decididoPorEmail: `${"x".repeat(200)}@test.local`,
        }),
      );
    } catch (e) {
      error = e;
    }

    // Si no falló, el test no probó nada: fallar ruidosamente en vez de
    // pasar en verde sin haber ejercido la garantía.
    expect(error).toBeTruthy();

    // El convenio NO se borró: la transacción entera se revirtió.
    const [convenioRestante] = await db
      .select()
      .from(convenios_pago)
      .where(eq(convenios_pago.convenio_id, convenio.convenio_id));
    expect(convenioRestante).toBeTruthy();
    expect(convenioRestante.activo).toBe(false); // ni siquiera el UPDATE del paso 2 sobrevivió

    // El crédito sigue EN_CONVENIO: el cambio de statusCredit también se revirtió.
    const [creditoTrasFallo] = await db
      .select({ statusCredit: creditos.statusCredit })
      .from(creditos)
      .where(eq(creditos.credito_id, credito.credito_id));
    expect(creditoTrasFallo.statusCredit).toBe("EN_CONVENIO");

    // No quedó fila de decisión ni de operación.
    const decisiones = await db
      .select()
      .from(convenioDecisiones)
      .where(eq(convenioDecisiones.convenioId, convenio.convenio_id));
    expect(decisiones.length).toBe(0);
  });

  it("append-only: tras un commit exitoso, convenio_decisiones recibió un solo INSERT", async () => {
    const credito = await crearCreditoDePrueba();
    creditosCreados.push(credito.credito_id);
    const convenio = await crearConvenioDePrueba(credito.credito_id);

    const resultado = await decidirConvenio(
      inputBase({ convenioId: convenio.convenio_id, decision: "aprobado" }),
    );

    const filas = await db
      .select()
      .from(convenioDecisiones)
      .where(eq(convenioDecisiones.convenioId, convenio.convenio_id));
    expect(filas.length).toBe(1);
    expect(filas[0].decisionId).toBe(resultado.decisionId);
  });

  it("snapshot: conserva las cuotas ORIGINALES del crédito, no el calendario del convenio", async () => {
    // Las dos listas del snapshot son datos distintos y se confundieron una
    // vez: `cuotas_convenio` son los `cuota_id` del CRÉDITO que el convenio
    // reestructuró (el dato que responde "¿qué deuda cubría?", y que el
    // rechazo borra junto con la fila), mientras `plan_pagos_numeros` es el
    // calendario que el convenio generó (cuota 1, 2, 3… del plan).
    const credito = await crearCreditoDePrueba();
    creditosCreados.push(credito.credito_id);
    // 4001/4002 = cuota_id del crédito reestructurados por el convenio.
    const convenio = await crearConvenioDePrueba(credito.credito_id, {
      cuotas_convenio: [4001, 4002],
    });
    // 1/2 = el calendario de pagos mensual que generó el convenio.
    await db.insert(convenio_cuotas).values([
      { convenio_id: convenio.convenio_id, numero_cuota: 1, fecha_vencimiento: "2026-01-01" },
      { convenio_id: convenio.convenio_id, numero_cuota: 2, fecha_vencimiento: "2026-02-01" },
    ] as any);

    const resultado = await decidirConvenio(
      inputBase({ convenioId: convenio.convenio_id, decision: "aprobado" }),
    );

    expect([...resultado.snapshot.cuotas_convenio].sort()).toEqual([4001, 4002]);
    expect([...resultado.snapshot.plan_pagos_numeros].sort()).toEqual([1, 2]);
    expect(resultado.snapshot.created_by).toBe(ADMIN_ID);
    expect(resultado.snapshot).toHaveProperty("numero_credito_sifco");
    expect(resultado.snapshot).toHaveProperty("monto_pendiente");
  });

  it("snapshot: las cuotas originales sobreviven al rechazo que borra el convenio", async () => {
    // El caso que justifica copiar `cuotas_convenio` al snapshot: tras el
    // rechazo la fila de `convenios_pago` ya no existe, así que la bitácora
    // es el único lugar donde queda registrado qué cuotas cubría.
    const credito = await crearCreditoDePrueba();
    creditosCreados.push(credito.credito_id);
    const convenio = await crearConvenioDePrueba(credito.credito_id, {
      cuotas_convenio: [5001, 5002, 5003],
    });

    const resultado = await decidirConvenio(
      inputBase({
        convenioId: convenio.convenio_id,
        decision: "rechazado",
        motivo: "no corresponde reestructurar",
      }),
    );

    const [decisionRow] = await db
      .select()
      .from(convenioDecisiones)
      .where(eq(convenioDecisiones.decisionId, resultado.decisionId));
    const snapshotGuardado = decisionRow.snapshot as { cuotas_convenio: number[] };
    expect([...snapshotGuardado.cuotas_convenio].sort()).toEqual([5001, 5002, 5003]);

    // El convenio ya no está: sin esta copia, el dato se habría perdido.
    const restante = await db
      .select()
      .from(convenios_pago)
      .where(eq(convenios_pago.convenio_id, convenio.convenio_id));
    expect(restante.length).toBe(0);
  });
});
