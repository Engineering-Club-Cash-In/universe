/**
 * Lógica pura de `POST /clientes/consulta-mora`: armado del veredicto y del
 * historial de mora. Sin acceso a base ni a SIFCO, para que el gate del CRM
 * quede cubierto por tests que corren siempre.
 */

import { aInstante } from "../utils/functions/diaGuatemala";

export type MotivoConsultaMora =
  | "SIN_MORA"
  | "MORA_ACTIVA"
  | "EN_CONVENIO"
  | "CREDITO_INSOLUTO"
  | "CLIENTE_NO_ENCONTRADO"
  | "SERVICIO_NO_DISPONIBLE";

/**
 * Estados que por sí solos ya significan mora, aunque no haya fila viva en
 * `moras_credito` (p. ej. un CAIDO al que le borraron la mora).
 *
 * Deliberadamente NO se reusa `STATUS_EXCLUIDOS_MORA` de `latefee.ts`. Esa
 * lista responde otra pregunta —"¿a qué créditos NO les corre el motor de
 * mora?"— y es `["EN_CONVENIO", "INCOBRABLE", "CANCELADO",
 * "PENDIENTE_CANCELACION", "CAIDO"]`. Se solapa con esta en dos estados
 * (INCOBRABLE y CAIDO) y por la razón opuesta: al motor no le corre mora
 * porque ya están perdidos, que es justo lo que acá los hace mora. Los otros
 * tres —EN_CONVENIO, CANCELADO, PENDIENTE_CANCELACION— no son mora acá. Como
 * ninguna de las dos listas contiene a la otra y significan cosas distintas,
 * compartirlas haría que tocar el motor cambiara el gate.
 */
export const STATUS_CON_MORA = ["MOROSO", "CAIDO", "INCOBRABLE"] as const;

export const STATUS_EN_CONVENIO = "EN_CONVENIO";

/**
 * Un crédito insoluto se reconoce por su número, no por su estado.
 *
 * Los insolutos no tienen número de SIFCO: `createCredit.ts` los numera con el
 * correlativo `insoluto-N` (ver `getNextInsolutoSifco`). Es la única marca que
 * los distingue en `creditos`, porque su `statusCredit` se mueve como el de
 * cualquier otro —nacen INCOBRABLE pero pueden terminar CANCELADO—.
 */
export const PATRON_CREDITO_INSOLUTO = /^insoluto-\d+$/;

/**
 * 🔴 Decisión de producto: un crédito insoluto bloquea SIEMPRE, sin importar su
 * estado. Un insoluto CANCELADO sigue siendo un crédito que hubo que dar por
 * perdido y recolocar; que ya esté saldado no lo borra del historial. Por eso
 * la regla mira el número y NO `estado`: condicionarla al estado dejaría pasar
 * justamente a los casos ya cerrados, que son la mayoría de los viejos.
 */
export function esCreditoInsoluto(credito: CreditoConsultaMora): boolean {
  return PATRON_CREDITO_INSOLUTO.test(credito.numeroCreditoSifco);
}

export interface MoraActivaConsulta {
  monto: string;
  cuotasAtrasadas: number;
}

export interface CreditoConsultaMora {
  numeroCreditoSifco: string;
  estado: string;
  moraActiva: MoraActivaConsulta | null;
}

export interface EventoHistorialMora {
  fecha: string;
  monto: string;
  numeroCreditoSifco: string;
  evento: string;
}

export interface ClienteConsultaMora {
  codigoClienteSifco: string;
  nombre: string;
}

export interface RespuestaConsultaMora {
  encontrado: boolean;
  tieneMoraActiva: boolean;
  puedeContinuar: boolean;
  motivo: MotivoConsultaMora;
  cliente: ClienteConsultaMora | null;
  creditos: CreditoConsultaMora[];
  historialMora: EventoHistorialMora[];
  consultadoEn: string;
}

export interface VeredictoConsultaMora {
  tieneMoraActiva: boolean;
  puedeContinuar: boolean;
  motivo: Extract<
    MotivoConsultaMora,
    "SIN_MORA" | "MORA_ACTIVA" | "CREDITO_INSOLUTO" | "EN_CONVENIO"
  >;
}

