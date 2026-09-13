import Big from "big.js";
import { STATUS_EXCLUIDOS_MORA } from "../constants/creditStatus";

type BigInput = number | string | Big;

/**
 * Veredicto de una regla de negocio: el `motivo` es el texto del 4xx.
 *
 * `status` existe porque no todo "no permitido" es lo mismo: negarle a un
 * ASESOR un rubro obligatorio es un problema de PERMISOS (403, cámbiese de
 * cuenta), mientras que negarlo por el estado del crédito es un choque de
 * negocio (409, el crédito no admite eso hoy). Quien conoce la regla decide el
 * código; el controlador sólo lo traduce. Sin `status` el default es 409, que
 * es lo que fue siempre este módulo.
 */
export type Veredicto = { permitido: boolean; motivo?: string; status?: number };

/**
 * Estados donde NO se crea NINGÚN rubro, ni obligatorio.
 *
 * Se deriva de `STATUS_EXCLUIDOS_MORA` para que la lista viva en un solo lugar
 * (si el cron de moras suma un estado, este módulo lo hereda), pero QUITANDO
 * `EN_CONVENIO`: son dos preguntas distintas.
 *
 * El cron excluye `EN_CONVENIO` porque un crédito en convenio no debe DEVENGAR
 * mora nueva — pero el crédito sigue VIVO, con cliente, carro y trámites que
 * cuestan plata (la tarjeta de circulación se vence igual). Bloquearle los
 * rubros obligatorios dejaría a Cartera sin forma de cobrar un gasto que ya
 * incurrió. Por eso al convenio sólo se le bloquean los rubros NO obligatorios
 * —los opcionales, que sí sería abusivo sumarle a alguien renegociando su
 * deuda— y eso se decide en `puedeCrearRubro`, no acá.
 *
 * Los otros cuatro sí son terminales: un INCOBRABLE, CANCELADO,
 * PENDIENTE_CANCELACION o CAIDO ya no admite deuda nueva de ninguna clase.
 */
export const STATUS_TERMINALES_RUBRO = STATUS_EXCLUIDOS_MORA.filter(
  (s) => s !== "EN_CONVENIO"
);

/**
 * ¿Se le puede crear este rubro al crédito?
 *
 * "Obligatorio" ya NO es una casilla del alta: es la naturaleza del TIPO de
 * cobro, definida una sola vez en el catálogo (`rubros_tipos.obligatorio`). Por
 * eso el parámetro se llama `tipoObligatorio` y llega leyendo el tipo, no el
 * body: quien crea el rubro elige el concepto, no si ese concepto es
 * obligatorio.
 *
 * La regla separa el cobro que Cartera YA pagó por el cliente (obligatorio: la
 * tarjeta de circulación, un traspaso) del que es opcional. El obligatorio pasa
 * en cualquier crédito vivo, incluso moroso o en convenio: negarlo no evita el
 * gasto, sólo lo vuelve incobrable — pero justamente por saltarse esos frenos
 * queda reservado al ADMIN (403), para que un asesor no pueda meterle deuda
 * nueva a un cliente atrasado con sólo elegir el tipo "correcto".
 *
 * El opcional, en cambio, lo cobra cualquiera con acceso al módulo, pero no se
 * le encima a un cliente que ya está atrasado — tres señales lo bloquean por
 * separado porque miden cosas distintas y ninguna implica a las otras: el
 * status MOROSO lo pone el cron por cuotas vencidas, EN_CONVENIO es una
 * renegociación en curso (que NO devenga mora, así que su monto será 0), y una
 * mora activa con saldo puede sobrevivir a un status que ya volvió a ACTIVO
 * tras ponerse al día.
 *
 * El ORDEN importa: el estado terminal se juzga primero porque es la negativa
 * que ningún rol levanta — decirle "necesita ser ADMIN" a quien pide un rubro
 * sobre un crédito CANCELADO lo mandaría a conseguir un permiso que tampoco le
 * va a servir.
 */
