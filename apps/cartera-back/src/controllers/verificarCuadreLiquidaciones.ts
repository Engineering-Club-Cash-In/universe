// ============================================================
// Verificación del cuadre de las liquidaciones del mes
// ------------------------------------------------------------
// Job que corre el 11, 12 y 13 a las 08:00 hora Guatemala (el 10 no: ese día
// se está liquidando y todo estaría a medio camino).
//
// Por cada liquidación del mes que TODAVÍA no cuadra, verifica:
//
//   espejo − capital_nuevo_neto  ==  historico + reinversion_total
//
// Se comparan MONTOS, no créditos: mover capital de un crédito a otro
// (`/reemplazar-inversionista-credito`) es una operación válida y rutinaria
// que da la misma suma, así que no debe alertar.
//
// capital_nuevo_neto = lo que ENTRÓ menos lo que SALIÓ:
//   • entraron → créditos que están en el espejo pero no dejaron fila en el
//     histórico de esa liquidación. Típico: crédito comprado a principio de mes,
//     que no genera pago espejo y por eso no entra a la liquidación del 10, pero
//     sí infla el monto_aportado. Un crédito que ya tenía monto y sí liquidó no
//     cuenta: el histórico se escribió con la compra ya incluida.
//   • salieron → créditos que sí liquidaron y que ya no están en el espejo. Sin
//     este término, una reubicación contaría el crédito destino como capital
//     nuevo y alertaría por el monto entero.
//
// El ajuste NO sale de compras_credito_inversionista: esa fila se crea recién
// cuando alguien acepta la compra, con fechas hacia atrás, así que el capital
// vive en el espejo días antes de que exista su registro y la tabla no sirve
// para saber qué había en un momento dado.
//
// El estado de la reinversión (aceptada, pendiente o cancelada) es
// irrelevante: el sistema ya la metió al monto aportado cuando la creó, y que
// la persona la acepte o no es decisión suya, no un error del sistema.
//
// El correo es una NOTIFICACIÓN, no una alerta. Hay descuadres perfectamente
// válidos (devoluciones a Cube hechas a mano, compras que entraron después)
// que no se pueden distinguir automáticamente de un error. Se avisa y que
// alguien decida si amerita revisión.
//
// De cada liquidación se avisa UNA sola vez (`notificado_at`). Las tres
// corridas no son tres correos: el 12 y el 13 existen para cerrar las que ya
// cuadraron por su cuenta y para avisar de liquidaciones que aparecieron
// después, no para repetir lo mismo. Mandar el mismo listado tres veces solo
// enseña a ignorarlo.
// ============================================================
import Big from "big.js";
import { sql } from "drizzle-orm";
import { db } from "../database";
import { sendPlainEmail } from "@cci/email";

const TZ_GUATEMALA = "America/Guatemala";

// Un quetzal: por debajo de eso es ruido de redondeo, no un descuadre.
const TOLERANCIA = new Big(1);

// Destinatarios de la notificación.
const EMAILS = [
  "diego.l@clubcashin.com",
  "jalvarado@clubcashin.com",
  "daniel.r@clubcashin.com",
  "diego.a@sepresta.com",
  "lralda@clubcashin.com",
  "caja@sepresta.com",
];

interface FilaCuadre {
  liquidacion_id: number;
  inversionista_id: number;
  nombre: string;
  fecha_liquidacion: string;
  espejo: string;
  historico: string;
  reinversion_total: string;
  compras_no_absorbidas: string;
  creditos_espejo: number;
  creditos_historico: number;
  compras_detalle: unknown;
  ya_notificada: boolean;
}

/** "YYYY-MM" del mes en curso, en hora Guatemala. */
export function periodoActualGuatemala(ahora: Date = new Date()): string {
  const guate = new Date(ahora.toLocaleString("en-US", { timeZone: TZ_GUATEMALA }));
  return `${guate.getFullYear()}-${String(guate.getMonth() + 1).padStart(2, "0")}`;
}