/**
 * Veredicto sobre los créditos de un cliente YA encontrado.
 *
 * - `tieneMoraActiva`: fila viva en `moras_credito` o estado MOROSO/CAIDO/INCOBRABLE.
 * - Un crédito insoluto bloquea aunque esté CANCELADO (ver `esCreditoInsoluto`).
 * - EN_CONVENIO no es mora activa pero igual bloquea (decisión de producto).
 * - La mora histórica no participa: viaja aparte, en `historialMora`.
 *
 * Precedencia MORA_ACTIVA > CREDITO_INSOLUTO > EN_CONVENIO. Los tres bloquean
 * igual, así que el orden NO cambia `puedeContinuar`: solo decide qué se le
 * cuenta al asesor cuando hay más de una razón. Se reporta la más grave —la
 * deuda viva antes que el antecedente— y por eso el insoluto INCOBRABLE (que
 * además es mora por estado) sale como MORA_ACTIVA y no como CREDITO_INSOLUTO.
 *
 * 🔴 `tieneMoraActiva` sigue siendo un hecho, no un veredicto: un cliente cuyo
 * único bloqueo es un insoluto CANCELADO sale con `tieneMoraActiva: false`.
 * Marcarlo en `true` para "reforzar" el bloqueo haría que la pantalla le dijera
 * al asesor que hay saldo en mora donde no lo hay.
 */
export function construirVeredicto(
  creditos: CreditoConsultaMora[]
): VeredictoConsultaMora {
  const tieneMoraActiva = creditos.some(
    (credito) =>
      credito.moraActiva !== null ||
      (STATUS_CON_MORA as readonly string[]).includes(credito.estado)
  );

  if (tieneMoraActiva) {
    return { tieneMoraActiva: true, puedeContinuar: false, motivo: "MORA_ACTIVA" };
  }

  if (creditos.some(esCreditoInsoluto)) {
    return {
      tieneMoraActiva: false,
      puedeContinuar: false,
      motivo: "CREDITO_INSOLUTO",
    };
  }

  const enConvenio = creditos.some(
    (credito) => credito.estado === STATUS_EN_CONVENIO
  );

  if (enConvenio) {
    return { tieneMoraActiva: false, puedeContinuar: false, motivo: "EN_CONVENIO" };
  }

  return { tieneMoraActiva: false, puedeContinuar: true, motivo: "SIN_MORA" };
}

/** Mínimo que hace falta de una ficha de SIFCO para decidir si es del DPI. */
export interface FichaClienteSifco {
  CodigoCliente?: number | string | null;
  NumeroIdentificacion?: string | null;
}

/** Quita todo lo que no sea dígito: los DPI viajan con espacios y guiones. */
export function normalizarIdentificacion(valor: string): string {
  return valor.replace(/\D/g, "");
}

/** Dígitos del DPI (CUI) guatemalteco. */
export const LARGO_DPI = 13;

/**
 * Lo único que puede traer el campo de DPI: dígitos y los separadores con que
 * la gente lo escribe. Se mira ANTES de normalizar; ver `validarDpiConsulta`.
 */
const FORMA_DPI_ACEPTADA = /^[\d\s-]*$/;

export type ValidacionDpi =
  | { valido: true; dpi: string }
  | { valido: false; mensaje: string };

/**
 * ¿Lo que llegó es un DPI, antes de gastarle un viaje al core?
 *
 * 🔴 El `minLength: 1` del schema deja pasar un valor que después se normaliza
 * a NADA —espacios, guiones, letras— y la consulta se iba igual a SIFCO con el
 * string vacío. El fallo aguas abajo volvía como 200 SERVICIO_NO_DISPONIBLE:
 * un error de VALIDACIÓN disfrazado de caída del core, que el CRM le muestra
 * al asesor como "no se pudo verificar, intentá de nuevo" cuando lo que hay
 * que hacer es corregir el dato.
 *
 * Se exige el largo EXACTO porque es un DPI, no una identificación cualquiera:
 * un valor de 7 dígitos no es un DPI mal escrito que el core podría reconocer,
 * es otra cosa.
 *
 * 🔴 Y se valida la FORMA antes de normalizar. Normalizar primero es borrar la
 * evidencia: `normalizarIdentificacion` tira todo lo que no sea dígito, así que
 * `abc1234567890123xyz` quedaba en 13 dígitos y pasaba como DPI legítimo. El
 * que escribe un DPI lo separa con espacios o guiones y nada más; cualquier
 * otro carácter significa que el campo trae otra cosa —texto pegado, un
 * intento de inyectar—, y eso es un dato a corregir, no un DPI a consultar.
 */