export const puedeCrearRubro = ({
  role,
  statusCredit,
  tipoObligatorio,
  moraActivaMonto,
}: {
  role?: string | null;
  statusCredit?: string | null;
  tipoObligatorio: boolean;
  moraActivaMonto?: BigInput | null;
}): Veredicto => {
  if (STATUS_TERMINALES_RUBRO.includes(statusCredit ?? "")) {
    return {
      permitido: false,
      motivo: `No se pueden crear rubros en un crédito ${statusCredit}.`,
    };
  }

  if (tipoObligatorio && role !== "ADMIN") {
    return {
      permitido: false,
      status: 403,
      motivo: "Solo un administrador puede registrar rubros obligatorios.",
    };
  }

  if (tipoObligatorio) return { permitido: true };

  if (statusCredit === "MOROSO") {
    return {
      permitido: false,
      motivo:
        "El crédito está MOROSO: solo se le pueden crear rubros obligatorios.",
    };
  }

  if (statusCredit === "EN_CONVENIO") {
    return {
      permitido: false,
      motivo:
        "El crédito está EN_CONVENIO: solo se le pueden crear rubros obligatorios.",
    };
  }

  if (new Big(moraActivaMonto ?? 0).gt(0)) {
    return {
      permitido: false,
      motivo:
        "El crédito tiene mora activa: solo se le pueden crear rubros obligatorios.",
    };
  }

  return { permitido: true };
};

/**
 * El monto en la escala EXACTA de la columna (`numeric(18,2)`).
 *
 * El redondeo ocurre acá y en ningún otro lado: los guards validaban el valor
 * crudo y el controlador redondeaba después, así que `monto: 0.004` pasaba el
 * "mayor a cero" y se guardaba "0.00" — el rubro de Q0 que ese guard existe
 * para impedir. Validar y guardar tienen que mirar el MISMO número.
 */
export const redondearMonto = (monto: BigInput): string =>
  new Big(monto).toFixed(2);

/**
 * Techo del monto de un rubro: Q99,999,999.99.
 *
 * La columna es `numeric(18,2)` —16 dígitos enteros—, así que sin tope un
 * `monto: 1e16` pasaba TODOS los guards de negocio y recién moría en el insert
 * con `numeric field overflow`: un 500 y un log de error por una entrada
 * inválida del cliente, que es un 4xx. El tope es MUY inferior al de la columna
 * a propósito: un rubro es un gasto por crédito (una tarjeta de circulación, un
 * traspaso), y cien millones de quetzales ya es varios órdenes de magnitud más
 * que cualquier cobro real — dejarlo pegado al límite físico de la columna
 * atraparía el overflow pero no el dedazo de quien escribe siete ceros de más.
 *
 * Es un `number` y no un string porque además alimenta el `maximum` del
 * esquema TypeBox del router, que es donde se corta la entrada malformada.
 */
export const MONTO_MAXIMO_RUBRO = 99999999.99;

/**
 * ¿Es un monto que un rubro puede cobrar?
 *
 * Un rubro ES una deuda a cobrar, así que el cero y el negativo no son montos
 * "raros": son otra cosa disfrazada de rubro. El de Q0 nace con saldo 0 pero
 * nunca lo abona nadie, así que queda activo para siempre ensuciando la ficha
 * y compitiendo por el disponible de cada pago sin consumir nada; el negativo
 * mete un saldo negativo, que es una devolución al cliente — un flujo distinto
 * que este módulo no hace ni sabe registrar.
 *
 * La regla es la misma al crear y al editar, y por eso vive acá y no duplicada
 * en cada endpoint: mientras sólo la aplicaba el front, `POST /rubros` con
 * `monto: 0` guardaba el rubro con 201.
 *
 * Se juzga el monto YA REDONDEADO a la escala de la columna: `0.004` no es "un
 * monto mayor a cero" sino un `"0.00"` a punto de guardarse.
 */
export const puedeUsarMonto = (monto: BigInput): Veredicto => {
  const valor = new Big(redondearMonto(monto));

  if (valor.lte(0)) {
    return {
      permitido: false,
      motivo: "El monto del rubro debe ser mayor a cero.",
    };
  }

  if (valor.gt(new Big(MONTO_MAXIMO_RUBRO))) {
    return {
      permitido: false,
      motivo: `El monto del rubro no puede superar Q${new Big(
        MONTO_MAXIMO_RUBRO
      ).toFixed(2)}.`,
    };
  }

  return { permitido: true };
};

