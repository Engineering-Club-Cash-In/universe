import { and, count, desc, eq, gte, ilike, inArray, notInArray, sql, sum } from "drizzle-orm";
import { client, db } from "../database";
import { asesores, creditos, cuotas_credito, moras_condonaciones, moras_credito, moras_historial, platform_users, usuarios } from "../database/db/schema";
import Big from "big.js";
import { toZonedTime } from "date-fns-tz";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { buildReporteCashInWorkbook } from "../utils/functions/excelCashInReport";
import { inicioDiaGTComoTimestampUTC } from "../utils/functions/diaGuatemala";
import { clampPagination, contienePatron } from "../utils/functions/pagination";
import { stat } from "fs";
import { emitCreditLateFee } from "../utils/structuredLogger";
import type { PoolClient } from "pg";

function safeNow(): number {
  try {
    return Date.now();
  } catch {
    return 0;
  }
}

function elapsedMilliseconds(startedAt: number): number {
  try {
    return Math.min(86_400_000, Math.max(0, Date.now() - startedAt));
  } catch {
    return 0;
  }
}

type MoraEventoTipo =
  | "CREACION"
  | "RECALCULO"
  | "INCREMENTO"
  | "DECREMENTO"
  | "CONDONACION"
  | "DESACTIVACION";

type MoraEventoOrigen =
  | "PROCESO_AUTO"
  | "API_MANUAL"
  | "CONDONACION_INDIVIDUAL"
  | "CONDONACION_MASIVA";

export const STATUS_EXCLUIDOS_MORA = ["EN_CONVENIO", "INCOBRABLE", "CANCELADO", "PENDIENTE_CANCELACION", "CAIDO"];

/**
 * La MISMA lista, tipada como la columna, para poder usarla dentro de una
 * condición SQL (`notInArray`). Se declara acá al lado y no se duplica: si
 * alguien agrega un estado arriba, la condición de los UPDATE lo hereda sola.
 */
/**
 * 🔒🔒 ORDEN DE CANDADOS DEL MÓDULO DE MORA — REGLA, NO ESTILO 🔒🔒
 *
 *      Dentro de UNA MISMA TRANSACCIÓN, primero se toma la fila de
 *      `creditos` y DESPUÉS la de `moras_credito`. NUNCA al revés.
 *
 * Por qué: las dos filas se tocan juntas en casi todos los caminos del módulo
 * (convenio, cron, limpieza al validar un pago, /mora/update, condonación). Si
 * una transacción toma `creditos` → `moras_credito` y otra toma
 * `moras_credito` → `creditos`, cada una queda esperando el candado que tiene
 * la otra: eso es un ciclo de deadlock y Postgres lo corta matando una con
 * 40P01. Nadie maneja el 40P01 acá, así que el precio es o un convenio que
 * falla, o —peor— la corrida nocturna entera de `procesarMoras` abortada antes
 * de procesar el resto de los créditos.
 *
 * El orden elegido es el que ya usaban el convenio (`createPaymentAgreement`
 * marca EN_CONVENIO y recién después llama a `desactivarMoraPorConvenio`) y la
 * rama CREACION del cron; el resto se alineó a ellos.
 *
 * Cómo se respeta en la práctica:
 *  - si la transacción ESCRIBE `creditos`, ese UPDATE va primero y de paso
 *    toma el candado (no hace falta un SELECT … FOR UPDATE aparte);
 *  - si el UPDATE de `creditos` no puede ir primero porque depende de leer la
 *    mora (condonación, /mora/update), se toma el candado con un
 *    `SELECT … FOR UPDATE` sobre `creditos` al abrir la transacción;
 *  - un UPDATE condicional de `creditos` que no matchea filas no deja candado,
 *    pero tampoco rompe la regla: lo prohibido es PEDIR `creditos` DESPUÉS de
 *    tener `moras_credito`, y en ese camino ya no se vuelve a pedir.
 *
 * Fuera de la regla quedan los caminos NO transaccionales (`createMora`,
 * `condonarTodasLasMoras`): cada statement autocommitea y suelta su candado
 * antes del siguiente, así que no pueden sostener un ciclo. Si alguien los
 * envuelve en una transacción, pasan a deberle el orden a esta regla.
 *
 * Los tests de `moraOrdenDeCandados.test.ts` fallan si alguna de estas
 * transacciones vuelve a pedir `moras_credito` antes que `creditos`.
 */

/**
 * Señal interna para abortar la transacción de un crédito que dejó de ser
 * elegible para mora a media corrida. No es un error del cron: se usa para
 * forzar el ROLLBACK (la única forma de deshacer un write ya hecho dentro de
 * la transacción) y se absorbe en el `catch` de la rama que la tira.
 */
class CreditoYaNoElegible extends Error {
  constructor() {
    super("El crédito dejó de ser elegible para mora a media corrida");
    this.name = "CreditoYaNoElegible";
  }
}

/**
 * Señal interna para abortar la transacción cuando el UPDATE condicional sobre
 * `moras_credito` (`activa = true` + `.returning()`) no afecta filas: otra ruta
 * ya apagó esa mora.
 *
 * Antes alcanzaba con un `return`, porque el candado de la mora era el PRIMER
 * write de la transacción y no había nada escrito que deshacer. Al invertir el
 * orden (ver la regla de arriba) el UPDATE de `creditos` ya corrió, así que un
 * `return` COMMITEARÍA ese cambio de estado sin haber apagado la mora — por
 * ejemplo bajando a ACTIVO un crédito cuya mora la apagó un convenio, que a
 * continuación lo deja EN_CONVENIO. Tirar revierte todo y el crédito cae en el
 * balde de omitidos, exactamente como antes.
 */
class MoraYaApagada extends Error {
  constructor() {
    super("La mora ya fue apagada por otra ruta");
    this.name = "MoraYaApagada";
  }
}

const STATUS_EXCLUIDOS_MORA_SQL = STATUS_EXCLUIDOS_MORA as Array<
  (typeof creditos.$inferSelect)["statusCredit"]
>;

/**
 * Fecha de CALENDARIO (año/mes/día) de un vencimiento, como número comparable
 * — `Date.UTC(y, m, d)`, o sea la medianoche UTC de ese día.
 *
 * `cuotas_credito.fecha_vencimiento` es un `timestamp` SIN zona que guarda la
 * fecha de calendario tal cual (siempre 00:00:00); NO es un instante. `pg` la
 * entrega como un Date cuyos campos LOCALES ya son esa fecha, así que se leen
 * tal cual. Pasarla por `toZonedTime` —que sirve para instantes reales, como
 * `moras_historial.fecha`— le resta 6 h y en un proceso UTC (producción: el
 * Dockerfile arranca de oven/bun y no fija TZ) la tira al DÍA ANTERIOR: la
 * cuota cobraría mora el mismo día que vence, y el cron (TS) quedaría peleado
 * con el guard de createMora/paymentAgreement (SQL, que usa
 * `fecha_vencimiento::date` y sí acierta).
 *
 * Con los dos extremos en `Date.UTC(...)` la resta es exacta en múltiplos de
 * 86_400_000: no hay residuos que redondear.
 *
 * El `hoy` que reciben los helpers de abajo es el canónico `hoyGuatemala()`,
 * cuyos campos locales YA son la hora de pared de Guatemala: por eso también
 * se le leen tal cual y no se lo vuelve a pasar por `toZonedTime` (hacerlo lo
 * correría un día más).
 */
export function fechaCalendarioGT(valor: Date | string): number {
  if (typeof valor === "string") {
    // "2026-09-20", "2026-09-20 00:00:00", "2026-09-20T00:00:00.000Z": los
    // primeros 10 caracteres son la fecha. Nunca `new Date(str)`, que
    // reintroduce la zona del proceso.
    // Se valida la FORMA antes de parsear: `Number("")` es 0, así que un string
    // truncado como "2026-09" pasaba el chequeo de Number.isFinite (día 0) y
    // devolvía en silencio el 31-ago-2026. Exigir YYYY-MM-DD en los primeros 10
    // caracteres es lo único que distingue "fecha" de "basura"; lo que venga
    // después ("T00:00:00Z", " 00:00:00") no importa y se ignora igual que antes.
    const fecha = valor.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return NaN;
    const anio = Number(fecha.slice(0, 4));
    const mes = Number(fecha.slice(5, 7));
    const dia = Number(fecha.slice(8, 10));
    return Date.UTC(anio, mes - 1, dia);
  }
  return Date.UTC(valor.getFullYear(), valor.getMonth(), valor.getDate());
}

export type CuotaParaMora = {
  fecha_vencimiento: Date | string;
  pagado: boolean | null;
  hasPaidPayment?: boolean | null;
  statusCredit?: string | null;
};

/**
 * La mitad del criterio de mora que NO habla de fechas: la cuota está impaga,
 * no tiene un pago aplicado encima, y el crédito no está en un estado que el
 * cron excluye.
 *
 * Existe separada porque hay DOS preguntas sobre la misma cuota: "¿el cron le
 * cobra mora hoy?" (vencida) y "¿le va a cobrar dentro del horizonte que se le
 * anuncia al cliente?" (vence pronto). Si cada una repitiera los mismos tres
 * chequeos, podrían divergir y el aviso hablaría de cuotas que el cron nunca
 * va a tocar.
 */
export function esCuotaElegibleParaMora(cuota: CuotaParaMora): boolean {
  const isUnpaid = cuota.pagado === false && cuota.hasPaidPayment !== true;
  const isEligible = !STATUS_EXCLUIDOS_MORA.includes(cuota.statusCredit ?? "");

  return isUnpaid && isEligible;
}

export function isOverdueInstallmentForMora(cuota: CuotaParaMora, hoy: Date) {
  const fechaVenc = fechaCalendarioGT(cuota.fecha_vencimiento);
  const fechaHoy = fechaCalendarioGT(hoy);

  return esCuotaElegibleParaMora(cuota) && fechaVenc < fechaHoy;
}

/**
 * Las cuotas que entran en la PROYECCIÓN de la mora: las elegibles cuyo
 * vencimiento cae dentro del horizonte que se le anuncia al cliente (por
 * defecto los próximos 30 días), estén ya vencidas o no.
 *
 * Por qué incluye las que todavía no vencen: lo que se le dice al cliente es
 * cuánto va a subir su saldo mañana y de aquí a un mes. Una cuota que vence
 * HOY mañana lleva 1 día de atraso y el cron ya le cobra 1/30 — dejarla fuera
 * anuncia un ritmo MENOR al real, que es la dirección peligrosa: el cliente
 * paga lo que se le dijo y queda corto. Con los días en negativo (una cuota
 * que vence en 10 días entra con −10), `calcularMoraProporcional` las recoge
 * solas el día que les toca, porque sube a 0 todo día negativo.
 */
export function isInstallmentWithinMoraHorizon(
  cuota: CuotaParaMora,
  hoy: Date,
  horizonteDias: number = BASE_DIAS_MORA,
) {
  return (
    esCuotaElegibleParaMora(cuota) &&
    diasAtrasoMoraConSigno(cuota.fecha_vencimiento, hoy) >= -horizonteDias
  );
}

// Tasa mensual de mora (1.12%). En la fila de moras_credito el porcentaje se
// sigue guardando como "1.12" — esta es la misma tasa en forma decimal.
export const TASA_MORA_MENSUAL = "0.0112";
// Base FIJA de 30 días (no los días calendario del mes): negocio quiere que el
// cargo de una cuota sea el mismo sin importar si cayó en febrero o en julio.
export const BASE_DIAS_MORA = 30;

/**
 * Días enteros de atraso de una cuota: diferencia de fechas de CALENDARIO en
 * los dos extremos (mismo helper que isOverdueInstallmentForMora, para que
 * nunca cuente un día que el filtro de vencidas no reconoce, ni al revés).
 * Como ambos lados son `Date.UTC(y,m,d)`, la resta cae siempre en múltiplos
 * exactos de 86_400_000 y el `Math.trunc` es solo blindaje.
 */
export function diasAtrasoMora(fechaVencimiento: Date | string, hoy: Date): number {
  return Math.max(0, diasAtrasoMoraConSigno(fechaVencimiento, hoy));
}

/**
 * Los mismos días, pero CON signo: negativo cuando la cuota todavía no vence
 * (vence en 10 días → −10). Lo necesita la proyección de la mora, que desplaza
 * los días hacia adelante y necesita saber cuánto le falta a cada cuota para
 * empezar a cobrar; `diasAtrasoMora` los aplasta a 0 y ahí se pierde esa
 * distancia. Para el cron y para el monto de hoy se sigue usando la versión
 * aplastada, que es la que corresponde a `calcularMoraProporcional`.
 */
export function diasAtrasoMoraConSigno(
  fechaVencimiento: Date | string,
  hoy: Date,
): number {
  const fechaVenc = fechaCalendarioGT(fechaVencimiento);
  const fechaHoy = fechaCalendarioGT(hoy);

  return Math.trunc((fechaHoy - fechaVenc) / 86_400_000);
}

/**
 * Mora proporcional a los días de atraso: por CADA cuota vencida se cobra
 * capital × 1.12% × (días/30), con TECHO de un cargo mensual completo por cuota.
 *
 * El techo es lo que evita que la cartera vieja se dispare: antes una cuota
 * vencida hace 365 días cobraba lo mismo que una de 30 (un bloque fijo), y sin
 * el min(1,·) ahora cobraría 12 veces más. Con el techo, atrasarse 1 día cuesta
 * 1/30 del cargo y atrasarse un año cuesta exactamente 1 cargo.
 *
 * Devuelve un Big SIN redondear: el .toFixed(2) va solo al final, para que
 * redondear los factores intermedios no corra el total centavo a centavo.
 */
export function calcularMoraProporcional(params: {
  capital: Big | string | number;
  diasAtrasadosPorCuota: number[];
}): Big {
  const capital = new Big(params.capital || 0);
  if (capital.lte(0) || params.diasAtrasadosPorCuota.length === 0) return new Big(0);

  const cargoMensual = capital.times(TASA_MORA_MENSUAL);

  return params.diasAtrasadosPorCuota.reduce((acc, diasRaw) => {
    const dias = Math.max(0, diasRaw);
    // big.js no tiene Big.min, así que el techo se hace con una comparación.
    const factor = dias >= BASE_DIAS_MORA ? new Big(1) : new Big(dias).div(BASE_DIAS_MORA);
    return acc.plus(cargoMensual.times(factor));
  }, new Big(0));
}

/**
 * La mora que este crédito va a tener DENTRO DE `dias` días, con la fórmula
 * real: los mismos días de atraso de cada cuota, desplazados hacia adelante.
 *
 * Es la única pieza que sabe proyectar. Las dos cifras que se le anuncian al
 * cliente —el ritmo diario y su techo mensual— salen de restar dos
 * proyecciones, no de contar cuotas: contar obliga a repetir la fórmula en
 * otras palabras ("1/30 por cada cuota bajo el techo") y esa paráfrasis se
 * desincroniza sola en cuanto la fórmula tiene un borde (el techo por cuota,
 * las cuotas que aún no vencen). Restar dos corridas de la MISMA función no
 * puede desincronizarse.
 *
 * Los días desplazados que sigan negativos (una cuota que aún no vence)
 * cuentan como 0: es lo que ya hace `calcularMoraProporcional`, y es lo
 * correcto — esa cuota todavía no cobra nada, pero empieza a cobrar sola en la
 * proyección del día en que vence.
 *
 * Devuelve un Big SIN redondear, igual que `calcularMoraProporcional`.
 */
