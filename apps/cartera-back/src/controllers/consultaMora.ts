import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "../database";
import {
  convenios_pago,
  creditos,
  moras_credito,
  moras_historial,
} from "../database/db/schema";
import { sifcoDb } from "../database/sifco";
import { prestamos } from "../database/sifco/schema";
import {
  buscarClientesPorIdentificacion,
  consultarPrestamosPorCliente,
} from "../services/sifcoIntegrations";
import {
  construirHistorialMora,
  construirRespuesta,
  cotaDelPresupuesto,
  fusionarCreditosPorId,
  numerosEspejoConPresupuesto,
  seleccionarFichasDelDpi,
  nombreClienteSifco,
  normalizarIdentificacion,
  respuestaClienteNoEncontrado,
  respuestaServicioNoDisponible,
  siguientePasoConsulta,
  unirNumerosCredito,
  type CreditoConsultaMora,
  type FilaCreditoMora,
  type RespuestaConsultaMora,
} from "./consultaMoraPolicy";

/**
 * ⏱️ Presupuesto GLOBAL de toda la resolución de números: identificación +
 * espejo + API de CADA ficha, desde que entra la request hasta que hay lista de
 * números. Es el único tope que le importa al asesor parado frente a la
 * pantalla.
 *
 * 🔴 Antes no existía: cada paso traía su propio tope y los topes eran
 * ADITIVOS. Una sola ficha podía tardar 10s (identificación) + 5s (espejo) +
 * 10s (API) = 25s, y cada ficha extra sumaba otros 15s, así que el techo real
 * dependía de cuántas fichas tuviera el DPI. Los topes por paso siguen abajo
 * como COTAS INTERNAS —el espejo no puede comerse el presupuesto entero—, pero
 * ninguno puede pasarse de lo que queda del global.
 *
 * 15s porque el gate corre mientras el asesor espera: más allá de eso el CRM
 * ya no está mostrando una validación, está mostrando una pantalla colgada. Al
 * vencer se corta fail-closed con SERVICIO_NO_DISPONIBLE: media lista de
 * créditos no alcanza para firmar un "sin mora".
 */
const PRESUPUESTO_NUMEROS_GATE_MS = 15000;

/** Cota interna de la búsqueda de fichas por identificación. */
const TIMEOUT_IDENTIFICACION_GATE_MS = 10000;

/** Cota interna del camino interactivo: ver `obtenerNumerosPrestamo`. */
const TIMEOUT_PRESTAMOS_GATE_MS = 10000;

/** Cota interna del espejo: ver `numerosEspejoConPresupuesto`. */
const TIMEOUT_ESPEJO_GATE_MS = 5000;

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
      `El presupuesto de ${PRESUPUESTO_NUMEROS_GATE_MS}ms de la consulta de mora venció antes de ${paso}`
    );
  }

  return ms;
}

/**
 * La misma cota, aplicada a una promesa ya en vuelo. El pool de la base de
 * cartera se configura sin timeout propio (`database/index.ts`): una query
 * colgada dejaba la request pendiente para siempre y el presupuesto de 15s
 * solo cubria la resolucion de numeros contra SIFCO. El throw sale por el
 * catch como SERVICIO_NO_DISPONIBLE, fail-closed.
 */
