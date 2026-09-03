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

// Desde cuándo se puede exigir el sello de procedencia (liquidacion_id) en las
// compras de reinversión: la fecha en que se aplicó la migración 0032.
//
// El corte se deriva normalmente del propio dato —la primera fila sellada— pero
// esa señal no aparece si la primera reinversión automática posterior a la
// migración no encuentra candidatos: addInvestorToCredit retorna sin insertar
// nada y no queda ninguna fila con sello. Sin un tope fijo, el fallback seguiría
// aceptando como "heredada" cualquier reasignación manual sin sello, que es
// justo lo que la procedencia vino a distinguir.
const CORTE_PROCEDENCIA = "2026-09-02";

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
    with inicio_procedencia as (
      -- Desde cuándo existe el sello de procedencia. Antes de esa marca no hay
      -- forma de atribuir una reinversión a su liquidación, así que ahí se cae
      -- a la fecha; después, el sello manda.
      -- El menor entre la primera fila sellada y la fecha de la migración: si
      -- ninguna reinversión llegó a sellar, el corte no puede quedar abierto.
      select least(
        min(created_at),
        ${CORTE_PROCEDENCIA}::timestamptz
      ) as desde
      from cartera.compras_credito_inversionista
      where liquidacion_id is not null
    ),
    todas as (
      select l.liquidacion_id, l.inversionista_id, l.fecha_liquidacion, l.reinversion_total,
             -- Desempate por id: /liquidate-inversionista-pagos acepta una
             -- fecha_liquidacion explícita, así que dos liquidaciones del mismo
             -- inversionista pueden llevar el mismo instante. Sin el id, cuál
             -- queda como "última" lo decide Postgres y el espejo vivo se
             -- compararía contra la foto equivocada.
             row_number() over (
               partition by l.inversionista_id
               order by l.fecha_liquidacion desc, l.liquidacion_id desc
             ) as orden
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
      -- revisar: se verifican aparte en leerReinversionesAnterioresSinColocar,
      -- comprobando que su reinversión llegara a colocarse.
      select liquidacion_id, inversionista_id, fecha_liquidacion, reinversion_total
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
      -- Entran dos grupos:
      --   (a) los créditos que liquidaron: tienen foto en el histórico y se
      --       compara su saldo completo contra ella;
      --   (b) cualquier crédito del inversionista que el trigger del espejo vio
      --       moverse DESPUÉS de la liquidación. Ahí caen el destino de la
      --       reinversión, las compras del mes, los pagos posteriores y las dos
      --       puntas de una reubicación manual. De estos no entra el saldo sino
      --       el cambio neto desde la liquidación (ver espejo_credito).
      --
      -- Se usa el trigger y no compras_credito_inversionista porque
      -- manualReassignInvestor escribe "reinversion" sin sello de procedencia
      -- (replaceInvestorCredit.ts:1416-1425): por la tabla de compras no hay
      -- forma de ver el crédito ORIGEN de una reubicación, y sin el origen una
      -- transferencia que no cambia el total aparece como faltante.
      select distinct p.liquidacion_id, p.inversionista_id, hl.credito_id
      from pendientes p
      join cartera.historico_liquidaciones_espejo hl
        on hl.liquidacion_id = p.liquidacion_id
       and hl.inversionista_id = p.inversionista_id
      union
      select distinct p.liquidacion_id, p.inversionista_id, hm.credito_id
      from pendientes p
      join cartera.historico_monto_aportado_espejo hm
        on hm.inversionista_id = p.inversionista_id
       and hm.fecha > p.fecha_liquidacion
    ),
    entradas_por_credito as (
      -- Capital que entró a cada crédito por reinversión o reubicación desde
      -- la liquidación (automática o manual: acá da igual, lo que importa es
      -- que ese crecimiento NO es una compra de cartera). Sirve para que el
      -- ajuste de compras no se apropie del crecimiento que trajo la
      -- reinversión. Los intentos revertidos devolvieron su monto a CUBE y no
      -- entran.
      -- La atribución va por el SELLO, no por fecha: completeEspejo reescribe
      -- created_at, fecha, fecha_completada y updated_at de la reinversión con
      -- el día siguiente a la ÚLTIMA liquidación del inversionista cuando se
      -- acepta tarde (completeEspejo.ts:309-328). Una reinversión vieja, ya
      -- incluida en la foto del histórico, se redataría como posterior a la
      -- liquidación y se descontaría del margen de las compras, produciendo un
      -- sobrante falso.
      select c.inversionista_id, c.credito_id, p.liquidacion_id,
             sum(c.monto_aportado) as monto
      from cartera.compras_credito_inversionista c
      join pendientes p on p.inversionista_id = c.inversionista_id
      where c.tipo_operacion = 'reinversion'
        and c.revertida_at is null
        and (
          c.liquidacion_id = p.liquidacion_id
          or (
            -- Filas anteriores al sello: no hay procedencia, solo la fecha.
            c.liquidacion_id is null
            and c.created_at < coalesce(
              (select desde from inicio_procedencia), ${CORTE_PROCEDENCIA}::timestamptz
            )
            and c.created_at > p.fecha_liquidacion
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
    saldo_previo as (
      -- Saldo que tenía cada crédito del grupo (b) justo antes de que corriera
      -- la liquidación. Es la línea base contra la que se mide su cambio neto.
      --
      -- Sale del trigger del espejo: el último monto_nuevo anterior a la
      -- liquidación. Si no hay ninguno (crédito sin movimientos desde que
      -- existe la bitácora), se toma el monto_anterior del primer movimiento
      -- posterior, que es el saldo que ese movimiento encontró. Un DELETE deja
      -- monto_nuevo NULL: se lee como 0, la posición no existía. Un INSERT
      -- sin DELETE previo también es 0: la posición nació ahí.
      --
      -- Sin esta línea base, una posición de Q1,000 que recibe Q100 de
      -- reinversión y después los pierde seguiría aportando Q100 (su saldo
      -- vivo sigue siendo ≥ Q100) y el faltante quedaría tapado.
      select cr.liquidacion_id, cr.inversionista_id, cr.credito_id,
             coalesce(
               (
                 select coalesce(hm.monto_nuevo, 0)
                 from cartera.historico_monto_aportado_espejo hm
                 where hm.credito_id       = cr.credito_id
                   and hm.inversionista_id = cr.inversionista_id
                   and hm.fecha < p.fecha_liquidacion
                 order by hm.fecha desc, hm.id desc
                 limit 1
               ),
               (
                 select coalesce(hm.monto_anterior, 0)
                 from cartera.historico_monto_aportado_espejo hm
                 where hm.credito_id       = cr.credito_id
                   and hm.inversionista_id = cr.inversionista_id
                   and hm.fecha > p.fecha_liquidacion
                 order by hm.fecha asc, hm.id asc
                 limit 1
               ),
               0
             ) as monto
      from creditos_rel cr
      join pendientes p on p.liquidacion_id = cr.liquidacion_id
    ),
    espejo_credito as (
      -- Grupo (a), crédito que liquidó: entra su saldo completo, que es lo que
      -- el histórico retrató y con eso se compara.
      --
      -- Grupo (b), crédito que no liquidó pero se movió después: entra el
      -- CAMBIO NETO desde la liquidación (saldo vivo menos saldo previo). Así:
      --   • el destino de la reinversión aporta exactamente lo que recibió,
      --     y si después lo pierde aporta 0, no su saldo preexistente;
      --   • una reubicación manual aporta +X en el destino y −X en el origen
      --     (o el origen entra por (a) con su saldo reducido) y se cancela;
      --   • una compra de cartera nueva aporta +compra, que el ajuste de
      --     compras resta a continuación;
      --   • un pago posterior baja el saldo y vuelve por pendiente_por_credito.
      select cr.liquidacion_id, cr.inversionista_id, cr.credito_id,
             (hl.credito_id is not null) as liquido,
             -- Referencia contra la que se mide el crecimiento del crédito: la
             -- foto del histórico si liquidó, y 0 si no (ahí monto ya es el
             -- cambio neto desde la liquidación).
             coalesce(hl.monto_aportado, 0) as referencia,
             case
               when hl.credito_id is not null
                 then coalesce(esp.monto_aportado, 0) + coalesce(pc.monto, 0)
               else coalesce(esp.monto_aportado, 0) + coalesce(pc.monto, 0) - sp.monto
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
      join saldo_previo sp
        on  sp.liquidacion_id   = cr.liquidacion_id
        and sp.credito_id       = cr.credito_id
        and sp.inversionista_id = cr.inversionista_id
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
    compras_por_credito_ajustada as (
      -- Cuánto de cada compra NO absorbió la liquidación.
      --
      -- La compra es lo que mete la plata al espejo, así que el monto sale de
      -- compras_credito_inversionista. De cada compra se resta solo lo que el
      -- crédito creció por encima de su referencia —la foto del histórico si
      -- liquidó, o el saldo previo si no— descontando el crecimiento que trajo
      -- la reinversión, y nunca más que la compra misma. Una compra anterior a
      -- la liquidación ya está dentro de la foto y da cero.
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
      -- El status de la compra no se mira: una compra pendiente ya movió el
      -- monto_aportado, y que la acepten o la cancelen después es decisión
      -- suya, no un error del sistema.
      select cc.liquidacion_id, cc.inversionista_id,
             ec.liquido,
             least(
               cc.monto_compras,
               greatest(
                 0,
                 ec.monto - coalesce(hl.monto_aportado, 0) - coalesce(en.monto, 0)
               )
             ) as monto,
             cc.detalle
      from compras_por_credito cc
      join espejo_credito ec
        on  ec.liquidacion_id   = cc.liquidacion_id
        and ec.credito_id       = cc.credito_id
        and ec.inversionista_id = cc.inversionista_id
      left join cartera.historico_liquidaciones_espejo hl
        on  hl.liquidacion_id   = cc.liquidacion_id
        and hl.credito_id       = cc.credito_id
        and hl.inversionista_id = cc.inversionista_id
      left join entradas_por_credito en
        on  en.liquidacion_id   = cc.liquidacion_id
        and en.credito_id       = cc.credito_id
        and en.inversionista_id = cc.inversionista_id
    ),
    crecimiento_cartera as (
      -- Cuánto creció la cartera del inversionista desde la liquidación, SIN
      -- contar la reinversión que sigue ahí. Es el techo de lo que las compras
      -- pueden explicar, y por lo tanto de lo que el ajuste puede restar.
      --
      -- Se toma la cartera COMPLETA, no solo la parte que no liquidó: una
      -- compra pendiente puede expirar sobre un crédito sin pago (−X en ese
      -- grupo) y rehacerse sobre uno que sí liquidó (+X en el otro). El total
      -- no se movió, pero un tope calculado por grupo no ve las dos puntas y
      -- deja restar la recompra.
      --
      -- El crecimiento se mide contra la referencia de cada crédito: la foto
      -- del histórico si liquidó, 0 si entró por cambio neto.
      --
      -- Se descuenta la reinversión que SOBREVIVE en cada crédito —lo entrado
      -- por reinversión, topado por el crecimiento real de ese crédito— y no
      -- el total registrado. Si se descontara el total, una reinversión
      -- colocada y luego perdida (crecimiento 0, registro Q100) bajaría el
      -- tope y taparía justo esa pérdida.
      select ec.liquidacion_id,
             sum(ec.monto - ec.referencia)
             - sum(least(
                 coalesce(en.monto, 0),
                 greatest(0, ec.monto - ec.referencia)
               )) as neto
      from espejo_credito ec
      left join entradas_por_credito en
        on  en.liquidacion_id   = ec.liquidacion_id
        and en.credito_id       = ec.credito_id
        and en.inversionista_id = ec.inversionista_id
      group by 1
    ),
    compras as (
      -- Lo que ya se ajustó por crédito, topado además por el crecimiento de
      -- la cartera completa.
      --
      -- El tope global es lo que evita inventar faltantes cuando el capital
      -- solo se movió de lugar. Una compra pendiente que expira devuelve su
      -- monto a CUBE (−X) y al rehacerse vuelve a entrar (+X, con una fila de
      -- compra nueva): en conjunto no creció nada, así que no hay nada que
      -- ajustar, y da igual si las dos puntas cayeron en créditos que
      -- liquidaron o no.
      --
      -- El tope no puede tapar una pérdida real: si la cartera creció Q200 por
      -- una compra y una reinversión de Q100 se perdió, la reinversión
      -- sobreviviente es 0, el tope es Q200, se resta la compra entera y el
      -- faltante de Q100 sigue a la vista.
      select cp.inversionista_id,
             least(
               coalesce(sum(cp.monto), 0),
               greatest(0, coalesce(max(cc.neto), 0))
             ) as monto,
             jsonb_agg(cp.detalle) as detalle
      from compras_por_credito_ajustada cp
      left join crecimiento_cartera cc on cc.liquidacion_id = cp.liquidacion_id
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
    with inicio_procedencia as (
      -- Desde cuándo existe el sello de procedencia. Antes de esa marca no hay
      -- forma de distinguir la reinversión automática de una reubicación
      -- manual, así que ahí se usa la ventana temporal; después, una fila de
      -- reinversión sin liquidacion_id es por definición manual
      -- (replaceInvestorCredit sigue escribiendo tipo_operacion = 'reinversion'
      -- sin sello) y no debe contarse como colocación automática.
      --
      -- Se deriva del dato en vez de fijar una fecha: apenas la primera
      -- liquidación sella una fila, el fallback deja de aplicar hacia adelante.
      -- El menor entre la primera fila sellada y la fecha de la migración: si
      -- ninguna reinversión llegó a sellar, el corte no puede quedar abierto.
      select least(
        min(created_at),
        ${CORTE_PROCEDENCIA}::timestamptz
      ) as desde
      from cartera.compras_credito_inversionista
      where liquidacion_id is not null
    ),
    todas as (
      select l.liquidacion_id, l.inversionista_id, l.fecha_liquidacion, l.reinversion_total,
             -- Mismo desempate por id que en la consulta principal: dos
             -- liquidaciones pueden compartir fecha_liquidacion explícita.
             row_number() over (
               partition by l.inversionista_id
               order by l.fecha_liquidacion desc, l.liquidacion_id desc
             ) as orden,
             lead(l.fecha_liquidacion) over (
               partition by l.inversionista_id
               order by l.fecha_liquidacion, l.liquidacion_id
             ) as siguiente,
             lead(l.liquidacion_id) over (
               partition by l.inversionista_id
               order by l.fecha_liquidacion, l.liquidacion_id
             ) as siguiente_id,
             -- Cota inferior: la liquidación previa. Con liquidaciones en días
             -- consecutivos, el margen de un día haría que la reinversión de la
             -- anterior contara como si fuera de esta.
             lag(l.fecha_liquidacion) over (
               partition by l.inversionista_id
               order by l.fecha_liquidacion, l.liquidacion_id
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
             -- Cuánto de la reinversión SIGUE en el espejo, no cuánto dice el
             -- log de compras que se colocó. Una colocación que después se
             -- borra deja su fila intacta y no revertida, y la liquidación
             -- siguiente fotografía el saldo ya deficiente: tratar la fila como
             -- prueba haría que los dos chequeos pasaran por alto la pérdida.
             --
             -- De cada colocación se cuenta lo que el crédito destino conservó
             -- entre la colocación y la liquidación siguiente: el saldo justo
             -- antes de esa liquidación menos el que tenía justo antes de la
             -- colocación, topado por el monto colocado.
             select sum(least(
               c.monto_aportado,
               greatest(0, coalesce(hasta.saldo, 0) - coalesce(antes.saldo, 0))
             ))
             from cartera.compras_credito_inversionista c
             left join lateral (
               -- La referencia se ancla a la LIQUIDACIÓN, no a la fecha de la
               -- compra: addInvestorToCredit reconstruye el espejo —y el
               -- trigger escribe su fila— antes de insertar el registro de
               -- compra, cuya fecha la pone la aplicación 1.5-2 s después
               -- (medido sobre producción, sin excepción). Cortar en c.fecha
               -- dejaba adentro el movimiento de la propia colocación, el
               -- delta daba cero y toda reinversión intacta se reportaba como
               -- no colocada.
               --
               -- Mismo patrón que saldo_previo: el último monto_nuevo anterior
               -- a la liquidación, o el monto_anterior del primer movimiento
               -- posterior si no hay bitácora previa.
               select coalesce(
                 (
                   select coalesce(hm.monto_nuevo, 0)
                   from cartera.historico_monto_aportado_espejo hm
                   where hm.credito_id       = c.credito_id
                     and hm.inversionista_id = c.inversionista_id
                     and hm.fecha < t.fecha_liquidacion
                   order by hm.fecha desc, hm.id desc
                   limit 1
                 ),
                 (
                   select coalesce(hm.monto_anterior, 0)
                   from cartera.historico_monto_aportado_espejo hm
                   where hm.credito_id       = c.credito_id
                     and hm.inversionista_id = c.inversionista_id
                     and hm.fecha > t.fecha_liquidacion
                   order by hm.fecha asc, hm.id asc
                   limit 1
                 ),
                 0
               ) as saldo
             ) antes on true
             left join lateral (
               -- Saldo del crédito justo ANTES de que corriera la liquidación
               -- siguiente.
               --
               -- Cuando esa liquidación tocó el crédito, se toma su propia foto
               -- y no la bitácora: el trigger data sus filas con NOW() —el
               -- inicio de la transacción— mientras t.siguiente viene de un
               -- new Date() de JavaScript creado después, así que las filas de
               -- la propia liquidación caen dentro de hm.fecha < t.siguiente y
               -- la bitácora devolvería el saldo YA reducido. Una reinversión
               -- intacta se reportaría como perdida por el capital que esa
               -- liquidación cobró legítimamente.
               --
               -- El histórico guarda el monto post-reducción junto con el
               -- capital que se liquidó, así que la suma reconstruye el saldo
               -- previo sin depender de relojes.
               select coalesce(
                 (
                   select hl.monto_aportado + coalesce(hl.capital_liquidado, 0)
                   from cartera.historico_liquidaciones_espejo hl
                   where hl.liquidacion_id   = t.siguiente_id
                     and hl.credito_id       = c.credito_id
                     and hl.inversionista_id = c.inversionista_id
                   limit 1
                 ),
                 (
                   select coalesce(hm.monto_nuevo, 0)
                   from cartera.historico_monto_aportado_espejo hm
                   where hm.credito_id       = c.credito_id
                     and hm.inversionista_id = c.inversionista_id
                     and (t.siguiente is null or hm.fecha < t.siguiente)
                   order by hm.fecha desc, hm.id desc
                   limit 1
                 ),
                 0
               ) as saldo
             ) hasta on true
             where c.inversionista_id = t.inversionista_id
               and c.tipo_operacion = 'reinversion'
               and c.revertida_at is null
               and (
                 c.liquidacion_id = t.liquidacion_id
                 or (
                   c.liquidacion_id is null
                   and c.created_at < coalesce(
                     (select desde from inicio_procedencia), ${CORTE_PROCEDENCIA}::timestamptz
                   )
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
        -- Todos los operandos, no solo el descuadre: si el reintento recalcula
        -- con Q75 colocados sobre una fila guardada con Q50, dejar el número
        -- viejo en su columna deja la verificación contradiciéndose a sí misma.
        espejo                = excluded.espejo,
        historico             = excluded.historico,
        reinversion_total     = excluded.reinversion_total,
        compras_no_absorbidas = excluded.compras_no_absorbidas,
        descuadre             = excluded.descuadre,
        cuadra                = excluded.cuadra,
        detalle               = excluded.detalle,
        intentos              = cartera.verificacion_liquidacion.intentos + 1,
        verificado_at         = now()
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
