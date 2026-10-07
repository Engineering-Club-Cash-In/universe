import Big from "big.js";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { mora_pagada_cuota } from "../database/db/schema";
import { montoParaLedger, anotacionesAGuardar } from "./montoLedger";

/**
 * Anotar y deshacer lo que el cliente pagó de mora, cuota por cuota.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * Hasta ahora la mora era una función del calendario: el cron la recalculaba
 * cada madrugada desde las fechas de vencimiento SIN mirar si el cliente había
 * pagado. Si pagaba mora, al día siguiente se le volvía a cobrar entera.
 *
 * `cartera.mora_pagada_cuota` es la otra mitad de la cuenta: lo que se acumuló
 * se sigue derivando de las fechas —y por eso se auto-repara si el cron se
 * salta una noche—, y lo único que se GUARDA es lo que el cliente ya abonó.
 *
 * ── Por qué la tabla es de solo agregar ─────────────────────────────────────
 * Acá nunca se hace UPDATE ni DELETE. Deshacer un pago INSERTA una fila
 * compensatoria con monto negativo que apunta a la original por `revierte_a`.
 * Así el saldo es siempre `SUM(monto)`, la reversa es exacta —se devuelve
 * justo lo que ese pago puso, ni un centavo más— y queda el rastro de los dos
 * hechos. Borrar la fila original habría hecho la reversa indistinguible de un
 * pago que nunca existió.
 *
 * ── Las dos redes que pone la base, no el código ────────────────────────────
 * `mora_pagada_cuota_uq_pago` impide que el mismo pago se anote dos veces en
 * la misma cuota, y `mora_pagada_cuota_uq_revierte` impide revertir dos veces
 * la misma fila. Las dos son índices únicos: aunque dos llamadas corran
 * solapadas, la base no deja duplicar. Una doble ANOTACIÓN choca (es un bug y
 * tiene que verse); una doble COMPENSACIÓN se omite sin error (ver
 * `compensarAnotacionesVivas`). Es la lección de
 * `pagos_credito_inversionistas_espejo`, que NO tiene unicidad por
 * (pago, inversionista) y por eso un doble clic llegó a duplicar montos.
 */

/** Una anotación de mora cobrada o condonada sobre UNA cuota. */
/**
 * Unión discriminada a propósito: un PAGO sin `pago_id` violaría
 * `mora_pagada_cuota_pago_obligatorio_en_pago`, y el tipo no lo deja
 * construir. Además, al escribir, `pago_id` y `reemplaza_a` se deciden por
 * `tipo`: una CONDONACION que llegue por `as any` con pago_id los guarda en
 * NULL en vez de violar `reemplaza_solo_pago` o dejar un pago colgado.
 */
export type AnotacionMoraPagada = {
  credito_id: number;
  cuota_id: number;
  /** Siempre POSITIVO: es lo que se le abona a la cuota. */
  monto: Big | string | number;
  usuario_id?: number | null;
  motivo?: string | null;
} & (
  | { tipo: "PAGO"; /** El pago que la cubrió. */ pago_id: number }
  | {
      tipo: "CONDONACION";
      pago_id?: null;
      /** La fila de moras_condonaciones que la originó (para compensarla sin buscar texto). */
      condonacion_id?: number | null;
    }
);

type Ejecutor = NodePgDatabase<any>;

export { montoParaLedger } from "./montoLedger";

/**
 * Anota lo abonado a mora en una o varias cuotas.
 *
 * Va SIEMPRE dentro de la transacción del pago que la origina: si la anotación
 * falla, el pago no debe pasar. Un pago cobrado cuya mora no quedó anotada le
 * cobraría de más al cliente mañana, que es justo lo que este módulo viene a
 * evitar.
 *
 * Las filas de monto cero se descartan en silencio: no aportan al saldo y la
 * restricción `mora_pagada_cuota_monto_no_cero` las rechazaría.
 *
 * ── reemplaza_a ──────────────────────────────────────────────────────────────
 * Para filas de tipo PAGO, calcula reemplaza_a en el INSERT: la fila PAGO
 * anterior del mismo (pago_id, cuota_id) que fue compensada (existe una fila con
 * revierte_a = ese id). Así:
 * - Una doble anotación del MISMO pago vivo calcula el mismo reemplaza_a → choca.
 * - Después de reversar, reemplaza_a apunta a la compensada → (pago, cuota, id)
 *   es una clave distinta de (pago, cuota, 0) → entra.
 * - Dos inserts concurrentes calculan lo mismo → choca uno.
 */
/**
 * Filas por INSERT. Postgres admite 65,535 parámetros por sentencia y una fila
 * PAGO usa 10: la condonación masiva de toda la cartera, en un solo INSERT,
 * abortaría la transacción entera al crecer. 5,000 filas ≈ 50k parámetros.
 */
export const FILAS_POR_INSERT = 5000;

export async function anotarMoraPagada(
  filas: AnotacionMoraPagada[],
  ejecutor: Ejecutor,
): Promise<number> {
  const aInsertar = anotacionesAGuardar(filas);

  if (aInsertar.length === 0) return 0;

  // En bloques, uno tras otro sobre el MISMO ejecutor: siguen dentro de la
  // transacción del llamador, así que o entran todos o ninguno.
  let total = 0;
  for (let i = 0; i < aInsertar.length; i += FILAS_POR_INSERT) {
    total += await insertarBloque(aInsertar.slice(i, i + FILAS_POR_INSERT), ejecutor);
  }
  return total;
}

