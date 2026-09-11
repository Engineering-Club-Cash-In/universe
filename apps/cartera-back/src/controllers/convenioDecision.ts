// CB-033 — Aprobación/rechazo de convenios de pago por supervisor.
//
// Este archivo es el ÚNICO lugar donde se decide un convenio (aprobar o
// rechazar). El endpoint nuevo (POST /payment-agreements/:id/decidir) y el
// viejo (POST /payment-agreements/toggle-status, delegando) llaman a la
// misma función `decidirConvenio` — cero lógica financiera duplicada.
//
// Contrato completo, decisiones y trampas: docs/features/cobros-02/06-ficha-360.md §3.5.
//
// ── Por qué DOS tablas y no una ───────────────────────────────────────────
// `convenio_operaciones` reclama el `operacion_id` ANTES de conocer el
// snapshot y el `credito_id` (la bitácora los exige NOT NULL); es la que
// muta cuando la operación cierra. `convenio_decisiones` es el historial
// real, append-only: un INSERT único y completo, nunca un UPDATE — así
// sobrevive al DELETE que el rechazo hace sobre `convenios_pago`.
//
// ── Por qué el INSERT (no un SELECT) es el candado de concurrencia ───────
// Dos requests con el mismo `operacion_id` insertando a la vez: el segundo
// `INSERT ... ON CONFLICT` se BLOQUEA por el índice único hasta que el
// primero resuelva. Recién entonces se sabe si hay que leer un resultado
// confirmado o reclamar de verdad (si el primero abortó, su fila se fue con
// el rollback). Un `SELECT` previo no da esta garantía: los dos lo pasan y
// el segundo choca contra el estado en vez de recibir el resultado original.
//
// ── Por qué `createMora` se envuelve en un `throw` acá ────────────────────
// `createMora` devuelve `{success:false}` en vez de lanzar (para no romper
// sus callers históricos, que solo miran `.success`). Drizzle únicamente
// hace rollback si la callback de `db.transaction` LANZA — un `return`
// dejaría comiteado el convenio ya borrado sin la mora recreada: el mismo
// "crédito huérfano" que paymentAgreement.ts:1560 documenta. Por eso, acá
// (y solo acá) ese resultado se convierte en excepción.

import { randomUUID, createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import Big from "big.js";
import { db } from "../database";
import {
  convenioDecisiones,
  convenioOperaciones,
  convenio_cuotas,
  convenios_pago,
  convenios_pagos_resume,
  creditos,
} from "../database/db/schema";
import { contarCuotasVencidasReales, createMora } from "./latefee";

export type ConvenioDecisionTipo = "aprobado" | "rechazado";
export type ConvenioDecisionOrigen = "crm" | "cartera_front";

export interface DecidirConvenioInput {
  convenioId: number;
  decision: ConvenioDecisionTipo;
  motivo?: string | null;
  /** Generado por el CLIENTE (no acá) — es lo que hace segura la idempotencia. */
  operacionId: string;
  origen: ConvenioDecisionOrigen;
  /** Del JWT verificado — quién ejecutó de verdad. Nunca del body. */
  actuadoPor: number;
  actuadoPorEmail: string;
  /**
   * Persona responsable de la decisión. Obligatoria SIEMPRE: si el ejecutor
   * es la cuenta de servicio del CRM, esta es la que el router exige del
   * body (validada allá que el llamante puede fijarla); si no, el router ya
   * la igualó a `actuadoPorEmail`.
   */
  decididoPorEmail: string;
}

/** Contrato explícito del snapshot v1 — nunca se guarda la respuesta HTTP cruda. */
export interface ConvenioSnapshotV1 {
  convenio_id: number;
  credito_id: number;
  numero_credito_sifco: string | null;
  monto_total_convenio: string;
  numero_meses: number;
  cuota_mensual: string;
  monto_pagado: string;
  monto_pendiente: string;
  pagos_realizados: number;
  pagos_pendientes: number;
  fecha_convenio: string;
  motivo_creacion: string | null;
  observaciones: string | null;
  /**
   * `cuota_id` de las cuotas del CRÉDITO que el convenio reestructuró —
   * copia de `convenios_pago.cuotas_convenio`. Es el dato que responde
   * "¿qué deuda cubría este convenio?", y el rechazo borra la fila que lo
   * contiene: si no se copia acá, la auditoría lo pierde para siempre.
   *
   * NO confundir con `plan_pagos_numeros`: aquello es el calendario del
   * convenio (cuota 1, 2, 3… del plan), esto son las cuotas originales.
   */
  cuotas_convenio: number[];
  /**
   * `numero_cuota` de `convenio_cuotas` — el calendario de pagos que el
   * convenio generó. Se guarda para poder reconstruir el plan que el
   * cliente tenía cuando se tomó la decisión.
   */
  plan_pagos_numeros: number[];
  created_by: number | null;
  created_at: string | null;
}

export interface DecidirConvenioResultado {
  decisionId: number;
  convenioId: number;
  creditoId: number;
  decision: ConvenioDecisionTipo;
  snapshot: ConvenioSnapshotV1;
  decidioEn: string;
  idempotente: boolean;
}

export class ConvenioDecisionError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ConvenioDecisionError";
  }
}