export function proyectarMoraEnDias(params: {
  capital: Big | string | number;
  diasAtrasadosPorCuota: number[];
  dias: number;
}): Big {
  return calcularMoraProporcional({
    capital: params.capital,
    diasAtrasadosPorCuota: params.diasAtrasadosPorCuota.map(
      (dias) => dias + params.dias,
    ),
  });
}

/**
 * La mora tal como el cliente la LEE: a dos decimales.
 *
 * Por qué redondear antes de restar y no al final: al cliente se le dice "hoy
 * debés Q108.27 y aumenta Q3.73 por día". Él suma esos dos números, no los
 * Big crudos. Si la resta se hiciera entre valores sin redondear, el
 * incremento anunciado no cerraría con la mora anunciada y le faltaría un
 * centavo para cubrir la cuota.
 */
function moraComoLaVeElCliente(mora: Big): Big {
  return new Big(mora.toFixed(2));
}

/**
 * Cuánto va a CRECER la mora de este crédito en la próxima corrida del cron:
 * la mora proyectada a mañana menos la de hoy, las dos ya redondeadas.
 *
 * Por qué existe: con la mora proporcional el monto adeudado ya no es el mismo
 * del día 5 al día 25 del mes — sube todos los días. Cuando al cliente se le
 * dice "debés Q4,318.20" ese número es correcto hoy y está corto pasado
 * mañana: paga lo que se le dijo, queda un residuo y la cuota no se cubre. En
 * vez de un "al día de hoy" sin más, se le dice cuánto sube por día para que
 * pueda calcular lo que debe el día que pague.
 *
 * Sale de la proyección y no de un conteo de cuotas porque el conteo se
 * equivocaba en los bordes: una cuota que VENCE HOY todavía no cobra nada,
 * pero mañana lleva 1 día y el cron le cobra 1/30 — contando solo las ya
 * vencidas, el ritmo anunciado se quedaba corto justo el día en que el cliente
 * más lo necesita. Las cuotas ya topadas por el min(1,·) aportan lo mismo en
 * las dos proyecciones y se cancelan solas, sin tener que reconocerlas.
 *
 * Devuelve un Big que YA es una diferencia de montos redondeados: el
 * `.toFixed(2)` del caller no lo mueve.
 */
export function incrementoDiarioMora(params: {
  capital: Big | string | number;
  diasAtrasadosPorCuota: number[];
}): Big {
  return crecimientoDeLaMoraEn(params, 1);
}

/**
 * El TECHO de ese crecimiento: lo MÁXIMO que la mora de este crédito puede
 * subir en un mes, contado desde hoy — la misma resta, pero contra la mora
 * proyectada a 30 días.
 *
 * Por qué existe: `incrementoDiarioMora` sola promete un ritmo que no dura
 * para siempre — "aumenta Q16.80 por cada día que pase" es cierto hoy, pero
 * cada cuota deja de crecer al llegar a su cargo mensual. Decir el techo junto
 * al ritmo —el mismo estándar de la plantilla del día de pago, "Q… por cada
 * día de atraso, hasta un máximo de Q… al mes"— evita prometer un crecimiento
 * infinito.
 *
 * Por qué 30 días es un techo de verdad: toda cuota elegible que entra en la
 * lista llega a su tope dentro de esa ventana (le faltan como mucho 30 días
 * desde que vence), así que la mora proyectada a 30 días ya no puede subir más
 * por esas cuotas.
 *
 * NO puede dar negativo: la mora proyectada crece con los días (cada cuota
 * aporta `cargoMensual × min(1, días/30)`, que es monótono), así que restarle
 * la de hoy nunca da menos que 0 — por eso no hay clamp, que sería código
 * muerto (ver el test que fija la invariante).
 */
export function incrementoMaximoMensualMora(params: {
  capital: Big | string | number;
  diasAtrasadosPorCuota: number[];
}): Big {
  return crecimientoDeLaMoraEn(params, BASE_DIAS_MORA);
}

/** Lo que la mora sube de hoy a `dias` días, entre los montos que el cliente ve. */
function crecimientoDeLaMoraEn(
  params: { capital: Big | string | number; diasAtrasadosPorCuota: number[] },
  dias: number,
): Big {
  const hoy = moraComoLaVeElCliente(proyectarMoraEnDias({ ...params, dias: 0 }));
  const futura = moraComoLaVeElCliente(proyectarMoraEnDias({ ...params, dias }));

  return futura.minus(hoy);
}

/**
 * Decisión pura de qué hacer con la mora al ROMPER un convenio de pago
 * (paymentAgreement.updateConvenioStatus con status=false).
 *
 * El orden de operaciones de esa función es: borra el convenio, pone el
 * crédito MOROSO y recrea la mora — sin rollback. Si el monto de mora redondea
 * a Q0.00, `createMora` lo rechaza ("Monto de mora debe ser mayor a 0") y el
 * crédito queda en tierra de nadie: sin convenio, sin mora y nunca MOROSO. Con
 * la mora proporcional eso pasa de verdad: un capital chico con 1 solo día de
 * atraso (capital ≲ Q13.40 → 13.40 × 1.12% × 1/30 ≈ Q0.005) redondea a 0.
 *
 * Con monto 0 no hay mora que cobrar, así que se toma el MISMO camino que "no
 * hay cuotas atrasadas": crédito ACTIVO y coherente.
 */
export function decidirMoraTrasRomperConvenio(params: {
  capital: Big | string | number | null;
  factorDias: Big | string | number;
  numCuotasAtrasadas: number;
}): { accion: "CREAR_MORA"; montoMora: number } | { accion: "ACTIVAR"; motivo: string } {
  const capital = new Big(params.capital || 0);
  const factor = new Big(params.factorDias || 0);
  const montoMora = capital.lte(0) ? new Big(0) : capital.times(TASA_MORA_MENSUAL).times(factor);
  const montoRedondeado = Number(montoMora.toFixed(2));

  if (params.numCuotasAtrasadas <= 0) {
    return { accion: "ACTIVAR", motivo: "sin cuotas atrasadas" };
  }
  if (!(montoRedondeado > 0)) {
    return {
      accion: "ACTIVAR",
      motivo: `mora proporcional de ${params.numCuotasAtrasadas} cuota(s) redondea a Q0.00 (capital Q${capital.toFixed(2)} × 1.12% × factor ${factor.toFixed(4)})`,
    };
  }
  return { accion: "CREAR_MORA", montoMora: montoRedondeado };
}

export const MOTIVO_MORA_SIN_CAPITAL = "Crédito sin capital — no aplica mora";
export const MOTIVO_MORA_MENOR_A_UN_CENTAVO = "Mora proporcional menor a un centavo";

/**
 * Decisión pura del paso 5 del cron (`procesarMoras`) para UN crédito con
 * cuotas vencidas: ¿hay mora que cobrar, o hay que apagar la que tuviera?
 *
 * Dos casos caen en "no hay mora que cobrar":
 *  - capital ≤ 0 (el caso viejo: sin capital no hay base sobre la cual cobrar);
 *  - la mora proporcional redondea a Q0.00 (capital positivo pero chico + pocos
 *    días de atraso, p. ej. Q10 con 1 día → 10 × 1.12% × 1/30 ≈ Q0.0037).
 *
 * El segundo caso NO se puede insertar: `createMora` rechaza explícitamente los
 * montos ≤ 0 ("Monto de mora debe ser mayor a 0"), y
 * `decidirMoraTrasRomperConvenio` ya decide dejar ACTIVO ese mismo crédito — si
 * el cron lo marcara MOROSO con una mora de Q0.00 el crédito se mecería entre
 * MOROSO y ACTIVO noche tras noche, y el cliente aparecería moroso por cero.
 *
 * El monto va como string ya redondeado porque es exactamente lo que se
 * escribe en `moras_credito.monto_mora`: decidir sobre el número redondeado es
 * lo único que garantiza que nunca se guarde un "0.00" activo.
 */
export function decidirMoraDelCron(params: {
  capital: Big | string | number | null;
  diasAtrasadosPorCuota: number[];
}): { accion: "APLICAR"; montoStr: string } | { accion: "DESACTIVAR"; motivo: string } {
  let capital: Big;
  try {
    capital = new Big(params.capital || 0);
  } catch {
    capital = new Big(0);
  }

  if (capital.lte(0)) {
    return { accion: "DESACTIVAR", motivo: MOTIVO_MORA_SIN_CAPITAL };
  }

  const montoStr = calcularMoraProporcional({
    capital,
    diasAtrasadosPorCuota: params.diasAtrasadosPorCuota,
  }).toFixed(2);

  if (!(Number(montoStr) > 0)) {
    return { accion: "DESACTIVAR", motivo: MOTIVO_MORA_MENOR_A_UN_CENTAVO };
  }

  return { accion: "APLICAR", montoStr };
}

/**
 * Techo del guard de cordura de montos de mora MANUALES: 10× la COTA SUPERIOR
 * de la mora de ese crédito, `capital × 1.12% × cuotas vencidas` (un cargo
 * mensual completo por cuota, la fórmula vieja).
 *
 * Se ancla a la cota superior y NO a la fórmula proporcional a propósito: la
 * proporcional siempre es ≤ cota superior, así que usarla como base encogía el
 * umbral hasta ~30× con 1 día de atraso (10× de 1/30 de cargo = 1/3 de cargo)
 * y rechazaba sin override una mora manual por el cargo mensual normal. El
 * guard existe para atrapar montos ABSURDOS (Q27,953.44 sobre un capital de
 * Q40k/1 cuota), no para clavar el monto exacto.
 *
 * Devuelve 0 cuando no hay base creíble (capital ≤ 0 o cero cuotas vencidas):
 * ahí cualquier monto exige override.
 */
export function maximoMoraSinOverride(
  capital: Big | string | number,
  cuotasVencidas: number,
): Big {
  const cap = new Big(capital || 0);
  if (cap.lte(0) || !(cuotasVencidas > 0)) return new Big(0);
  return cap.times(TASA_MORA_MENSUAL).times(cuotasVencidas).times(10);
}

/**
 * Inserta un evento en moras_historial. No lanza si falla — el historial
 * no debe romper la operación principal, solo loguea.
 */
async function registrarHistorialMora(params: {
  credito_id: number;
  mora_id: number | null;
  tipo_evento: MoraEventoTipo;
  origen: MoraEventoOrigen;
  monto_anterior: string | number;
  monto_nuevo: string | number;
  cuotas_atrasadas_anterior?: number;
  cuotas_atrasadas_nuevas?: number;
  capital_credito?: string | number | null;
  porcentaje_mora?: string | number | null;
  usuario_id?: number | null;
  motivo?: string | null;
  dbClient?: typeof db;
  // Dentro de una transacción el swallow es mentiroso: un insert fallido deja
  // la tx abortada y el COMMIT se vuelve rollback silencioso, pero el caller
  // seguiría creyendo que sus writes persistieron. Con esto el error se
  // propaga y la tx puede reportar el fallo de verdad.
  propagarError?: boolean;
}) {
  const startedAt = safeNow();
  try {
    await (params.dbClient ?? db).insert(moras_historial).values({
      credito_id: params.credito_id,
      mora_id: params.mora_id,
      tipo_evento: params.tipo_evento,
      origen: params.origen,
      monto_anterior: params.monto_anterior.toString(),
      monto_nuevo: params.monto_nuevo.toString(),
      cuotas_atrasadas_anterior: params.cuotas_atrasadas_anterior ?? 0,
      cuotas_atrasadas_nuevas: params.cuotas_atrasadas_nuevas ?? 0,
      capital_credito:
        params.capital_credito !== undefined && params.capital_credito !== null
          ? params.capital_credito.toString()
          : null,
      porcentaje_mora:
        params.porcentaje_mora !== undefined && params.porcentaje_mora !== null
          ? params.porcentaje_mora.toString()
          : null,
      usuario_id: params.usuario_id ?? null,
      motivo: params.motivo ?? null,
    });
  } catch (err) {
    emitCreditLateFee({ outcome: "degraded", operation: "history", durationMs: elapsedMilliseconds(startedAt), errorCode: "persistence_failed" });
    if (params.propagarError) throw err;
  }
}

/**
 * Medianoche de hoy en hora Guatemala — el "hoy" canónico del módulo de mora.
 *
 * Acá `toZonedTime` SÍ corresponde: `ahora` es un INSTANTE real y lo que se
 * quiere es su hora de pared en Guatemala. El Date que devuelve tiene esa hora
 * de pared en sus campos LOCALES, que es justo lo que leen `fechaCalendarioGT`
 * y sus dos consumidores — por eso ellos NO lo vuelven a pasar por
 * `toZonedTime` (hacerlo lo correría otro día hacia atrás).
 *
 * `ahora` es parámetro solo para poder fijarlo en pruebas.
 */
export function hoyGuatemala(ahora: Date = new Date()): Date {
  const hoy = toZonedTime(ahora, "America/Guatemala");
  hoy.setHours(0, 0, 0, 0);
  return hoy;
}

/**
 * Decisión pura de limpieza de mora al validar/aplicar un pago. Espejo del
 * paso "se puso al día" de procesarMoras: la mora se desactiva si el crédito
 * ya no tiene cuotas vencidas elegibles — o si quedó sin capital (mismo
 * override del cron: sin capital no aplica mora) — y el status solo baja
 * MOROSO→ACTIVO (nunca des-castiga INCOBRABLE/EN_CONVENIO/etc.).
 */
export function decidirLimpiezaMoraTrasAplicar(params: {
  cuotasVencidasRestantes: number;
  capitalCredito: string | number | null;
  statusCredit: string | null;
}): { desactivarMora: boolean; bajarStatusAActivo: boolean; sinCapital: boolean } {
  let sinCapital = false;
  if (params.capitalCredito !== null) {
    try {
      sinCapital = new Big(params.capitalCredito).lte(0);
    } catch {
      // Capital no numérico: no forzar la desactivación por esta vía.
      sinCapital = false;
    }
  }
  const desactivarMora = params.cuotasVencidasRestantes === 0 || sinCapital;
  return {
    desactivarMora,
    bajarStatusAActivo: desactivarMora && params.statusCredit === "MOROSO",
    sinCapital,
  };
}