/**
 * Origen del evento de historial según QUIÉN lo ejecuta.
 *
 * Estaba hardcodeado en `"admin"` desde cuando el módulo entero era ADMIN-only.
 * Al abrirle el alta al ASESOR, ese literal dejó de describir la realidad: el
 * historial de rubros existe justamente para responder "¿quién le cobró esto al
 * cliente?", y con todo marcado "admin" la pregunta "¿qué rubros dio de alta un
 * asesor?" no se puede contestar desde `rubros_historial`.
 *
 * El rol llega del TOKEN, nunca del body, y se compara EXACTO — igual que
 * `requireRole` en el router y que `puedeCrearRubro` acá mismo.
 *
 * Antes esta función normalizaba (trim + mayúsculas) justificándose en que "el
 * claim viene de dos emisores distintos", pero era la ÚNICA de las tres que lo
 * hacía, y la última de la cadena: un token con `" asesor "` recibe 403 en
 * `requireRole` y nunca llega a escribir historial. O sea que la tolerancia no
 * existía, sólo la aparentaba en el eslabón donde ya no servía.
 *
 * De las dos salidas posibles —normalizar en un solo lugar al leer el token y
 * comparar normalizado en todos, o no normalizar en ninguno— se eligió la
 * segunda: la primera AMPLÍA lo que hoy pasa el gate (un `"admin"` minúscula
 * que hoy recibe 403 empezaría a entrar) apoyándose en un supuesto sobre los
 * emisores que nadie verificó, y ampliar un control de acceso por comodidad de
 * grafía es exactamente lo que no se hace. Con esta decisión el comportamiento
 * observable no cambia y hay una sola regla en todo el módulo: el rol se
 * compara literal.
 *
 * Cualquier rol que no sea exactamente `"ASESOR"` cae en `admin`: el router
 * sólo deja pasar ADMIN y ASESOR, así que ese default cubre al ADMIN y deja el
 * valor histórico para un token raro — inventarle "asesor" sería peor, porque
 * ensuciaría justo la consulta que este módulo viene a habilitar.
 */
export const origenDeRole = (role?: string | null): "admin" | "asesor" =>
  role === "ASESOR" ? "asesor" : "admin";

/**
 * El texto tal como se va a GUARDAR: recortado.
 *
 * Vive acá y no inline en cada guard para que validar y guardar miren el mismo
 * string. Un `"   "` pasa el `minLength: 1` de TypeBox (mide 3 caracteres) y el
 * NOT NULL de la columna, pero no informa nada — y en un nombre de tipo es peor
 * que inútil: el índice único es sobre `lower(nombre)`, así que el blanco ocupa
 * el lugar para siempre y el siguiente intento recibe un 409 que miente.
 */
export const textoLimpio = (valor?: string | null): string =>
  String(valor ?? "").trim();

/**
 * ¿Puede esta persona escribir rubros?
 *
 * `usuario_id` sale de resolver el token contra `platform_users`, y un token
 * bien firmado con un email que no está en esa tabla lo deja en null. Guardar
 * igual —con `created_by`/`usuario_id` en NULL— no es "un dato faltante": el
 * historial de rubros ES la evidencia de quién le cobró qué al cliente, y una
 * fila sin autor no se puede auditar ni reclamar. Sin dueño no se escribe.
 */
export const puedeActuar = (usuario_id?: number | null): Veredicto => {
  if (!usuario_id) {
    return {
      permitido: false,
      motivo:
        "No se pudo identificar al usuario de la sesión; no se puede registrar la operación sin autor.",
    };
  }
  return { permitido: true };
};

/**
 * ¿Se puede anular este rubro?
 *
 * Anular es la salida para el rubro creado por error: no se puede borrar (su
 * historial es evidencia) ni editar a 0 (`puedeUsarMonto` lo rechaza, y con
 * razón: un rubro de Q0 no es un rubro), y mientras siga vivo el índice único
 * `rubros_uq_credito_tipo_vivo` impide crear el correcto de ese mismo tipo.
 * La anulación deja el saldo en 0 y marca `completado`, que es justo lo que
 * saca la fila del índice — SIN tocar `monto_original`, para que quede el
 * rastro de cuánto se había llegado a cobrar.
 *
 * Un rubro ya completado no se anula: o ya se anuló (y repetirlo sólo mete
 * ruido en el historial sin liberar nada, porque ya salió del índice) o el
 * cliente ya lo pagó, y ahí "dejar de cobrarlo" no tiene sentido — lo que
 * corresponde a un cobro ya pagado es una devolución, que es otro flujo.
 */
