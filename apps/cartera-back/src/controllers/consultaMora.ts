import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "../database";
import {
  convenios_pago,
  creditos,
  moras_credito,
  moras_historial,
} from "../database/db/schema";
import {
  construirHistorialMora,
  construirRespuesta,
  cotaDelPresupuesto,
  fusionarCreditosPorId,
  respuestaClienteNoEncontrado,
  respuestaServicioNoDisponible,
  siguientePasoConsulta,
  unirNumerosCredito,
  usuariosParaExpandir,
  type CreditoConsultaMora,
  type FilaCreditoMora,
  type RespuestaConsultaMora,
} from "./consultaMoraPolicy";

/**
 * ⏱️ Presupuesto GLOBAL de la consulta: desde que entra la request hasta que
 * hay veredicto. Es el único tope que le importa al asesor parado frente a la
 * pantalla.
 *
 * 🔴 Antes no existía: cada paso traía su propio tope y los topes eran
 * ADITIVOS. Los pasos caros de entonces —identificación, espejo y API de CADA
 * ficha contra la pasarela de SIFCO— ya no existen (ver `consultarMoraPorDpi`),
 * pero el presupuesto global sí sigue: las lecturas de cartera también se
 * cuelgan, y el asesor sigue esperando.
 *
 * 15s porque el gate corre mientras el asesor espera: más allá de eso el CRM
 * ya no está mostrando una validación, está mostrando una pantalla colgada. Al
 * vencer se corta fail-closed con SERVICIO_NO_DISPONIBLE: media lista de
 * créditos no alcanza para firmar un "sin mora".
 */
const PRESUPUESTO_NUMEROS_GATE_MS = 15000;

/**
 * Lo que este endpoint necesita de la base de cartera, y nada más.
 *
 * Existe para que las pruebas puedan ejercitar el VEREDICTO —que es lo que el
 * CRM consume— con una base falsa, sin `mock.module("../database")`: ese mock
 * es GLOBAL en bun test y se lo comen también los demás archivos de la suite.
 * En producción siempre es `db`; ver `consultarMoraPorDpi`.
 */
export type BaseDeCartera = Pick<typeof db, "transaction">;

/** Costuras internas del endpoint. Solo las pruebas pasan algo acá. */
export interface DependenciasConsultaMora {
  baseDeCartera?: BaseDeCartera;
  /** Ver `PRESUPUESTO_NUMEROS_GATE_MS`. Se baja en pruebas para no esperar 15s. */
  presupuestoMs?: number;
}

/**
 * Cuánto le toca a un paso, o el corte si el presupuesto global ya venció.
 * Ver `cotaDelPresupuesto`; el throw sale por el catch como
 * SERVICIO_NO_DISPONIBLE.
 */
function cotaODesistir(
  cotaDelPasoMs: number,
  venceEnMs: number,
  paso: string
): number {
  const ms = cotaDelPresupuesto(cotaDelPasoMs, venceEnMs, Date.now());

  if (ms === null) {
    throw new Error(
      `El presupuesto de la consulta de mora venció antes de ${paso}`
    );
  }

  return ms;
}

/**
 * La misma cota, aplicada al trabajo que arranca acá adentro.
 *
 * 🔴 Recibe una FÁBRICA, no una promesa ya en vuelo, y el orden importa: la
 * cota se calcula ANTES de crear nada. Con una promesa como argumento, el
 * llamador la construía primero —`conRelojDePostgres(...)` abre la transacción
 * y puede rechazar— y recién después entraba acá `cotaODesistir`, que con el
 * presupuesto ya vencido lanza ANTES de que `Promise.race` le enganche un
 * manejador: la promesa del argumento quedaba rechazada y huérfana
 * (`unhandledRejection`, que según cómo esté configurado el runtime tumba el
 * proceso, no solo la petición). Con la fábrica, si el presupuesto ya venció
 * `cotaODesistir` lanza y la promesa nunca llega a existir; y si llega a
 * existir, la carrera ya la está observando.
 *
 * El pool de la base de cartera se configura sin timeout propio
 * (`database/index.ts`): una query colgada dejaba la request pendiente para
 * siempre. El throw sale por el catch como SERVICIO_NO_DISPONIBLE, fail-closed.
 */
