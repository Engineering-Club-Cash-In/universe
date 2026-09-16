/**
 * COBROS-02 · Fase 2 — RE-SIEMBRA de los convenios que ya existían.
 *
 * Por qué hace falta. Los ~63 créditos EN_CONVENIO que el motor viejo ya movió
 * con la regla de "borrón y cuenta nueva" están repartidos entre B0 y B5, con
 * asesores que no les tocaban. La Fase 2 congela el bucket al firmar, pero eso
 * solo arregla los convenios NUEVOS: los viejos ya tienen fila de su régimen,
 * así que la red de seguridad del vigilante no los toca — y el bucket que
 * tienen es el que les puso la regla que acabamos de invertir.
 *
 * Qué criterio se usa. NO se intenta reconstruir de qué bucket venían: esa
 * información no está en ningún lado y adivinarla sería peor que elegir un
 * default honesto. Se re-siembran por CÓMO ESTÁN PAGANDO HOY (decisión 19 del
 * plan 08):
 *
 *     al día (cumpliendo su convenio)        → B2
 *     atrasado (debe alguna cuota del conv.) → B4
 *
 * "Al día" se mide con el mismo modelo que el vigilante y que
 * `convenioAlertas.ts`: meses atrasados = fechas de vencimiento distintas,
 * pasadas, con algo impago, uniendo las cuotas del crédito no absorbidas por el
 * convenio + las cuotas del convenio posteriores al acuerdo no cubiertas por
 * monto. Cero = al día.
 *
 * El asesor se reparte con la MISMA regla del motor (`elegirAsesorParaBucket`):
 * si el dueño actual ya cubre el bucket destino se queda (sin churn); si no,
 * pasa al del pool con menos carga. Un crédito que queda en B2/B4 con un asesor
 * de B0 no lo gestiona nadie.
 *
 * ── Cómo se corre ───────────────────────────────────────────────────────────
 *     bun run src/scripts/resiembraConveniosBuckets.ts            # simulación
 *     bun run src/scripts/resiembraConveniosBuckets.ts --apply    # escribe
 *
 * Es IDEMPOTENTE: un crédito que ya quedó re-sembrado en el bucket que le toca
 * se salta. Se puede correr las veces que haga falta.
 *
 * ── Dónde corre ─────────────────────────────────────────────────────────────
 * Hoy, contra el sandbox de dev (`cartera_cobros2`): ahí vive todo COBROS-02
 * mientras dure la rama, y si el reparto no convence se vuelve a correr. El día
 * que esta versión pase a producción, el criterio se revisa entonces — el
 * script queda escrito para ese momento.
 *
 * Toma el schema de `CARTERA_SCHEMA` (la env del proceso), igual que el resto
 * de la app: no hay nombres de schema escritos a mano acá.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../database";
import {
  asesor_bucket,
  asesores,
  CARTERA_SCHEMA,
  credito_asesor_historial,
  creditos,
  SQL_CARTERA_SCHEMA,
} from "../database/db/schema";
import { bucketActualSql } from "../lib/buckets-classification";
import {
  type CriterioAtrasoConvenio,
  medirAtrasoDeConvenios,
} from "../controllers/buckets/atrasoConvenio";
import {
  BUCKET_CONVENIO_AL_DIA,
  BUCKET_CONVENIO_ATRASADO,
} from "../controllers/buckets/congelarBucketConvenio";
import { elegirAsesorParaBucket } from "../controllers/latefee";

/** Marca en el motivo que permite reconocer una fila puesta por este script. */
const MARCA = "Re-siembra de convenios (COBROS-02 Fase 2)";

const APLICAR = process.argv.includes("--apply");

/**
 * Qué cuenta como "atrasado" para mandar el crédito a B4. Ver
 * `CriterioAtrasoConvenio`: el default (`convenio`) pregunta si está
 * cumpliendo el acuerdo que firmó; `--criterio=union` pregunta si debe algo,
 * incluida la cuota normal del mes. En el sandbox de dev la diferencia es
 * brutal —9 contra 57 de 63— así que la elección es una decisión de negocio,
 * no un detalle: queda explícita acá y anotada en el plan 08.
 */
const CRITERIO: CriterioAtrasoConvenio = process.argv.includes("--criterio=union")
  ? "union"
  : "convenio";