export const puedeAnularRubro = ({
  completado,
}: {
  completado: boolean;
}): Veredicto => {
  if (completado) {
    return {
      permitido: false,
      status: 409,
      motivo:
        "El rubro ya está completado (saldado o anulado): no hay nada que anular.",
    };
  }
  return { permitido: true };
};

/**
 * ¿Se puede editar este rubro?
 *
 * Un rubro anulado ya no se cobra a propósito: alguien decidió deliberadamente
 * dejar de cobrarlo, y esa decisión queda escrita en el historial como
 * evidencia. Editarlo (por ejemplo subirle el monto) lo revive sin que nadie
 * lo haya vuelto a dar de alta, y encima lo deja en un estado contradictorio:
 * `activo` vuelve a `true` mientras `anulado` sigue en `true`, dos hechos que
 * no pueden convivir. La anulación es DEFINITIVA — la salida para un cobro
 * anulado por error es crear el rubro de nuevo, no resucitar el viejo por la
 * puerta de la edición.
 *
 * Esta regla es SOLO sobre `anulado`, no sobre `completado`: un rubro saldado
 * por abono (no anulado) sí se sigue editando —`puedeEditarMonto` es quien
 * decide eso, subir el monto de uno saldado lo revive a propósito, y esa
 * conducta no cambia acá.
 */
export const puedeEditarRubro = ({ anulado }: { anulado: boolean }): Veredicto => {
  if (anulado) {
    return {
      permitido: false,
      status: 409,
      motivo: "El rubro está anulado: no se puede editar, hay que dar de alta uno nuevo si corresponde.",
    };
  }
  return { permitido: true };
};

/**
 * Qué evento de historial deja una edición — o null si no cambió nada.
 *
 * TODO cambio queda auditado, no sólo el de monto: `obligatorio` es justo el
 * campo del que depende `puedeCrearRubro`, así que sin fila se podía crear un
 * rubro obligatorio en un crédito MOROSO y voltearlo a opcional sin dejar
 * rastro. Cuando cambian monto y otros campos a la vez basta `edicion_monto`:
 * ya lleva montos y saldos anterior/nuevo, y partirlo en dos filas simultáneas
 * sólo haría ruido en la ficha.
 */
export const eventoDeEdicion = ({
  cambiaMonto,
  cambiaOtroCampo,
}: {
  cambiaMonto: boolean;
  cambiaOtroCampo: boolean;
}): "edicion_monto" | "edicion" | null => {
  if (cambiaMonto) return "edicion_monto";
  if (cambiaOtroCampo) return "edicion";
  return null;
};

/** Lo que el cliente ya abonó a este rubro: monto original − saldo pendiente. */
const abonadoAlRubro = ({
  montoOriginal,
  saldoPendiente,
}: {
  montoOriginal: BigInput;
  saldoPendiente: BigInput;
}): Big => new Big(montoOriginal).minus(new Big(saldoPendiente));

/**
 * ¿Se puede corregir el monto del rubro a `montoNuevo`?
 *
 * El piso NO es cero, es lo YA ABONADO: bajar el monto por debajo de eso
 * dejaría el rubro cobrando menos de lo que el cliente entregó, o sea un saldo
 * negativo que no existe como concepto (el rubro no devuelve plata; una
 * devolución es otro flujo). Por eso el borde `montoNuevo === abonado` SÍ se
 * permite: es la corrección legítima de "cóbrenle sólo lo que ya pagó" — deja
 * el saldo exactamente en 0 y el rubro se da por completado.
 *
 * El monto cero o negativo se rechaza aparte, delegando en `puedeUsarMonto`
 * (la misma regla que aplica el alta), porque no es un rubro: para dejar de
 * cobrar se anula el rubro, no se edita a 0 (así queda el rastro).
 */