/**
 * Apaga la mora activa de un crédito que quedó al día al validar un pago.
 *
 * Por qué: una boleta registrada queda `pending` hasta que contabilidad la
 * valida; si esa ventana cruza la corrida nocturna de procesarMoras, el cron
 * crea una mora (correcta bajo la regla "solo cuenta lo validado") que nadie
 * apaga al validar — quedaba viva hasta el cron siguiente y el crédito se veía
 * "0 atrasadas pero con mora y MOROSO" todo el día, forzando condonaciones
 * manuales. Esta función es el espejo acotado-a-un-crédito del paso
 * "se puso al día" del cron.
 *
 * Nunca lanza: la limpieza de mora no debe romper la aplicación del pago.
 * El UPDATE es condicional sobre `activa=true`: si el cron u otra validación
 * concurrente ya la apagó, no afecta filas y no se duplica el historial.
 */
export async function desactivarMoraSiCreditoAlDia(
  credito_id: number,
  opts: { motivo?: string; dbClient?: typeof db } = {},
): Promise<{ desactivada: boolean; error?: string }> {
  const startedAt = safeNow();
  const dbi = opts.dbClient ?? db;
  try {
    // El índice único parcial moras_credito_uq_activa garantiza a lo sumo
    // una mora activa por crédito.
    const [moraActiva] = await dbi
      .select({
        mora_id: moras_credito.mora_id,
        monto_mora: moras_credito.monto_mora,
        cuotas_atrasadas: moras_credito.cuotas_atrasadas,
        porcentaje_mora: moras_credito.porcentaje_mora,
      })
      .from(moras_credito)
      .where(
        and(
          eq(moras_credito.credito_id, credito_id),
          eq(moras_credito.activa, true),
        ),
      );

    if (!moraActiva) {
      emitCreditLateFee({ outcome: "skipped", operation: "deactivate", durationMs: elapsedMilliseconds(startedAt), reasonCode: "active_late_fee_not_found" });
      return { desactivada: false };
    }

    const [credito] = await dbi
      .select({
        statusCredit: creditos.statusCredit,
        capital: creditos.capital,
      })
      .from(creditos)
      .where(eq(creditos.credito_id, credito_id));

    const hoy = hoyGuatemala();

    // Mismo universo y criterio que procesarMoras, acotado a este crédito.
    // El EXISTS replica el del cron, incluido COALESCE(monto_aplicado,0)>0:
    // los pagos especiales (solo mora/otros/convenio) se cuelgan de la cuota
    // con pagado=true y monto_aplicado=0 sin cubrirla de verdad.
    const cuotas = await dbi
      .select({
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        pagado: cuotas_credito.pagado,
        statusCredit: creditos.statusCredit,
        hasPaidPayment: sql<boolean>`EXISTS (
          SELECT 1
          FROM cartera.pagos_credito pc
          WHERE pc.cuota_id = ${cuotas_credito.cuota_id}
            AND pc."paymentFalse" = false
            AND pc.pagado = true
            AND pc.validation_status IN ('validated', 'no_required')
            AND COALESCE(pc.monto_aplicado, 0) > 0
        )`,
      })
      .from(cuotas_credito)
      .innerJoin(creditos, eq(cuotas_credito.credito_id, creditos.credito_id))
      .where(eq(cuotas_credito.credito_id, credito_id));

    const cuotasVencidas = cuotas.filter((c) =>
      isOverdueInstallmentForMora(c, hoy),
    ).length;

    const decision = decidirLimpiezaMoraTrasAplicar({
      cuotasVencidasRestantes: cuotasVencidas,
      capitalCredito: credito?.capital ?? null,
      statusCredit: credito?.statusCredit ?? null,
    });

    if (!decision.desactivarMora) {
      emitCreditLateFee({ outcome: "skipped", operation: "deactivate", durationMs: elapsedMilliseconds(startedAt), reasonCode: "overdue_installments_remain" });
      return { desactivada: false };
    }

    // Los tres writes van JUNTOS en una transacción propia: si el status o el
    // historial fallara a media limpieza, quedaría un MOROSO sin mora activa
    // que ni el cron ni una segunda pasada corrigen (ambos parten de "hay
    // mora activa"). El update sigue condicional sobre activa=true: si el
    // cron u otra validación concurrente ya la apagó, no afecta filas, no se
    // duplica historial y no se toca el status.
    let apagada = false;
    await dbi.transaction(async (txm) => {
      // 🔒 ORDEN DE CANDADOS: `creditos` PRIMERO, `moras_credito` después (ver
      // la regla al inicio del archivo). El convenio toma el crédito y después
      // la mora; si acá lo hiciéramos al revés, las dos transacciones se
      // esperarían en cruz y Postgres mataría una con 40P01.
      if (decision.bajarStatusAActivo) {
        await txm
          .update(creditos)
          .set({ statusCredit: "ACTIVO" })
          .where(
            and(
              eq(creditos.credito_id, credito_id),
              eq(creditos.statusCredit, "MOROSO"),
            ),
          );
      }

      const apagadas = await txm
        .update(moras_credito)
        .set({
          monto_mora: "0",
          cuotas_atrasadas: 0,
          activa: false,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(moras_credito.mora_id, moraActiva.mora_id),
            eq(moras_credito.activa, true),
          ),
        )
        .returning({ mora_id: moras_credito.mora_id });

      // 🔒 El candado sigue vivo: cero filas = otra ruta la apagó primero. Pero
      // ya NO alcanza con `return`, porque el cambio de estado de arriba se
      // commitearía: se aborta la transacción para que el crédito quede como
      // estaba (ver `MoraYaApagada`).
      if (apagadas.length === 0) throw new MoraYaApagada();
      apagada = true;

      await registrarHistorialMora({
        credito_id,
        mora_id: moraActiva.mora_id,
        tipo_evento: "DESACTIVACION",
        origen: "PROCESO_AUTO",
        monto_anterior: moraActiva.monto_mora,
        monto_nuevo: "0",
        cuotas_atrasadas_anterior: moraActiva.cuotas_atrasadas,
        cuotas_atrasadas_nuevas: 0,
        porcentaje_mora: moraActiva.porcentaje_mora,
        // "sin capital" solo cuando fue el factor decisivo (quedaban
        // vencidas); si el crédito quedó al día, gana el motivo del caller.
        motivo: decision.sinCapital && cuotasVencidas > 0
          ? "Crédito sin capital — no aplica mora"
          : (opts.motivo ?? "Crédito se puso al día al validar pago"),
        dbClient: txm as unknown as typeof db,
        propagarError: true,
      });
    }).catch((e) => {
      // La carrera perdida es una omisión esperada, no un fallo: la
      // transacción ya revirtió todo. Cualquier otro error sí se propaga al
      // catch de afuera, como antes.
      if (!(e instanceof MoraYaApagada)) throw e;
      apagada = false;
    });

    if (apagada) {
      emitCreditLateFee({ outcome: "completed", operation: "deactivate", durationMs: elapsedMilliseconds(startedAt) });
    } else {
      emitCreditLateFee({ outcome: "skipped", operation: "deactivate", durationMs: elapsedMilliseconds(startedAt), reasonCode: "concurrent_run" });
    }
    return { desactivada: apagada };
  } catch (error: any) {
    emitCreditLateFee({ outcome: "failed", operation: "deactivate", durationMs: elapsedMilliseconds(startedAt), errorCode: "unknown" });
    return { desactivada: false, error: String(error?.message ?? error) };
  }
}

/**
 * Create a new mora (penalty) for a credit.
 *
 * Rules:
 * 1. A mora is always created as active by default.
 * 2. If the mora amount > 0, the credit status changes to "MOROSO".
 * 3. If the mora amount = 0, the credit remains "ACTIVO".
 */

export async function createMora({
  credito_id,
  monto_mora,
  cuotas_atrasadas,
  origen = "API_MANUAL",
  motivo,
  usuario_id,
  usuario_email,
  override = false,
}: {
  credito_id: number;
  monto_mora?: number;
  cuotas_atrasadas?: number;
  origen?: MoraEventoOrigen;
  motivo?: string;
  usuario_id?: number;
  usuario_email?: string;
  override?: boolean;
}) {
  const startedAt = safeNow();
  const requestId = `${credito_id}-${Date.now()}`;



  try {
    // 🔥 VALIDACIÓN 1: Monto debe ser mayor a 0
    if (!monto_mora || monto_mora <= 0) {
      emitCreditLateFee({ outcome: "rejected", operation: "create", durationMs: elapsedMilliseconds(startedAt), reasonCode: "invalid_late_fee_amount" });
      return {
        success: false,
        message: "[ERROR] Monto de mora debe ser mayor a 0",
      };
    }

    // 🔥 VALIDACIÓN 2: cuotas_atrasadas es obligatorio y >= 1. Una mora con monto>0 y
    // cuotas=0 no cae en ningún bucket (30/60/90/120) de Mora Histórica y rompería el
    // invariante mora_total = Σbuckets. Antes se default-eaba a 0 silenciosamente.
    if (cuotas_atrasadas === undefined || cuotas_atrasadas === null || cuotas_atrasadas < 1) {
      emitCreditLateFee({ outcome: "rejected", operation: "create", durationMs: elapsedMilliseconds(startedAt), reasonCode: "invalid_installment_count" });
      return {
        success: false,
        message: "[ERROR] cuotas_atrasadas es requerido y debe ser >= 1",
      };
    }

    // Traer el crédito una sola vez: capital (para validar + fotografiar) y status (para no des-castigar).
    const [credito] = await db
      .select({ capital: creditos.capital, statusCredit: creditos.statusCredit })
      .from(creditos)
      .where(eq(creditos.credito_id, credito_id));
    if (!credito) {
      emitCreditLateFee({ outcome: "rejected", operation: "create", durationMs: elapsedMilliseconds(startedAt), reasonCode: "credit_not_found" });
      return { success: false, message: `[ERROR] No se encontró crédito con credito_id=${credito_id}` };
    }

    const estadoExcluido = STATUS_EXCLUIDOS_MORA.includes(credito.statusCredit ?? "");
    const capitalBig = new Big(credito.capital || 0);

    // 🔥 Conteo REAL de cuotas vencidas (derivado de cuotas_credito), NO el cuotas_atrasadas
    // del request. Confiar en el valor enviado permitía inflarlo para esquivar el guard de
    // cordura: p.ej. Q27,953.44 pasaba con cuotas_atrasadas: 7 porque el umbral se volvía
    // 10× la fórmula de 7 cuotas. Misma lógica que procesarMoras (isOverdueInstallmentForMora).
    // El `factor` es la suma de min(1, días/30) de esas mismas cuotas: la mora ya
    // no es un bloque por cuota sino proporcional a los días de atraso (con techo
    // de un cargo mensual). Va en el MISMO query para no pagar un segundo viaje ni
    // arriesgar que los dos vean fotos distintas de las cuotas.
    const ovRes = await db.execute<any>(sql`
      SELECT COUNT(*)::int AS n,
             COALESCE(SUM(LEAST(1.0, GREATEST(0, ((now() AT TIME ZONE 'America/Guatemala')::date - cu.fecha_vencimiento::date))::numeric / 30.0)), 0)::numeric AS factor
      FROM cartera.cuotas_credito cu
      WHERE cu.credito_id = ${credito_id}
        AND cu.fecha_vencimiento::date < (now() AT TIME ZONE 'America/Guatemala')::date
        AND cu.pagado = false
        AND NOT EXISTS (
          SELECT 1 FROM cartera.pagos_credito pc
          WHERE pc.cuota_id = cu.cuota_id AND pc."paymentFalse" = false AND pc.pagado = true
            AND pc.validation_status IN ('validated', 'no_required')
            AND COALESCE(pc.monto_aplicado, 0) > 0)`);
    const cuotasReales = Number(ovRes.rows?.[0]?.n ?? 0);
    const factorDias = new Big(ovRes.rows?.[0]?.factor ?? 0);

    // Si el cuotas_atrasadas enviado NO coincide con las cuotas vencidas reales, exigir override
    // (el caller no puede inflar el conteo para disparar el umbral del guard).
    if (cuotas_atrasadas !== cuotasReales && !override) {
      emitCreditLateFee({ outcome: "rejected", operation: "create", durationMs: elapsedMilliseconds(startedAt), reasonCode: "overdue_count_mismatch" });
      return {
        success: false,
        message: `[ERROR] cuotas_atrasadas=${cuotas_atrasadas} no coincide con las cuotas vencidas reales (${cuotasReales}). Envía override:true + motivo si es intencional.`,
      };
    }

    // La fórmula y el guard usan SIEMPRE las cuotas reales (no el valor no confiable del request).
    // `esperado` es lo que da HOY la fórmula proporcional (capital × 1.12% × Σ min(1, días/30)):
    // sirve de referencia informativa en el mensaje, pero NO como base del umbral.
    const esperado = capitalBig.times(TASA_MORA_MENSUAL).times(factorDias);

    // 🔥 VALIDACIÓN 3: NUNCA escribir mora sobre créditos en estado excluido (EN_CONVENIO/
    // INCOBRABLE/CANCELADO/PENDIENTE_CANCELACION/CAIDO) — ni con override. Castigados/cancelados
    // no llevan mora; además el cron procesarMoras desactivaría esa mora en su corrida (la fila
    // quedaría huérfana), así que el override sobre un excluido era transitorio e inútil. Para
    // morar uno de estos hay que sacarlo del estado excluido primero (como hace el teardown de
    // convenio, que lo pone MOROSO antes de llamar a createMora).
    if (estadoExcluido) {
      emitCreditLateFee({ outcome: "rejected", operation: "create", durationMs: elapsedMilliseconds(startedAt), reasonCode: "excluded_credit_state" });
      return {
        success: false,
        message: `[ERROR] El crédito está en estado '${credito.statusCredit}' (excluido de mora): no se le puede registrar mora. Saca el crédito de ese estado primero si corresponde.`,
      };
    }

    // 🔥 VALIDACIÓN 4: guard de cordura del monto. "Absurdo" = más de 10× la COTA SUPERIOR
    // (atrapa errores tipo Q27,953.44 sobre un capital de Q40k/1 cuota).
    const montoBig = new Big(monto_mora);
    // No se compara contra el capital directo: la mora correcta de un crédito con 90+ cuotas
    // vencidas ya supera el capital y sería un falso positivo. Si la cota superior da 0
    // (capital 0 o cero cuotas vencidas), cualquier monto exige override.
    const maximoSinOverride = maximoMoraSinOverride(capitalBig, cuotasReales);
    const esAbsurdo = maximoSinOverride.gt(0) ? montoBig.gt(maximoSinOverride) : true;
    if (esAbsurdo && !override) {
      emitCreditLateFee({ outcome: "rejected", operation: "create", durationMs: elapsedMilliseconds(startedAt), reasonCode: "amount_out_of_range" });
      return {
        success: false,
        message: `[ERROR] Monto Q${monto_mora} fuera de rango: la fórmula proporcional da hoy Q${esperado.toFixed(2)} (capital Q${capitalBig.toFixed(2)} × 1.12% × factor de días ${factorDias.toFixed(4)}, sobre ${cuotasReales} cuotas vencidas reales con techo de 1 cargo mensual por cuota) y el máximo que se acepta sin override es Q${maximoSinOverride.toFixed(2)} (10× la cota superior capital × 1.12% × ${cuotasReales} cuotas). Envía override:true + motivo si es intencional.`,
      };
    }

    // Cualquier override debe justificarse (rastro de auditoría).
    if (override && (!motivo || !motivo.trim())) {
      emitCreditLateFee({ outcome: "rejected", operation: "create", durationMs: elapsedMilliseconds(startedAt), reasonCode: "override_reason_missing" });
      return { success: false, message: "[ERROR] override:true requiere 'motivo' (justificación)." };
    }

    // Identidad del que ejecuta: directo del token (usuario_id). Si el token no trae id,
    // se resuelve por email. Best-effort: la atribución no debe bloquear la operación.
    let usuarioId: number | undefined = usuario_id ?? undefined;
    if (!usuarioId && usuario_email) {
      const [u] = await db
        .select({ id: platform_users.id })
        .from(platform_users)
        .where(eq(platform_users.email, usuario_email));
      usuarioId = u?.id;
    }

    // 🔥 VERIFICAR SI YA EXISTE MORA ACTIVA (UPSERT)


    const [moraExistente] = await db
      .select({
        mora_id: moras_credito.mora_id,
        monto_mora: moras_credito.monto_mora,
        cuotas_atrasadas: moras_credito.cuotas_atrasadas,
      })
      .from(moras_credito)
      .where(
        and(
          eq(moras_credito.credito_id, credito_id),
          eq(moras_credito.activa, true)
        )
      );

    let newMora;
    let tipo_evento: MoraEventoTipo;
    let monto_anterior = "0";
    let cuotas_anteriores = 0;

    if (moraExistente) {
      // 🔄 ACTUALIZAR MORA EXISTENTE


      monto_anterior = moraExistente.monto_mora;
      cuotas_anteriores = moraExistente.cuotas_atrasadas;
      tipo_evento = "RECALCULO";

      [newMora] = await db
        .update(moras_credito)
        .set({
          monto_mora: monto_mora.toString(),
          cuotas_atrasadas,
          updated_at: new Date(),
        })
        .where(eq(moras_credito.mora_id, moraExistente.mora_id))
        .returning();


    } else {
      // 🔥 INSERTAR NUEVA MORA


      tipo_evento = "CREACION";

      [newMora] = await db
        .insert(moras_credito)
        .values({
          credito_id,
          monto_mora: monto_mora.toString(),
          cuotas_atrasadas,
          activa: true,
          porcentaje_mora: "1.12",
        })
        .returning();


    }

    // Actualizar status a MOROSO. Llegar aquí implica que el crédito NO está en estado
    // excluido (V3 ya los rechaza), así que es seguro marcarlo MOROSO.
    //
    // 🔒 Esta función NO es transaccional: cada statement autocommitea y suelta
    // su candado antes del siguiente, así que no puede sostener el ciclo que
    // previene la regla de orden del inicio del archivo (por eso el status
    // puede quedar después del write de la mora). Si alguien la envuelve en una
    // transacción, el UPDATE de `creditos` tiene que pasar ARRIBA del write de
    // `moras_credito`.

    await db
      .update(creditos)
      .set({ statusCredit: "MOROSO" })
      .where(eq(creditos.credito_id, credito_id));


    await registrarHistorialMora({
      credito_id,
      mora_id: newMora.mora_id,
      tipo_evento,
      origen,
      monto_anterior,
      monto_nuevo: monto_mora,
      cuotas_atrasadas_anterior: cuotas_anteriores,
      cuotas_atrasadas_nuevas: cuotas_atrasadas,
      capital_credito: credito.capital,
      porcentaje_mora: newMora.porcentaje_mora,
      usuario_id: usuarioId,
      motivo,
    });

    emitCreditLateFee({ outcome: "completed", operation: "create", durationMs: elapsedMilliseconds(startedAt) });

    return {
      success: true,
      mora: newMora,
      status: "MOROSO",
    };

  } catch (error) {
    emitCreditLateFee({ outcome: "failed", operation: "create", durationMs: elapsedMilliseconds(startedAt), errorCode: "unknown" });

    return {
      success: false,
      message: "[ERROR] Could not create mora",
      error: String(error),
    };
  }
}