/**
 * Hash estable del contenido de la operación — INCLUYE al actor humano.
 * Reutilizar un `operacion_id` con otro convenio, otra decisión, otro
 * motivo o **otra persona** se rechaza igual: la operación pertenece a
 * quien la inició, no solo a "esta acción sobre este convenio".
 */
function calcularFingerprint(input: {
  convenioId: number;
  decision: ConvenioDecisionTipo;
  motivo: string | null;
  decididoPorEmail: string;
}): string {
  const motivoNormalizado = (input.motivo ?? "").trim().toLowerCase();
  const emailNormalizado = input.decididoPorEmail.trim().toLowerCase();
  return createHash("sha256")
    .update(`${input.convenioId}|${input.decision}|${motivoNormalizado}|${emailNormalizado}`)
    .digest("hex");
}

function construirSnapshot(
  convenio: typeof convenios_pago.$inferSelect,
  planPagosNumeros: number[],
): ConvenioSnapshotV1 {
  return {
    convenio_id: convenio.convenio_id,
    credito_id: convenio.credito_id,
    numero_credito_sifco: null, // se completa en el router si hace falta mostrarlo
    monto_total_convenio: convenio.monto_total_convenio,
    numero_meses: convenio.numero_meses,
    cuota_mensual: convenio.cuota_mensual,
    monto_pagado: convenio.monto_pagado,
    monto_pendiente: convenio.monto_pendiente,
    pagos_realizados: convenio.pagos_realizados,
    pagos_pendientes: convenio.pagos_pendientes,
    fecha_convenio:
      convenio.fecha_convenio instanceof Date
        ? convenio.fecha_convenio.toISOString()
        : String(convenio.fecha_convenio),
    motivo_creacion: convenio.motivo ?? null,
    observaciones: convenio.observaciones ?? null,
    // Las cuotas del crédito que el convenio reestructuró, tal cual las
    // guardó la creación. Vienen del RETURNING del UPDATE (paso 2), no de
    // una query aparte: la fila que las contiene se borra en el rechazo.
    cuotas_convenio: convenio.cuotas_convenio ?? [],
    plan_pagos_numeros: planPagosNumeros,
    created_by: convenio.created_by ?? null,
    created_at: convenio.created_at ? new Date(convenio.created_at).toISOString() : null,
  };
}

/**
 * El corazón de CB-033. Aprueba o rechaza un convenio dentro de una única
 * transacción: reclamo de idempotencia, exclusión mutua, efecto financiero,
 * bitácora y cierre de la operación se comitean o abortan juntos.
 */