export const puedeEditarMonto = ({
  montoOriginal,
  saldoPendiente,
  montoNuevo,
}: {
  montoOriginal: BigInput;
  saldoPendiente: BigInput;
  montoNuevo: BigInput;
}): Veredicto => {
  const montoValido = puedeUsarMonto(montoNuevo);
  if (!montoValido.permitido) return montoValido;

  // Redondeado, igual que en `puedeUsarMonto`: lo que se compara contra lo
  // abonado tiene que ser el número que va a quedar en la columna, si no el
  // veredicto habla de un monto que nunca se guardó.
  const nuevo = new Big(redondearMonto(montoNuevo));
  const abonado = abonadoAlRubro({ montoOriginal, saldoPendiente });
  if (nuevo.lt(abonado)) {
    return {
      permitido: false,
      motivo: `El monto no puede ser menor a lo ya abonado (Q${abonado.toFixed(
        2
      )}).`,
    };
  }

  return { permitido: true };
};

/**
 * Saldo que queda tras cambiar el monto: lo abonado se CONSERVA y el saldo se
 * recalcula contra el monto nuevo. Nunca negativo — `puedeEditarMonto` ya
 * rechaza el caso que lo produciría, pero el clamp se queda porque este cálculo
 * también corre en recálculos masivos donde los datos históricos pueden traer
 * un abonado mayor al monto (rubros editados antes de que existiera el guard).
 */
export const nuevoSaldoTrasEdicion = ({
  montoOriginal,
  saldoPendiente,
  montoNuevo,
}: {
  montoOriginal: BigInput;
  saldoPendiente: BigInput;
  montoNuevo: BigInput;
}): Big => {
  // Parte del monto REDONDEADO: el saldo se guarda junto al monto y derivarlo
  // del crudo los dejaría descuadrados por la fracción de centavo.
  const saldo = new Big(redondearMonto(montoNuevo)).minus(
    abonadoAlRubro({ montoOriginal, saldoPendiente })
  );
  return saldo.gt(0) ? saldo : new Big(0);
};

/**
 * Un rubro está completado cuando ya no queda saldo. `lte` y no `eq`: un
 * saldo negativo (sobre-abono de datos históricos) también está cobrado de
 * más, no pendiente.
 */
export const rubroCompletado = (saldoPendiente: BigInput): boolean =>
  new Big(saldoPendiente).lte(0);

// ===========================================================================
// FASE 2 — COBRO DE RUBROS EN EL FLUJO DE PAGOS
//
// El pago corre en DOS ETAPAS y estas reglas viven en la frontera entre ambas:
//
//   1. REGISTRAR (`POST /newPayment`): la boleta sólo ESCRIBE filas en
//      `pagos_credito` con `validationStatus: "pending"`. No mueve plata. Acá
//      el rubro se APARTA: se escribe un reclamo en `rubros_pagos` con
//      `aplicado = false` y `rubros.saldo_pendiente` NO se toca.
//   2. APLICAR (`/aplicar-pago`): contabilidad valida y recién ahí baja el
//      saldo del rubro. Regla del dueño del dominio: el saldo baja al APLICAR,
//      registrar sólo aparta.
//
// Todo lo decidible de ese flujo vive acá como función pura: el orden de
// consumo y el neteo contra las boletas hermanas son aritmética de negocio que
// se tiene que poder probar sin base de datos.
// ===========================================================================

/** Lo que hace falta saber de un rubro para ordenarlo en la cola de cobro. */
export type RubroOrdenable = {
  rubro_id: number;
  /** Del TIPO (`rubros_tipos.obligatorio`), no del rubro: ver `puedeCrearRubro`. */
  obligatorio: boolean;
  created_at: Date | string | null;
};

/**
 * La cola de cobro: OBLIGATORIOS primero, y dentro de cada grupo el más VIEJO
 * primero.
 *
 * Las dos mitades responden a cosas distintas. El obligatorio es plata que
 * Cartera YA desembolsó por el cliente (la tarjeta de circulación, un
 * traspaso): si la boleta no alcanza para todo, lo que tiene que quedar
 * pendiente es el cobro opcional, no el gasto ya incurrido. Y a igualdad de
 * naturaleza cobra primero el más viejo, que es el criterio con el que la
 * migración 0036 documentó `created_at` ("created_at define el orden de
 * consumo") y el único que no depende de en qué orden los devuelva Postgres.
 *
 * El desempate final por `rubro_id` existe porque dos rubros creados en la
 * misma transacción comparten `created_at` al microsegundo: sin él, el reparto
 * de una boleta que no alcanza para ambos dependería del plan de la consulta y
 * el mismo pago daría resultados distintos en dos corridas.
 *
 * Un `created_at` nulo (columna con DEFAULT, no NOT NULL) va al FINAL de su
 * grupo y no al principio: sin fecha no se puede afirmar que sea el más viejo,
 * y darle la prioridad máxima por un dato faltante sería inventarla.
 *
 * Devuelve un arreglo nuevo: el llamador suele tener la lista que salió de la
 * consulta y reordenarla en el lugar escondería el criterio.
 */