export function validarDpiConsulta(valor: string): ValidacionDpi {
  const crudo = String(valor ?? "");

  if (!FORMA_DPI_ACEPTADA.test(crudo)) {
    return {
      valido: false,
      mensaje:
        "El DPI solo puede traer dígitos, espacios y guiones: revisá lo que se escribió en el campo.",
    };
  }

  const dpi = normalizarIdentificacion(crudo);

  if (!dpi) {
    return {
      valido: false,
      mensaje: "El DPI no trae ningún dígito: se esperan los 13 del DPI.",
    };
  }

  if (dpi.length !== LARGO_DPI) {
    return {
      valido: false,
      mensaje: `El DPI debe tener ${LARGO_DPI} dígitos; se recibieron ${dpi.length}.`,
    };
  }

  return { valido: true, dpi };
}

/**
 * Roles que pueden preguntar por la mora de un DPI.
 *
 * 🔴 `authMiddleware` SOLO valida la firma del JWT: sin gate, cualquier token
 * vivo entra —incluido el de un INVESTOR del portal, que es un CLIENTE, no
 * personal de la casa—. Y esta consulta devuelve la historia crediticia de una
 * persona a partir de su DPI, más el canal confiado de
 * `numerosCreditoConocidos` (ver el router), así que un token de afuera podía
 * pescar la cartera de cualquiera.
 *
 * Son los tres roles de `user_role` en cartera, o sea TODO usuario propio del
 * sistema. Deliberadamente NO se cierra solo a ADMIN aunque DEPLOYMENT.md exija
 * que la cuenta de `CARTERA_USER` lo sea: un 403 acá no degrada nada, el CRM lo
 * lee como "no se pudo verificar" y el gate es fail-closed, así que una cuenta
 * de servicio con rol CONTA o ASESOR —el propio DEPLOYMENT.md admite que puede
 * pasar— dejaría al CRM sin poder dar de alta a NADIE. La población que sobra
 * es la de afuera, y esa queda afuera.
 */
export const ROLES_CONSULTA_MORA = ["ADMIN", "CONTA", "ASESOR"] as const;

/** Ver `ROLES_CONSULTA_MORA`. */
export function rolPuedeConsultarMora(rol: unknown): boolean {
  return (ROLES_CONSULTA_MORA as readonly string[]).includes(String(rol ?? ""));
}

/**
 * Cota de un paso bajo el presupuesto GLOBAL de la consulta.
 *
 * 🔴 Los presupuestos por paso eran ADITIVOS: identificación + espejo + API por
 * cada ficha, todo secuencial. Una sola ficha ya podía tardar ~25s y cada ficha
 * extra sumaba lo suyo, así que el techo real era "depende de cuántas fichas
 * tenga el DPI" — y del otro lado hay un asesor esperando en pantalla. Ahora el
 * presupuesto lo fija la CONSULTA entera y cada paso se acota contra lo que
 * queda; los tiempos por paso sobreviven solo como cotas internas.
 *
 * Devuelve `null` cuando ya no queda presupuesto: el llamador corta
 * fail-closed, porque una lista de créditos a medias no alcanza para firmar un
 * "sin mora".
 */
export function cotaDelPresupuesto(
  cotaDelPasoMs: number,
  venceEnMs: number,
  ahoraMs: number
): number | null {
  const restante = venceEnMs - ahoraMs;
  if (restante <= 0) return null;
  return Math.min(cotaDelPasoMs, restante);
}

