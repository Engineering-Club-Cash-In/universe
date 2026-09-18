/**
 * Lógica pura de `POST /clientes/consulta-mora`: armado del veredicto y del
 * historial de mora. Sin acceso a base ni a SIFCO, para que el gate del CRM
 * quede cubierto por tests que corren siempre.
 */

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

/**
 * Las fichas de SIFCO que hay que consultar para un DPI.
 *
 * 🔴 NO alcanza con la primera. Un mismo DPI puede tener más de una ficha en el
 * core —persona natural y jurídica, o duplicados que nunca se unificaron— y los
 * créditos cuelgan de la ficha, no de la persona. Quedarse con la primera hacía
 * que un moroso con dos fichas pasara limpio cada vez que la primera estaba al
 * día: la mora de la segunda no se consultaba nunca.
 *
 * Se descartan las fichas sin código (no se les puede pedir préstamos) y las
 * que traen una identificación que no es la buscada: la búsqueda del core es
 * por identificación, pero es suya y no nuestra, y traer créditos ajenos al
 * veredicto bloquearía a quien no debe. La ficha SIN `NumeroIdentificacion` se
 * conserva —el core no siempre lo devuelve— porque descartarla sería volver al
 * falso negativo que este endpoint existe para evitar.
 */
export function fichasDelDpi<T extends FichaClienteSifco>(
  clientes: T[],
  dpi: string
): T[] {
  const buscado = normalizarIdentificacion(dpi);

  return clientes.filter((cliente) => {
    if (cliente.CodigoCliente === undefined || cliente.CodigoCliente === null) {
      return false;
    }

    const propia = (cliente.NumeroIdentificacion ?? "").trim();
    if (!propia) return true;

    return normalizarIdentificacion(propia) === buscado;
  });
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
  }>;
  /** `moras_credito` con `activa = false`. */
  morasCerradas: Array<{
    fecha: Date | string;
    monto_mora: string | number | null;
    numeroCreditoSifco: string;
  }>;
  /** `convenios_pago`. */
  convenios: Array<{
    fecha_convenio: Date | string;
    monto_total_convenio: string | number | null;
    numeroCreditoSifco: string;
  }>;
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
  const eventos: EventoHistorialMora[] = [
    ...fuentes.eventos.map((fila) => ({
      fecha: aISO(fila.fecha),
      monto: aMonto(fila.monto_nuevo),
      numeroCreditoSifco: fila.numeroCreditoSifco,
      evento: fila.tipo_evento,
    })),
    ...fuentes.morasCerradas.map((fila) => ({
      fecha: aISO(fila.fecha),
      monto: aMonto(fila.monto_mora),
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

function aISO(fecha: Date | string): string {
  return fecha instanceof Date ? fecha.toISOString() : new Date(fecha).toISOString();
}

function aMonto(monto: string | number | null | undefined): string {
  return monto === null || monto === undefined ? "0.00" : String(monto);
}