async function bajoPlazo<T>(
  promesa: Promise<T>,
  venceEnMs: number,
  paso: string
): Promise<T> {
  const ms = cotaODesistir(PRESUPUESTO_NUMEROS_GATE_MS, venceEnMs, paso);
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const corte = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => {
      rechazar(
        new Error(
          `El presupuesto de ${PRESUPUESTO_NUMEROS_GATE_MS}ms de la consulta de mora vencio durante ${paso}`
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
  venceEnMs: number,
  paso: string,
  correr: (ejecutor: EjecutorCartera) => Promise<T>
): Promise<T> {
  const ms = cotaODesistir(PRESUPUESTO_NUMEROS_GATE_MS, venceEnMs, paso);
  return db.transaction(async (tx) => {
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
 * Fail-closed: cualquier fallo de SIFCO o de la base sale como
 * SERVICIO_NO_DISPONIBLE con `puedeContinuar: false`. Nunca se devuelve un
 * "sin mora" optimista ante un fallo.
 *
 * `numerosCreditoConocidos` los aporta quien pregunta (ver
 * `unirNumerosCredito`): son créditos que existen en `creditos` pero que SIFCO
 * no sabe asociar a este DPI.
 */
export async function consultarMoraPorDpi(
  dpi: string,
  numerosCreditoConocidos?: string[]
): Promise<RespuestaConsultaMora> {
  const consultadoEn = new Date();
  // El reloj arranca acá, no en cada paso: ver `PRESUPUESTO_NUMEROS_GATE_MS`.
  const venceEn = Date.now() + PRESUPUESTO_NUMEROS_GATE_MS;

  try {
    // Normalizado a dígitos, no solo trim: los DPI viajan con espacios y
    // guiones internos, y el core busca por igualdad. Un DPI formateado de un
    // moroso volvía como "sin ficha" → CLIENTE_NO_ENCONTRADO → pasaba.
    // Normalizar solo las fichas de la respuesta no rescata una búsqueda que
    // ya volvió vacía.
    const dpiLimpio = normalizarIdentificacion(dpi);
    const clientes = await buscarClientesPorIdentificacion(
      dpiLimpio,
      cotaODesistir(
        TIMEOUT_IDENTIFICACION_GATE_MS,
        venceEn,
        "buscar las fichas del DPI"
      )
    );

    // TODAS las fichas del DPI, no la primera: un mismo DPI puede tener varias
    // en el core (natural + jurídica, o duplicados sin unificar) y los créditos
    // cuelgan de la ficha. Con la primera, un moroso con dos fichas pasaba
    // limpio si la primera estaba al día. Ver `seleccionarFichasDelDpi`.
    const { fichas, indeterminado } = seleccionarFichasDelDpi(
      clientes,
      dpiLimpio
    );

    // El DPI tenía fichas y alguna quedó inconsultable: no se le pueden pedir
    // los créditos, así que no sabemos si debe. Una ficha basura no es "no
    // cliente", es "no pude verificar", y sin este throw el descarte silencioso
    // se veía idéntico a un DPI inexistente —CLIENTE_NO_ENCONTRADO y a seguir—.
    // El throw baja al catch y sale SERVICIO_NO_DISPONIBLE, fail-closed.
    if (indeterminado) {
      throw new Error(
        `SIFCO devolvió fichas del DPI con CodigoCliente inconsultable (${fichas.length} de ${clientes.length} consultables)`
      );
    }
    const codigosCliente = fichas.map((ficha) => String(ficha.CodigoCliente));

    // Secuencial y no en paralelo: son pocas fichas (casi siempre una) y el
    // core aguanta mal las ráfagas. Si una falla, el throw sube y el veredicto
    // sale SERVICIO_NO_DISPONIBLE — fail-closed: una ficha no consultada no
    // puede leerse como una ficha sin mora.
    const numerosSifco: string[] = [];
    for (const codigo of codigosCliente) {
      numerosSifco.push(...(await obtenerNumerosPrestamo(codigo, venceEn)));
    }

    const numerosPrestamo = unirNumerosCredito(
      numerosSifco,
      numerosCreditoConocidos
    );

    // Ver `siguientePasoConsulta`: sin números pero CON ficha el cliente existe
    // y está al día; el no-encontrado exige que no haya ni ficha ni números.
    const paso = siguientePasoConsulta({
      cantidadFichas: fichas.length,
      cantidadNumeros: numerosPrestamo.length,
    });

    if (paso === "CLIENTE_NO_ENCONTRADO") {
      return respuestaClienteNoEncontrado(consultadoEn);
    }

    // Sin números no se consulta la base: un `inArray` vacío no tiene nada que
    // buscar y el cliente sale como lo que es, conocido y sin créditos.
    const creditosCliente =
      paso === "BUSCAR_CREDITOS"
        ? await bajoPlazo(
            conRelojDePostgres(venceEn, "la lectura de creditos y moras", (ej) =>
              obtenerCreditosConMora(numerosPrestamo, ej)
            ),
            venceEn,
            "la lectura de creditos y moras"
          )
        : [];

    // Ni ficha ni crédito: el DPI no le consta a nadie.
    if (!fichas.length && !creditosCliente.length) {
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
      // El cliente que viaja en la respuesta es la primera ficha: es un dato de
      // presentación. El veredicto se arma sobre los créditos de todas. Va
      // `null` cuando el crédito se encontró por los números aportados y el
      // core no tiene ficha — el hallazgo es igual de real.
      cliente: fichas.length
        ? {
            codigoClienteSifco: codigosCliente[0],
            nombre: nombreClienteSifco(fichas[0]),
          }
        : null,
      creditos: creditosRespuesta,
      // Sin créditos no hay historial que leer, y abrir la transacción igual
      // solo agregaba una forma de fallar: con el pool ocupado o el
      // presupuesto agotado, un cliente que YA quedó establecido como sin
      // deuda se volvía SERVICIO_NO_DISPONIBLE por una consulta cuyo
      // resultado ya se sabe vacío.
      historialMora: numeroPorCreditoId.size
        ? await bajoPlazo(
            conRelojDePostgres(venceEn, "la lectura del historial de mora", (ej) =>
              obtenerHistorialMora(numeroPorCreditoId, ej)
            ),
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
 */
async function obtenerCreditosConMora(
  numerosPrestamo: string[],
  ejecutor: EjecutorCartera
): Promise<FilaCreditoMora[]> {
  const porNumero = await selectCreditosConMora(ejecutor).where(
    inArray(creditos.numero_credito_sifco, numerosPrestamo)
  );

  const usuarioIds = [
    ...new Set(
      porNumero
        .map((fila) => fila.usuario_id)
        .filter((id): id is number => id !== null)
    ),
  ];

  if (!usuarioIds.length) {
    return porNumero;
  }

  const porUsuario = await selectCreditosConMora(ejecutor).where(
    inArray(creditos.usuario_id, usuarioIds)
  );

  return fusionarCreditosPorId(porNumero, porUsuario);
}

/**
 * Números de préstamo del cliente: la UNIÓN del espejo y del API, nunca uno u
 * otro.
 *
 * 🔴 El schema `sifco.` NO vive en la base de cartera: `database/sifco/index.ts`
 * abre su propio Pool contra `SIFCO_DB_URL`. Cruzar `sifco.prestamos` con
 * `cartera.creditos` en un solo SELECT es imposible; el cruce se hace en JS,
 * con los `pre_numero` de acá y un `inArray` sobre la conexión de cartera.
 *
 * 🔴 El espejo NO corta la consulta al API aunque devuelva filas. Antes sí: si
 * el espejo traía algo, se devolvía eso y el API ni se tocaba. Un espejo
 * PARCIALMENTE atrasado —tiene los préstamos viejos, le falta el que acaba de
 * caer en mora— pasaba entonces la validación como `SIN_MORA`, que es
 * exactamente el falso negativo que este endpoint existe para evitar; y es peor
 * que el espejo vacío, porque ahí sí había fallback. Un espejo incompleto no se
 * distingue de uno completo mirándolo, así que se preguntan los dos y se unen.
 *
 * Además `sifcoDb` puede ser `null` (variable sin configurar: el módulo solo
 * avisa por consola), y por eso el API es el camino principal en cualquier
 * entorno sin esa variable.
 *
 * ⚠️ Si el API lanza, el throw sube y el llamador responde
 * SERVICIO_NO_DISPONIBLE aunque el espejo hubiera traído filas. Es a propósito:
 * media lista no alcanza para decir "sin mora" —el crédito que falta puede ser
 * justo el moroso—, y fail-closed es la regla de todo el endpoint.
 *
 * ⚠️ El espejo es el caso OPUESTO y por eso no es fail-closed: si vence o falla,
 * se sigue con solo el API. Ver `numerosEspejoConPresupuesto`.
 */
async function obtenerNumerosPrestamo(
  codigoClienteSifco: string,
  venceEn: number
): Promise<string[]> {
  // El espejo va con cota propia y corta: es una base aparte (`SIFCO_DB_URL`)
  // que antes podía colgar la request entera sin llegar nunca ni al API ni al
  // catch. 5s y no los 10s del API porque el espejo es el atajo: si no contesta
  // rápido, dejó de ser atajo. Nunca más de lo que quede del presupuesto global
  // —con varias fichas, la segunda ya no tiene 5s propios que gastar—.
  const filasEspejo = sifcoDb
    ? await numerosEspejoConPresupuesto(
        (cotaMs) =>
          // Con reloj también del lado de Postgres: la carrera de 5s soltaba
          // la espera pero la query seguía viva en el servidor, y este pool
          // (`SIFCO_DB_URL`) tampoco tiene statement_timeout propio — las
          // consultas abandonadas se acumulaban reteniendo conexiones aunque
          // el API en vivo respondiera.
          sifcoDb!.transaction(async (tx) => {
            await tx.execute(relojDe(cotaMs));
            const filas = await tx
              .select({ pre_numero: prestamos.pre_numero })
              .from(prestamos)
              .where(eq(prestamos.pre_cli_cod, codigoClienteSifco));
            return filas.map((fila) => fila.pre_numero ?? "");
          }),
        cotaODesistir(
          TIMEOUT_ESPEJO_GATE_MS,
          venceEn,
          `consultar el espejo del cliente ${codigoClienteSifco}`
        ),
        (detalle) =>
          console.warn(
            `⚠️ espejo de SIFCO no utilizable para el cliente ${codigoClienteSifco}; se sigue solo con el API:`,
            detalle
          )
      )
    : [];

  // 10s y no los 30s del cliente: acá hay un asesor esperando en pantalla. Los
  // 30s son el techo de los caminos por lote (sync, migración), donde una
  // respuesta lenta sigue siendo útil; en el gate una respuesta a los 25s ya no
  // le sirve a nadie. Al vencerse, el throw sube y sale SERVICIO_NO_DISPONIBLE.
  // Igual que el espejo, nunca más de lo que quede del presupuesto global.
  const respuesta = await consultarPrestamosPorCliente(
    Number(codigoClienteSifco),
    cotaODesistir(
      TIMEOUT_PRESTAMOS_GATE_MS,
      venceEn,
      `consultar los préstamos del cliente ${codigoClienteSifco}`
    )
  );

  // La misma unión que usa el llamador para los números del CRM: deduplica y
  // descarta vacíos.
  return unirNumerosCredito(
    filasEspejo,
    (respuesta?.Prestamos ?? []).map((prestamo) => prestamo.NumeroPrestamo ?? "")
  );
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