/**
 * ¿El código de la ficha sirve para pedirle los créditos al core?
 *
 * 🔴 `CodigoCliente` viene tipado `number | string | null` porque el core lo
 * manda de las dos formas, y la variante string admite basura que el tipo no
 * distingue: `""`, `"   "`, `"N/A"`. Esa basura no se puede consultar —el
 * lookup posterior la pasa por `Number(...)` y le llega `NaN`— así que la
 * ficha se descarta ACÁ, igual que la que no trae código: es el mismo caso
 * ("no se le pueden pedir préstamos"), solo que disfrazado de valor presente.
 */
function codigoClienteUtilizable(
  codigo: number | string | null | undefined
): boolean {
  if (codigo === undefined || codigo === null) return false;

  return /^\d+$/.test(String(codigo).trim());
}

/** Resultado de mirar las fichas que el core devolvió para un DPI. */
export interface SeleccionFichasDpi<T> {
  /** Las que sí se le pueden pedir préstamos al core. */
  fichas: T[];
  /**
   * El DPI tenía fichas y al menos una quedó inconsultable (código ausente,
   * vacío o no numérico). No se puede armar veredicto con lo que queda.
   */
  indeterminado: boolean;
}

/**
 * Las fichas de SIFCO que hay que consultar para un DPI, y si el descarte dejó
 * el veredicto en el aire.
 *
 * 🔴 NO alcanza con la primera. Un mismo DPI puede tener más de una ficha en el
 * core —persona natural y jurídica, o duplicados que nunca se unificaron— y los
 * créditos cuelgan de la ficha, no de la persona. Quedarse con la primera hacía
 * que un moroso con dos fichas pasara limpio cada vez que la primera estaba al
 * día: la mora de la segunda no se consultaba nunca.
 *
 * Se descartan las fichas sin código USABLE —ausente, vacío o no numérico, ver
 * `codigoClienteUtilizable`: a ninguna se le pueden pedir préstamos— y las
 * que traen una identificación que no es la buscada: la búsqueda del core es
 * por identificación, pero es suya y no nuestra, y traer créditos ajenos al
 * veredicto bloquearía a quien no debe. La ficha SIN `NumeroIdentificacion` se
 * conserva —el core no siempre lo devuelve— porque descartarla sería volver al
 * falso negativo que este endpoint existe para evitar.
 *
 * 🔴 "Sin identificación" se decide DESPUÉS de normalizar, no antes. El core
 * rellena el campo con placeholders —"N/A", "SIN DATO", "-"— que tienen texto
 * pero cero dígitos: normalizan a `""`. Compararlos contra el DPI los hacía
 * salir como ficha "de OTRA persona" y se descartaban sin levantar
 * `indeterminado`; si era la única ficha del DPI, el endpoint contestaba
 * CLIENTE_NO_ENCONTRADO con `puedeContinuar: true` y la deuda sin consultar.
 * Un placeholder no dice de quién es la ficha: es el mismo caso que el campo
 * ausente, así que la ficha se conserva y se consulta.
 *
 * 🔴 Los dos descartes NO son lo mismo y por eso solo uno levanta
 * `indeterminado`. La ficha de OTRA identificación no es del DPI: dejarla fuera
 * no le quita nada al veredicto. La ficha del DPI con código basura SÍ es suya
 * y tiene créditos que no se pudieron mirar: una ficha basura no es "no
 * cliente", es "no pude verificar". Descartarla en silencio hacía que el
 * resultado se viera idéntico a "el DPI no existe" —CLIENTE_NO_ENCONTRADO,
 * `puedeContinuar: true`— con la deuda sin consultar, justo el falso negativo
 * que el endpoint existe para evitar.
 *
 * Alcanza con UNA inconsultable: media lista no alcanza para firmar un "sin
 * mora", mismo principio que el espejo a medio actualizar.
 */
export function seleccionarFichasDelDpi<T extends FichaClienteSifco>(
  clientes: T[],
  dpi: string
): SeleccionFichasDpi<T> {
  const buscado = normalizarIdentificacion(dpi);

  const delDpi = clientes.filter((cliente) => {
    const propia = normalizarIdentificacion(cliente.NumeroIdentificacion ?? "");
    if (!propia) return true;

    return propia === buscado;
  });

  const fichas = delDpi.filter((cliente) =>
    codigoClienteUtilizable(cliente.CodigoCliente)
  );

  return { fichas, indeterminado: fichas.length < delDpi.length };
}