export const ordenarRubrosParaCobro = <T extends RubroOrdenable>(
  rubros: readonly T[]
): T[] => {
  const alMilis = (v: Date | string | null): number => {
    if (v === null || v === undefined) return Number.POSITIVE_INFINITY;
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };

  return [...rubros].sort((a, b) => {
    if (a.obligatorio !== b.obligatorio) return a.obligatorio ? -1 : 1;
    const fecha = alMilis(a.created_at) - alMilis(b.created_at);
    if (fecha !== 0) return fecha;
    return a.rubro_id - b.rubro_id;
  });
};

/**
 * Cuánto de este rubro puede cobrar la boleta EN VUELO: su saldo menos lo que
 * ya apartaron las boletas hermanas todavía sin aplicar.
 *
 * Es el mismo criterio que `registerPayment.ts` usa para las cuotas (el bloque
 * de `pagosHermanos` que alimenta `calcularSaldoNetoCuota`) y por la misma
 * razón: entre que una boleta se registra y contabilidad la valida pueden
 * entrar más boletas al mismo crédito, y como el registro NO baja el saldo del
 * rubro, las tres leerían el saldo completo y apartarían Q100 cada una contra
 * un rubro de Q100. Netear contra los reclamos vivos es lo que hace que la
 * suma de lo apartado nunca supere el saldo — y por lo tanto que el guard de
 * la aplicación (`puedeAplicarReclamo`) no tenga por qué dispararse nunca.
 *
 * Nunca negativo: un rubro sobre-reclamado por datos históricos es un rubro
 * sin disponible, no uno que devuelva plata.
 */
export const disponibleDeRubro = ({
  saldoPendiente,
  reclamadoVivo,
}: {
  saldoPendiente: BigInput;
  reclamadoVivo: BigInput;
}): Big => {
  const disponible = new Big(saldoPendiente).minus(new Big(reclamadoVivo ?? 0));
  return disponible.gt(0) ? disponible : new Big(0);
};

export type RubroCobrable = RubroOrdenable & {
  saldoPendiente: BigInput;
  /** Σ de los reclamos `aplicado = false` de OTRAS boletas vivas. */
  reclamadoVivo: BigInput;
};

export type RepartoRubros = {
  /** Un reclamo por rubro tocado, en el orden en que se cobraron. */
  cobros: { rubro_id: number; monto: string }[];
  /** Lo que la boleta le entrega a los rubros en total. */
  total: Big;
  /** Lo que le queda a la boleta para las cuotas. */
  disponibleRestante: Big;
};

/**
 * Reparte el disponible de la boleta entre los rubros vivos del crédito.
 *
 * Consume del disponible de cada rubro LO QUE ALCANCE —el abono parcial está
 * permitido, igual que en la mora—, y a diferencia del convenio lo consumido
 * SÍ se resta del disponible: el convenio sólo deja rastro de cuánto de la
 * boleta cuenta como catch-up, mientras que un rubro es un cobro aparte que de
 * verdad compite con las cuotas por la plata.
 *
 * Los montos salen ya redondeados a la escala de la columna (`numeric(18,2)`),
 * con el mismo `redondearMonto` que valida y guarda el resto del módulo: el
 * número que se resta del disponible tiene que ser exactamente el que se va a
 * escribir en `rubros_pagos.monto`, o el descuadre nace en el reparto.
 *
 * Un cobro de Q0 no se escribe: un reclamo vivo por cero congela la edición del
 * rubro (ver `puedeTocarRubroConReclamosVivos`) sin apartar nada.
 */