async function bajoPlazo<T>(
  arrancar: () => Promise<T>,
  presupuestoMs: number,
  venceEnMs: number,
  paso: string
): Promise<T> {
  const ms = cotaODesistir(presupuestoMs, venceEnMs, paso);
  const promesa = arrancar();
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const corte = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => {
      rechazar(
        new Error(
          `El presupuesto de ${presupuestoMs}ms de la consulta de mora vencio durante ${paso}`
        )
      );
    }, ms);
  });
  try {
    return await Promise.race([promesa, corte]);
  } finally {
    clearTimeout(temporizador);
  }
}


/** Lo que las lecturas de cartera necesitan del ejecutor (db o transacción). */
type EjecutorCartera = Pick<typeof db, "select">;

/**
 * El reloj del lado de POSTGRES, no solo del nuestro. `bajoPlazo` suelta la
 * espera, pero la query perdedora seguía corriendo en el servidor: el pool no
 * tiene `statement_timeout`, así que consultas vencidas repetidas podían
 * quedarse con todas las conexiones y frenar endpoints ajenos. `SET LOCAL`
 * dentro de una transacción propia hace que Postgres CANCELE la query al
 * vencerse, y muere con la transacción: el pool compartido —que usan cierres y
 * migraciones legítimamente lentos— no se toca.
 */
async function conRelojDePostgres<T>(
  baseDeCartera: BaseDeCartera,
  presupuestoMs: number,
  venceEnMs: number,
  paso: string,
  correr: (ejecutor: EjecutorCartera) => Promise<T>
): Promise<T> {
  const ms = cotaODesistir(presupuestoMs, venceEnMs, paso);
  return baseDeCartera.transaction(async (tx) => {
    await tx.execute(relojDe(ms));
    return correr(tx);
  });
}

/**
 * El `SET LOCAL` que hace cancelable la query desde el servidor. Va dentro de
 * una transacción a propósito: así el ajuste muere con ella y no ensucia la
 * conexión que vuelve al pool compartido.
 */
