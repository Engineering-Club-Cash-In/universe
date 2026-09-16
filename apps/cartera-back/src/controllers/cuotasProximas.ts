import { db } from "../database";
import { SQL_CARTERA_SCHEMA } from "../database/db/schema";
import { sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// COBROS-02 · Premora (CC2-11) — cuotas próximas a vencer de créditos AL DÍA.
// Solo lectura: el CRM lo consume con su job diario de recordatorios D-5/D-3/
// D-1/D-0 (el WhatsApp vive allá; cartera-back solo responde datos).
//
// "Al día" = ACTIVO y SIN ninguna cuota vencida pendiente (B0, cartera sana —
// alcance confirmado: los morosos ya los gestiona su asesor por bucket).
// "Pendiente" = mismo predicado que el motor de moras: cuota sin pagar y sin
// pago validado que haya aplicado plata REAL (monto_aplicado > 0) — así las
// etiquetas de pagado no dejan pasar recordatorios a quien ya pagó.
// ─────────────────────────────────────────────────────────────────────────────

// Fila de pago que realmente cubre una cuota (predicado espejo de
// procesarMoras/createMora en latefee.ts — mantener alineados).
const pagoCubriente = (cuotaIdCol: ReturnType<typeof sql.raw>) => sql`
  SELECT 1 FROM ${SQL_CARTERA_SCHEMA}.pagos_credito pc
  WHERE pc.cuota_id = ${cuotaIdCol}
    AND pc."paymentFalse" = false
    AND pc.pagado = true
    AND pc.validation_status IN ('validated', 'no_required')
    AND COALESCE(pc.monto_aplicado, 0) > 0`;

// Estados que NO devengan mora (espejo de STATUS_EXCLUIDOS_MORA en latefee.ts).
const ESTADOS_SIN_MORA = sql`('EN_CONVENIO', 'INCOBRABLE', 'CANCELADO', 'PENDIENTE_CANCELACION', 'CAIDO')`;

export async function getCuotasProximasVencer(
  dias: number[],
  opts: {
    soloAlDia?: boolean;
    buckets?: number[];
    asesorId?: number;
    page?: number;
    perPage?: number;
  } = {},
) {
  // Default true: premora SOLO recuerda a créditos al día (B0). Con false
  // (la Agenda del día del CRM) entra TODO el funnel — el asesor gestiona
  // también las cuotas próximas de créditos en mora.
  const soloAlDia = opts.soloAlDia !== false;
  // buckets: filtro por bucket MOTOR (PREMORA_BUCKETS del CRM). Un crédito
  // SIN historial de buckets NO se asume B0 a ciegas (review Codex): solo
  // cuenta como B0 si además está al día EN TIEMPO REAL — si no, un moroso
  // sin INICIAL recibiría la plantilla amistosa de cartera sana. Orthogonal
  // a soloAlDia: el job del CRM manda soloAlDia=false + buckets=0,1,...
  // cuando el funnel de recordatorios está encendido.
  const buckets = opts.buckets ?? [];

  // Filtro por asesor DUEÑO del crédito (Agenda del día por asesor). Se baja al
  // SQL a propósito — NO filtrar en el CRM después de traer todo — para que la
  // paginación sea correcta: el LIMIT/OFFSET tiene que aplicar sobre las filas
  // del asesor, no sobre el universo completo.
  const filtroAsesor =
    opts.asesorId != null ? sql`AND c.asesor_id = ${opts.asesorId}` : sql``;

  // Paginación OPCIONAL: la Agenda del CRM manda page/per_page (el día 15/30
  // trae ~600 cuentas y se pagina de a perPage). El job de recordatorios NO los
  // manda: necesita TODAS las cuotas del día para enviarlas. Sin perPage → se
  // devuelven todas las filas (comportamiento clásico intacto).
  const paginar = opts.perPage != null && opts.perPage > 0;
  const page = Math.max(1, opts.page ?? 1);
  const perPage = paginar ? (opts.perPage as number) : 0;
  const offset = paginar ? (page - 1) * perPage : 0;

  const hoyGT = sql`(now() AT TIME ZONE 'America/Guatemala')::date`;
  const diasList = sql.join(
    dias.map((d) => sql`${d}`),
    sql`, `,
  );

  // COBROS-02 · Fase 1 — EN_CONVENIO entra al modo AGENDA (soloAlDia=false).
  // Antes quedaba fuera y por eso al asesor no le aparecía la cuota del
  // convenio que vencía ese día, aunque el crédito siguiera siendo suyo y
  // contara para su capacidad. En premora (soloAlDia=true) sigue fuera: ese
  // funnel es solo para cartera sana.
  const filtroEstado = soloAlDia
    ? sql`c."statusCredit" = 'ACTIVO'`
    : sql`c."statusCredit" IN ('ACTIVO', 'MOROSO', 'EN_RECUPERACION', 'INCOBRABLE', 'EN_CONVENIO')`;

  const bucketMotorSub = sql`(SELECT h.bucket_nuevo
      FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
      WHERE h.credito_id = c.credito_id
      ORDER BY h.fecha DESC, h.historial_id DESC
      LIMIT 1)`;

  // Crédito al día EN TIEMPO REAL (mismo criterio estricto del modo premora).
  const esAlDiaReal = sql`(c."statusCredit" = 'ACTIVO'
      AND NOT EXISTS (
        SELECT 1 FROM ${SQL_CARTERA_SCHEMA}.cuotas_credito v
        WHERE v.credito_id = c.credito_id
          AND v.fecha_vencimiento::date < ${hoyGT}
          AND v.pagado = false
          AND NOT EXISTS (${pagoCubriente(sql.raw("v.cuota_id"))})
      ))`;

  const bucketsList = sql.join(
    buckets.map((b) => sql`${b}`),
    sql`, `,
  );
  const filtroBuckets =
    buckets.length > 0
      ? sql`AND (
      ${bucketMotorSub} IN (${bucketsList})
      ${
        buckets.includes(0)
          ? sql`OR (${bucketMotorSub} IS NULL AND ${esAlDiaReal})`
          : sql``
      }
    )`
      : sql``;

  // FROM + JOINs y WHERE se comparten entre el COUNT y la query de datos para
  // que el total sea EXACTAMENTE el del set paginado (los mismos predicados).
  const fromJoins = sql`
    FROM ${SQL_CARTERA_SCHEMA}.cuotas_credito cu
    INNER JOIN ${SQL_CARTERA_SCHEMA}.creditos c ON c.credito_id = cu.credito_id
    INNER JOIN ${SQL_CARTERA_SCHEMA}.usuarios u ON u.usuario_id = c.usuario_id
    LEFT JOIN ${SQL_CARTERA_SCHEMA}.asesores a ON a.asesor_id = c.asesor_id
    LEFT JOIN ${SQL_CARTERA_SCHEMA}.moras_credito m
      ON m.credito_id = c.credito_id AND m.activa = true
    -- COBROS-02 · Fase 1 — lo que RESTA de la cuota del CONVENIO que vence el
    -- mismo día que esta cuota del crédito. En convenio el cliente paga AMBAS,
    -- así que la agenda tiene que mostrar el total, no la cuota suelta (el
    -- mismo cálculo que convenioProximos.ts, del que sale el WhatsApp).
    --
    -- Es LEFT JOIN LATERAL con LIMIT 1: nunca agrega filas, así que el COUNT
    -- que comparte este FROM sigue contando exactamente las mismas cuotas.
    -- Para un crédito sin convenio activo devuelve NULL → 0.
    LEFT JOIN LATERAL (
      SELECT LEAST(
               cp.cuota_mensual::numeric,
               GREATEST(0, conv.j * cp.cuota_mensual::numeric - cp.monto_pagado::numeric)
             ) AS restante
      FROM ${SQL_CARTERA_SCHEMA}.convenios_pago cp
      INNER JOIN LATERAL (
        -- Ordinal re-indexado entre las cuotas POSTERIORES al acuerdo (las que
        -- nacieron vencidas son la deuda vieja que el convenio regularizó).
        -- Mismo criterio que bucketsConvenio.ts / convenioAlertas.ts.
        SELECT cc.cuota_convenio_id,
               cc.fecha_vencimiento,
               ROW_NUMBER() OVER (ORDER BY cc.numero_cuota) AS j
        FROM ${SQL_CARTERA_SCHEMA}.convenio_cuotas cc
        WHERE cc.convenio_id = cp.convenio_id
          AND cc.fecha_vencimiento::date > cp.fecha_convenio::date
      ) conv ON conv.fecha_vencimiento::date = cu.fecha_vencimiento::date
      WHERE cp.credito_id = c.credito_id
        AND cp.activo = true
        AND cp.completado = false
        AND cp.monto_pagado::numeric < conv.j * cp.cuota_mensual::numeric
      ORDER BY conv.j
      LIMIT 1
    ) cvn ON true`;

  // ── ¿La cuota NORMAL del crédito sigue cobrable? ───────────────────────────
  // Se arma una sola vez porque la responden DOS lugares que tienen que decir
  // lo mismo: el WHERE (si esta fila entra a la agenda) y el SELECT (si el
  // monto normal suma o vale 0).
  //
  // "Cobrable" = sin pagar, sin pago validado que haya aplicado plata, sin
  // boleta pendiente de validar, y no absorbida por un convenio vigente (esa
  // ya vive como cuota del convenio: cobrarla otra vez sería doble).
  const normalCobrable = sql`(
    cu.pagado = false
    AND NOT EXISTS (${pagoCubriente(sql.raw("cu.cuota_id"))})
    AND NOT EXISTS (
      SELECT 1 FROM ${SQL_CARTERA_SCHEMA}.pagos_credito pr
      WHERE pr.cuota_id = cu.cuota_id
        AND pr."paymentFalse" = false
        AND pr.validation_status = 'pending'
        AND COALESCE(pr.monto_boleta, 0) > 0
    )
    AND NOT EXISTS (
      SELECT 1 FROM ${SQL_CARTERA_SCHEMA}.convenios_pago cp2
      WHERE cp2.credito_id = c.credito_id
        AND cp2.activo = true
        AND cp2.completado = false
        AND cu.cuota_id = ANY(COALESCE(cp2.cuotas_convenio, '{}'::int[]))
    )
  )`;

  const whereClause = sql`
    WHERE ${filtroEstado}
      ${filtroBuckets}
      ${filtroAsesor}
      AND (cu.fecha_vencimiento::date - ${hoyGT}) IN (${diasList})
      -- La fila entra si hay ALGO que cobrar ese día: la cuota normal, o lo que
      -- reste de la cuota del CONVENIO que vence el mismo día.
      --
      -- El segundo término no es un detalle (review de Codex, P1): la query
      -- está enraizada en cuotas_credito, así que exigir solo que la normal
      -- siga impaga borraba del día al cliente que YA pagó su cuota normal pero
      -- todavía debe la del convenio — justo la mitad del trato que se le
      -- olvida a la gente. En premora no aplica: ahí no hay convenios.
      AND (
        ${normalCobrable}
        ${soloAlDia ? sql`` : sql`OR COALESCE(cvn.restante, 0) > 0`}
      )
      -- Crédito AL DÍA: ninguna cuota ya vencida sigue pendiente (solo premora).
      ${
        soloAlDia
          ? sql`AND NOT EXISTS (
        SELECT 1 FROM ${SQL_CARTERA_SCHEMA}.cuotas_credito v
        WHERE v.credito_id = cu.credito_id
          AND v.fecha_vencimiento::date < ${hoyGT}
          AND v.pagado = false
          AND NOT EXISTS (${pagoCubriente(sql.raw("v.cuota_id"))})
      )`
          : sql``
      }`;

  // Total + clamp de página ANTES de traer la página (review Codex): con un
  // COUNT(*) OVER() en la misma query, una página fuera de rango vuelve VACÍA →
  // total 0 → la sección de la agenda desaparecería si el día encogió (un pago
  // o una reasignación) mientras el usuario estaba en una página tardía. Un
  // COUNT dedicado da el total real siempre, y si la página quedó fuera de rango
  // se devuelve la ÚLTIMA página válida en vez de una vacía.
  let totalPaginado = 0;
  let pageEfectiva = page;
  let offsetEfectivo = offset;
  if (paginar) {
    const countRes = await db.execute<any>(
      sql`SELECT COUNT(*)::int AS total ${fromJoins} ${whereClause}`,
    );
    totalPaginado = Number(countRes.rows[0]?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalPaginado / perPage));
    pageEfectiva = Math.min(page, totalPages);
    offsetEfectivo = (pageEfectiva - 1) * perPage;
  }

  const res = await db.execute<any>(sql`
    SELECT
      cu.cuota_id,
      cu.credito_id,
      cu.numero_cuota,
      cu.fecha_vencimiento::date::text AS fecha_vencimiento,
      (cu.fecha_vencimiento::date - ${hoyGT})::int AS dias_para_vencer,
      c.numero_credito_sifco,
      c."statusCredit" AS status_credit,
      -- Bucket MOTOR (último de buckets_historial, misma fuente que el listado
      -- por bucket): NULL si el crédito no tiene INICIAL registrado.
      (SELECT h.bucket_nuevo FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
        WHERE h.credito_id = c.credito_id
        ORDER BY h.fecha DESC, h.historial_id DESC
        LIMIT 1) AS bucket,
      -- Total a cobrar ese día: cuota normal + lo que resta de la cuota del
      -- convenio que vence el mismo día (0 si no hay convenio).
      --
      -- La parte normal vale 0 cuando esa cuota ya no se cobra —pagada, con
      -- boleta en validación, o absorbida por el convenio—: sin eso, una fila
      -- que entra SOLO por la cuota del convenio pediría además una cuota que
      -- el cliente ya pagó. Mismo criterio que convenioProximos.ts.
      ROUND(
        (CASE WHEN ${normalCobrable} THEN c.cuota::numeric ELSE 0 END
         + COALESCE(cvn.restante, 0)), 2
      )::text AS monto_cuota,
      -- Desglose, para que la UI pueda decir "cuota + convenio" sin recalcular.
      ROUND(
        CASE WHEN ${normalCobrable} THEN c.cuota::numeric ELSE 0 END, 2
      )::text AS monto_cuota_normal,
      ROUND(COALESCE(cvn.restante, 0), 2)::text AS monto_convenio,
      -- Mora ACTIVA del crédito (0 si no tiene). OJO: monto_mora es SOLO el
      -- RECARGO (capital × porcentaje × cuotas atrasadas), NO incluye las
      -- cuotas vencidas — por eso se devuelve junto a cuotas_atrasadas y el
      -- mensaje las nombra por separado. moras_credito tiene
      -- UNIQUE (credito_id) WHERE activa → el LEFT JOIN nunca duplica filas.
      COALESCE(ROUND(m.monto_mora::numeric, 2), 0)::text AS monto_mora,
      COALESCE(m.cuotas_atrasadas, 0)::int AS cuotas_atrasadas,
      -- Cuotas vencidas REALES en este instante (espejo de
      -- isOverdueInstallmentForMora en latefee.ts). moras_credito es una FOTO
      -- que solo se refresca cuando corre procesarMoras (review Codex): entre
      -- que CONTA valida una cuota vencida y la siguiente corrida del job, la
      -- fila sigue diciendo las cuotas y el recargo VIEJOS. El CRM compara este
      -- conteo vivo contra cuotas_atrasadas y solo cita números cuando cuadran.
      CASE
        WHEN c."statusCredit" IN ${ESTADOS_SIN_MORA} THEN 0
        ELSE (
          SELECT COUNT(*)
          FROM ${SQL_CARTERA_SCHEMA}.cuotas_credito v
          WHERE v.credito_id = c.credito_id
            AND v.fecha_vencimiento::date < ${hoyGT}
            AND v.pagado = false
            AND NOT EXISTS (${pagoCubriente(sql.raw("v.cuota_id"))})
        )
      END::int AS cuotas_vencidas_reales,
      u.nombre AS cliente,
      -- usuarios NO tiene teléfono en cartera (solo asesores/admins/conta/
      -- inversionistas lo tienen). Se devuelve NULL para mantener la forma
      -- del API: el CRM resuelve el teléfono real con caso de cobros → lead.
      NULL::text AS telefono_cliente_cartera,
      c.asesor_id,
      a.nombre AS asesor,
      a.telefono AS telefono_asesor
    ${fromJoins}
    ${whereClause}
    ORDER BY dias_para_vencer ASC, u.nombre ASC, cu.cuota_id ASC
    ${paginar ? sql`LIMIT ${perPage} OFFSET ${offsetEfectivo}` : sql``}
  `);

  const rows = res.rows as Array<Record<string, unknown>>;

  // Sin paginación (job de recordatorios): forma clásica, todas las filas.
  if (!paginar) {
    return { success: true, total: rows.length, data: rows };
  }

  return {
    success: true,
    total: totalPaginado,
    page: pageEfectiva,
    perPage,
    totalPages: Math.max(1, Math.ceil(totalPaginado / perPage)),
    data: rows,
  };
}