export const repartirEnRubros = ({
  disponible,
  rubros,
}: {
  disponible: BigInput;
  rubros: readonly RubroCobrable[];
}): RepartoRubros => {
  let restante = new Big(disponible ?? 0);
  const cobros: { rubro_id: number; monto: string }[] = [];
  let total = new Big(0);

  if (restante.lte(0)) {
    return { cobros, total, disponibleRestante: restante.gt(0) ? restante : new Big(0) };
  }

  for (const rubro of ordenarRubrosParaCobro(rubros)) {
    if (restante.lte(0)) break;

    const disponibleRubro = disponibleDeRubro({
      saldoPendiente: rubro.saldoPendiente,
      reclamadoVivo: rubro.reclamadoVivo,
    });
    if (disponibleRubro.lte(0)) continue;

    const cobro = new Big(
      redondearMonto(restante.lt(disponibleRubro) ? restante : disponibleRubro)
    );
    if (cobro.lte(0)) continue;

    cobros.push({ rubro_id: rubro.rubro_id, monto: cobro.toFixed(2) });
    total = total.plus(cobro);
    restante = restante.minus(cobro);
  }

  return { cobros, total, disponibleRestante: restante };
};

/**
 * ¿Se puede EDITAR o ANULAR este rubro, o hay una boleta registrada esperando a
 * contabilidad que ya apartó parte de su saldo?
 *
 * Este bloqueo es lo que vuelve imposible el descuadre que el guard de la
 * aplicación detecta: mientras exista un reclamo con `aplicado = false`, el
 * saldo del rubro está comprometido, y bajarle el monto (o anularlo, que lo
 * deja en 0) haría que al validar esa boleta el saldo ya no alcance para lo
 * apartado. Sin el bloqueo, la salida sería aplicar de menos —o sea perder
 * plata en silencio—; con él, el conflicto se ve ANTES, con las dos salidas
 * escritas en el mensaje: aplicar esa boleta o revertirla.
 *
 * Se rechaza TODA edición y no sólo la que baja el monto: el reclamo apartó
 * saldo de un rubro concreto, y cambiarle la descripción mientras una boleta
 * pendiente lo está cobrando también cambia lo único que el cliente puede leer
 * cuando reclame ese cargo.
 */
export const puedeTocarRubroConReclamosVivos = ({
  reclamos,
}: {
  reclamos: readonly { pago_id: number; monto: BigInput }[];
}): Veredicto => {
  if (reclamos.length === 0) return { permitido: true };

  const total = reclamos.reduce(
    (acc, r) => acc.plus(new Big(r.monto ?? 0)),
    new Big(0)
  );
  const pagos = reclamos.map((r) => `#${r.pago_id}`).join(", ");

  return {
    permitido: false,
    status: 409,
    motivo:
      `No se puede modificar el rubro: hay ${reclamos.length} boleta(s) registrada(s) ` +
      `(${pagos}) que ya apartaron Q${total.toFixed(2)} de su saldo y esperan a ` +
      `contabilidad. Aplique esa(s) boleta(s) o reviértala(s) y vuelva a intentar.`,
  };
};

/**
 * ¿El saldo del rubro alcanza para lo que la boleta apartó?
 *
 * Guard RUIDOSO a propósito: si no alcanza, la aplicación FALLA en vez de
 * abonar de menos. Por diseño esto no debería pasar nunca —el neteo contra los
 * reclamos hermanos (`disponibleDeRubro`) impide apartar de más y el bloqueo de
 * edición (`puedeTocarRubroConReclamosVivos`) impide que el saldo se achique por
 * debajo mientras el reclamo vive—, así que llegar acá significa que uno de los
 * dos falló. Aplicar el mínimo taparía el agujero justo donde se puede ver;
 * abortar la transacción deja el pago sin aplicar, el reclamo intacto y el caso
 * visible. Es la misma filosofía del gate de integridad de cuotas de
 * `registerPayment.ts`: mejor un 4xx/500 que un descuadre silencioso.
 */
export const puedeAplicarReclamo = ({
  rubro_id,
  saldoPendiente,
  montoApartado,
}: {
  rubro_id: number;
  saldoPendiente: BigInput;
  montoApartado: BigInput;
}): Veredicto => {
  const saldo = new Big(saldoPendiente ?? 0);
  const apartado = new Big(montoApartado ?? 0);

  if (saldo.lt(apartado)) {
    return {
      permitido: false,
      status: 409,
      motivo:
        `Inconsistencia de integridad: el rubro ${rubro_id} tiene saldo ` +
        `Q${saldo.toFixed(2)} pero esta boleta apartó Q${apartado.toFixed(2)}. ` +
        `El pago NO se aplica: revise si el rubro se editó o se anuló con la ` +
        `boleta ya registrada.`,
    };
  }

  return { permitido: true };
};