function relojDe(ms: number): SQL {
  return sql.raw(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(ms))}`);
}

/**
 * Responde si el dueño de un DPI ya es cliente y si está en mora, para el gate
 * del CRM antes de dejar avanzar una solicitud.
 *
 * 🔴 **Los números de crédito los pone QUIEN PREGUNTA. Cartera ya no le
 * pregunta a SIFCO por este DPI.** La pasarela de SIFCO
 * (`services/sifcoIntegrations.ts`, `http://localhost:9500`) NUNCA se desplegó
 * en producción y no se va a desplegar: mientras este endpoint la consultaba
 * como primer paso, TODA consulta terminaba en el catch y salía
 * SERVICIO_NO_DISPONIBLE. Fail-closed sobre un servicio inexistente no es un
 * gate, es un portón cerrado con llave: rebotaba a morosos y a clientes nuevos
 * por igual, y obligó al CRM a dejar pasar ese motivo (hotfix #1756).
 *
 * El CRM sí sabe de quién es el DPI: lo resuelve con su propia base
 * (`leads.dpi` ↔ `opportunities.numeroSifco`) y manda el resultado en
 * `numerosCreditoConocidos`. Cartera no puede hacer ese join —`cartera.usuarios`
 * no guarda DPI—, así que la lista que llega es la ÚNICA fuente posible acá.
 *
 * - Con números: se buscan esos créditos en cartera y se arma el veredicto
 *   igual que siempre. La mora, el convenio y el insoluto siguen bloqueando;
 *   ver `construirVeredicto` y `usuariosParaExpandir`.
 * - Sin números: `CLIENTE_NO_ENCONTRADO` con `puedeContinuar: true`. Es la
 *   misma conducta que ya existía para un DPI sin ficha, y es lo único
 *   honesto: sin la lista del CRM, cartera no sabe de quién es ese DPI.
 *
 * ⚠️ Consecuencia ACEPTADA del enfoque: el cliente viejo o importado cuya
 * oportunidad no tiene `numeroSifco` en el CRM llega con la lista vacía y pasa
 * sin validar. El gate cubre lo que el CRM conoce, no la cartera entera.
 *
 * Fail-closed sigue vivo, pero solo para fallos REALES de cartera: si la base
 * no responde o se vence el presupuesto, sale SERVICIO_NO_DISPONIBLE con
 * `puedeContinuar: false`. Nunca se devuelve un "sin mora" optimista ante un
 * fallo.
 *
 * 🔴 `numerosCreditoGarantizados` —los créditos que este DPI AFIANZÓ— también
 * los resuelve el CRM y también cuentan para "¿hay números?". Entran al
 * veredicto igual que los demás, pero NO expanden por dueño: el fiador responde
 * por lo que garantizó, no por la vida entera del titular. Ver
 * `usuariosParaExpandir`.
 *
 * `dpi` ya no se usa para resolver nada —queda en la firma porque es el sujeto
 * de la consulta y el contrato del endpoint no cambia—. Lo valida el router
 * (`validarDpiConsulta`) antes de llegar acá.
 */
export async function consultarMoraPorDpi(
  dpi: string,
  numerosCreditoConocidos?: string[],
  numerosCreditoGarantizados?: string[],
  dependencias: DependenciasConsultaMora = {}
): Promise<RespuestaConsultaMora> {
  void dpi;
  const consultadoEn = new Date();
  const baseDeCartera = dependencias.baseDeCartera ?? db;
  const presupuestoMs =
    dependencias.presupuestoMs ?? PRESUPUESTO_NUMEROS_GATE_MS;
  // El reloj arranca acá, no en cada paso: ver `PRESUPUESTO_NUMEROS_GATE_MS`.
  const venceEn = Date.now() + presupuestoMs;

  try {
    // Los que SÍ expanden por dueño: lo que el CRM conoce de este DPI como
    // TITULAR. Antes se unían con los que devolvía SIFCO; ya no hay SIFCO.
    const numerosExpansivos = unirNumerosCredito(numerosCreditoConocidos);
    // Los afianzados, que entran al veredicto pero no arrastran la cartera del
    // titular. Ver `usuariosParaExpandir`.
    const numerosGarantizados = unirNumerosCredito(numerosCreditoGarantizados);
    const numerosPrestamo = unirNumerosCredito(
      numerosExpansivos,
      numerosGarantizados
    );

    // `cantidadFichas: 0` no es un placeholder: cartera ya no resuelve fichas
    // del core, así que el no-encontrado depende solo de que no haya números.
    // Ver `siguientePasoConsulta`.
    const paso = siguientePasoConsulta({
      cantidadFichas: 0,
      cantidadNumeros: numerosPrestamo.length,
    });

    if (paso === "CLIENTE_NO_ENCONTRADO") {
      return respuestaClienteNoEncontrado(consultadoEn);
    }

    const creditosCliente = await bajoPlazo(
      () =>
        conRelojDePostgres(
          baseDeCartera,
          presupuestoMs,
          venceEn,
          "la lectura de creditos y moras",
          (ej) => obtenerCreditosConMora(numerosPrestamo, numerosExpansivos, ej)
        ),
      presupuestoMs,
      venceEn,
      "la lectura de creditos y moras"
    );

    // Los números que mandó el CRM no empataron con ningún crédito de cartera:
    // el DPI no le consta a nadie de este lado.
    if (!creditosCliente.length) {
      return respuestaClienteNoEncontrado(consultadoEn);
    }

    const creditosRespuesta: CreditoConsultaMora[] = creditosCliente.map((fila) => ({
      numeroCreditoSifco: fila.numeroCreditoSifco,
      estado: fila.estado,
      moraActiva:
        fila.moraMonto !== null
          ? { monto: fila.moraMonto, cuotasAtrasadas: fila.moraCuotas ?? 0 }
          : null,
    }));

    const numeroPorCreditoId = new Map(
      creditosCliente.map((fila) => [fila.credito_id, fila.numeroCreditoSifco])
    );

    return construirRespuesta({
      // Siempre `null`: el nombre y el código de cliente salían de la ficha del
      // core, y cartera ya no la consulta. Es un dato de PRESENTACIÓN —el
      // veredicto nunca dependió de él— y el hallazgo es igual de real: ver
      // `construirRespuesta`.
      cliente: null,
      creditos: creditosRespuesta,
      // Sin créditos no hay historial que leer, y abrir la transacción igual
      // solo agregaba una forma de fallar: con el pool ocupado o el
      // presupuesto agotado, un cliente que YA quedó establecido como sin
      // deuda se volvía SERVICIO_NO_DISPONIBLE por una consulta cuyo
      // resultado ya se sabe vacío.
      historialMora: numeroPorCreditoId.size
        ? await bajoPlazo(
            () =>
              conRelojDePostgres(
                baseDeCartera,
                presupuestoMs,
                venceEn,
                "la lectura del historial de mora",
                (ej) => obtenerHistorialMora(numeroPorCreditoId, ej)
              ),
            presupuestoMs,
            venceEn,
            "la lectura del historial de mora"
          )
        : [],
      consultadoEn,
    });
  } catch (error) {
    console.error("❌ consultarMoraPorDpi falló:", error);
    return respuestaServicioNoDisponible(consultadoEn);
  }
}

/**
 * El SELECT de créditos + mora viva, compartido por las dos pasadas.
 *
 * El ejecutor es OBLIGATORIO, sin `= db` por defecto: la única forma legítima
 * de leer acá es dentro de la transacción con `statement_timeout` de
 * `conRelojDePostgres`. Con un default, olvidarse de pasarlo compilaba y se
 * salía del reloj en silencio; sin él, no compila.
 */
function selectCreditosConMora(ejecutor: EjecutorCartera) {
  return ejecutor
    .select({
      credito_id: creditos.credito_id,
      usuario_id: creditos.usuario_id,
      numeroCreditoSifco: creditos.numero_credito_sifco,
      estado: creditos.statusCredit,
      moraMonto: moras_credito.monto_mora,
      moraCuotas: moras_credito.cuotas_atrasadas,
    })
    .from(creditos)
    .leftJoin(
      moras_credito,
      and(
        eq(moras_credito.credito_id, creditos.credito_id),
        eq(moras_credito.activa, true)
      )
    );
}

/**
 * Dos pasadas: por número y después por dueño. Ver `fusionarCreditosPorId` para
 * por qué la segunda existe y por qué no reemplaza a la primera.
 *
 * 🔴 La segunda pasada es lo que sostiene el gate ahora que SIFCO no aporta
 * nada: con UN solo número del CRM que empate, la expansión por `usuario_id`
 * alcanza a TODOS los créditos de ese dueño —los `insoluto-N`, los
 * `CRM-<uuid>` y los que el CRM no tenía anotados—, así que la lista corta del
 * CRM no se traduce en un veredicto corto.
 *
 * `numerosExpansivos` es un SUBCONJUNTO de `numerosPrestamo`: los números que
 * este DPI tiene como titular. Los que no están ahí —los afianzados— se miran
 * uno por uno y no arrastran la cartera de su dueño. Ver
 * `usuariosParaExpandir`.
 */
async function obtenerCreditosConMora(
  numerosPrestamo: string[],
  numerosExpansivos: string[],
  ejecutor: EjecutorCartera
): Promise<FilaCreditoMora[]> {
  const porNumero = await selectCreditosConMora(ejecutor).where(
    inArray(creditos.numero_credito_sifco, numerosPrestamo)
  );

  const usuarioIds = usuariosParaExpandir(porNumero, numerosExpansivos);

  if (!usuarioIds.length) {
    return porNumero;
  }

  const porUsuario = await selectCreditosConMora(ejecutor).where(
    inArray(creditos.usuario_id, usuarioIds)
  );

  return fusionarCreditosPorId(porNumero, porUsuario);
}

async function obtenerHistorialMora(
  numeroPorCreditoId: Map<number, string>,
  ejecutor: EjecutorCartera
): Promise<ReturnType<typeof construirHistorialMora>> {
  const creditoIds = [...numeroPorCreditoId.keys()];

  if (!creditoIds.length) {
    return construirHistorialMora({ eventos: [], morasCerradas: [], convenios: [] });
  }

  const numeroDe = (creditoId: number) => numeroPorCreditoId.get(creditoId) ?? "";

  const [eventos, morasCerradas, convenios] = await Promise.all([
    ejecutor
      .select({
        credito_id: moras_historial.credito_id,
        fecha: moras_historial.fecha,
        monto_nuevo: moras_historial.monto_nuevo,
        tipo_evento: moras_historial.tipo_evento,
        // Para el monto de las moras cerradas: ver `montoDeMorasCerradas`. Sin
        // consulta extra —los eventos de esos créditos ya vienen en este
        // SELECT—, así que no hay N+1 por mora.
        mora_id: moras_historial.mora_id,
        monto_anterior: moras_historial.monto_anterior,
      })
      .from(moras_historial)
      .where(inArray(moras_historial.credito_id, creditoIds)),
    ejecutor
      .select({
        credito_id: moras_credito.credito_id,
        mora_id: moras_credito.mora_id,
        // Una mora cerrada no guarda fecha de cierre propia: `updated_at` es el
        // momento en que se la desactivó.
        fecha: moras_credito.updated_at,
        created_at: moras_credito.created_at,
        monto_mora: moras_credito.monto_mora,
      })
      .from(moras_credito)
      .where(
        and(
          inArray(moras_credito.credito_id, creditoIds),
          eq(moras_credito.activa, false)
        )
      ),
    ejecutor
      .select({
        credito_id: convenios_pago.credito_id,
        fecha_convenio: convenios_pago.fecha_convenio,
        monto_total_convenio: convenios_pago.monto_total_convenio,
      })
      .from(convenios_pago)
      .where(inArray(convenios_pago.credito_id, creditoIds)),
  ]);

  return construirHistorialMora({
    eventos: eventos.map((fila) => ({
      fecha: fila.fecha,
      monto_nuevo: fila.monto_nuevo,
      tipo_evento: fila.tipo_evento,
      numeroCreditoSifco: numeroDe(fila.credito_id),
      mora_id: fila.mora_id,
      monto_anterior: fila.monto_anterior,
    })),
    morasCerradas: morasCerradas
      .map((fila) => ({
        fecha: fila.fecha ?? fila.created_at,
        monto_mora: fila.monto_mora,
        numeroCreditoSifco: numeroDe(fila.credito_id),
        mora_id: fila.mora_id,
      }))
      .filter(
        (
          fila
        ): fila is {
          fecha: Date;
          monto_mora: string;
          numeroCreditoSifco: string;
          mora_id: number;
        } => fila.fecha !== null
      ),
    convenios: convenios.map((fila) => ({
      fecha_convenio: fila.fecha_convenio,
      monto_total_convenio: fila.monto_total_convenio,
      numeroCreditoSifco: numeroDe(fila.credito_id),
    })),
  });
}