/**
 * Update mora (penalty) for a credit using increments or decrements.
 *
 * Rules:
 * 1. If type = "INCREMENTO", add monto_cambio to the existing mora.
 * 2. If type = "DECREMENTO", subtract monto_cambio from the existing mora (never below 0).
 * 3. If final monto_mora > 0 and mora is active -> credit = MOROSO.
 * 4. If final monto_mora = 0 or mora inactive -> credit = ACTIVO.
 */
/**
 * Update mora (penalty) for a credit using increments or decrements.
 *
 * Rules:
 * 1. If type = "INCREMENTO", add monto_cambio to the existing mora.
 * 2. If type = "DECREMENTO", subtract monto_cambio from the existing mora (never below 0).
 * 3. If final monto_mora > 0 and mora is active -> credit = MOROSO.
 * 4. If final monto_mora = 0 or mora inactive -> credit = ACTIVO.
 */
export async function updateMora({
  credito_id,
  numero_credito_sifco,
  monto_cambio,
  tipo,
  cuotas_atrasadas,
  activa,
  usuario_email,
  motivo,
}: {
  credito_id?: number;
  numero_credito_sifco?: string;
  monto_cambio: number;
  tipo: "INCREMENTO" | "DECREMENTO";
  cuotas_atrasadas?: number;
  activa?: boolean;
  usuario_email?: string;
  /**
   * Justificación del ajuste; queda en moras_historial.motivo. Opcional a nivel de
   * función (los callers internos pasan uno automático), pero OBLIGATORIO en la
   * ruta POST /mora/update, la única puerta de entrada desde la interfaz.
   */
  motivo?: string;
}) {
  const startedAt = safeNow();
  try {
    if (monto_cambio < 0) {
    emitCreditLateFee({ outcome: "rejected", operation: "update", durationMs: elapsedMilliseconds(startedAt), reasonCode: "invalid_late_fee_amount" });
    return { success: false, message: "[ERROR] monto_cambio debe ser >= 0 (usa el campo 'tipo' para indicar dirección)" };
  }

  // Resolver credito_id desde numero_credito_sifco si solo vino ese
  let targetCreditoId = credito_id;
  if (!targetCreditoId && numero_credito_sifco) {
    const [credito] = await db
      .select({ credito_id: creditos.credito_id })
      .from(creditos)
      .where(eq(creditos.numero_credito_sifco, numero_credito_sifco));
    if (!credito) {
      emitCreditLateFee({ outcome: "rejected", operation: "update", durationMs: elapsedMilliseconds(startedAt), reasonCode: "credit_not_found" });
      return { success: false, message: `[ERROR] No se encontró crédito con numero_credito_sifco=${numero_credito_sifco}` };
    }
    targetCreditoId = credito.credito_id;
  }
  if (!targetCreditoId) {
    emitCreditLateFee({ outcome: "rejected", operation: "update", durationMs: elapsedMilliseconds(startedAt), reasonCode: "schema_invalid" });
    return { success: false, message: "[ERROR] credito_id o numero_credito_sifco es requerido" };
  }

  const requestId = `${targetCreditoId}-${Date.now()}`;



    // Resolver usuario que ejecuta la acción (si vino email)
    let usuarioId: number | undefined;
    if (usuario_email) {
      const [user] = await db
        .select({ id: platform_users.id })
        .from(platform_users)
        .where(eq(platform_users.email, usuario_email));
      if (!user) {
        emitCreditLateFee({ outcome: "rejected", operation: "update", durationMs: elapsedMilliseconds(startedAt), reasonCode: "user_not_found" });
        return { success: false, message: "[ERROR] Usuario no encontrado" };
      }
      usuarioId = user.id;
    }

    // Toda la operación dentro de una transacción con row lock para evitar races
    const result = await db.transaction(async (tx) => {
      // 🔒 ORDEN DE CANDADOS: `creditos` PRIMERO, `moras_credito` después (ver
      // la regla al inicio del archivo). Acá el UPDATE de `creditos` no puede
      // ir primero —el estado a escribir depende del monto que resulte de la
      // mora—, así que el candado se toma con este `SELECT … FOR UPDATE`, que
      // además es la lectura de `statusCredit` que esta transacción ya
      // necesitaba más abajo: no agrega un viaje a la base, solo lo adelanta.
      // Con el orden viejo (mora FOR UPDATE y después el UPDATE del crédito)
      // esta ruta y la del convenio se pedían los candados en cruz: ciclo de
      // deadlock y 40P01 sin manejar.
      const [creditoActual] = await tx
        .select({ statusCredit: creditos.statusCredit })
        .from(creditos)
        .where(eq(creditos.credito_id, targetCreditoId))
        .limit(1)
        .for("update");

      const shouldReactivateMora = tipo === "INCREMENTO" && activa === true;
      const moraWhere = shouldReactivateMora
        ? eq(moras_credito.credito_id, targetCreditoId)
        : and(
          eq(moras_credito.credito_id, targetCreditoId),
          eq(moras_credito.activa, true),
        );

      const [moraActual] = await tx
        .select({
          id: moras_credito.mora_id,
          monto: moras_credito.monto_mora,
          activa: moras_credito.activa,
          porcentaje_mora: moras_credito.porcentaje_mora,
          cuotas_atrasadas: moras_credito.cuotas_atrasadas,
        })
        .from(moras_credito)
        .where(moraWhere)
        .orderBy(desc(moras_credito.activa), desc(moras_credito.created_at))
        .limit(1)
        .for("update");

      if (!moraActual) {
        return { kind: "not_found" as const };
      }

      let newMonto = new Big(moraActual.monto);
      if (tipo === "INCREMENTO") {
        newMonto = newMonto.plus(monto_cambio);
      } else {
        newMonto = newMonto.minus(monto_cambio);
        if (newMonto.lt(0)) newMonto = new Big(0);
      }

      // Estado activa: si llega 0 forzamos inactiva; si quedó >0 respetamos param o estado actual
      const newActiva = newMonto.eq(0)
        ? false
        : (activa !== undefined ? activa : moraActual.activa);

      const [updated] = await tx
        .update(moras_credito)
        .set({
          monto_mora: newMonto.toString(),
          ...(cuotas_atrasadas !== undefined ? { cuotas_atrasadas } : {}),
          activa: newActiva,
          updated_at: new Date(),
        })
        .where(eq(moras_credito.mora_id, moraActual.id))
        .returning();

      // statusCredit según la lógica documentada (rules 3 y 4 de la docstring),
      // PERO nunca pisar un estado de cierre/castigo: un ajuste de mora no debe
      // "des-castigar" un crédito (p.ej. reversar un pago con mora sobre un
      // INCOBRABLE lo flipeaba a MOROSO/ACTIVO). Solo se toca el status si el
      // crédito NO está en STATUS_EXCLUIDOS_MORA.
      const newStatus = (newMonto.gt(0) && newActiva) ? "MOROSO" : "ACTIVO";

      // `creditoActual` se leyó al abrir la transacción, con FOR UPDATE: la
      // fila está candada desde entonces, así que este estado no puede haber
      // cambiado bajo nuestros pies.
      const estadoProtegido = STATUS_EXCLUIDOS_MORA.includes(
        creditoActual?.statusCredit ?? "",
      );

      if (!estadoProtegido) {
        await tx
          .update(creditos)
          .set({ statusCredit: newStatus })
          .where(eq(creditos.credito_id, targetCreditoId));
      } else {

      }

      return {
        kind: "ok" as const,
        updated,
        newStatus,
        montoAnterior: moraActual.monto,
        montoNuevo: newMonto.toString(),
        cuotasAnteriores: moraActual.cuotas_atrasadas,
      };
    });

    if (result.kind === "not_found") {
      emitCreditLateFee({ outcome: "rejected", operation: "update", durationMs: elapsedMilliseconds(startedAt), reasonCode: "active_late_fee_not_found" });
      return { success: false, message: "[ERROR] Mora activa no encontrada para este crédito" };
    }

    await registrarHistorialMora({
      credito_id: targetCreditoId,
      mora_id: result.updated.mora_id,
      tipo_evento: tipo,
      origen: "API_MANUAL",
      monto_anterior: result.montoAnterior,
      monto_nuevo: result.montoNuevo,
      cuotas_atrasadas_anterior: result.cuotasAnteriores,
      // Si el llamador NO mandó cuotas_atrasadas (los flujos de pago y de
      // reversa solo ajustan el monto), la fila conservó su valor: registrar 0
      // inventaba un "3 → 0" que el modal de Historial de mora mostraba en cada
      // pago como si las cuotas atrasadas se hubieran limpiado.
      cuotas_atrasadas_nuevas: cuotas_atrasadas ?? result.updated.cuotas_atrasadas ?? result.cuotasAnteriores,
      porcentaje_mora: result.updated.porcentaje_mora,
      usuario_id: usuarioId,
      motivo,
    });

    emitCreditLateFee({ outcome: "completed", operation: "update", durationMs: elapsedMilliseconds(startedAt) });

    return {
      success: true,
      mora: result.updated,
      newStatus: result.newStatus,
    };

  } catch (error) {
    emitCreditLateFee({ outcome: "failed", operation: "update", durationMs: elapsedMilliseconds(startedAt), errorCode: "unknown" });
    return {
      success: false,
      message: "[ERROR] Could not update mora",
      error: String(error),
    };
  }
}

/**
 * Process overdue installments and update loan penalties (moras).
 *
 * Steps:
 * 1. Get all installments (cuotas) from the database.
 * 2. Filter those overdue (not paid and past due date) using Guatemala timezone.
 * 3. Group overdue installments by credit.
 * 4. For each credit:
 *    - Calculate the new penalty (mora) = capital × percentage × overdue installments.
 *      The mora is RECALCULATED from scratch each run (idempotent): the stored value is
 *      REPLACED, never accumulated, so re-running the job does not double the amount.
 *    - If an active mora record already exists, recalculate it; if not, insert a new one.
 *    - Update the credit status to "MOROSO".
 * 5. Log every step for debugging and monitoring.
 */
/**
 * Apaga la mora activa de un crédito dentro de la corrida del cron y deja el
 * rastro en `moras_historial`. Lo usan los tres caminos del cron que llegan al
 * mismo final —sin capital, mora que redondea a Q0.00 y crédito al día—, que
 * solo se diferencian en el `motivo`.
 *
 * El UPDATE del crédito es CONDICIONAL sobre MOROSO a propósito: bajar a
 * ACTIVO sin esa condición des-castigaría un EN_CONVENIO/CAIDO/INCOBRABLE.
 *
 * El UPDATE de la mora es CONDICIONAL sobre `activa=true` y usa `.returning()`,
 * igual que `desactivarMoraPorConvenio` y `desactivarMoraSiCreditoAlDia`: el
 * cron lee las moras activas al arrancar y las apaga al final de la corrida, y
 * el advisory lock de `procesarMoras` solo lo protege de OTRA corrida del cron
 * — no de un convenio (u otra ruta) que apague la misma fila en el medio. Sin
 * el filtro, el cron la apagaría "otra vez" y escribiría un segundo evento
 * DESACTIVACION por el mismo monto, duplicando justo la cifra que sirve para
 * auditar cuánta mora se perdona. Cero filas = alguien más ya la apagó: no se
 * escribe historial, no se toca el status y se devuelve `false` para que el
 * caller no cuente una desactivación que no hizo.
 */