/**
 * ¿El saldo del rubro TODAVÍA alcanza para lo que esta boleta va a APARTAR?
 *
 * Hermano de `puedeAplicarReclamo`, pero una etapa antes: éste se pregunta al
 * ESCRIBIR el reclamo, aquél al aplicarlo. Existe porque entre las dos hay una
 * ventana real: `cobrarRubrosParaBoleta` calcula el reparto al principio de
 * `insertPayment`, con una lectura SIN bloqueo, y el reclamo se escribe recién
 * al final, después de todo el recorrido de cuotas. Un admin que corrija o
 * anule el rubro en esa ventana achica el saldo por debajo de un reparto ya
 * decidido, y sin este guard la boleta se registraba igual con un reclamo
 * imposible: el 409 saltaba días después, en la validación de contabilidad, y
 * como ese 409 aborta la transacción que aplica TODO el pago, se caía la boleta
 * entera (cuota sin cerrar, capital sin tocar, inversionistas sin repartir).
 *
 * Fallar acá es mucho mejor: el asesor lo ve en el momento, con la boleta
 * todavía en la mano, y reintentar recalcula el reparto contra el rubro ya
 * corregido. Por eso el motivo está escrito para él —sin jerga, diciendo qué
 * pasó y qué hacer— y no para quien lea un log.
 *
 * Se mide contra el DISPONIBLE (saldo − reclamos vivos de otras boletas), no
 * contra el saldo pelado: es el mismo número con el que `repartirEnRubros`
 * había decidido el cobro, así que el guard rechaza exactamente cuando el
 * reparto dejó de ser válido y no antes.
 */
export const puedeApartarReclamo = ({
  rubro_id,
  saldoPendiente,
  reclamadoVivo,
  montoApartado,
}: {
  rubro_id: number;
  saldoPendiente: BigInput;
  /** Σ de lo apartado por OTRAS boletas vivas y todavía sin aplicar. */
  reclamadoVivo: BigInput;
  montoApartado: BigInput;
}): Veredicto => {
  const disponible = disponibleDeRubro({ saldoPendiente, reclamadoVivo });
  const apartado = new Big(montoApartado ?? 0);

  if (disponible.lt(apartado)) {
    return {
      permitido: false,
      status: 409,
      motivo:
        `El cobro adicional #${rubro_id} cambió mientras se registraba esta ` +
        `boleta: ahora quedan Q${disponible.toFixed(2)} por cobrar y la boleta ` +
        `iba a apartar Q${apartado.toFixed(2)}. La boleta NO se registró. ` +
        `Vuelva a registrarla: el reparto se recalcula con el cobro ya corregido.`,
    };
  }

  return { permitido: true };
};

/**
 * El total cobrado en rubros se suma al campo `otros` de UNA sola fila de la
 * boleta, aunque la boleta escriba varias (cierre de una cuota + parcial de la
 * siguiente + abono a capital).
 *
 * Mismo problema y misma forma que `crearEstampadorPagoConvenio`: el cobro
 * ocurre una vez por boleta, pero `insertPayment` puede insertar N filas, y si
 * todas cargaran el monto el cliente vería el cargo repetido N veces en su
 * estado de cuenta y la reversa lo devolvería N veces. El estampador le entrega
 * el monto a la PRIMERA fila que lo pide y "0" a las demás.
 *
 * `pendiente()` es un peek NO consumidor: el loop de cuotas lo necesita para
 * decidir si una cuota que no absorbió nada puede saltarse
 * (`debeInsertarFilaParcialCuota`) sin quemar el sello en la consulta — una
 * boleta que SÓLO cobró rubros tiene que dejar su fila.
 */
export const crearEstampadorRubros = (total: BigInput | null | undefined) => {
  const monto = new Big(total ?? 0);
  let estampado = false;
  return Object.assign(
    (): string => {
      if (estampado || monto.lte(0)) return "0";
      estampado = true;
      return monto.toString();
    },
    {
      pendiente: (): string =>
        estampado || monto.lte(0) ? "0" : monto.toString(),
    }
  );
};