async function main() {
  console.log(
    `\n🧊 ${MARCA}\n   schema:   ${CARTERA_SCHEMA}\n   criterio: ${CRITERIO === "union" ? "unión (convenio + cuota normal)" : "convenio (cumple el acuerdo que firmó)"}\n   modo:     ${APLICAR ? "APLICAR (escribe)" : "SIMULACIÓN (no escribe)"}\n`,
  );

  const filas = await db
    .select({
      credito_id: creditos.credito_id,
      numero_credito_sifco: creditos.numero_credito_sifco,
      asesor_id: creditos.asesor_id,
    })
    .from(creditos)
    .where(eq(creditos.statusCredit, "EN_CONVENIO"));

  if (filas.length === 0) {
    console.log("No hay créditos EN_CONVENIO. Nada que hacer.");
    return;
  }
  const creditoIds = filas.map((f) => f.credito_id);
  // La MISMA medición que usa el vigilante — importada, no copiada: tenerla
  // duplicada acá ya costó un bug (la correlación del EXISTS se rompía sin el
  // JOIN; ver la cabecera de atrasoConvenio.ts).
  const { mesesAtrasados: meses, mesesUnion } = await medirAtrasoDeConvenios({
    criterio: CRITERIO,
  });

  // Bucket actual: la última fila del historial, del régimen que sea. No se usa
  // `bucketActualSql` porque para un EN_CONVENIO ignora el historial que no sea
  // de convenio y devolvería null justo en los casos que hay que arreglar.
  const ultimos = await db.execute<{
    credito_id: number;
    bucket_nuevo: number;
    motivo: string | null;
  }>(sql`
    SELECT DISTINCT ON (h.credito_id) h.credito_id, h.bucket_nuevo, h.motivo
    FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
    WHERE h.credito_id = ANY(${sql`ARRAY[${sql.join(creditoIds.map((id) => sql`${id}`), sql`, `)}]::int[]`})
    ORDER BY h.credito_id, h.fecha DESC, h.historial_id DESC
  `);
  const bucketActual = new Map<number, number>();
  const motivoUltimo = new Map<number, string | null>();
  for (const row of ultimos.rows ?? []) {
    bucketActual.set(Number(row.credito_id), Number(row.bucket_nuevo));
    motivoUltimo.set(Number(row.credito_id), row.motivo ?? null);
  }

  // Pool por bucket + carga viva, igual que el motor.
  const poolRows = await db
    .select({ asesor_id: asesor_bucket.asesor_id, bucket: asesor_bucket.bucket })
    .from(asesor_bucket)
    .innerJoin(asesores, eq(asesores.asesor_id, asesor_bucket.asesor_id))
    .where(and(eq(asesor_bucket.activo, true), eq(asesores.activo, true)))
    .orderBy(asesor_bucket.bucket, asesor_bucket.asesor_id);
  const pool = new Map<number, number[]>();
  for (const r of poolRows) {
    const lista = pool.get(r.bucket) ?? [];
    lista.push(r.asesor_id);
    pool.set(r.bucket, lista);
  }

  const cargaRows = await db.execute<{ asesor_id: number; bucket: number; cuentas: number }>(sql`
    SELECT c.asesor_id, ${bucketActualSql("c", "m")} AS bucket, COUNT(*)::int AS cuentas
    FROM ${SQL_CARTERA_SCHEMA}.creditos c
    LEFT JOIN ${SQL_CARTERA_SCHEMA}.moras_credito m
      ON m.credito_id = c.credito_id AND m.activa = true
    WHERE c.asesor_id IS NOT NULL
      AND c."statusCredit" NOT IN ('CANCELADO', 'PENDIENTE_CANCELACION', 'CAIDO')
    GROUP BY c.asesor_id, 2
  `);
  const carga = new Map<number, Map<number, number>>();
  for (const r of cargaRows.rows ?? []) {
    if (r.bucket === null || r.bucket === undefined) continue;
    const b = Number(r.bucket);
    const porAsesor = carga.get(b) ?? new Map<number, number>();
    porAsesor.set(Number(r.asesor_id), Number(r.cuentas));
    carga.set(b, porAsesor);
  }

  let alDia = 0;
  let atrasados = 0;
  let saltados = 0;
  let movidos = 0;
  let reasignados = 0;
  const detalle: string[] = [];

  for (const fila of filas) {
    const atraso = meses.get(fila.credito_id) ?? 0;
    const destino =
      atraso > 0 ? BUCKET_CONVENIO_ATRASADO : BUCKET_CONVENIO_AL_DIA;
    if (atraso > 0) atrasados++;
    else alDia++;

    const actual = bucketActual.get(fila.credito_id) ?? null;
    const yaResembrado =
      actual === destino && (motivoUltimo.get(fila.credito_id) ?? "").includes(MARCA);
    if (yaResembrado) {
      saltados++;
      continue;
    }

    // Asesor destino: misma regla del motor (sin churn si ya cubre el bucket).
    const poolDestino = pool.get(destino) ?? [];
    const asesorElegido = elegirAsesorParaBucket(
      poolDestino,
      carga.get(destino),
      fila.asesor_id,
    );
    const cambiaAsesor =
      asesorElegido !== null && asesorElegido !== fila.asesor_id;

    detalle.push(
      `  ${fila.numero_credito_sifco.padEnd(42)} B${actual ?? "?"} → B${destino}` +
        ` (${atraso} mes(es) atrasado)` +
        (cambiaAsesor ? `  ·  asesor ${fila.asesor_id ?? "—"} → ${asesorElegido}` : ""),
    );

    if (!APLICAR) {
      movidos++;
      if (cambiaAsesor) reasignados++;
      continue;
    }

    await db.transaction(async (tx) => {
      // `CONGELADO` cuando no se mueve (el CHECK exige bucket_nuevo =
      // bucket_anterior); SUBIDA/BAJADA cuando sí. Sin fila previa no hay de
      // dónde salir: se escribe un CONGELADO sobre el destino, que es lo más
      // honesto — no hubo movimiento observable, solo quedó fijado.
      const anterior = actual ?? destino;
      const tipo =
        destino > anterior ? "SUBIDA" : destino < anterior ? "BAJADA" : "CONGELADO";
      await tx.execute(sql`
        INSERT INTO ${SQL_CARTERA_SCHEMA}.buckets_historial
          (credito_id, bucket_anterior, bucket_nuevo, tipo_evento, origen,
           cuotas_atrasadas_nuevas, status_credito, motivo)
        VALUES (${fila.credito_id}, ${anterior}, ${destino}, ${sql.raw(`'${tipo}'`)},
                'API_MANUAL', ${atraso}, 'EN_CONVENIO',
                ${`${MARCA}: ${atraso > 0 ? "atrasado" : "al día"} → B${destino}`})
      `);

      if (cambiaAsesor && asesorElegido !== null) {
        await tx.insert(credito_asesor_historial).values({
          credito_id: fila.credito_id,
          asesor_anterior: fila.asesor_id,
          asesor_nuevo: asesorElegido,
          bucket: destino,
          origen: "API_MANUAL",
          motivo: `${MARCA}: el crédito pasa a B${destino}`,
          usuario_id: null,
        });
        await tx
          .update(creditos)
          .set({ asesor_id: asesorElegido })
          .where(eq(creditos.credito_id, fila.credito_id));
      }
    });

    movidos++;
    if (cambiaAsesor) reasignados++;

    // La carga viva se ajusta en TODO movimiento, no solo cuando cambia el
    // asesor (review de Codex, P2).
    //
    // El caso que faltaba: un crédito que cambia de bucket pero conserva a su
    // asesor porque también cubre el destino. La foto inicial lo contó en su
    // bucket VIEJO, así que sin este ajuste el destino se veía artificialmente
    // vacío para ese asesor y los créditos siguientes del lote se le
    // amontonaban encima.
    //
    // Sale del bucket anterior y entra al destino, siempre con el asesor FINAL
    // — el mismo criterio que usa el motor dentro de su corrida.
    const asesorFinal = cambiaAsesor ? asesorElegido : fila.asesor_id;
    if (actual !== null) {
      const porAsesorOrigen = carga.get(actual);
      const previoOrigen = porAsesorOrigen?.get(fila.asesor_id as number);
      if (porAsesorOrigen && previoOrigen != null) {
        porAsesorOrigen.set(
          fila.asesor_id as number,
          Math.max(0, previoOrigen - 1),
        );
      }
    }
    if (asesorFinal != null) {
      const porAsesorDestino = carga.get(destino) ?? new Map<number, number>();
      porAsesorDestino.set(
        asesorFinal,
        (porAsesorDestino.get(asesorFinal) ?? 0) + 1,
      );
      carga.set(destino, porAsesorDestino);
    }
  }

  if (detalle.length > 0) {
    console.log("Movimientos:");
    for (const linea of detalle) console.log(linea);
    console.log("");
  }
  const debenAlgo = [...mesesUnion.values()].filter((m) => m > 0).length;
  console.log(
    `Créditos EN_CONVENIO: ${filas.length}\n` +
      `  (referencia: ${debenAlgo} deben ALGO — convenio o cuota normal del mes)\n` +
      `  al día → B${BUCKET_CONVENIO_AL_DIA}:      ${alDia}\n` +
      `  atrasados → B${BUCKET_CONVENIO_ATRASADO}:   ${atrasados}\n` +
      `  ya re-sembrados (saltados): ${saltados}\n` +
      `  ${APLICAR ? "escritos" : "se escribirían"}: ${movidos} (reasignados: ${reasignados})`,
  );
  if (!APLICAR) {
    console.log("\nSimulación. Volvé a correrlo con --apply para escribir.\n");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("💥 Falló la re-siembra:", err);
    process.exit(1);
  });