async function desactivarMoraDelCron(
  creditoId: number,
  moraPrevia: {
    mora_id: number;
    monto_mora: string;
    cuotas_atrasadas: number;
    porcentaje_mora: string | null;
  },
  motivo: string,
): Promise<boolean> {
  // 🧾 Los tres writes van JUNTOS en una transacción, igual que las ramas
  // CREACION y RECALCULO del cron. Sueltos y autocommiteados, un corte entre
  // el primero y el último dejaba el crédito ACTIVO con la mora todavía viva,
  // o la mora apagada sin su evento en `moras_historial`. Y la transacción es
  // además lo que hace exigible el orden de candados: sin ella cada statement
  // soltaba su candado antes del siguiente.
  return await db
    .transaction(async (tx) => {
      // 🔒 ORDEN DE CANDADOS: `creditos` PRIMERO, `moras_credito` después (ver
      // la regla al inicio del archivo). Este UPDATE es además la escritura
      // que igual había que hacer, así que toma el candado sin costo.
      //
      // Es CONDICIONAL sobre MOROSO a propósito: bajar a ACTIVO sin esa
      // condición des-castigaría un EN_CONVENIO/CAIDO/INCOBRABLE. Que no
      // matchee filas es un desenlace legítimo (el crédito no estaba MOROSO),
      // no un error: no aborta nada. Tampoco rompe la regla del orden —
      // después de acá esta transacción ya no vuelve a pedir `creditos`.
      await tx
        .update(creditos)
        .set({ statusCredit: "ACTIVO" })
        .where(
          and(
            eq(creditos.credito_id, creditoId),
            eq(creditos.statusCredit, "MOROSO")
          )
        );

      const apagadas = await tx
        .update(moras_credito)
        .set({ monto_mora: "0", cuotas_atrasadas: 0, activa: false, updated_at: new Date() })
        .where(
          and(
            eq(moras_credito.mora_id, moraPrevia.mora_id),
            // 🔒 Sin este filtro, una ruta concurrente que ya la apagó no impide
            // que el cron "gane" también y duplique el evento DESACTIVACION.
            eq(moras_credito.activa, true),
          ),
        )
        .returning({ mora_id: moras_credito.mora_id });

      // Cero filas = otra ruta la apagó primero. No hay nada que auditar: el
      // evento lo escribió ella. Se ABORTA (no `return`) porque el UPDATE de
      // `creditos` de arriba ya corrió y commitearlo bajaría a ACTIVO un
      // crédito cuya mora apagó, por ejemplo, un convenio que enseguida lo
      // deja EN_CONVENIO.
      if (apagadas.length === 0) throw new MoraYaApagada();

      await registrarHistorialMora({
        credito_id: creditoId,
        mora_id: moraPrevia.mora_id,
        tipo_evento: "DESACTIVACION",
        origen: "PROCESO_AUTO",
        monto_anterior: moraPrevia.monto_mora,
        monto_nuevo: "0",
        cuotas_atrasadas_anterior: moraPrevia.cuotas_atrasadas,
        cuotas_atrasadas_nuevas: 0,
        porcentaje_mora: moraPrevia.porcentaje_mora,
        motivo,
        dbClient: tx as unknown as typeof db,
        // Dentro de la tx el swallow es mentiroso: un historial fallido deja la
        // tx abortada y el COMMIT es un rollback silencioso, mientras el cron
        // contaría una desactivación que no quedó.
        propagarError: true,
      });

      return true;
    })
    .catch((e) => {
      // La carrera perdida es una omisión esperada, no un fallo del cron.
      if (e instanceof MoraYaApagada) return false;
      throw e;
    });
}

/**
 * Apaga la mora activa de un crédito al abrirle un convenio de pago, DEJANDO
 * RASTRO en `moras_historial`.
 *
 * Existe porque el convenio era la ÚNICA ruta del módulo que hacía desaparecer
 * un monto de mora con un DELETE duro: la fila se iba y con ella la respuesta a
 * "cuánta mora perdonamos vía convenios". La regla del módulo es que
 * `moras_credito` es el monto de HOY y `moras_historial` la auditoría, que solo
 * se inserta — así que acá se desactiva, igual que hacen el cron
 * (`desactivarMoraDelCron`) y la limpieza tras aplicar un pago.
 *
 * NO toca `creditos.statusCredit`: el caller lo deja en EN_CONVENIO justo
 * después, y bajarlo a ACTIVO acá lo des-castigaría.
 *
 * 🔒 ORDEN DE CANDADOS (ver la regla al inicio del archivo): esta función solo
 * toca `moras_credito`, pero corre DENTRO de la transacción del convenio, que
 * ya tomó la fila de `creditos` con su UPDATE a EN_CONVENIO. O sea que el orden
 * compuesto es `creditos` → `moras_credito`, el canónico del módulo. Mover el
 * UPDATE del crédito para después de esta llamada lo invertiría.
 *
 * El UPDATE es CONDICIONAL sobre `activa=true` y usa `.returning()`, igual que
 * `desactivarMoraSiCreditoAlDia`: dos solicitudes de convenio del mismo crédito
 * que se solapen leen la MISMA fila activa, y sin ese filtro las dos apagarían
 * "con éxito" y las dos insertarían un DESACTIVACION por el mismo monto —
 * duplicando justo la cifra que sirve para auditar cuánta mora perdonan los
 * convenios. Si el update no devuelve fila, otra ejecución ganó la carrera: no
 * se escribe historial y se reporta `desactivada: false`.
 *
 * La LECTURA de la mora también va adentro de la transacción, con FOR UPDATE:
 * los montos que se leen son los que se escriben al historial, así que leerlos
 * fuera del candado dejaba que /mora/update o el cron cambiaran la fila en el
 * medio y el evento auditara una cifra que ya no era la que se apagó.
 *
 * Las dos escrituras van SIEMPRE juntas y atómicas: si el caller no trae
 * `dbClient`, acá se abre una transacción propia. Con `propagarError: true` el
 * fallo del historial revierte la desactivación, en vez de dejar el convenio
 * "exitoso" con la mora fuera del saldo y sin constancia — que es exactamente
 * el defecto que este helper vino a cerrar.
 */
export async function desactivarMoraPorConvenio(
  credito_id: number,
  opts: {
    convenio_id?: number | null;
    usuario_id?: number | null;
    dbClient?: typeof db;
  } = {},
): Promise<{ desactivada: boolean; mora_id?: number; monto_anterior?: string }> {
  const apagarYRegistrar = async (
    tx: typeof db,
  ): Promise<{ desactivada: boolean; mora_id?: number; monto_anterior?: string }> => {
    // 🔒 La lectura va DENTRO de la transacción y con FOR UPDATE: los valores
    // que se leen acá son los que después se escriben al historial, y entre el
    // SELECT y el UPDATE otra ruta (/mora/update, el cron) puede recalcular la
    // fila. Sin el candado el UPDATE apagaba el monto NUEVO mientras el evento
    // DESACTIVACION anotaba el VIEJO: el rastro mentía sobre cuánta mora se
    // soltó, que es justo la cifra por la que existe este helper.
    //
    // Se eligió `SELECT … FOR UPDATE` y no un CTE con el UPDATE adentro porque
    // así todo sigue en el query builder de drizzle (una sola definición de las
    // condiciones, sin SQL crudo que repita el filtro `activa`) y porque el
    // camino ya necesitaba transacción para que la desactivación y el historial
    // confirmen juntos: el candado no agrega nada que no estuviera.
    //
    // El índice único parcial moras_credito_uq_activa garantiza a lo sumo una
    // mora activa por crédito, así que basta con la primera fila.
    const [moraActiva] = await tx
      .select({
        mora_id: moras_credito.mora_id,
        monto_mora: moras_credito.monto_mora,
        cuotas_atrasadas: moras_credito.cuotas_atrasadas,
        porcentaje_mora: moras_credito.porcentaje_mora,
      })
      .from(moras_credito)
      .where(
        and(
          eq(moras_credito.credito_id, credito_id),
          eq(moras_credito.activa, true),
        ),
      )
      .for("update");

    if (!moraActiva) return { desactivada: false };

    const apagadas = await tx
      .update(moras_credito)
      .set({ monto_mora: "0", cuotas_atrasadas: 0, activa: false, updated_at: new Date() })
      .where(
        and(
          eq(moras_credito.mora_id, moraActiva.mora_id),
          // 🔒 Sin este filtro, un convenio concurrente que ya la apagó no
          // impide que esta corrida "gane" también y duplique el evento.
          // (Con el FOR UPDATE de arriba es redundante en el camino normal;
          // se queda como respaldo duro por si la lectura se relaja.)
          eq(moras_credito.activa, true),
        ),
      )
      .returning({ mora_id: moras_credito.mora_id });

    // Cero filas = otra ejecución la apagó primero. No hay nada que auditar:
    // el evento lo escribió ella.
    if (apagadas.length === 0) return { desactivada: false };

    await registrarHistorialMora({
      credito_id,
      mora_id: moraActiva.mora_id,
      tipo_evento: "DESACTIVACION",
      origen: "API_MANUAL",
      monto_anterior: moraActiva.monto_mora,
      monto_nuevo: "0",
      cuotas_atrasadas_anterior: moraActiva.cuotas_atrasadas,
      cuotas_atrasadas_nuevas: 0,
      porcentaje_mora: moraActiva.porcentaje_mora,
      usuario_id: opts.usuario_id ?? null,
      motivo:
        opts.convenio_id != null
          ? `Mora desactivada por convenio de pago (convenio ${opts.convenio_id})`
          : "Mora desactivada por convenio de pago",
      dbClient: tx,
      // Nunca se traga: apagar la mora sin dejar el evento es el defecto original.
      propagarError: true,
    });

    return {
      desactivada: true,
      mora_id: moraActiva.mora_id,
      monto_anterior: moraActiva.monto_mora,
    };
  };

  return opts.dbClient
    ? // El caller ya corre dentro de su propia transacción: se usa la suya, y
      // el FOR UPDATE queda cubierto por ESA transacción (es la de
      // createPaymentAgreement, que así confirma convenio + mora + historial
      // juntos o no confirma nada).
      await apagarYRegistrar(opts.dbClient)
    : await db.transaction(async (txm) =>
        apagarYRegistrar(txm as unknown as typeof db),
      );
}

// Clave fija para el advisory lock de procesarMoras (cualquier int estable sirve).
const PROCESAR_MORAS_LOCK_KEY = 728193;

