import { db } from "../database";
import { SQL_CARTERA_SCHEMA } from "../database/db/schema";
import { sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// CB-010 · Comportamiento de pago — racha de cuotas pagadas AL DÍA por crédito.
// Solo lectura: el CRM lo consume con su job diario de elegibilidad para la
// reducción de recordatorios premora (la tabla y el módulo del gerente viven
// allá; cartera-back solo responde el dato de pago que solo existe aquí).
//
// "Al día" = una cuota cuyo pago cubriente entró DENTRO de la gracia:
//   fecha_pago <= fecha_vencimiento + DIAS_GRACIA.
// "Cubriente" = mismo predicado que premora/procesarMoras (pago real,
// validado, monto_aplicado > 0) — así las etiquetas de pagado no inflan la
// racha con pagos falsos o sin plata.
//
// GRACIA (confirmada por negocio): 2 días. Una cuota solo se EVALÚA una vez
// pasada su ventana de gracia (venc + 2 < hoy); dentro de la gracia es como una
// cuota aún no vencida (no cuenta ni rompe), así un cliente puntual no se cae de
// elegibles por ir 1 día pasado su vencimiento.
//
// La RACHA es el número de cuotas ya evaluadas pagadas al día contando desde la
// más reciente (mayor numero_cuota) hacia atrás, hasta el primer atraso. Un
// atraso = cuota pagada TARDE (después de la gracia) o cuota SIN pago cubriente
// ya pasada la gracia (mora). Elegible (>=4) lo decide el CRM; aquí devolvemos
// la racha cruda.
// ─────────────────────────────────────────────────────────────────────────────

// Días de gracia después del vencimiento que todavía cuentan como "al día".
// Confirmado por negocio (Gerente de Cobros). Cambiar aquí si se ajusta.
const DIAS_GRACIA = 2;

// Pago que realmente cubre una cuota (espejo de pagoCubriente en
// cuotasProximas.ts / latefee.ts — mantener alineados). Dos formas del MISMO
// predicado: la fecha (MIN, escalar) para clasificar al día vs tarde, y el
// EXISTS (SELECT 1) para el NOT EXISTS de "cuota aún sin pagar".
const filtroPagoCubriente = (cuotaIdCol: ReturnType<typeof sql.raw>) => sql`
    pc.cuota_id = ${cuotaIdCol}
    AND pc."paymentFalse" = false
    AND pc.pagado = true
    AND pc.validation_status IN ('validated', 'no_required')
    AND COALESCE(pc.monto_aplicado, 0) > 0`;

const pagoCubrienteFecha = (cuotaIdCol: ReturnType<typeof sql.raw>) => sql`
  SELECT MIN(pc.fecha_pago::date)
  FROM ${SQL_CARTERA_SCHEMA}.pagos_credito pc
  WHERE ${filtroPagoCubriente(cuotaIdCol)}`;

const pagoCubrienteExiste = (cuotaIdCol: ReturnType<typeof sql.raw>) => sql`
  SELECT 1
  FROM ${SQL_CARTERA_SCHEMA}.pagos_credito pc
  WHERE ${filtroPagoCubriente(cuotaIdCol)}`;

export interface ComportamientoPagoRow {
  credito_id: number;
  numero_credito_sifco: string;
  racha: number;
  ultima_cuota_evaluada: number;
  total_vencidas: number;
  // Datos del crédito para el módulo del gerente (nombre del titular, cuota
  // mensual y próxima fecha de pago). El nombre SIEMPRE de cartera (usuarios),
  // que lo tiene para TODO crédito — el CRM solo lo tiene si nació por su funnel.
  cliente: string | null;
  cuota_mensual: string;
  proxima_fecha_pago: string | null;
}

export interface ComportamientoPagoResponse {
  success: true;
  total: number;
  data: ComportamientoPagoRow[];
  // Presentes solo cuando se pidió paginación (el job del CRM la usa para
  // recorrer toda la cartera de a lotes). Sin per_page van todas las filas.
  page?: number;
  perPage?: number;
  totalPages?: number;
}

export async function getComportamientoPago(
  opts: { sifcos?: string[]; page?: number; perPage?: number } = {},
): Promise<ComportamientoPagoResponse> {
  const hoyGT = sql`(now() AT TIME ZONE 'America/Guatemala')::date`;

  // Filtro opcional por SIFCO (pruebas quirúrgicas / recálculo puntual). Sin él
  // se evalúa TODA la cartera activa (el job diario del CRM refresca todo).
  const filtroSifco =
    opts.sifcos && opts.sifcos.length > 0
      ? sql`AND c.numero_credito_sifco = ANY(${opts.sifcos})`
      : sql``;

  // Paginación OPCIONAL (el job del CRM la usa: la cartera activa puede ser de
  // miles). Sin per_page → todas las filas (una sola pasada, comportamiento
  // clásico). COUNT(*) OVER() da el total exacto en la misma consulta.
  const paginar = opts.perPage != null && opts.perPage > 0;
  const page = Math.max(1, opts.page ?? 1);
  const perPage = paginar ? (opts.perPage as number) : 0;
  const offset = paginar ? (page - 1) * perPage : 0;
  const limitOffset = paginar
    ? sql`LIMIT ${perPage} OFFSET ${offset}`
    : sql``;
  const totalWindow = paginar
    ? sql`, COUNT(*) OVER()::int AS _total`
    : sql``;

  const res = await db.execute<any>(sql`
    WITH vencidas AS (
      -- Cuotas ya pasadas de su GRACIA (venc + DIAS_GRACIA < hoy GT) de créditos
      -- ACTIVOS, con la fecha del pago cubriente más temprano. Una cuota dentro
      -- de su gracia (o que vence hoy/futura) aún no se evalúa: no cuenta ni
      -- rompe la racha.
      SELECT
        c.credito_id,
        c.numero_credito_sifco,
        cu.numero_cuota,
        cu.fecha_vencimiento::date AS venc,
        (${pagoCubrienteFecha(sql.raw("cu.cuota_id"))}) AS fecha_pago_cubriente
      FROM ${SQL_CARTERA_SCHEMA}.cuotas_credito cu
      INNER JOIN ${SQL_CARTERA_SCHEMA}.creditos c ON c.credito_id = cu.credito_id
      WHERE cu.fecha_vencimiento::date < (${hoyGT} - ${DIAS_GRACIA})
        AND c."statusCredit" = 'ACTIVO'
        ${filtroSifco}
    ),
    clasificadas AS (
      SELECT
        credito_id,
        numero_credito_sifco,
        numero_cuota,
        -- Al día = pago cubriente dentro de la gracia (venc + DIAS_GRACIA).
        (fecha_pago_cubriente IS NOT NULL
          AND fecha_pago_cubriente <= venc + ${DIAS_GRACIA})
          AS al_dia
      FROM vencidas
    ),
    -- La cuota vencida más RECIENTE (mayor numero_cuota) que NO está al día:
    -- rompe la racha. Todo lo que esté por encima es al día por definición.
    rotas AS (
      SELECT credito_id, MAX(numero_cuota) AS ultima_rota
      FROM clasificadas
      WHERE al_dia = false
      GROUP BY credito_id
    ),
    agg AS (
      SELECT
        cl.credito_id,
        cl.numero_credito_sifco,
        COUNT(*) FILTER (
          WHERE cl.al_dia
            AND (r.ultima_rota IS NULL OR cl.numero_cuota > r.ultima_rota)
        )::int AS racha,
        MAX(cl.numero_cuota)::int AS ultima_cuota_evaluada,
        COUNT(*)::int AS total_vencidas
      FROM clasificadas cl
      LEFT JOIN rotas r ON r.credito_id = cl.credito_id
      GROUP BY cl.credito_id, cl.numero_credito_sifco
    )
    SELECT
      agg.credito_id,
      agg.numero_credito_sifco,
      agg.racha,
      agg.ultima_cuota_evaluada,
      agg.total_vencidas,
      u.nombre AS cliente,
      ROUND(c.cuota::numeric, 2)::text AS cuota_mensual,
      -- Próxima fecha de pago = la cuota SIN pagar (sin pago cubriente) que
      -- vence primero. Para un crédito al día es su siguiente cuota futura.
      (SELECT MIN(cx.fecha_vencimiento::date)::text
        FROM ${SQL_CARTERA_SCHEMA}.cuotas_credito cx
        WHERE cx.credito_id = agg.credito_id
          AND cx.pagado = false
          AND NOT EXISTS (${pagoCubrienteExiste(sql.raw("cx.cuota_id"))})
      ) AS proxima_fecha_pago
      ${totalWindow}
    FROM agg
    INNER JOIN ${SQL_CARTERA_SCHEMA}.creditos c ON c.credito_id = agg.credito_id
    INNER JOIN ${SQL_CARTERA_SCHEMA}.usuarios u ON u.usuario_id = c.usuario_id
    ORDER BY agg.racha DESC, agg.numero_credito_sifco ASC
    ${limitOffset}
  `);

  const rows = (res.rows as Array<ComportamientoPagoRow & { _total?: number }>) ?? [];

  if (!paginar) {
    return { success: true, total: rows.length, data: rows };
  }

  const total = Number(rows[0]?._total ?? 0);
  // `_total` es de la ventana de conteo, no del modelo — se quita de cada fila.
  const data = rows.map(({ _total, ...row }) => row);
  return {
    success: true,
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    data,
  };
}
