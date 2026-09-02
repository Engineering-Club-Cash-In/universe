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
    with liq as (
      -- Una liquidación por inversionista: la última del período. En condiciones
      -- normales solo hay una; el distinct on es por si acaso.
      select distinct on (l.inversionista_id)
             l.liquidacion_id, l.inversionista_id, l.fecha_liquidacion, l.reinversion_total
      from cartera.liquidaciones l
      where l.fecha_liquidacion >= ${inicio}::date
        and l.fecha_liquidacion <  (${inicio}::date + interval '1 month')
      order by l.inversionista_id, l.fecha_liquidacion desc
    ),
    pendientes as (
      -- Las que ya cuadraron no se vuelven a verificar.
      select liq.* from liq
      where not exists (
        select 1 from cartera.verificacion_liquidacion v
        where v.liquidacion_id = liq.liquidacion_id and v.cuadra = true
      )
    ),
    espejo as (
      select e.inversionista_id,
             sum(e.monto_aportado) as espejo,
             count(*)::int         as creditos
      from cartera.creditos_inversionistas_espejo e
      where e.inversionista_id in (select inversionista_id from pendientes)
      group by 1
    ),
    hist as (
      select h.liquidacion_id,
             sum(h.monto_aportado) as historico,
             count(*)::int         as creditos
      from cartera.historico_liquidaciones_espejo h
      where h.liquidacion_id in (select liquidacion_id from pendientes)
      group by 1
    ),
    entraron as (
      -- Capital que la liquidación no absorbió: créditos que están en el espejo
      -- pero no dejaron fila en el histórico de esa liquidación.
      --
      -- Sale del espejo y NO de compras_credito_inversionista: esa fila se crea
      -- recién cuando alguien acepta la compra, con fechas hacia atrás, así que
      -- el capital vive en el espejo días antes de que exista su registro (caso
      -- Glenda: capital el 7-ago, fila creada el 17-ago fechada 12-ago).
      --
      -- Excepción: el crédito donde aterrizó la REINVERSIÓN no cuenta como
      -- capital nuevo. Restarlo cancelaría la reinversión del lado derecho y el
      -- guard nunca vería una reinversión perdida. Las compras de tipo
      -- 'reinversion' sí se registran en el instante, así que sirven para
      -- identificarlo (las de compra_cartera no).
      select e.inversionista_id,
             sum(e.monto_aportado) as monto,
             jsonb_agg(jsonb_build_object(
               'credito_id', e.credito_id, 'monto', e.monto_aportado
             ) order by e.credito_id) as detalle
      from cartera.creditos_inversionistas_espejo e
      join pendientes p on p.inversionista_id = e.inversionista_id
      where not exists (
        select 1 from cartera.historico_liquidaciones_espejo hl
        where hl.liquidacion_id = p.liquidacion_id
          and hl.credito_id = e.credito_id
          and hl.inversionista_id = e.inversionista_id
      )
      and not exists (
        select 1 from cartera.compras_credito_inversionista c
        where c.credito_id = e.credito_id
          and c.inversionista_id = e.inversionista_id
          and c.tipo_operacion = 'reinversion'
          and c.created_at >= p.fecha_liquidacion - interval '1 day'
      )
      group by 1
    ),
    salieron as (
      -- Contrapartida: créditos que sí liquidaron pero que ya no están en el
      -- espejo. Sin esto, mover capital de un crédito viejo a uno nuevo
      -- (reubicación, que es válida y rutinaria) contaría el destino como
      -- capital nuevo y alertaría por el monto completo. Restando lo que salió,
      -- una reubicación neta da cero.
      select hl.inversionista_id, sum(hl.monto_aportado) as monto
      from cartera.historico_liquidaciones_espejo hl
      join pendientes p on p.liquidacion_id = hl.liquidacion_id
      where not exists (
        select 1 from cartera.creditos_inversionistas_espejo e
        where e.credito_id = hl.credito_id
          and e.inversionista_id = hl.inversionista_id
      )
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
      (coalesce(en.monto, 0) - coalesce(sa.monto, 0))::text as compras_no_absorbidas,
      coalesce(e.creditos, 0)                as creditos_espejo,
      coalesce(h.creditos, 0)                as creditos_historico,
      coalesce(en.detalle, '[]'::jsonb)      as compras_detalle,
      -- Ya se avisó de esta liquidación: se sigue verificando (por si cuadra y
      -- se cierra) pero no se vuelve a mandar correo.
      (v.notificado_at is not null)          as ya_notificada
    from pendientes p
    join cartera.inversionistas i on i.inversionista_id = p.inversionista_id
    left join espejo  e on e.inversionista_id = p.inversionista_id
    left join hist    h on h.liquidacion_id   = p.liquidacion_id
    left join entraron en on en.inversionista_id = p.inversionista_id
    left join salieron sa on sa.inversionista_id = p.inversionista_id
    left join cartera.verificacion_liquidacion v on v.liquidacion_id = p.liquidacion_id
    order by p.inversionista_id
  `);

  return (resultado as unknown as { rows: FilaCuadre[] }).rows ?? [];
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