export async function procesarMoras() {
  const startedAt = safeNow();
  // 🔒 Lock entre instancias: con varias réplicas del back, todas agendan el cron
  // (23:59 GT) y corrían EN PARALELO leyendo el mismo estado viejo → duplicaban
  // eventos en moras_historial y, peor, filas activa=true en moras_credito.
  // Tomamos un advisory lock en una conexión dedicada; si otra corrida ya lo tiene,
  // se omite esta. (El índice único parcial moras_credito_uq_activa es el respaldo duro.)
  let lockConn: PoolClient | undefined;
  let lockHeld = false;
  try {
    lockConn = await client.connect();
    const _lk = await lockConn.query("SELECT pg_try_advisory_lock($1) AS ok", [PROCESAR_MORAS_LOCK_KEY]);
    lockHeld = _lk.rows[0]?.ok === true;
    if (!lockHeld) {
      emitCreditLateFee({ outcome: "skipped", operation: "process", durationMs: elapsedMilliseconds(startedAt), reasonCode: "concurrent_run" });
      return { skipped: true, creadas: 0, recalculadas: 0, sinCambios: 0, desactivadas: 0, sinCapital: 0, moraCero: 0 };
    }

    const hoy = hoyGuatemala();






    // 1. Get all installments WITH PROPER JOIN
    const cuotas = await db
      .select({
        cuota_id: cuotas_credito.cuota_id,
        credito_id: cuotas_credito.credito_id,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        pagado: cuotas_credito.pagado,
        statusCredit: creditos.statusCredit,
        capital: creditos.capital,
        // Una fila de pago "vouchea" la cuota solo si aplicó plata REAL a la
        // cuota (monto_aplicado > 0). Los pagos especiales de solo mora/otros/
        // convenio se insertan colgados de la primera cuota pendiente con
        // pagado=true y monto_aplicado=0 (getSpecialPaymentInstallmentFields):
        // ese `pagado` significa "fila completa", NO "cuota cubierta" — sin
        // este AND, pagar SOLO la mora sacaba la cuota del conteo al validar
        // (cuotas_atrasadas 2→1 → mora recalculada de menos y etapa incorrecta).
        hasPaidPayment: sql<boolean>`EXISTS (
          SELECT 1
          FROM cartera.pagos_credito pc
          WHERE pc.cuota_id = ${cuotas_credito.cuota_id}
            AND pc."paymentFalse" = false
            AND pc.pagado = true
            AND pc.validation_status IN ('validated', 'no_required')
            AND COALESCE(pc.monto_aplicado, 0) > 0
        )`,
      })
      .from(cuotas_credito)
      .innerJoin(creditos, eq(cuotas_credito.credito_id, creditos.credito_id));



    // 2. Filter overdue installments (excluyendo estados que no aplican)
    const cuotasVencidas = cuotas.filter((c) => isOverdueInstallmentForMora(c, hoy));



    // 3. Group by credit (conteo de cuotas vencidas + capital del crédito,
    //    ya traído en el JOIN para evitar un SELECT por crédito dentro del loop).
    const moraPorCredito: Record<number, number> = {};
    const capitalPorCredito = new Map<number, string>();
    // Los días de atraso van POR CUOTA: la mora ya no es un bloque fijo por cuota
    // sino proporcional al tiempo real de atraso de cada una (con techo mensual).
    const diasPorCredito = new Map<number, number[]>();
    for (const cuota of cuotasVencidas) {
      moraPorCredito[cuota.credito_id] = (moraPorCredito[cuota.credito_id] ?? 0) + 1;
      capitalPorCredito.set(cuota.credito_id, cuota.capital);
      const dias = diasPorCredito.get(cuota.credito_id) ?? [];
      dias.push(diasAtrasoMora(cuota.fecha_vencimiento, hoy));
      diasPorCredito.set(cuota.credito_id, dias);
    }



    // 4. Cargar moras activas existentes para comparar (UPSERT real)
    const morasActivas = await db
      .select({
        mora_id: moras_credito.mora_id,
        credito_id: moras_credito.credito_id,
        monto_mora: moras_credito.monto_mora,
        cuotas_atrasadas: moras_credito.cuotas_atrasadas,
        porcentaje_mora: moras_credito.porcentaje_mora,
      })
      .from(moras_credito)
      .where(eq(moras_credito.activa, true));

    const morasActivasPorCredito = new Map<number, typeof morasActivas[number]>();
    for (const m of morasActivas) {
      morasActivasPorCredito.set(m.credito_id, m);
    }

    let creadas = 0;
    let recalculadas = 0;
    let sinCambios = 0;
    let desactivadas = 0;
    let sinCapital = 0;
    let desactivadasSinCapital = 0;
    // Créditos con capital positivo cuya mora proporcional redondea a Q0.00:
    // no se les crea mora (createMora prohíbe montos ≤ 0) ni se los marca MOROSO.
    let moraCero = 0;
    let desactivadasMoraCero = 0;
    let skippedInternally = 0;

    // 5. Procesar créditos CON cuotas vencidas → crear o recalcular
    for (const [creditoIdStr, cuotasAtrasadas] of Object.entries(moraPorCredito)) {
      const creditoId = Number(creditoIdStr);

      const capitalStr = capitalPorCredito.get(creditoId);
      if (capitalStr === undefined) {
        skippedInternally++;
        continue;
      }

      // ¿Hay mora que cobrar? Dos casos dicen que no: capital ≤ 0 (nunca hubo
      // base) y mora proporcional que redondea a Q0.00 (capital chico + pocos
      // días). Ambos terminan igual: no se crea mora, se apaga la que hubiera y
      // el crédito NO se marca MOROSO.
      const decision = decidirMoraDelCron({
        capital: capitalStr,
        diasAtrasadosPorCuota: diasPorCredito.get(creditoId) ?? [],
      });

      if (decision.accion === "DESACTIVAR") {
        const esSinCapital = decision.motivo === MOTIVO_MORA_SIN_CAPITAL;
        if (esSinCapital) sinCapital++;
        else moraCero++;

        const moraPrevia = morasActivasPorCredito.get(creditoId);
        if (moraPrevia) {
          // Si otra ruta la apagó a media corrida no hubo desactivación NUESTRA:
          // el crédito ya viene contado en sinCapital/moraCero y, al no sumarse
          // acá, cae solo en `skippedCount` — sin inflar `desactivadas`.
          const desactivo = await desactivarMoraDelCron(creditoId, moraPrevia, decision.motivo);
          if (desactivo) {
            desactivadas++;
            if (esSinCapital) desactivadasSinCapital++;
            else desactivadasMoraCero++;
          }
        }

        continue;
      }

      const moraNuevaStr = decision.montoStr;

      const moraActual = morasActivasPorCredito.get(creditoId);

      if (!moraActual) {
        // CREACION
        //
        // 🔒 El cambio de status va PRIMERO y es CONDICIONAL: hace de candado y
        // de escritura a la vez. El cron leyó el estado del crédito al arrancar
        // (paso 1) y escribe acá, al final del recorrido; si en el medio se
        // confirmó un convenio, la foto vieja decía "moroso sin mora" y el cron
        // le insertaba una mora NUEVA a un crédito EN_CONVENIO y lo marcaba
        // MOROSO. El índice único parcial no lo frena: justamente NO hay mora
        // activa que chocar. Con `notInArray` el UPDATE no matchea ningún
        // estado de STATUS_EXCLUIDOS_MORA (EN_CONVENIO, INCOBRABLE, CANCELADO,
        // PENDIENTE_CANCELACION, CAIDO) y `.returning()` nos dice si el crédito
        // sigue siendo elegible: cero filas = ya no lo es → no se inserta mora,
        // no se escribe historial y el crédito cae en los omitidos.
        //
        // Se eligió el UPDATE condicional y no un SELECT de re-verificación
        // porque el SELECT deja abierto el hueco entre leer y escribir — que es
        // exactamente el defecto que se está cerrando — mientras que acá la
        // condición se evalúa dentro del mismo write. (`statusCredit` es NOT
        // NULL en el esquema, así que el `NOT IN` nunca cae en el NULL de SQL.)
        //
        // 🧾 Y los tres writes van JUNTOS en una transacción (el mismo patrón
        // de `desactivarMoraPorConvenio` y `desactivarMoraDelCron`): con el
        // update suelto, autocommiteado, si el INSERT de la mora fallaba por
        // cualquier motivo distinto del 23505 ya contemplado, `procesarMoras`
        // salía con error y el crédito quedaba MOROSO sin mora activa ni evento
        // de CREACION — un estado que ni el cron ni una segunda pasada
        // corrigen, porque ambos parten de "hay mora activa". Adentro de la
        // transacción ese fallo revierte también el cambio de estado.
        // Beneficio extra: el UPDATE deja el row lock del crédito tomado hasta
        // el commit, así que el candado ya no es solo lógico.
        let creacionOk = false;
        await db.transaction(async (txm) => {
          const marcadoMoroso = await txm
            .update(creditos)
            .set({ statusCredit: "MOROSO" })
            .where(
              and(
                eq(creditos.credito_id, creditoId),
                notInArray(creditos.statusCredit, STATUS_EXCLUIDOS_MORA_SQL),
              ),
            )
            .returning({ credito_id: creditos.credito_id });

          if (marcadoMoroso.length === 0) {
            // Convenio (u otra ruta) cambió el estado a media corrida: este
            // crédito ya no lleva mora. No se crea nada (el update no afectó
            // filas, así que la tx commitea vacía).
            return;
          }

          let insertada;
          try {
            // 💾 SAVEPOINT (transacción anidada de drizzle) alrededor del
            // insert. En Postgres un error de statement aborta la transacción
            // entera: sin el savepoint, el 23505 se llevaría puesto el MOROSO
            // que SÍ queremos conservar. El savepoint es justo lo que separa
            // los dos casos, y la distinción es de fondo, no de forma:
            //   - 23505 → existe una mora ACTIVA de este crédito (la creó otra
            //     corrida) y el UPDATE ya probó que el crédito no está en un
            //     estado excluido: MOROSO es el estado correcto → rollback
            //     solo hasta el savepoint y la tx commitea el status.
            //   - cualquier otro error → NO quedó mora: MOROSO sería mentira →
            //     se propaga y la tx entera revierte el status.
            insertada = await txm.transaction(async (sp) => {
              const [fila] = await sp
                .insert(moras_credito)
                .values({
                  credito_id: creditoId,
                  monto_mora: moraNuevaStr,
                  cuotas_atrasadas: cuotasAtrasadas,
                  activa: true,
                  porcentaje_mora: "1.12",
                })
                .returning();
              return fila;
            });
          } catch (e: any) {
            // Índice único parcial moras_credito_uq_activa: otra corrida concurrente
            // ya creó la mora activa de este crédito → omitir (no duplicar).
            // El MOROSO que acabamos de dejar sigue siendo el estado correcto:
            // hay una mora activa sobre un crédito que no estaba excluido.
            if (e?.code === "23505") return;
            throw e;
          }

          await registrarHistorialMora({
            credito_id: creditoId,
            mora_id: insertada.mora_id,
            tipo_evento: "CREACION",
            origen: "PROCESO_AUTO",
            monto_anterior: "0",
            monto_nuevo: moraNuevaStr,
            cuotas_atrasadas_anterior: 0,
            cuotas_atrasadas_nuevas: cuotasAtrasadas,
            capital_credito: capitalStr,
            porcentaje_mora: insertada.porcentaje_mora,
            dbClient: txm as unknown as typeof db,
            // Dentro de la tx el swallow es mentiroso: sin esto, un historial
            // fallido dejaría la tx abortada y el COMMIT sería un rollback
            // silencioso mientras el contador dice "creada".
            propagarError: true,
          });

          creacionOk = true;
        });

        // Los dos caminos que no crearon nada (candado con cero filas y 23505)
        // caen en el mismo balde de omitidos que antes: los contadores siguen
        // diciendo lo que de verdad pasó.
        if (!creacionOk) {
          skippedInternally++;
          continue;
        }

        creadas++;

      } else {
        const cambioMonto = new Big(moraActual.monto_mora).cmp(moraNuevaStr) !== 0;
        const cambioCuotas = moraActual.cuotas_atrasadas !== cuotasAtrasadas;

        if (!cambioMonto && !cambioCuotas) {
          sinCambios++;
          continue;
        }

        // RECALCULO
        //
        // 🔒 CONDICIONAL sobre `activa=true` + `.returning()`, igual que las
        // tres rutas de desactivación del módulo. El cron leyó esta mora activa
        // al arrancar; si un convenio la apagó en el medio, la fila sigue ahí
        // con activa=false y un update por `mora_id` solo la REVIVIRÍA con el
        // monto recalculado — deshaciendo el perdón del convenio y anotando un
        // RECALCULO después del DESACTIVACION. (Antes esto no se veía porque el
        // convenio BORRABA la fila y el update no encontraba nada que pisar.)
        // Cero filas = otra ruta ya la apagó: no se toca el status, no se
        // escribe historial y el crédito cae en los omitidos — no se cuenta un
        // recálculo que no ocurrió.
        //
        // 🧾 Los tres writes van JUNTOS en una transacción, por lo mismo que la
        // rama CREACION de acá arriba: sueltos y autocommiteados, un fallo en
        // el update de status o en el historial dejaba el monto de la mora ya
        // cambiado sin el estado que le corresponde y, peor, SIN RASTRO en
        // moras_historial — y el rastro es justo lo que esta rama vino a
        // garantizar. Además el saldo de la mora y su evento son lo que le
        // cobramos al cliente: no pueden discrepar. Adentro de la transacción
        // cualquier fallo revierte también el recálculo.
        // (Acá no hace falta el SAVEPOINT de la CREACION: no hay ninguna
        // violación de restricción esperada que haya que absorber. Cualquier
        // error revierte todo, que es lo correcto.)
        let recalculoOk = false;
        await db.transaction(async (txm) => {
          // 🔒 ORDEN DE CANDADOS: `creditos` PRIMERO, `moras_credito` después
          // (ver la regla al inicio del archivo). Esta rama tomaba la mora
          // primero mientras el convenio tomaba el crédito primero: órdenes
          // opuestos sobre las mismas dos filas = ciclo de deadlock. El 40P01
          // no está manejado, así que se llevaba puesta la corrida entera.
          //
          // Subir a MOROSO tampoco puede pisar un estado excluido: es el mismo
          // cuidado que ya tienen los UPDATE que BAJAN a ACTIVO (condicionados a
          // MOROSO para no des-castigar), en el sentido contrario. Sin la
          // condición, un crédito que pasó a EN_CONVENIO/INCOBRABLE a media
          // corrida volvía a MOROSO por la foto vieja del paso 1.
          //
          // 🔒 Y el `.returning()` no es decorativo: es la ÚNICA señal de que
          // el crédito sigue siendo elegible. El candado de la mora de acá
          // abajo solo detecta a quien toca `moras_credito`; una transición de
          // estado que no la toca —`marcarCreditoComoCaido`, por ejemplo— pasa
          // por debajo de él, y sin mirar las filas afectadas la transacción
          // confirmaba una mora recalculada y un evento RECALCULO sobre un
          // crédito CAIDO. El paso 6 tampoco lo recoge después: su mapa
          // `moraPorCredito` viene de la foto vieja y todavía lo contiene.
          //
          // Cero filas ⇒ se aborta la transacción. Acá todavía no hay nada
          // escrito, pero se tira igual (y no `return`) para no tener dos
          // formas de salir de esta transacción: el `catch` de abajo cuenta el
          // omitido en un solo lugar.
          const sigueElegible = await txm
            .update(creditos)
            .set({ statusCredit: "MOROSO" })
            .where(
              and(
                eq(creditos.credito_id, creditoId),
                notInArray(creditos.statusCredit, STATUS_EXCLUIDOS_MORA_SQL),
              ),
            )
            .returning({ credito_id: creditos.credito_id });

          if (sigueElegible.length === 0) throw new CreditoYaNoElegible();

          const recalculadasFilas = await txm
            .update(moras_credito)
            .set({
              monto_mora: moraNuevaStr,
              cuotas_atrasadas: cuotasAtrasadas,
              updated_at: new Date(),
            })
            .where(
              and(
                eq(moras_credito.mora_id, moraActual.mora_id),
                eq(moras_credito.activa, true),
              ),
            )
            .returning({ mora_id: moras_credito.mora_id });

          // 🔒 Cero filas = otra ruta ya apagó la mora. Se ABORTA (no `return`):
          // el UPDATE de `creditos` de arriba ya corrió y commitearlo dejaría
          // MOROSO a un crédito al que el convenio le acaba de perdonar la mora.
          if (recalculadasFilas.length === 0) throw new MoraYaApagada();

          await registrarHistorialMora({
            credito_id: creditoId,
            mora_id: moraActual.mora_id,
            tipo_evento: "RECALCULO",
            origen: "PROCESO_AUTO",
            monto_anterior: moraActual.monto_mora,
            monto_nuevo: moraNuevaStr,
            cuotas_atrasadas_anterior: moraActual.cuotas_atrasadas,
            cuotas_atrasadas_nuevas: cuotasAtrasadas,
            capital_credito: capitalStr,
            porcentaje_mora: moraActual.porcentaje_mora,
            dbClient: txm as unknown as typeof db,
            // Dentro de la tx el swallow es mentiroso: sin esto, un historial
            // fallido dejaría la tx abortada y el COMMIT sería un rollback
            // silencioso mientras el contador dice "recalculada".
            propagarError: true,
          });

          recalculoOk = true;
        }).catch((e) => {
          // Los dos abortos —crédito no elegible y mora ya apagada por otra
          // ruta— son omisiones esperadas, no fallos del cron: la transacción
          // ya revirtió TODO (monto de la mora y status incluidos) y la corrida
          // sigue con el resto de los créditos. Cualquier otro error sí se
          // propaga, como antes.
          if (!(e instanceof CreditoYaNoElegible) && !(e instanceof MoraYaApagada)) throw e;
        });

        // El candado con cero filas sigue cayendo en el mismo balde de omitidos
        // que antes: los contadores dicen lo que de verdad pasó.
        if (!recalculoOk) {
          skippedInternally++;
          continue;
        }

        recalculadas++;

      }
    }

    // 6. Procesar créditos que tenían mora activa pero YA NO tienen cuotas vencidas
    //    → se pusieron al día: desactivar mora y bajar status a ACTIVO
    //
    // 🕸️ RED DE SEGURIDAD DEL CONVENIO — no romper sin saber qué sostiene.
    // Si `createPaymentAgreement` no alcanzó a apagar la mora (su transacción
    // revirtió la desactivación, o el crédito llegó a EN_CONVENIO por otra
    // vía), el crédito queda EN_CONVENIO y ese status está en
    // STATUS_EXCLUIDOS_MORA: sus cuotas se caen de
    // `isOverdueInstallmentForMora`, no entran a `moraPorCredito` y su mora
    // activa aterriza EN ESTE PASO, que la apaga y escribe su propio evento
    // DESACTIVACION en moras_historial. O sea que la garantía de auditoría del
    // convenio se sostiene aunque el camino del convenio falle. Sacar
    // EN_CONVENIO de STATUS_EXCLUIDOS_MORA, o dejar de escribir historial acá,
    // quita esa red.
    for (const mora of morasActivas) {
      if (moraPorCredito[mora.credito_id]) continue; // sigue moroso, ya procesado

      const desactivo = await desactivarMoraDelCron(
        mora.credito_id,
        mora,
        "Crédito se puso al día (sin cuotas vencidas)",
      );

      // Acá no hay contador sinCapital/moraCero que lo recoja: si otra ruta
      // ganó la carrera, el crédito va a `skippedInternally` (el mismo balde de
      // los omitidos por concurrencia) para que processedCount no lo pierda.
      if (desactivo) desactivadas++;
      else skippedInternally++;

    }










    const succeededCount = creadas + recalculadas + sinCambios + desactivadas;
    // Un crédito "omitido" es el que no terminó en creación/recálculo/sin-cambios/
    // desactivación: los sin capital y los de mora Q0.00 que NO tenían mora previa
    // (los que sí la tenían ya se contaron en `desactivadas`, dentro de succeeded).
    const skippedCount =
      (sinCapital - desactivadasSinCapital) +
      (moraCero - desactivadasMoraCero) +
      skippedInternally;
    emitCreditLateFee({
      outcome: "completed",
      operation: "process",
      durationMs: elapsedMilliseconds(startedAt),
      processedCount: succeededCount + skippedCount,
      succeededCount,
      failedCount: 0,
      skippedCount,
    });
    return { creadas, recalculadas, sinCambios, desactivadas, sinCapital, moraCero };

  } catch (error: any) {
    emitCreditLateFee({ outcome: "failed", operation: "process", durationMs: elapsedMilliseconds(startedAt), errorCode: "unknown" });
    throw error;
  } finally {
    if (lockConn) {
      if (lockHeld) {
        try {
          await lockConn.query("SELECT pg_advisory_unlock($1)", [PROCESAR_MORAS_LOCK_KEY]);
        } catch {
          /* el lock se libera solo al cerrar la sesión; no es crítico */
        }
      }
      lockConn.release();
    }
  }
}