async function insertarBloque(
  aInsertar: Array<AnotacionMoraPagada & { montoBig: Big }>,
  ejecutor: Ejecutor,
): Promise<number> {
  const insertadas = await ejecutor
    .insert(mora_pagada_cuota)
    .values(
      aInsertar.map((f) => ({
        credito_id: f.credito_id,
        cuota_id: f.cuota_id,
        pago_id: f.tipo === "PAGO" ? f.pago_id : null,
        monto: montoParaLedger(f.montoBig),
        tipo: f.tipo,
        revierte_a: null,
        // reemplaza_a: para filas PAGO, la fila anterior compensada del mismo (pago_id, cuota_id)
        // Por el TIPO, no por el pago_id: algunos llamadores pasan por `as any`
        // y el tipo no los protege en tiempo de ejecución.
        reemplaza_a:
          f.tipo === "PAGO"
            ? sql`(SELECT MAX(p.id) FROM ${mora_pagada_cuota} p
                   WHERE p.tipo = 'PAGO' AND p.pago_id = ${f.pago_id} AND p.cuota_id = ${f.cuota_id}
                   AND EXISTS (SELECT 1 FROM ${mora_pagada_cuota} c WHERE c.revierte_a = p.id))`
            : null,
        usuario_id: f.usuario_id ?? null,
        motivo: f.motivo ?? null,
        // Solo una CONDONACION lo lleva; los demás tipos, NULL (y por el TIPO,
        // igual que pago_id, por los llamadores que pasan por `as any`).
        condonacion_id: f.tipo === "CONDONACION" ? (f.condonacion_id ?? null) : null,
      })),
    )
    .returning({ id: mora_pagada_cuota.id });

  return insertadas.length;
}

/**
 * Deshace lo que un pago había abonado a mora, insertando una fila
 * compensatoria por cada anotación viva de ese pago.
 *
 * `tipo` distingue los dos hechos, que NO son el mismo: `REVERSA` deshace un
 * pago que sí existió, `ANULACION` declara que la boleta nunca valió. El saldo
 * queda igual en los dos casos, pero el reporte tiene que poder separarlos.
 *
 * Solo compensa las filas que todavía no fueron compensadas (ver
 * `compensarAnotacionesVivas`): si dos llamadas corren solapadas, la segunda
 * no hace nada en vez de fallar.
 *
 * Devuelve cuántas filas compensó. Cero significa que ese pago no había
 * abonado mora, o que ya se había deshecho: las dos son situaciones legítimas
 * y por eso no lanza.
 */
export async function revertirMoraPagadaDePago(
  params: {
    pago_id: number;
    tipo: "REVERSA" | "ANULACION";
    usuario_id?: number | null;
    motivo?: string | null;
  },
  ejecutor: Ejecutor,
): Promise<number> {
  return compensarAnotacionesVivas(
    and(eq(mora_pagada_cuota.pago_id, params.pago_id), eq(mora_pagada_cuota.tipo, "PAGO"))!,
    { tipo: params.tipo, usuario_id: params.usuario_id, motivo: params.motivo },
    ejecutor,
  );
}

/**
 * La regla de compensación, escrita UNA vez: toma las anotaciones positivas
 * que `filtro` selecciona y que todavía no fueron compensadas, e inserta por
 * cada una su fila negativa con `revierte_a` apuntándola. La usan la reversa o
 * anulación de un pago y la ruptura de un convenio; solo cambian el filtro, el
 * tipo y el motivo.
 *
 * El filtro debe elegir filas PAGO o CONDONACION: una compensatoria no se
 * vuelve a compensar (sería negar un negativo).
 */
export async function compensarAnotacionesVivas(
  filtro: SQL,
  compensacion: {
    tipo: "REVERSA" | "ANULACION";
    usuario_id?: number | null;
    motivo?: string | null;
  },
  ejecutor: Ejecutor,
): Promise<number> {
  const vivas = await ejecutor
    .select({
      id: mora_pagada_cuota.id,
      credito_id: mora_pagada_cuota.credito_id,
      cuota_id: mora_pagada_cuota.cuota_id,
      monto: mora_pagada_cuota.monto,
    })
    .from(mora_pagada_cuota)
    .where(
      and(
        filtro,
        // Sin compensación previa: no existe otra fila que apunte a ésta.
        sql`NOT EXISTS (
          SELECT 1 FROM ${mora_pagada_cuota} AS c
          WHERE c.revierte_a = ${mora_pagada_cuota.id}
        )`,
      ),
    );

  if (vivas.length === 0) return 0;

  // Dos compensaciones solapadas pueden leer las mismas filas vivas antes de
  // que la otra confirme. La que llega segunda choca con
  // `mora_pagada_cuota_uq_revierte` y se OMITE (no es un error: ya estaba
  // compensado). El target es SOLO ese índice parcial: un choque de otra
  // restricción —p. ej. la clave primaria con la secuencia atrasada tras un
  // restore— tiene que seguir fallando, no perder la compensación en silencio.
  const insertadas = await ejecutor
    .insert(mora_pagada_cuota)
    .values(
    vivas.map((v) => ({
      credito_id: v.credito_id,
      cuota_id: v.cuota_id,
      // La compensatoria NO lleva `pago_id`: el único `PAGO` de ese pago en esa
      // cuota tiene que seguir siendo uno solo, o chocaría con el índice único.
      pago_id: null,
      monto: montoParaLedger(new Big(v.monto).times(-1)),
      tipo: compensacion.tipo,
      revierte_a: v.id,
      usuario_id: compensacion.usuario_id ?? null,
      motivo: compensacion.motivo ?? null,
    })),
    )
    .onConflictDoNothing({
      target: mora_pagada_cuota.revierte_a,
      where: sql`revierte_a IS NOT NULL`,
    })
    .returning({ id: mora_pagada_cuota.id });

  // Lo que REALMENTE se compensó (las omitidas por la otra llamada no cuentan).
  return insertadas.length;
}