function fmtQ(valor: Big | string | number): string {
  const n = new Big(valor);
  const signo = n.lt(0) ? "−" : "";
  const [entero, decimales] = n.abs().toFixed(2).split(".");
  const conComas = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${signo}Q${conComas}.${decimales}`;
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-08" → "agosto de 2026" */
function periodoEnPalabras(periodo: string): string {
  const [anio, mes] = periodo.split("-");
  const nombre = MESES[Number(mes) - 1] ?? periodo;
  return `${nombre} de ${anio}`;
}

/**
 * Lee el cuadre de todas las liquidaciones del período que aún no fueron
 * marcadas como cuadradas. No escribe nada.
 */
export async function leerCuadreLiquidaciones(periodo: string): Promise<FilaCuadre[]> {
  const inicio = `${periodo}-01`;

  const resultado = await db.execute(sql`
    with todas as (
      select l.liquidacion_id, l.inversionista_id, l.fecha_liquidacion, l.reinversion_total,
             row_number() over (
               partition by l.inversionista_id order by l.fecha_liquidacion desc
             ) as orden,
             -- Liquidación cronológicamente anterior del mismo inversionista.
             -- Acota por abajo la ventana en que se le atribuye una reinversión:
             -- con liquidaciones en días consecutivos, el margen de un día haría
             -- que la reinversión de la primera contara también para la segunda.
             lead(l.fecha_liquidacion) over (
               partition by l.inversionista_id order by l.fecha_liquidacion desc
             ) as anterior
      from cartera.liquidaciones l
      -- El período se clasifica en hora Guatemala, igual que periodoActualGuatemala.
      -- Comparando el timestamptz crudo con la sesión en UTC, una liquidación del
      -- 31 a las 20:00 GT caería en el mes siguiente y nunca se verificaría.
      where (l.fecha_liquidacion at time zone 'America/Guatemala')::date >= ${inicio}::date
        and (l.fecha_liquidacion at time zone 'America/Guatemala')::date
            < (${inicio}::date + interval '1 month')
    ),
    liq as (
      -- La ecuación se evalúa contra la ÚLTIMA liquidación del mes: el espejo
      -- vivo refleja todo lo posterior, así que compararlo con el histórico de
      -- una liquidación anterior daría un descuadre garantizado.
      --
      -- Las anteriores del mismo mes (raro, pero liquidateByInvestorId lo
      -- permite cuando aparecen pagos NO_LIQUIDADO nuevos) no quedan sin
      -- revisar: se verifican aparte, más abajo, comprobando que su
      -- reinversión llegó a colocarse. Sin eso, una reinversión perdida en la
      -- primera liquidación se volvería invisible, porque el histórico de la
      -- segunda arranca del espejo ya deficiente y cuadra solo.
      select liquidacion_id, inversionista_id, fecha_liquidacion, reinversion_total,
             -- Ventana (desde, hasta] para las filas sin procedencia. El corte
             -- es la liquidación previa misma, no un margen fijo: con dos
             -- liquidaciones en días seguidos, un margen hacia atrás haría que
             -- la reinversión de la primera cayera también en la ventana de la
             -- segunda y se contara dos veces.
             coalesce(anterior, fecha_liquidacion - interval '1 day') as desde_reinversion,
             null::timestamptz as hasta_reinversion
      from todas where orden = 1
    ),
    pendientes as (
      -- TODAS las liquidaciones del mes se revisan los tres días, incluidas
      -- las que ya cuadraron. Cuadrar el 11 no es un salvoconducto: el caso
      -- que motivó este job (Adriana Bahaia, agosto 2026) cuadraba a las 8am
      -- del 11 y el borrado de Q95,035.51 de su espejo ocurrió a las 15:47 de
      -- ese mismo día. Excluir lo ya cuadrado lo volvería invisible, que es
      -- justo lo contrario de para qué existen las corridas del 12 y el 13.
      --
      -- Lo que evita el correo repetido es notificado_at, no este filtro.
      select * from liq
    ),
    creditos_rel as (
      -- El conjunto de créditos sobre el que se compara. No puede ser "todo lo
      -- que el inversionista tiene vivo": liquidateByInvestorId escribe
      -- historico_liquidaciones_espejo solo mientras itera creditosConPagos, así
      -- que un crédito establecido que no tuvo pago este mes no deja fila en el
      -- histórico. Sumarlo del lado del espejo y no del otro inventa un
      -- descuadre por su saldo completo, con la cartera intacta.
      --
      -- Son los créditos que liquidaron, más aquel donde aterrizó la reinversión
      -- (que es nuevo y por eso no está en el histórico, pero sí del lado
      -- derecho dentro de reinversion_total).
      select distinct p.liquidacion_id, p.inversionista_id, hl.credito_id
      from pendientes p
      join cartera.historico_liquidaciones_espejo hl
        on hl.liquidacion_id = p.liquidacion_id
       and hl.inversionista_id = p.inversionista_id
      union
      select distinct p.liquidacion_id, p.inversionista_id, c.credito_id
      from pendientes p
      join cartera.compras_credito_inversionista c
        on c.inversionista_id = p.inversionista_id
      where c.tipo_operacion = 'reinversion'
        -- Un intento revertido devolvió su monto a CUBE: no colocó nada.
        and c.revertida_at is null
        and (
          -- Filas nuevas: procedencia exacta.
          c.liquidacion_id = p.liquidacion_id
          -- Filas anteriores a la columna de procedencia: ventana acotada por
          -- ambos lados. El límite inferior es la liquidación previa (excluida)
          -- y el superior la siguiente, así dos liquidaciones en días seguidos
          -- no se disputan la misma reinversión.
          or (
            c.liquidacion_id is null
            and c.fecha >  p.desde_reinversion
            and (p.hasta_reinversion is null or c.fecha <= p.hasta_reinversion)
          )
        )
    ),
    reinversion_por_credito as (
      -- Cuánto de la reinversión aterrizó en cada crédito. addInvestorToCredit
      -- puede elegir una posición existente con porcentaje compatible, así que
      -- el crecimiento del espejo en un crédito que ya liquidó puede venir de la
      -- reinversión y no de una compra. Sin descontarlo, ese crecimiento se le
      -- atribuye a la compra del mes y se resta de más.
      select c.inversionista_id, c.credito_id, p.liquidacion_id,
             sum(c.monto_aportado) as monto
      from cartera.compras_credito_inversionista c
      join pendientes p on p.inversionista_id = c.inversionista_id
      where c.tipo_operacion = 'reinversion'
        and c.revertida_at is null
        and (
          c.liquidacion_id = p.liquidacion_id
          or (
            c.liquidacion_id is null
            and c.fecha >  p.desde_reinversion
            and (p.hasta_reinversion is null or c.fecha <= p.hasta_reinversion)
          )
        )
      group by 1, 2, 3
    ),
    pendiente_por_credito as (
      -- Capital de pagos registrados después de la liquidación:
      -- insertPagosCreditoInversionistas ya bajó monto_aportado en el espejo
      -- pero la fila sigue NO_LIQUIDADO esperando la liquidación siguiente. Se
      -- suma POR CRÉDITO y no solo al total, porque el delta de las compras se
      -- mide contra este mismo saldo: medirlo contra el espejo crudo haría que
      -- una compra de Q200 seguida de Q100 de capital pendiente se contara como
      -- Q100.
      select pe.credito_id, pe.inversionista_id, sum(pe.abono_capital) as monto
      from cartera.pagos_credito_inversionistas_espejo pe
      where pe.estado_liquidacion = 'NO_LIQUIDADO'
      group by 1, 2
    ),
    espejo_credito as (
      -- Para un crédito que liquidó, entra su saldo completo: es lo que el
      -- histórico retrató y con eso se compara.
      --
      -- Para un crédito que NO liquidó y solo está acá porque recibió la
      -- reinversión, entra únicamente lo reinvertido. La reinversión puede
      -- aterrizar sobre una posición que ya existía, y sumar su saldo entero
      -- contra un lado derecho que solo trae reinversion_total inventaría un
      -- descuadre del tamaño de la posición previa: Q1,000 preexistentes que
      -- reciben Q100 no son Q1,000 que faltan.
      select cr.liquidacion_id, cr.inversionista_id, cr.credito_id,
             case
               when hl.credito_id is not null
                 then coalesce(esp.monto_aportado, 0) + coalesce(pc.monto, 0)
               else least(
                 coalesce(esp.monto_aportado, 0) + coalesce(pc.monto, 0),
                 coalesce(rpc.monto, 0)
               )
             end as monto
      from creditos_rel cr
      left join cartera.historico_liquidaciones_espejo hl
        on  hl.liquidacion_id   = cr.liquidacion_id
        and hl.credito_id       = cr.credito_id
        and hl.inversionista_id = cr.inversionista_id
      left join cartera.creditos_inversionistas_espejo esp
        on  esp.credito_id       = cr.credito_id
        and esp.inversionista_id = cr.inversionista_id
      left join pendiente_por_credito pc
        on  pc.credito_id       = cr.credito_id
        and pc.inversionista_id = cr.inversionista_id
      left join reinversion_por_credito rpc
        on  rpc.liquidacion_id   = cr.liquidacion_id
        and rpc.credito_id       = cr.credito_id
        and rpc.inversionista_id = cr.inversionista_id
    ),
    espejo as (
      select liquidacion_id, sum(monto) as espejo, count(*)::int as creditos
      from espejo_credito group by 1
    ),
    hist as (
      select h.liquidacion_id,
             sum(h.monto_aportado) as historico,
             count(*)::int         as creditos
      from cartera.historico_liquidaciones_espejo h
      where h.liquidacion_id in (select liquidacion_id from pendientes)
      group by 1
    ),
    compras_por_credito as (
      select c.inversionista_id, c.credito_id, p.liquidacion_id,
             sum(c.monto_aportado) as monto_compras,
             jsonb_agg(jsonb_build_object(
               'compra_id',  c.id,
               'credito_id', c.credito_id,
               'monto',      c.monto_aportado,
               'status',     c.status,
               'created_at', c.created_at
             ) order by c.id) as detalle
      from cartera.compras_credito_inversionista c
      join pendientes p on p.inversionista_id = c.inversionista_id
      where c.tipo_operacion = 'compra_cartera'
        and (
          c.created_at >= ${inicio}::date
          or (c.fecha_completada >= ${inicio}::date
              and c.fecha_completada < (${inicio}::date + interval '1 month'))
        )
      group by 1, 2, 3
    ),
    compras as (
      -- De cada compra se resta solo lo que el espejo tiene HOY por encima de la
      -- foto del histórico, y nunca más que la compra misma. Una compra anterior
      -- a la liquidación ya está dentro del histórico y da cero.
      --
      -- Se correlaciona por monto y no por "hubo movimiento después": el
      -- nuke&rebuild reinserta el roster completo y el trigger anota cada
      -- reinserción con monto_anterior NULL, así que cualquier rebaraje se
      -- vería como un aumento.
      --
      -- LÍMITE CONOCIDO: sobre un mismo crédito, después de la liquidación,
      -- una compra y una reinversión de montos parecidos se tapan entre sí. Si
      -- entran Q100 de reinversión y Q100 de compra y luego se pierden los Q100
      -- reinvertidos, el saldo vivo queda igual que si se hubiera perdido la
      -- compra, y la ecuación cuadra. Con saldos agregados los dos escenarios
      -- son indistinguibles; separarlos exige rastrear la procedencia de cada
      -- movimiento del espejo, no solo su neto. El caso pide coincidencia de
      -- crédito, momento y monto, así que se acepta a cambio de no complicar
      -- el chequeo.
      --
      -- Las compras sobre créditos fuera de creditos_rel no entran: su capital
      -- tampoco está del lado del espejo, así que no hay nada que corregir.
      --
      -- El status no se mira: una compra pendiente ya movió el monto_aportado, y
      -- que la acepten o la cancelen después es decisión suya.
      select cc.inversionista_id,
             sum(least(
               cc.monto_compras,
               greatest(
                 0,
                 ec.monto - coalesce(hl.monto_aportado, 0) - coalesce(rpc.monto, 0)
               )
             )) as monto,
             jsonb_agg(cc.detalle) as detalle
      from compras_por_credito cc
      join espejo_credito ec
        on  ec.liquidacion_id   = cc.liquidacion_id
        and ec.credito_id       = cc.credito_id
        and ec.inversionista_id = cc.inversionista_id
      left join cartera.historico_liquidaciones_espejo hl
        on  hl.liquidacion_id   = cc.liquidacion_id
        and hl.credito_id       = cc.credito_id
        and hl.inversionista_id = cc.inversionista_id
      left join reinversion_por_credito rpc
        on  rpc.liquidacion_id   = cc.liquidacion_id
        and rpc.credito_id       = cc.credito_id
        and rpc.inversionista_id = cc.inversionista_id
      group by 1
    )
    select
      p.liquidacion_id,
      p.inversionista_id,
      i.nombre,
      p.fecha_liquidacion,
      coalesce(e.espejo, 0)::text            as espejo,
      coalesce(h.historico, 0)::text         as historico,
      p.reinversion_total::text              as reinversion_total,
      coalesce(c.monto, 0)::text             as compras_no_absorbidas,
      coalesce(e.creditos, 0)                as creditos_espejo,
      coalesce(h.creditos, 0)                as creditos_historico,
      coalesce(c.detalle, '[]'::jsonb)       as compras_detalle,
      -- Ya se avisó de esta liquidación: se sigue verificando (por si cuadra y
      -- se cierra) pero no se vuelve a mandar correo.
      (v.notificado_at is not null)          as ya_notificada
    from pendientes p
    join cartera.inversionistas i on i.inversionista_id = p.inversionista_id
    left join espejo  e on e.liquidacion_id = p.liquidacion_id
    left join hist    h on h.liquidacion_id   = p.liquidacion_id
    left join compras c on c.inversionista_id = p.inversionista_id
    left join cartera.verificacion_liquidacion v on v.liquidacion_id = p.liquidacion_id
    order by p.inversionista_id
  `);

  return (resultado as unknown as { rows: FilaCuadre[] }).rows ?? [];
}

/**
 * Liquidaciones NO finales del mes (un inversionista liquidado dos veces) con
 * reinversión, junto con cuánto de ella llegó a colocarse.
 *
 * Devuelve también las que ya cuadran: si una quedó registrada como fallida y
 * su reinversión se colocó antes de la corrida siguiente, hay que poder cerrar
 * esa fila. Filtrando acá quedaría para siempre en cuadra = false con un
 * descuadre y una fecha de verificación viejos.
 *
 * La ecuación principal solo puede evaluarse contra la última liquidación del
 * mes: el espejo vivo ya refleja todo lo posterior. Para las anteriores el
 * histórico de la siguiente arranca del espejo ya deficiente y cuadra solo, así
 * que una reinversión perdida ahí sería invisible. Acá se comprueba lo único
 * que sigue siendo verificable: que existiera una compra de reinversión después
 * de esa liquidación.
 */
export async function leerReinversionesAnterioresSinColocar(periodo: string) {
  const inicio = `${periodo}-01`;

  const resultado = await db.execute(sql`
    with todas as (
      select l.liquidacion_id, l.inversionista_id, l.fecha_liquidacion, l.reinversion_total,
             row_number() over (
               partition by l.inversionista_id order by l.fecha_liquidacion desc
             ) as orden,
             lead(l.fecha_liquidacion) over (
               partition by l.inversionista_id order by l.fecha_liquidacion
             ) as siguiente,
             -- Cota inferior: la liquidación previa. Con liquidaciones en días
             -- consecutivos, el margen de un día haría que la reinversión de la
             -- anterior contara como si fuera de esta.
             lag(l.fecha_liquidacion) over (
               partition by l.inversionista_id order by l.fecha_liquidacion
             ) as previa
      from cartera.liquidaciones l
      -- El período se clasifica en hora Guatemala, igual que periodoActualGuatemala.
      -- Comparando el timestamptz crudo con la sesión en UTC, una liquidación del
      -- 31 a las 20:00 GT caería en el mes siguiente y nunca se verificaría.
      where (l.fecha_liquidacion at time zone 'America/Guatemala')::date >= ${inicio}::date
        and (l.fecha_liquidacion at time zone 'America/Guatemala')::date
            < (${inicio}::date + interval '1 month')
    )
    select t.liquidacion_id, t.inversionista_id, i.nombre,
           t.fecha_liquidacion, t.reinversion_total::text as reinversion_total,
           coalesce((
             select sum(c.monto_aportado)
             from cartera.compras_credito_inversionista c
             where c.inversionista_id = t.inversionista_id
               and c.tipo_operacion = 'reinversion'
               and c.revertida_at is null
               and (
                 c.liquidacion_id = t.liquidacion_id
                 or (
                   c.liquidacion_id is null
                   and c.fecha > coalesce(t.previa, t.fecha_liquidacion - interval '1 day')
                   and (t.siguiente is null or c.fecha <= t.siguiente)
                 )
               )
           ), 0)::text as reinversion_colocada
    from todas t
    join cartera.inversionistas i on i.inversionista_id = t.inversionista_id
    where t.orden > 1
      and t.reinversion_total > 0
    order by t.inversionista_id
  `);

  return (resultado as unknown as { rows: any[] }).rows ?? [];
}

/**
 * Verifica el cuadre de las liquidaciones del período, guarda el snapshot y
 * notifica por correo las que no cuadran. No modifica ningún dato financiero.
 */
export async function verificarCuadreLiquidaciones(periodo = periodoActualGuatemala()) {
  console.log(`\n🔍 [verificarCuadreLiquidaciones] Período ${periodo}`);

  const filas = await leerCuadreLiquidaciones(periodo);

  if (filas.length === 0) {
    console.log("✅ [verificarCuadreLiquidaciones] No hay liquidaciones pendientes de verificar");
    return { periodo, verificadas: 0, cuadran: 0, descuadres: 0, notificado: false };
  }

  const porAvisar: Array<FilaCuadre & { descuadre: Big; intentos: number }> = [];
  let cuadran = 0;
  let descuadran = 0;
  let yaAvisadas = 0;

  for (const fila of filas) {
    const espejo = new Big(fila.espejo || 0);
    const historico = new Big(fila.historico || 0);
    const reinversion = new Big(fila.reinversion_total || 0);
    const compras = new Big(fila.compras_no_absorbidas || 0);

    const descuadre = espejo.minus(compras).minus(historico).minus(reinversion);
    const cuadra = descuadre.abs().lte(TOLERANCIA);

    const detalle = {
      creditos_en_espejo: fila.creditos_espejo,
      creditos_en_historico: fila.creditos_historico,
      compras_consideradas: fila.compras_detalle,
      ecuacion: {
        espejo: espejo.toFixed(8),
        menos_compras_no_absorbidas: compras.toFixed(8),
        historico: historico.toFixed(8),
        mas_reinversion_total: reinversion.toFixed(2),
        descuadre: descuadre.toFixed(8),
      },
    };

    // Upsert: la revisión del 12 y 13 reescribe la misma fila y sube intentos,
    // aunque ya no se vuelva a avisar por correo.
    const guardada = await db.execute(sql`
      insert into cartera.verificacion_liquidacion (
        liquidacion_id, inversionista_id, periodo,
        espejo, historico, reinversion_total, compras_no_absorbidas,
        descuadre, cuadra, detalle
      ) values (
        ${fila.liquidacion_id}, ${fila.inversionista_id}, ${periodo},
        ${espejo.toFixed(8)}, ${historico.toFixed(8)},
        ${reinversion.toFixed(2)}, ${compras.toFixed(8)},
        ${descuadre.toFixed(8)}, ${cuadra}, ${JSON.stringify(detalle)}::jsonb
      )
      on conflict (liquidacion_id) do update set
        espejo                = excluded.espejo,
        historico             = excluded.historico,
        reinversion_total     = excluded.reinversion_total,
        compras_no_absorbidas = excluded.compras_no_absorbidas,
        descuadre             = excluded.descuadre,
        cuadra                = excluded.cuadra,
        detalle               = excluded.detalle,
        intentos              = cartera.verificacion_liquidacion.intentos + 1,
        verificado_at         = now()
      returning intentos
    `);

    const intentos =
      Number((guardada as unknown as { rows: { intentos: number }[] }).rows?.[0]?.intentos ?? 1);

    if (cuadra) {
      cuadran++;
      continue;
    }

    descuadran++;

    // De cada liquidación se avisa UNA sola vez. Si ya se notificó y sigue sin
    // cuadrar, se actualiza el snapshot en silencio: repetir el mismo correo
    // el 12 y el 13 no aporta nada y solo entrena a la gente a ignorarlo.
    if (fila.ya_notificada) {
      yaAvisadas++;
      continue;
    }

    porAvisar.push({ ...fila, descuadre, intentos });
  }

  console.log(
    `📊 [verificarCuadreLiquidaciones] Verificadas ${filas.length} · cuadran ${cuadran} · ` +
    `descuadran ${descuadran} (${yaAvisadas} ya avisadas antes) · por avisar ${porAvisar.length}`
  );

  // Liquidaciones anteriores del mismo mes cuya reinversión nunca se colocó.
  // No pasan por la ecuación (el espejo vivo no sirve para compararlas), así
  // que se guardan con el descuadre igual a la reinversión que falta.
  const anteriores = await leerReinversionesAnterioresSinColocar(periodo);
  for (const ant of anteriores) {
    // Faltante real: lo prometido menos lo que sí llegó a colocarse. Una
    // colocación parcial deja un remanente que también hay que avisar.
    const prometida = new Big(ant.reinversion_total || 0);
    const colocada = new Big(ant.reinversion_colocada || 0);
    const faltante = prometida.minus(colocada);
    // Se compara el MONTO colocado contra el prometido, no la mera existencia de
    // una compra: addInvestorToCredit puede colocar de forma parcial y devolver
    // monto_sin_asignar > 0, así que Q100 colocados no prueban que se colocaran
    // los Q1,000 de la liquidación.
    const cuadraAnt = faltante.abs().lte(TOLERANCIA);
    const guardadaAnt = await db.execute(sql`
      insert into cartera.verificacion_liquidacion (
        liquidacion_id, inversionista_id, periodo,
        espejo, historico, reinversion_total, compras_no_absorbidas,
        descuadre, cuadra, detalle
      ) values (
        ${ant.liquidacion_id}, ${ant.inversionista_id}, ${periodo},
        '0', '0', ${prometida.toFixed(2)}, ${colocada.toFixed(8)},
        ${faltante.times(-1).toFixed(8)}, ${cuadraAnt},
        ${JSON.stringify({
          motivo: "liquidacion_anterior_del_mes_con_reinversion_sin_colocar",
          reinversion_prometida: prometida.toFixed(2),
          reinversion_colocada: colocada.toFixed(8),
          faltante: faltante.toFixed(8),
          nota: "No se evalúa la ecuación: el espejo vivo ya refleja la liquidación posterior.",
        })}::jsonb
      )
      on conflict (liquidacion_id) do update set
        descuadre     = excluded.descuadre,
        cuadra        = excluded.cuadra,
        detalle       = excluded.detalle,
        intentos      = cartera.verificacion_liquidacion.intentos + 1,
        verificado_at = now()
      returning intentos, (notificado_at is not null) as ya_notificada
    `);
    const filaAnt = (guardadaAnt as unknown as {
      rows: { intentos: number; ya_notificada: boolean }[];
    }).rows?.[0];

    if (cuadraAnt) {
      cuadran++;
      continue;
    }

    descuadran++;
    if (filaAnt?.ya_notificada) {
      yaAvisadas++;
      continue;
    }
    porAvisar.push({
      liquidacion_id: ant.liquidacion_id,
      inversionista_id: ant.inversionista_id,
      nombre: ant.nombre,
      fecha_liquidacion: ant.fecha_liquidacion,
      espejo: "0",
      historico: "0",
      reinversion_total: prometida.toFixed(2),
      compras_no_absorbidas: colocada.toFixed(8),
      creditos_espejo: 0,
      creditos_historico: 0,
      compras_detalle: [],
      ya_notificada: false,
      descuadre: faltante.times(-1),
      intentos: Number(filaAnt?.intentos ?? 1),
    });
  }

  if (porAvisar.length === 0) {
    return {
      periodo,
      verificadas: filas.length,
      cuadran,
      descuadres: descuadran,
      ya_avisadas: yaAvisadas,
      notificados: 0,
      notificado: false,
    };
  }

  await notificarDescuadres(periodo, porAvisar);

  return {
    periodo,
    verificadas: filas.length,
    cuadran,
    descuadres: descuadran,
    ya_avisadas: yaAvisadas,
    notificados: porAvisar.length,
    notificado: true,
  };
}

async function notificarDescuadres(
  periodo: string,
  descuadres: Array<FilaCuadre & { descuadre: Big; intentos: number }>
) {
  const filasHtml = descuadres
    .map((d) => {
      const signo = d.descuadre.gt(0) ? "de más" : "de menos";
      return `<tr>
        <td style="padding:6px 10px;border:1px solid #ddd;">${d.nombre}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;text-align:center;">${d.inversionista_id}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;text-align:center;">${d.liquidacion_id}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${fmtQ(d.espejo)}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${fmtQ(d.compras_no_absorbidas)}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${fmtQ(d.historico)}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${fmtQ(d.reinversion_total)}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;font-weight:600;">${fmtQ(d.descuadre)}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;">${signo}</td>
      </tr>`;
    })
    .join("");

  const mes = periodoEnPalabras(periodo);
  const sonVarios = descuadres.length > 1;

  const html = `
    <div style="font-family:Arial,sans-serif;color:#222;line-height:1.6;">
      <h2 style="font-weight:600;margin:0 0 14px;">Liquidaciones de ${mes} para revisar</h2>
      <p style="margin:0 0 12px;">Buen día,</p>
      <p style="margin:0 0 12px;">
        Revisamos las liquidaciones de ${mes} y en
        ${sonVarios ? `<strong>${descuadres.length}</strong> de ellas` : "<strong>una</strong>"}
        el capital que hoy tiene ${sonVarios ? "cada inversionista" : "el inversionista"}
        no coincide con lo que dejó registrado su liquidación del mes.
      </p>
      <p style="margin:0 0 12px;">
        Puede que esté todo bien. Una devolución a Cube hecha a mano, una compra que entró
        después del corte o cualquier ajuste manual dejan exactamente esta misma diferencia.
        Lo que no podemos es distinguir eso de algo que se haya perdido en el camino, así que
        preferimos avisar y que ustedes decidan.
      </p>
      <p style="margin:0 0 4px;">Este es el detalle:</p>
      <table style="border-collapse:collapse;border:1px solid #ddd;font-size:13px;">
        <thead>
          <tr style="background:#f4f4f4;">
            <th style="padding:6px 10px;border:1px solid #ddd;">Inversionista</th>
            <th style="padding:6px 10px;border:1px solid #ddd;">ID</th>
            <th style="padding:6px 10px;border:1px solid #ddd;">Liquidación</th>
            <th style="padding:6px 10px;border:1px solid #ddd;">Monto aportado</th>
            <th style="padding:6px 10px;border:1px solid #ddd;">Compras</th>
            <th style="padding:6px 10px;border:1px solid #ddd;">Histórico</th>
            <th style="padding:6px 10px;border:1px solid #ddd;">Reinversión</th>
            <th style="padding:6px 10px;border:1px solid #ddd;">Diferencia</th>
            <th style="padding:6px 10px;border:1px solid #ddd;"></th>
          </tr>
        </thead>
        <tbody>${filasHtml}</tbody>
      </table>
      <p style="margin:16px 0 0;">
        Si algo de acá les llama la atención, vale la pena mirarlo. Si ya saben a qué
        corresponde, se puede dejar pasar sin más.
      </p>
      <p style="color:#888;font-size:12px;margin-top:16px;">
        Revisión automática de cartera. De cada liquidación se avisa una sola vez, así que
        este es el único correo que van a recibir por estos casos.
      </p>
    </div>`;

  const envio = await sendPlainEmail(
    EMAILS,
    `Liquidaciones de ${mes}: ${descuadres.length} para revisar`,
    html
  );

  // sendPlainEmail NO lanza si Resend falla: resuelve { success:false, error }.
  if (!envio?.success) {
    console.error(
      "❌ [verificarCuadreLiquidaciones] El correo NO se pudo enviar:",
      envio?.error
    );
    throw new Error(
      `Falló el envío de la notificación de cuadre: ${JSON.stringify(envio?.error)}`
    );
  }

  await db.execute(sql`
    update cartera.verificacion_liquidacion
    set notificado_at = now()
    where liquidacion_id in (${sql.join(
      descuadres.map((d) => sql`${d.liquidacion_id}`),
      sql`, `
    )})
  `);

  console.log(
    `📧 [verificarCuadreLiquidaciones] Notificados ${descuadres.length} descuadre(s) a ${EMAILS.length} destinatarios`
  );
}