/**
 * Condonar mora de un crédito:
 * 1. Look up user_id by email.
 * 2. Set mora monto = 0, activa = false.
 * 3. Set credit status = ACTIVO.
 * 4. Insert record into moras_condonaciones for audit/history.
 */
export async function condonarMora({
  credito_id,
  motivo,
  usuario_email,
}: {
  credito_id: number;
  motivo: string;
  usuario_email: string;
}) {
  const startedAt = safeNow();
  try {
    // 1. Buscar el usuario por email
    const [user] = await db
      .select({ id: platform_users.id })
      .from(platform_users)
      .where(eq(platform_users.email, usuario_email));

    if (!user) {
      emitCreditLateFee({ outcome: "rejected", operation: "condone", durationMs: elapsedMilliseconds(startedAt), reasonCode: "user_not_found" });
      return { success: false, message: "[ERROR] Usuario no encontrado" };
    }

    // 2-5. Toda la operación en una sola transacción con row lock para evitar
    //      condonaciones duplicadas si dos requests llegan en paralelo.
    const result = await db.transaction(async (tx) => {
      // 🔒 ORDEN DE CANDADOS: `creditos` PRIMERO, `moras_credito` después (ver
      // la regla al inicio del archivo). El UPDATE del crédito no puede ir
      // primero —si no hay mora activa esta ruta se va sin tocar el status—,
      // así que el candado se toma con un `SELECT … FOR UPDATE`. Con el orden
      // viejo (mora FOR UPDATE y después el UPDATE del crédito) esta ruta y la
      // del convenio se pedían los candados en cruz: ciclo de deadlock.
      await tx
        .select({ credito_id: creditos.credito_id })
        .from(creditos)
        .where(eq(creditos.credito_id, credito_id))
        .limit(1)
        .for("update");

      const [moraActual] = await tx
        .select({
          id: moras_credito.mora_id,
          monto: moras_credito.monto_mora,
          cuotas_atrasadas: moras_credito.cuotas_atrasadas,
        })
        .from(moras_credito)
        .where(and(
          eq(moras_credito.credito_id, credito_id),
          eq(moras_credito.activa, true),
        ))
        .orderBy(desc(moras_credito.created_at))
        .limit(1)
        .for("update");

      if (!moraActual) {
        return { kind: "not_found" as const };
      }

      const monto = moraActual.monto ?? "0";



      // Re-check activa=true en el UPDATE como defensa extra: si dos tx
      // pasaran el SELECT FOR UPDATE en algún edge case raro, solo la primera
      // afectará filas y la segunda saldrá vacía.
      const [updatedMora] = await tx
        .update(moras_credito)
        .set({ monto_mora: "0", activa: false, updated_at: new Date() })
        .where(and(
          eq(moras_credito.mora_id, moraActual.id),
          eq(moras_credito.activa, true),
        ))
        .returning();

      if (!updatedMora) {
        return { kind: "not_found" as const };
      }

      await tx
        .update(creditos)
        .set({ statusCredit: "ACTIVO" })
        .where(eq(creditos.credito_id, credito_id));

      const [condonacion] = await tx
        .insert(moras_condonaciones)
        .values({
          credito_id,
          mora_id: moraActual.id,
          motivo,
          usuario_id: user.id,
          montoCondonacion: monto,
        })
        .returning();

      return {
        kind: "ok" as const,
        moraId: moraActual.id,
        monto,
        cuotas: moraActual.cuotas_atrasadas,
        updatedMora,
        condonacion,
      };
    });

    if (result.kind === "not_found") {
      emitCreditLateFee({ outcome: "rejected", operation: "condone", durationMs: elapsedMilliseconds(startedAt), reasonCode: "active_late_fee_not_found" });
      return { success: false, message: "[ERROR] No hay mora activa para este crédito" };
    }

    await registrarHistorialMora({
      credito_id,
      mora_id: result.moraId,
      tipo_evento: "CONDONACION",
      origen: "CONDONACION_INDIVIDUAL",
      monto_anterior: result.monto,
      monto_nuevo: "0",
      // Condonar pone el MONTO en 0; las cuotas atrasadas de la fila no se
      // tocan. Registrar el valor real evita el "N → 0" falso en el historial.
      cuotas_atrasadas_anterior: result.cuotas ?? 0,
      cuotas_atrasadas_nuevas: result.updatedMora?.cuotas_atrasadas ?? result.cuotas ?? 0,
      usuario_id: user.id,
      motivo,
    });

    emitCreditLateFee({ outcome: "completed", operation: "condone", durationMs: elapsedMilliseconds(startedAt) });
    return {
      success: true,
      message: `[SUCCESS] Mora condonada para crédito #${credito_id}`,
      mora: result.updatedMora,
      condonacion: result.condonacion,
    };
  } catch (error) {
    emitCreditLateFee({ outcome: "failed", operation: "condone", durationMs: elapsedMilliseconds(startedAt), errorCode: "unknown" });
    return {
      success: false,
      message: "[ERROR] No se pudo condonar la mora",
      error: String(error),
    };
  }
}


// Clamp defensivo de paginación. Vive en utils/functions/pagination.ts porque
// `getMoraHistorialSnapshot` (moraHistorial.ts) tenía su propia copia inline con
// "el mismo criterio". Se re-exporta para no romper importadores.
export { clampPagination };

/**
 * Parámetro de entrada inválido: el request pide algo que no se puede cumplir.
 *
 * NO es un 500: el `status` es 400 y el `message` está en español para
 * mostrarlo tal cual. Existe porque descartar un filtro que no se pudo
 * interpretar y responder 200 hace que "filtro inválido" y "no pedí filtro"
 * se vean igual: el usuario cree estar viendo un rango de fechas y está
 * viendo TODA la historia (y con excel=true se sube ese Excel a R2).
 */
export class ParametroInvalidoError extends Error {
  readonly status = 400;
  readonly parametro: string;
  constructor(parametro: string, message: string) {
    super(message);
    this.name = "ParametroInvalidoError";
    this.parametro = parametro;
  }
}

/**
 * Obtener créditos con información de mora.
 *
 * Filtros disponibles:
 * - numero_credito_sifco
 * - nombre_usuario (ILIKE sobre usuarios.nombre)
 * - cuotas_atrasadas (ej: > 2)
 * - estado (ACTIVO, MOROSO, etc.)
 *
 * Pagina el listado JSON (page/pageSize) y devuelve `pagination` + `totales`
 * calculados sobre TODO el conjunto filtrado (no sobre la página).
 * Si excel=true, exporta TODAS las filas filtradas (sin paginar) y sube a R2.
 */