export async function decidirConvenio(
  input: DecidirConvenioInput,
): Promise<DecidirConvenioResultado> {
  const motivoNormalizado = input.motivo?.trim() || null;

  if (input.decision === "rechazado" && (!motivoNormalizado || motivoNormalizado.length < 5)) {
    throw new ConvenioDecisionError(
      "El rechazo requiere un motivo de al menos 5 caracteres.",
      400,
      "motivo_requerido",
    );
  }

  const fingerprint = calcularFingerprint({
    convenioId: input.convenioId,
    decision: input.decision,
    motivo: motivoNormalizado,
    decididoPorEmail: input.decididoPorEmail,
  });

  return await db.transaction(async (tx) => {
    // ── Paso 1: reclamar operacion_id — el candado es este INSERT ────────
    const [reclamo] = await tx
      .insert(convenioOperaciones)
      .values({
        operacionId: input.operacionId,
        requestFingerprint: fingerprint,
        estado: "en_curso",
      })
      .onConflictDoNothing({ target: convenioOperaciones.operacionId })
      .returning({ operacionId: convenioOperaciones.operacionId });

    if (!reclamo) {
      // Ya existe — por el bloqueo del INSERT, cuando llegamos acá la otra
      // transacción (si estaba abierta) ya resolvió. Leemos su resultado.
      const [existente] = await tx
        .select()
        .from(convenioOperaciones)
        .where(eq(convenioOperaciones.operacionId, input.operacionId));

      if (!existente) {
        // No debería pasar (el INSERT sin fila implica conflicto), pero
        // ante una condición de carrera rarísima, tratamos como conflicto.
        throw new ConvenioDecisionError(
          "No se pudo procesar la operación. Intentá de nuevo con un identificador nuevo.",
          409,
          "operacion_en_conflicto",
        );
      }

      if (existente.requestFingerprint !== fingerprint) {
        throw new ConvenioDecisionError(
          "Ese identificador de operación ya se usó para otra decisión (convenio, decisión, motivo o actor distintos).",
          409,
          "fingerprint_no_coincide",
        );
      }

      if (existente.estado === "completada" && existente.resultado) {
        return { ...(existente.resultado as DecidirConvenioResultado), idempotente: true };
      }

      // Reclamada pero no completada y el INSERT no bloqueó (rareza de
      // timing): no hay resultado que devolver todavía.
      throw new ConvenioDecisionError(
        "La operación está en curso. Reintentá en unos segundos.",
        409,
        "operacion_en_curso",
      );
    }

    // ── Paso 2: exclusión mutua — UPDATE condicional, no read-then-write ─
    const [convenioActualizado] = await tx
      .update(convenios_pago)
      .set({
        activo: input.decision === "aprobado",
        updated_at: new Date(),
      })
      .where(
        and(
          eq(convenios_pago.convenio_id, input.convenioId),
          eq(convenios_pago.activo, false),
          eq(convenios_pago.completado, false),
        ),
      )
      .returning();

    if (!convenioActualizado) {
      throw new ConvenioDecisionError(
        "El convenio ya fue decidido por otro supervisor, o ya está completado y no puede reabrirse.",
        409,
        "convenio_no_pendiente",
      );
    }

    // ── Paso 3: snapshot (credito_id y datos completos ya se conocen) ────
    // El calendario de pagos del convenio (cuota 1, 2, 3… del plan). Las
    // cuotas ORIGINALES del crédito que se reestructuraron son otra cosa y
    // salen de `convenioActualizado.cuotas_convenio` — ver construirSnapshot.
    const planPagos = await tx
      .select({ numero_cuota: convenio_cuotas.numero_cuota })
      .from(convenio_cuotas)
      .where(eq(convenio_cuotas.convenio_id, input.convenioId));
    const planPagosNumeros = planPagos.map((c) => c.numero_cuota);

    const [{ numero_credito_sifco } = { numero_credito_sifco: null as string | null }] = await tx
      .select({ numero_credito_sifco: creditos.numero_credito_sifco })
      .from(creditos)
      .where(eq(creditos.credito_id, convenioActualizado.credito_id));

    const snapshot: ConvenioSnapshotV1 = {
      ...construirSnapshot(convenioActualizado, planPagosNumeros),
      numero_credito_sifco: numero_credito_sifco ?? null,
    };

    // ── Paso 4: efecto financiero ─────────────────────────────────────────
    if (input.decision === "rechazado") {
      await tx.delete(convenio_cuotas).where(eq(convenio_cuotas.convenio_id, input.convenioId));
      await tx
        .delete(convenios_pagos_resume)
        .where(eq(convenios_pagos_resume.convenio_id, input.convenioId));
      await tx.delete(convenios_pago).where(eq(convenios_pago.convenio_id, input.convenioId));

      const numCuotasAtrasadas = await contarCuotasVencidasReales(
        convenioActualizado.credito_id,
        "MOROSO",
        tx,
      );

      if (numCuotasAtrasadas > 0) {
        const [{ capital } = { capital: "0" }] = await tx
          .select({ capital: creditos.capital })
          .from(creditos)
          .where(eq(creditos.credito_id, convenioActualizado.credito_id));

        const montoMora = new Big(capital).times("0.0112").times(numCuotasAtrasadas);

        await tx
          .update(creditos)
          .set({ statusCredit: "MOROSO" })
          .where(eq(creditos.credito_id, convenioActualizado.credito_id));

        const resultMora = await createMora(
          {
            credito_id: convenioActualizado.credito_id,
            monto_mora: Number(montoMora.toFixed(2)),
            cuotas_atrasadas: numCuotasAtrasadas,
            origen: "API_MANUAL",
            motivo: motivoNormalizado ?? undefined,
            usuario_id: input.actuadoPor,
          },
          tx,
        );

        // createMora devuelve {success:false} en vez de lanzar — acá SÍ
        // tiene que abortar la transacción completa (ver cabecera).
        if (!resultMora.success) {
          throw new Error(
            `No se pudo recrear la mora del crédito ${convenioActualizado.credito_id} al rechazar el convenio: ${resultMora.message}`,
          );
        }
      } else {
        await tx
          .update(creditos)
          .set({ statusCredit: "ACTIVO" })
          .where(eq(creditos.credito_id, convenioActualizado.credito_id));
      }
    }
    // aprobado: el UPDATE del paso 2 ya dejó activo=true. Nada más que hacer.

    // ── Paso 5: bitácora — INSERT único y completo, append-only ──────────
    const [fila] = await tx
      .insert(convenioDecisiones)
      .values({
        operacionId: input.operacionId,
        convenioId: input.convenioId,
        creditoId: convenioActualizado.credito_id,
        decision: input.decision,
        motivo: motivoNormalizado,
        snapshotVersion: 1,
        snapshot,
        origen: input.origen,
        actuadoPor: input.actuadoPor,
        actuadoPorEmail: input.actuadoPorEmail,
        decididoPorEmail: input.decididoPorEmail,
      })
      .returning();

    const resultado: DecidirConvenioResultado = {
      decisionId: fila.decisionId,
      convenioId: input.convenioId,
      creditoId: convenioActualizado.credito_id,
      decision: input.decision,
      snapshot,
      decidioEn: new Date(fila.decididoEn).toISOString(),
      idempotente: false,
    };

    // ── Paso 6: cerrar la operación — muta convenio_operaciones, NO la bitácora ─
    await tx
      .update(convenioOperaciones)
      .set({
        estado: "completada",
        decisionId: fila.decisionId,
        resultado,
        completadaEn: new Date(),
      })
      .where(eq(convenioOperaciones.operacionId, input.operacionId));

    return resultado;
  });
}

/** Helper para el router: nuevo operacion_id, usado cuando el llamante no manda uno (compat transitoria). */
export function generarOperacionId(): string {
  return randomUUID();
}