/** Solo las fichas consultables. Ver `seleccionarFichasDelDpi`. */
export function fichasDelDpi<T extends FichaClienteSifco>(
  clientes: T[],
  dpi: string
): T[] {
  return seleccionarFichasDelDpi(clientes, dpi).fichas;
}

/**
 * Une los números que resolvió SIFCO con los que aporta quien pregunta.
 *
 * 🔴 SIFCO no es la lista completa de créditos de una persona.
 * `creditos.numero_credito_sifco` guarda también números que el core jamás
 * emitió: `CRM-<uuid>` para los créditos nacidos al ganar una oportunidad en el
 * CRM (`close-opportunity.ts`) e `insoluto-N` para los insolutos
 * (`createCredit.ts`). Preguntarle a SIFCO por el DPI nunca los devuelve.
 *
 * Por eso el llamador puede aportar los números que él conoce —el CRM sabe los
 * `numeroSifco` de las oportunidades de sus propios leads— y acá se unen. Es la
 * ÚNICA fuente para el cliente cuyos créditos nacieron todos en el CRM: ese ni
 * siquiera tiene ficha en el core.
 *
 * Se deduplica y se descartan los vacíos: un `""` en el `inArray` no matchea
 * nada pero ensucia la consulta.
 */
export function unirNumerosCredito(
  numerosSifco: readonly string[],
  numerosConocidos: readonly string[] | undefined
): string[] {
  const vistos = new Set<string>();

  for (const numero of [...numerosSifco, ...(numerosConocidos ?? [])]) {
    const limpio = numero.trim();
    if (limpio) vistos.add(limpio);
  }

  return [...vistos];
}

/**
 * Corre la consulta al ESPEJO con un presupuesto corto y, pase lo que pase, sin
 * poder voltear el veredicto.
 *
 * 🔴 El espejo no tenía reloj: con su pool agotado o la base colgada, la request
 * del asesor quedaba viva sin llegar ni al API ni al catch —ni respuesta ni
 * fail-closed, solo la pantalla girando—.
 *
 * ⚠️ Vencerse o fallar acá NO es fail-closed, y es la asimetría a propósito de
 * esta función: el espejo es un CACHE del core y el API es la fuente
 * autoritativa viva, así que seguir con SOLO el API deja la lista COMPLETA, no
 * media lista. Es el caso opuesto al del API caído —ahí sí falta la fuente
 * autoritativa y el throw sube a SERVICIO_NO_DISPONIBLE— y al del espejo que sí
 * contesta pero atrasado, que por eso NO corta la consulta al API.
 *
 * El `clearTimeout` en el `finally` evita dejar el temporizador vivo cuando el
 * espejo gana la carrera. La consulta perdedora sigue su curso contra la base
 * (no hay cómo cancelarla); lo que no sigue es la espera.
 */
export async function numerosEspejoConPresupuesto(
  consultarEspejo: () => Promise<string[]>,
  presupuestoMs: number,
  avisar: (detalle: unknown) => void
): Promise<string[]> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;

  const vencimiento = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(
      () =>
        rechazar(
          new Error(`El espejo de SIFCO no respondió en ${presupuestoMs}ms`)
        ),
      presupuestoMs
    );
  });

  try {
    return await Promise.race([consultarEspejo(), vencimiento]);
  } catch (error) {
    avisar(error);
    return [];
  } finally {
    clearTimeout(temporizador);
  }
}

export type SiguientePasoConsulta =
  | "BUSCAR_CREDITOS"
  | "RESPONDER_SIN_CREDITOS"
  | "CLIENTE_NO_ENCONTRADO";