export async function getCreditosWithMoras({
  numero_credito_sifco,
  nombre_usuario,
  cuotas_atrasadas,
  estado,
  excel,
  page,
  pageSize,
}: {
  numero_credito_sifco?: string;
  nombre_usuario?: string;
  cuotas_atrasadas?: number;
  estado?: "ACTIVO" | "CANCELADO" | "INCOBRABLE" | "PENDIENTE_CANCELACION" | "MOROSO";
  excel?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const startedAt = safeNow();
  try {
  // 1️⃣ Build query base
  let whereClauses: any[] = [];

  if (numero_credito_sifco) {
    whereClauses.push(eq(creditos.numero_credito_sifco, numero_credito_sifco));
  }
  if (nombre_usuario) {
    // `contienePatron` escapa % _ \: sin eso, buscar "_" matchea a TODOS y "%"
    // devuelve la tabla entera (son los comodines de ILIKE).
    whereClauses.push(ilike(usuarios.nombre, contienePatron(nombre_usuario)));
  }
  if (estado) {
    whereClauses.push(eq(creditos.statusCredit, estado));
  }
  if (cuotas_atrasadas !== undefined && cuotas_atrasadas !== null) {
    // Llega de un query string vía `Number(...)`: "abc" da NaN, que NO es
    // undefined, se colaba hasta el `gte` y Postgres tumbaba el request con un
    // 500. Se valida acá, junto al resto de los parámetros del listado.
    if (!Number.isInteger(cuotas_atrasadas) || cuotas_atrasadas < 0) {
      throw new ParametroInvalidoError(
        "cuotas_atrasadas",
        `[ERROR] cuotas_atrasadas inválido: "${cuotas_atrasadas}". Se espera un número entero mayor o igual a 0.`
      );
    }
    whereClauses.push(gte(moras_credito.cuotas_atrasadas, cuotas_atrasadas));
  }
  whereClauses.push(eq(moras_credito.activa, true)); // Solo moras activas
  const query = db
    .select({
      credito_id: creditos.credito_id,
      numero_credito_sifco: creditos.numero_credito_sifco,
      capital: creditos.capital,
      cuota: creditos.cuota,
      plazo: creditos.plazo,
      estado: creditos.statusCredit,
      fecha_creacion: creditos.fecha_creacion,
      observaciones: creditos.observaciones,
      usuario: usuarios.nombre,
      usuario_nit: usuarios.nit,
      usuario_categoria: usuarios.categoria,
      asesor: asesores.nombre,
      monto_mora: moras_credito.monto_mora,
      cuotas_atrasadas: moras_credito.cuotas_atrasadas,
      mora_activa: moras_credito.activa,
    })
    .from(creditos)
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
    .leftJoin(moras_credito, eq(moras_credito.credito_id, creditos.credito_id))
    .where(whereClauses.length > 0 ? and(...whereClauses) : undefined)
    // Orden estable: sin ORDER BY explícito la paginación puede repetir/saltar filas.
    // mora_id desempata si un crédito llegara a tener más de una mora activa (el índice
    // único lo impide hoy, pero ya pasó cuando el índice no existía).
    .orderBy(desc(moras_credito.monto_mora), creditos.credito_id, moras_credito.mora_id);

  if (!excel) {
    // 1️⃣.1 Totales sobre TODO el conjunto filtrado (el front los usa para el
    // encabezado y para el diálogo de condonación masiva), NO sobre la página.
    const { page: pageNum, pageSize: size, offset } = clampPagination(page, pageSize);

    const [totalesRes, data] = await Promise.all([
      db
        .select({
          creditos: count(),
          mora_total: sum(moras_credito.monto_mora),
        })
        .from(creditos)
        .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
        .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
        .leftJoin(moras_credito, eq(moras_credito.credito_id, creditos.credito_id))
        .where(whereClauses.length > 0 ? and(...whereClauses) : undefined),
      query.limit(size).offset(offset),
    ]);

    const total = Number(totalesRes?.[0]?.creditos ?? 0);

    // Misma convención que getCondonacionesMora: el listado también emite
    // telemetría en la rama JSON, no solo en la del Excel.
    emitCreditLateFee({ outcome: "completed", operation: "list", durationMs: elapsedMilliseconds(startedAt), processedCount: data.length, succeededCount: data.length, failedCount: 0, skippedCount: 0 });
    return {
      success: true,
      count: data.length,
      data,
      pagination: { page: pageNum, pageSize: size, total, totalPages: Math.ceil(total / size) },
      totales: {
        mora_total: Number(totalesRes?.[0]?.mora_total ?? 0).toFixed(2),
        creditos: total,
      },
    };
  }

  // Excel: TODAS las filas que cumplen los filtros, sin paginar.
  const data = await query;

  // 2️⃣ Generar Excel (mismo lenguaje visual que el reporte de inversionistas)
  const excelBuffer = await buildReporteCashInWorkbook({
    sheetName: "CreditosMora",
    titulo: "Créditos con mora",
    subtitulo: `${data.length} crédito${data.length === 1 ? "" : "s"}`,
    conTotales: true,
    filas: data as any[],
    columnas: [
      { header: "Crédito ID", key: "credito_id", width: 12, type: "number" },
      { header: "Número SIFCO", key: "numero_credito_sifco", width: 20 },
      { header: "Estado", key: "estado", width: 15 },
      // Sin `total`: sumar capitales de créditos distintos no significa nada y
      // no tiene contraparte en pantalla (la tarjeta es de MORA, no de capital).
      // Mismo criterio que el reporte de condonaciones.
      { header: "Capital", key: "capital", width: 16, type: "money" },
      { header: "Cuota", key: "cuota", width: 15, type: "money" },
      { header: "Plazo", key: "plazo", width: 10, type: "number" },
      { header: "Usuario", key: "usuario", width: 28 },
      { header: "NIT", key: "usuario_nit", width: 20 },
      { header: "Categoría", key: "usuario_categoria", width: 15 },
      { header: "Asesor", key: "asesor", width: 22 },
      { header: "Fecha Creación (GT)", key: "fecha_creacion", width: 20, type: "date" },
      { header: "Observaciones", key: "observaciones", width: 40 },
      { header: "Monto Mora", key: "monto_mora", width: 16, type: "money", total: true },
      { header: "Cuotas Atrasadas", key: "cuotas_atrasadas", width: 18, type: "number" },
      { header: "Mora Activa", key: "mora_activa", width: 12 },
    ],
  });

  // 3️⃣ Subir a R2
  const filename = `reportes/creditos_moras_${Date.now()}.xlsx`;
  const s3 = new S3Client({
    endpoint: process.env.BUCKET_REPORTS_URL,
    region: "auto",
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    },
  });

  const uint8Array = new Uint8Array(excelBuffer);

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.BUCKET_REPORTS,
      Key: filename,
      Body: uint8Array,
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );

  const url = `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;

  emitCreditLateFee({ outcome: "completed", operation: "list", durationMs: elapsedMilliseconds(startedAt), processedCount: data.length, succeededCount: data.length, failedCount: 0, skippedCount: 0 });
  return {
    success: true,
    excelUrl: url,
    count: data.length,
  };
  } catch (error) {
    if (error instanceof ParametroInvalidoError) {
      emitCreditLateFee({ outcome: "rejected", operation: "list", durationMs: elapsedMilliseconds(startedAt), reasonCode: "schema_invalid" });
    } else {
      emitCreditLateFee({ outcome: "failed", operation: "list", durationMs: elapsedMilliseconds(startedAt), errorCode: "unknown" });
    }
    throw error;
  }
}
/**
 * Filtro por día de Guatemala sobre `moras_condonaciones.fecha`.
 *
 * La columna es `timestamp` SIN zona con el instante en UTC y la pantalla
 * muestra el día de Guatemala: comparar crudo contra "2026-08-25" dejaría
 * fuera las condonaciones de las 18:00–23:59 GT (que en UTC ya son del 26) y
 * metería las de las 00:00–05:59 UTC del 25 (que en GT son del 24).
 *
 * Se convierten los límites del día GT a instantes UTC y se compara contra la
 * columna CRUDA, no contra `(fecha AT TIME ZONE …)::date`: así el índice de
 * `fecha` sigue sirviendo. El rango es semiabierto [desde, díaSiguiente) para
 * que el día "hasta" entre completo hasta su último microsegundo.
 *
 * Una fecha PRESENTE pero que no se puede interpretar lanza
 * `ParametroInvalidoError` (400) en vez de descartarse: ver la docstring de esa
 * clase. Ausente o vacía sí significa "sin filtro".
 *
 * Exportada para poder afirmar el SQL generado en los tests.
 */
export function filtroFechaCondonacionesGT(
  fecha_desde?: string,
  fecha_hasta?: string
) {
  const convertir = (valor: string | undefined, nombre: string, offsetDias: number) => {
    if (valor === undefined || valor === null || String(valor).trim() === "") return null;
    const ts = inicioDiaGTComoTimestampUTC(String(valor), offsetDias);
    if (!ts) {
      throw new ParametroInvalidoError(
        nombre,
        `[ERROR] ${nombre} inválida: "${valor}". Se espera un día de Guatemala con formato YYYY-MM-DD (año entre 1900 y 9998).`
      );
    }
    return ts;
  };

  const desde = convertir(fecha_desde, "fecha_desde", 0);
  // +1 día: el límite superior es la medianoche del día SIGUIENTE, así el día
  // elegido entra completo.
  const hastaExclusivo = convertir(fecha_hasta, "fecha_hasta", 1);
  const clauses: any[] = [];
  // Independientes a propósito: antes el filtro solo se aplicaba con AMBOS
  // presentes y mandar solo uno se ignoraba en silencio.
  if (desde) {
    clauses.push(sql`${moras_condonaciones.fecha} >= ${desde}::timestamp`);
  }
  if (hastaExclusivo) {
    clauses.push(
      sql`${moras_condonaciones.fecha} < ${hastaExclusivo}::timestamp`
    );
  }
  return clauses;
}

/**
 * Get mora condonations (history of condonations).
 *
 * Filters:
 * - numero_credito_sifco (string)
 * - nombre_usuario (ILIKE sobre usuarios.nombre)
 * - usuario_email (string)
 * - fecha_desde / fecha_hasta (`YYYY-MM-DD`, DÍAS DE GUATEMALA, independientes:
 *   se puede mandar solo uno)
 *
 * Pagina el listado JSON (page/pageSize) y devuelve `pagination` + `totales`
 * sobre TODO el conjunto filtrado. If excel=true, exporta todas las filas
 * filtradas (sin paginar) y sube a R2.
 */
export async function getCondonacionesMora({
  numero_credito_sifco,
  nombre_usuario,
  usuario_email,
  fecha_desde,
  fecha_hasta,
  excel,
  page,
  pageSize,
}: {
  numero_credito_sifco?: string;
  nombre_usuario?: string;
  usuario_email?: string;
  /** Día de Guatemala `YYYY-MM-DD` (inclusive). */
  fecha_desde?: string;
  /** Día de Guatemala `YYYY-MM-DD` (inclusive, día completo). */
  fecha_hasta?: string;
  excel?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const startedAt = safeNow();
  try {
  // 1️⃣ Build filters
  const whereClauses: any[] = [];

  if (numero_credito_sifco) {
    whereClauses.push(eq(creditos.numero_credito_sifco, numero_credito_sifco));
  }
  if (nombre_usuario) {
    // Comodines de ILIKE escapados: ver getCreditosWithMoras.
    whereClauses.push(ilike(usuarios.nombre, contienePatron(nombre_usuario)));
  }
  if (usuario_email) {
    whereClauses.push(eq(platform_users.email, usuario_email));
  }
  whereClauses.push(...filtroFechaCondonacionesGT(fecha_desde, fecha_hasta));

  // 2️⃣ Query con joins
  const query = db
    .select({
      condonacion_id: moras_condonaciones.condonacion_id,
      credito_id: creditos.credito_id,
      numero_credito_sifco: creditos.numero_credito_sifco,
      estado_credito: creditos.statusCredit,
      capital: creditos.capital,
      usuario: usuarios.nombre,
      asesor: asesores.nombre,
      motivo: moras_condonaciones.motivo,
      fecha: moras_condonaciones.fecha,
      usuario_email: platform_users.email,
      montoCondonacion: moras_condonaciones.montoCondonacion,
    })
    .from(moras_condonaciones)
    .innerJoin(creditos, eq(moras_condonaciones.credito_id, creditos.credito_id))
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
    .innerJoin(platform_users, eq(moras_condonaciones.usuario_id, platform_users.id))
    .where(whereClauses.length > 0 ? and(...whereClauses) : undefined)
    // Orden estable (y útil): lo más reciente primero; sin ORDER BY la paginación
    // puede repetir/saltar filas entre páginas.
    .orderBy(desc(moras_condonaciones.fecha), desc(moras_condonaciones.condonacion_id));

  if (!excel) {
    const { page: pageNum, pageSize: size, offset } = clampPagination(page, pageSize);

    const [totalesRes, data] = await Promise.all([
      db
        .select({
          condonaciones: count(),
          monto_total: sum(moras_condonaciones.montoCondonacion),
        })
        .from(moras_condonaciones)
        .innerJoin(creditos, eq(moras_condonaciones.credito_id, creditos.credito_id))
        .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
        .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
        .innerJoin(platform_users, eq(moras_condonaciones.usuario_id, platform_users.id))
        .where(whereClauses.length > 0 ? and(...whereClauses) : undefined),
      query.limit(size).offset(offset),
    ]);

    const total = Number(totalesRes?.[0]?.condonaciones ?? 0);

    emitCreditLateFee({ outcome: "completed", operation: "list", durationMs: elapsedMilliseconds(startedAt), processedCount: data.length, succeededCount: data.length, failedCount: 0, skippedCount: 0 });
    return {
      success: true,
      count: data.length,
      data,
      pagination: { page: pageNum, pageSize: size, total, totalPages: Math.ceil(total / size) },
      totales: {
        monto_total: Number(totalesRes?.[0]?.monto_total ?? 0).toFixed(2),
        condonaciones: total,
      },
    };
  }

  // Excel: TODAS las filas filtradas, sin paginar.
  const data = await query;

  // 3️⃣ Crear Excel (mismo lenguaje visual que el reporte de inversionistas)
  const excelBuffer = await buildReporteCashInWorkbook({
    sheetName: "Condonaciones",
    titulo: "Condonaciones de mora",
    subtitulo: `${data.length} condonaci${data.length === 1 ? "ón" : "ones"}`,
    // La fila de totales suma SOLO el monto condonado (ver `total: true` abajo):
    // es el dato del reporte y tiene que cuadrar con la tarjeta "Monto total
    // condonado" de la pantalla. El capital del crédito no se suma —sumar
    // capitales no dice nada— y por eso va sin `total`.
    conTotales: true,
    filas: data as any[],
    columnas: [
      { header: "Condonación ID", key: "condonacion_id", width: 14, type: "number" },
      { header: "Crédito ID", key: "credito_id", width: 12, type: "number" },
      { header: "Número SIFCO", key: "numero_credito_sifco", width: 20 },
      { header: "Estado Crédito", key: "estado_credito", width: 18 },
      { header: "Capital", key: "capital", width: 16, type: "money" },
      {
        header: "Monto Condonado",
        key: "montoCondonacion",
        width: 18,
        type: "money",
        total: true,
      },
      { header: "Usuario Cliente", key: "usuario", width: 28 },
      { header: "Asesor", key: "asesor", width: 25 },
      { header: "Motivo", key: "motivo", width: 40 },
      { header: "Fecha (GT)", key: "fecha", width: 18, type: "date" },
      { header: "Usuario que condonó", key: "usuario_email", width: 30 },
    ],
  });

  // 4️⃣ Subir a R2
  const filename = `reportes/condonaciones_mora_${Date.now()}.xlsx`;
  const s3 = new S3Client({
    endpoint: process.env.BUCKET_REPORTS_URL,
    region: "auto",
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    },
  });

  const uint8Array = new Uint8Array(excelBuffer);

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.BUCKET_REPORTS,
      Key: filename,
      Body: uint8Array,
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );

  const url = `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;

  emitCreditLateFee({ outcome: "completed", operation: "list", durationMs: elapsedMilliseconds(startedAt), processedCount: data.length, succeededCount: data.length, failedCount: 0, skippedCount: 0 });
  return {
    success: true,
    excelUrl: url,
    count: data.length,
  };
  } catch (error) {
    if (error instanceof ParametroInvalidoError) {
      emitCreditLateFee({ outcome: "rejected", operation: "list", durationMs: elapsedMilliseconds(startedAt), reasonCode: "schema_invalid" });
    } else {
      emitCreditLateFee({ outcome: "failed", operation: "list", durationMs: elapsedMilliseconds(startedAt), errorCode: "unknown" });
    }
    throw error;
  }
}


export async function condonarTodasLasMoras({
  motivo,
  usuario_email,
}: {
  motivo: string;
  usuario_email: string;
}) {
  const startedAt = safeNow();
  try {
    // 1. Buscar el usuario por email
    const [user] = await db
      .select({ id: platform_users.id })
      .from(platform_users)
      .where(eq(platform_users.email, usuario_email));

    if (!user) {
      emitCreditLateFee({ outcome: "rejected", operation: "bulk_condone", durationMs: elapsedMilliseconds(startedAt), reasonCode: "user_not_found" });
      return { success: false, message: "[ERROR] Usuario no encontrado" };
    }

    // 2. Obtener todos los créditos MOROSOS con sus moras activas
    const creditosMorosos = await db
      .select({
        credito_id: creditos.credito_id,
        mora_id: moras_credito.mora_id,
        monto_mora: moras_credito.monto_mora,
        cuotas_atrasadas: moras_credito.cuotas_atrasadas,
      })
      .from(creditos)
      .leftJoin(
        moras_credito,
        and(
          eq(creditos.credito_id, moras_credito.credito_id),
          eq(moras_credito.activa, true)
        )
      )
      .where(eq(creditos.statusCredit, "MOROSO"));


    if (creditosMorosos.length === 0) {
      emitCreditLateFee({ outcome: "completed", operation: "bulk_condone", durationMs: elapsedMilliseconds(startedAt), processedCount: 0, succeededCount: 0, failedCount: 0, skippedCount: 0 });
      return {
        success: true,
        message: "[INFO] No hay créditos morosos para condonar",
        condonados: 0,
      };
    }

    // El leftJoin trae también los créditos MOROSO SIN mora activa (mora_id
    // null): esos no se actualizan, no generan condonación y no deben contarse.
    // Contarlos inflaba el "Se condonaron N moras" y el `condonados`.
    const conMoraActiva = creditosMorosos.filter(
      (c): c is typeof c & { mora_id: number } => c.mora_id !== null
    );

    if (conMoraActiva.length === 0) {
      emitCreditLateFee({ outcome: "completed", operation: "bulk_condone", durationMs: elapsedMilliseconds(startedAt), processedCount: creditosMorosos.length, succeededCount: 0, failedCount: 0, skippedCount: creditosMorosos.length });
      return {
        success: true,
        message: "[INFO] No hay moras activas para condonar",
        condonados: 0,
        creditos_afectados: 0,
        condonaciones: [],
      };
    }

    // 3. Actualizar todas las moras a 0 (mantener activas y estado MOROSO)
    const moraIds = conMoraActiva.map((c) => c.mora_id);
    await db
      .update(moras_credito)
      .set({
        monto_mora: "0",
        updated_at: new Date(),
      })
      .where(inArray(moras_credito.mora_id, moraIds));



    // 5. Insertar registros masivos en moras_condonaciones
    const condonacionesData = conMoraActiva.map((credito) => ({
      credito_id: credito.credito_id,
      mora_id: credito.mora_id,
      motivo,
      usuario_id: user.id,
      montoCondonacion: credito.monto_mora ?? "0",
    }));

    const condonaciones = await db
      .insert(moras_condonaciones)
      .values(condonacionesData)
      .returning();

    // Registrar histórico para cada condonación masiva
    await Promise.all(
      conMoraActiva.map((c) =>
        registrarHistorialMora({
          credito_id: c.credito_id,
          mora_id: c.mora_id,
          tipo_evento: "CONDONACION",
          origen: "CONDONACION_MASIVA",
          monto_anterior: c.monto_mora ?? "0",
          monto_nuevo: "0",
          // La condonación masiva NO toca cuotas_atrasadas de la fila: se
          // registra el valor real (antes y después) en vez de un "→ 0" falso.
          cuotas_atrasadas_anterior: c.cuotas_atrasadas ?? 0,
          cuotas_atrasadas_nuevas: c.cuotas_atrasadas ?? 0,
          usuario_id: user.id,
          motivo,
        })
      )
    );

    emitCreditLateFee({
      outcome: "completed",
      operation: "bulk_condone",
      durationMs: elapsedMilliseconds(startedAt),
      processedCount: creditosMorosos.length,
      succeededCount: condonacionesData.length,
      failedCount: 0,
      skippedCount: creditosMorosos.length - condonacionesData.length,
    });
    return {
      success: true,
      message: `[SUCCESS] Se condonaron ${condonacionesData.length} moras`,
      condonados: condonacionesData.length,
      creditos_afectados: condonacionesData.length,
      condonaciones,
    };
  } catch (error) {
    emitCreditLateFee({ outcome: "failed", operation: "bulk_condone", durationMs: elapsedMilliseconds(startedAt), errorCode: "unknown" });
    return {
      success: false,
      message: "[ERROR] No se pudieron condonar las moras masivamente",
      error: String(error),
    };
  }
}