/**
 * Qué hacer una vez resueltas las fichas del DPI y los números a mirar.
 *
 * 🔴 Quedarse sin números NO significa que el DPI sea un desconocido. El cliente
 * con ficha en el core pero sin un solo préstamo —o cuyos préstamos el core no
 * devolvió porque no los tiene— es un cliente CONOCIDO y al día: su respuesta es
 * `encontrado: true` con `SIN_MORA` y sus datos, no `CLIENTE_NO_ENCONTRADO`.
 * Cortar ahí por "no hay números" tiraba a la basura una ficha válida y le decía
 * al CRM que esa persona nunca fue cliente.
 *
 * El no-encontrado de verdad exige las dos cosas: ni ficha en el core ni un
 * número que mirar (ni de SIFCO ni de los que aportó quien pregunta).
 */
export function siguientePasoConsulta(params: {
  cantidadFichas: number;
  cantidadNumeros: number;
}): SiguientePasoConsulta {
  if (params.cantidadNumeros > 0) return "BUSCAR_CREDITOS";

  return params.cantidadFichas > 0
    ? "RESPONDER_SIN_CREDITOS"
    : "CLIENTE_NO_ENCONTRADO";
}

/** Fila de `creditos` + su mora viva, tal como la leen las dos consultas. */
export interface FilaCreditoMora {
  credito_id: number;
  usuario_id: number | null;
  numeroCreditoSifco: string;
  estado: string;
  moraMonto: string | null;
  moraCuotas: number | null;
}

/**
 * Los créditos del veredicto: los que empataron por número MÁS todos los
 * hermanos de sus dueños.
 *
 * 🔴 Sin esta expansión el gate es ciego a poblaciones enteras. Un cliente con
 * un crédito de SIFCO al día y un `insoluto-3` invisible pasaba limpio: el
 * insoluto no tiene número de SIFCO, así que nunca entraba al `inArray` y el
 * veredicto se armaba sobre la mitad buena de su cartera. Lo mismo con los
 * `CRM-<uuid>`.
 *
 * El puente es `usuario_id`: los insolutos y los créditos del CRM cuelgan del
 * MISMO usuario que el crédito visible (`createCredit.ts` los inserta con el
 * `usuario_id` del usuario resuelto), así que basta con UN crédito visible por
 * SIFCO para alcanzar a todos los invisibles del mismo dueño.
 *
 * Se fusiona por `credito_id` en vez de reemplazar: un crédito que empató por
 * número pero tiene `usuario_id` nulo se perdería si la segunda consulta
 * mandara sola. Y fusionar —en vez de concatenar— es lo que evita que el
 * crédito que está en las dos pasadas se cuente dos veces.
 */
export function fusionarCreditosPorId(
  ...grupos: ReadonlyArray<readonly FilaCreditoMora[]>
): FilaCreditoMora[] {
  const porId = new Map<number, FilaCreditoMora>();

  for (const grupo of grupos) {
    for (const fila of grupo) {
      porId.set(fila.credito_id, fila);
    }
  }

  return [...porId.values()];
}

export interface FuentesHistorialMora {
  /** `moras_historial`: el evento es su propio `tipo_evento`. */
  eventos: Array<{
    fecha: Date | string;
    monto_nuevo: string | number | null;
    tipo_evento: string;
    numeroCreditoSifco: string;
    /** Para rescatar el monto de la mora cerrada. Ver `montoDeMorasCerradas`. */
    mora_id?: number | null;
    monto_anterior?: string | number | null;
  }>;
  /** `moras_credito` con `activa = false`. */
  morasCerradas: Array<{
    fecha: Date | string;
    monto_mora: string | number | null;
    numeroCreditoSifco: string;
    mora_id?: number | null;
  }>;
  /** `convenios_pago`. */
  convenios: Array<{
    fecha_convenio: Date | string;
    monto_total_convenio: string | number | null;
    numeroCreditoSifco: string;
  }>;
}

/**
 * Cuánto debía cada mora cerrada JUSTO ANTES de que la apagaran, sacado de su
 * evento de DESACTIVACION.
 *
 * 🔴 `moras_credito.monto_mora` NO sirve para esto: `latefee.ts` pone
 * `monto_mora = "0"` en el mismo update que baja `activa` (ver las tres
 * desactivaciones del motor), así que toda MORA_CERRADA salía con monto 0 y el
 * asesor leía un historial de moras que nunca debieron nada. El monto real
 * sobrevive en `moras_historial.monto_anterior` del evento DESACTIVACION.
 *
 * Se queda con el ÚLTIMO evento por mora: una mora puede desactivarse y
 * reactivarse, y lo que cerró la fila es la última vez.
 *
 * ⚠️ Puede no haber evento, y entonces el monto queda en el 0 de la fila. El
 * caso conocido es el convenio: `paymentAgreement.ts` borra la mora activa sin
 * escribir en `moras_historial`. Ese historial no se pierde —viaja por la
 * fuente CONVENIO, que es la única evidencia que sobrevive— así que acá no hay
 * nada que inventar.
 */
export function montoDeMorasCerradas(
  eventos: ReadonlyArray<{
    fecha: Date | string;
    tipo_evento: string;
    mora_id?: number | null;
    monto_anterior?: string | number | null;
  }>
): Map<number, string> {
  const ultimo = new Map<number, { fecha: string; monto: string }>();

  for (const fila of eventos) {
    // La condonación individual también cierra la mora dejando monto_mora en
    // "0", pero su rastro va en un evento CONDONACION (latefee.ts ~1227), no
    // en DESACTIVACION: sin esta línea, la mora condonada salía cerrada en 0.
    if (
      fila.tipo_evento !== "DESACTIVACION" &&
      fila.tipo_evento !== "CONDONACION"
    )
      continue;
    if (fila.mora_id === null || fila.mora_id === undefined) continue;

    const fecha = aISO(fila.fecha);
    const previo = ultimo.get(fila.mora_id);
    if (previo && previo.fecha >= fecha) continue;

    ultimo.set(fila.mora_id, { fecha, monto: aMonto(fila.monto_anterior) });
  }

  return new Map([...ultimo].map(([moraId, { monto }]) => [moraId, monto]));
}

/**
 * Historial de mora compuesto, ordenado por fecha descendente.
 *
 * 🔴 El convenio NO es redundante con las tablas de mora: al crear un convenio,
 * `paymentAgreement.ts` hace DELETE de la mora activa y no escribe nada en
 * `moras_historial`. El crédito que cayó en mora → hizo convenio → lo terminó
 * no deja rastro en ninguna de las dos tablas de mora; el convenio es la única
 * evidencia que sobrevive. Borrar esta fuente hace desaparecer esos casos.
 *
 * ⚠️ Por eso mismo el convenio va con su propio evento "CONVENIO" y no como si
 * fuera una mora: un convenio se puede crear sin que haya mora activa, así que
 * su existencia no prueba que hubo mora.
 */
export function construirHistorialMora(
  fuentes: FuentesHistorialMora
): EventoHistorialMora[] {
  const montoDesactivada = montoDeMorasCerradas(fuentes.eventos);

  const eventos: EventoHistorialMora[] = [
    ...fuentes.eventos.map((fila) => ({
      fecha: aISO(fila.fecha),
      // En la CONDONACION el monto que importa es lo condonado: latefee deja
      // monto_nuevo en 0 y el original viaja en monto_anterior. Con
      // monto_nuevo, la fila decía "condonación de 0".
      monto: aMonto(
        fila.tipo_evento === "CONDONACION" && fila.monto_anterior != null
          ? fila.monto_anterior
          : fila.monto_nuevo
      ),
      numeroCreditoSifco: fila.numeroCreditoSifco,
      evento: fila.tipo_evento,
    })),
    ...fuentes.morasCerradas.map((fila) => ({
      fecha: aISO(fila.fecha),
      monto:
        (fila.mora_id !== null && fila.mora_id !== undefined
          ? montoDesactivada.get(fila.mora_id)
          : undefined) ?? aMonto(fila.monto_mora),
      numeroCreditoSifco: fila.numeroCreditoSifco,
      evento: "MORA_CERRADA",
    })),
    ...fuentes.convenios.map((fila) => ({
      fecha: aISO(fila.fecha_convenio),
      monto: aMonto(fila.monto_total_convenio),
      numeroCreditoSifco: fila.numeroCreditoSifco,
      evento: "CONVENIO",
    })),
  ];

  return eventos.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

/**
 * `cliente` es `null` cuando el crédito se encontró SIN ficha de SIFCO — el
 * caso del cliente cuyos créditos nacieron todos en el CRM y que llegó por los
 * números que el propio CRM aportó (ver `numerosCreditoConocidos`). El hallazgo
 * es real (`encontrado: true`) aunque el core no sepa quién es: el nombre es
 * presentación y el veredicto no depende de él.
 */
export function construirRespuesta(params: {
  cliente: ClienteConsultaMora | null;
  creditos: CreditoConsultaMora[];
  historialMora: EventoHistorialMora[];
  consultadoEn: Date;
}): RespuestaConsultaMora {
  const veredicto = construirVeredicto(params.creditos);

  return {
    encontrado: true,
    tieneMoraActiva: veredicto.tieneMoraActiva,
    puedeContinuar: veredicto.puedeContinuar,
    motivo: veredicto.motivo,
    cliente: params.cliente,
    creditos: params.creditos,
    historialMora: params.historialMora,
    consultadoEn: params.consultadoEn.toISOString(),
  };
}

/** Un DPI que no es cliente no tiene por qué ser rechazado. */
export function respuestaClienteNoEncontrado(
  consultadoEn: Date
): RespuestaConsultaMora {
  return {
    encontrado: false,
    tieneMoraActiva: false,
    puedeContinuar: true,
    motivo: "CLIENTE_NO_ENCONTRADO",
    cliente: null,
    creditos: [],
    historialMora: [],
    consultadoEn: consultadoEn.toISOString(),
  };
}

/**
 * Fail-closed: si SIFCO o la base no respondieron, no sabemos si hay mora. El
 * motivo es SERVICIO_NO_DISPONIBLE justamente para que el CRM no lo lea como
 * un "sin mora"; `tieneMoraActiva: false` acá significa "no consta", no "está al día".
 */
export function respuestaServicioNoDisponible(
  consultadoEn: Date
): RespuestaConsultaMora {
  return {
    encontrado: false,
    tieneMoraActiva: false,
    puedeContinuar: false,
    motivo: "SERVICIO_NO_DISPONIBLE",
    cliente: null,
    creditos: [],
    historialMora: [],
    consultadoEn: consultadoEn.toISOString(),
  };
}

/** Nombre desplegable del cliente tal como lo devuelve el core. */
export function nombreClienteSifco(cliente: {
  NombreJuridico?: string | null;
  PrimerNombre?: string | null;
  SegundoNombre?: string | null;
  PrimeApellido?: string | null;
  SegundoApellido?: string | null;
  ApellidoCasada?: string | null;
}): string {
  const juridico = (cliente.NombreJuridico ?? "").trim();
  if (juridico) return juridico;

  return [
    cliente.PrimerNombre,
    cliente.SegundoNombre,
    cliente.PrimeApellido,
    cliente.SegundoApellido,
    cliente.ApellidoCasada,
  ]
    .map((parte) => (parte ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Las fechas del historial llegan de columnas `timestamp` SIN zona
 * (`moras_historial.fecha`, `moras_credito.fecha`, `convenios_pago.fecha_convenio`)
 * y el driver las entrega como string desnudo ("2026-09-09 05:59:05.245566").
 * `new Date(...)` interpretaría ese string en la zona del PROCESO, así que bajo
 * TZ=America/Guatemala el historial salía corrido +6h —y con eso hasta cambiaba
 * el orden descendente de dos eventos cercanos a la medianoche—. Se usa el
 * helper canónico `aInstante`, que marca como UTC lo que no trae zona.
 */
function aISO(fecha: Date | string): string {
  const instante = aInstante(fecha);
  // `aInstante` solo devuelve null ante algo que la BD no debería producir. Se
  // conserva el comportamiento anterior (reventar) en lugar de inventar una
  // fecha: un evento de mora fechado en falso es peor que un error visible.
  return (instante ?? new Date(fecha as string)).toISOString();
}

function aMonto(monto: string | number | null | undefined): string {
  return monto === null || monto === undefined ? "0.00" : String(monto);
}
