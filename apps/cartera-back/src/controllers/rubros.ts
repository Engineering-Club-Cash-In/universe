/**
 * Rubros — cobros adicionales por crédito (tarjeta de circulación, traspaso…).
 *
 * Catálogo, alta y corrección manual (arriba), y el COBRO desde el flujo de
 * pagos (al final del archivo). El cobro respeta las dos etapas del pago:
 * registrar una boleta sólo APARTA saldo del rubro (`rubros_pagos` con
 * `aplicado = false`) y aplicarla es lo que de verdad lo baja — por eso la
 * corrección manual de un rubro con reclamos vivos se rechaza con 409 en vez
 * de dejar que el saldo se mueva por debajo de una boleta ya registrada.
 *
 * Las REGLAS de negocio no viven en este archivo: están en `rubrosPolicy.ts`
 * como funciones puras (qué crédito admite qué rubro, hasta dónde se puede
 * bajar un monto). Acá sólo se orquesta —leer la base, preguntarle a la policy,
 * escribir en una transacción— para que las reglas se puedan testear sin base
 * de datos y no se dupliquen cuando la fase 2 las necesite desde el cron.
 *
 * Toda la aritmética de dinero pasa por `Big`: los montos son `numeric(18,2)` y
 * un float haría que "abonado = monto − saldo" arrastre centavos fantasma.
 */

import Big from "big.js";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../database";
import {
  asesores,
  creditos,
  moras_credito,
  pagos_credito,
  platform_users,
  rubros,
  rubros_historial,
  rubros_pagos,
  rubros_tipos,
} from "../database/db";
import { withPaymentAdvisoryLock } from "../utils/paymentAdvisoryLock";
import {
  eventoDeEdicion,
  nuevoSaldoTrasEdicion,
  origenDeRole,
  puedeActuar,
  puedeAnularRubro,
  puedeApartarReclamo,
  puedeAplicarReclamo,
  puedeCrearRubro,
  puedeEditarMonto,
  puedeEditarRubro,
  puedeTocarRubroConReclamosVivos,
  puedeUsarMonto,
  redondearMonto,
  repartirEnRubros,
  rubroCompletado,
  saldoTrasReversaDeReclamo,
  textoLimpio,
} from "./rubrosPolicy";

/**
 * Quien ejecuta las consultas: la conexión normal o la transacción en curso.
 *
 * Existe para que los helpers de lectura se puedan llamar DENTRO de una
 * transacción. Leer con `db` mientras `tx` tiene la fila bloqueada es leer un
 * snapshot distinto al que se está por escribir, que es exactamente el bug que
 * el `FOR UPDATE` de `editarRubro` viene a cerrar.
 */
type Ejecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Error con código HTTP ya decidido. El router lo traduce tal cual: así el
 * "por qué" de un 409 lo redacta quien conoce la regla (la policy) y no un
 * catch genérico que lo aplastaría en 500.
 */
export class RubroError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "RubroError";
  }
}

/** Código de Postgres para violación de índice único. */
const PG_UNIQUE_VIOLATION = "23505";

const esViolacionUnica = (e: unknown): boolean =>
  (e as { code?: string })?.code === PG_UNIQUE_VIOLATION;

/**
 * `numeric(18,2)`: la base guarda string, no float.
 *
 * Es el `redondearMonto` de la policy, no un redondeo propio: los guards
 * validan exactamente el mismo número que acá se escribe. Si el redondeo
 * viviera en dos lados, un monto podría pasar la regla con un valor y guardarse
 * con otro (así entraba el rubro de Q0 con `monto: 0.004`).
 */
const aMonto = redondearMonto;

/**
 * El "ahora" de `updated_at`: el reloj de POSTGRES, no el de este proceso.
 *
 * `created_at` sale del `DEFAULT now()` de la columna, así que escribir
 * `updated_at` con un `new Date()` de JS mezclaba dos relojes en la misma fila
 * — y las columnas son `timestamp` SIN zona horaria, donde el driver manda el
 * Date como parámetro y este repo tiene un incidente documentado de
 * corrimiento de +6h por exactamente eso. Con un rubro editado, `updated_at`
 * quedaba seis horas en el futuro respecto de su `created_at` y de su propio
 * evento de historial, que sí usa el default de la base: el mismo cambio
 * fechado de dos maneras distintas. `now()` los deja en el mismo reloj.
 */
const SELLO_DE_TIEMPO = sql`now()`;

/**
 * Quién ejecuta la acción. Sale del TOKEN, nunca del body: el body lo escribe
 * el cliente y el historial de rubros es la evidencia de quién cobró qué.
 * El id directo del JWT es el camino normal; el fallback por email cubre los
 * tokens viejos que no lo traen (mismo patrón que `condonarMora`).
 */
export async function resolverUsuarioId({
  usuario_id,
  usuario_email,
}: {
  usuario_id?: number | null;
  usuario_email?: string | null;
}): Promise<number | null> {
  // El id del token NO se toma como bueno sin verificarlo: `created_by` y
  // `rubros_historial.usuario_id` son llaves foráneas a platform_users, así que
  // un id que no existe (token viejo de una cuenta borrada, o firmado con otro
  // payload) no daba un 403 sino un 500 crudo de violación de FK a mitad de la
  // transacción. Confirmarlo cuesta una consulta por escritura, y las
  // escrituras de rubros son raras.
  if (usuario_id) {
    const [porId] = await db
      .select({ id: platform_users.id })
      .from(platform_users)
      .where(eq(platform_users.id, usuario_id))
      .limit(1);

    if (porId) return porId.id;
    // El id no corresponde a ninguna cuenta viva; queda el email como respaldo.
  }

  if (!usuario_email) return null;

  const [user] = await db
    .select({ id: platform_users.id })
    .from(platform_users)
    .where(eq(platform_users.email, usuario_email))
    .limit(1);

  return user?.id ?? null;
}

/**
 * El id del autor o un 403 — nunca un null que se guarde igual.
 *
 * Un JWT bien firmado cuyo email no está en `platform_users` deja
 * `resolverUsuarioId` en null: la firma prueba que la sesión es legítima, no
 * que exista la persona detrás. Antes ese null entraba a la base tal cual y el
 * rubro quedaba sin `created_by` y el historial sin `usuario_id`, o sea un
 * cobro que nadie hizo. Es 403 y no 401 a propósito: el token vale, lo que
 * falta es la cuenta que respalde la escritura.
 */
function exigirUsuario(usuario_id?: number | null): number {
  const veredicto = puedeActuar(usuario_id);
  if (!veredicto.permitido) {
    // El `status` del veredicto manda, igual que en el resto de los call sites.
    // Acá el default es 403 y no 409 a propósito: el token vale, lo que falta
    // es la cuenta que respalde la escritura.
    throw new RubroError(
      veredicto.status ?? 403,
      veredicto.motivo ?? "Usuario no identificado."
    );
  }
  return usuario_id as number;
}

// ---------------------------------------------------------------------------
// Catálogo de tipos
// ---------------------------------------------------------------------------

export async function listarTipos({
  incluir_inactivos = false,
}: {
  incluir_inactivos?: boolean;
} = {}) {
  const q = db.select().from(rubros_tipos);
  const tipos = incluir_inactivos
    ? await q.orderBy(rubros_tipos.nombre)
    : await q.where(eq(rubros_tipos.activo, true)).orderBy(rubros_tipos.nombre);

  return tipos;
}

export async function crearTipo({
  nombre,
  descripcion,
  obligatorio = false,
  usuario_id,
}: {
  nombre: string;
  descripcion?: string | null;
  obligatorio?: boolean;
  usuario_id?: number | null;
}) {
  const autor = exigirUsuario(usuario_id);

  // Mismo criterio que la descripción del rubro: se juzga el texto YA
  // RECORTADO, que es el que se guarda. `"   "` pasa el `minLength: 1` de
  // TypeBox (mide 3 caracteres) y se guardaba como `""` — y como el índice
  // único es sobre `lower(nombre)`, ese blanco se quedaba con el lugar para
  // siempre y el segundo intento recibía un 409 diciendo que "ya existe un tipo
  // con ese nombre", que no explica nada de lo que realmente pasó.
  const nombreStr = textoLimpio(nombre);
  if (!nombreStr) {
    throw new RubroError(400, "El nombre del tipo de rubro es obligatorio.");
  }

  try {
    const [tipo] = await db
      .insert(rubros_tipos)
      .values({
        nombre: nombreStr,
        descripcion: descripcion ?? null,
        obligatorio,
        created_by: autor,
      })
      .returning();

    return tipo;
  } catch (e) {
    // El índice único es sobre `lower(nombre)` de los tipos ACTIVOS: dos tipos
    // "Tarjeta de circulación" harían ambiguo el catálogo del front.
    if (esViolacionUnica(e)) {
      throw new RubroError(409, "Ya existe un tipo de rubro activo con ese nombre.");
    }
    throw e;
  }
}

export async function actualizarTipo(
  tipo_id: number,
  patch: {
    nombre?: string;
    descripcion?: string | null;
    obligatorio?: boolean;
    activo?: boolean;
    // La tabla de tipos no guarda `updated_by`, así que el autor acá sólo sirve
    // de gate: quien no se pueda identificar tampoco toca el catálogo.
    usuario_id?: number | null;
  }
) {
  exigirUsuario(patch.usuario_id);

  const cambios: Record<string, unknown> = { updated_at: SELLO_DE_TIEMPO };
  // Vale igual que en el alta, y acá es peor dejarlo pasar: el PUT podía
  // blanquearle el nombre a un tipo YA EN USO, dejando sin etiqueta los rubros
  // que lo referencian. Omitir el campo sigue significando "no lo toques".
  if (patch.nombre !== undefined) {
    const nombreStr = textoLimpio(patch.nombre);
    if (!nombreStr) {
      throw new RubroError(400, "El nombre del tipo de rubro es obligatorio.");
    }
    cambios.nombre = nombreStr;
  }
  if (patch.descripcion !== undefined) cambios.descripcion = patch.descripcion;
  if (patch.obligatorio !== undefined) cambios.obligatorio = patch.obligatorio;
  if (patch.activo !== undefined) cambios.activo = patch.activo;

  try {
    /**
     * LEER y ESCRIBIR en la MISMA transacción, con la fila bloqueada.
     *
     * Antes la existencia se comprobaba con un `SELECT` suelto, fuera de
     * transacción y sin bloqueo, y el `UPDATE` venía después. Entre los dos
     * cabía el `DELETE` de un tipo sin usar: el UPDATE no tocaba ninguna fila,
     * `.returning()` devolvía vacío, y esta función retornaba `undefined`. El
     * router no distingue eso de un éxito —`return { success: true, tipo }`—,
     * así que la pantalla daba por guardado el cambio sobre un tipo que ya no
     * existía, sin error ni aviso.
     *
     * Con el `FOR UPDATE` el borrado espera a que esta transacción termine, y
     * cuando le toca ya no encuentra nada que borrar. Es el mismo patrón que
     * usan `editarRubro` y `anularRubro`.
     */
    return await db.transaction(async (tx) => {
      const [actual] = await tx
        .select({ tipo_id: rubros_tipos.tipo_id })
        .from(rubros_tipos)
        .where(eq(rubros_tipos.tipo_id, tipo_id))
        .limit(1)
        .for("update");

      if (!actual) throw new RubroError(404, "El tipo de rubro no existe.");

      const [tipo] = await tx
        .update(rubros_tipos)
        .set(cambios)
        .where(eq(rubros_tipos.tipo_id, tipo_id))
        .returning();

      // Cinturón además del bloqueo: si por lo que sea el UPDATE no tocó la
      // fila, esto es un 404 y no un éxito mudo. Devolver `undefined` acá es
      // justo lo que hacía que el front creyera que guardó.
      if (!tipo) throw new RubroError(404, "El tipo de rubro no existe.");

      return tipo;
    });
  } catch (e) {
    if (e instanceof RubroError) throw e;
    if (esViolacionUnica(e)) {
      throw new RubroError(409, "Ya existe un tipo de rubro activo con ese nombre.");
    }
    throw e;
  }
}

/** Código de Postgres para violación de llave foránea. */
const PG_FK_VIOLATION = "23503";

const esViolacionFk = (e: unknown): boolean =>
  (e as { code?: string })?.code === PG_FK_VIOLATION;

/**
 * Borra un tipo del catálogo — DE VERDAD, y sólo si nadie lo usa.
 *
 * Es un borrado real y no un `activo = false` encubierto porque el catálogo se
 * ensucia: un tipo creado con el nombre mal escrito, o de prueba, que nunca se
 * le cobró a nadie, no tiene por qué quedar como fantasma desactivado. Pero en
 * cuanto EXISTE un rubro de ese tipo, el tipo dejó de ser una entrada de
 * catálogo y pasó a ser parte de la evidencia de un cobro: `rubros_historial`
 * cuelga de `rubros`, y `rubros` de `rubros_tipos`, así que borrarlo en cascada
 * se llevaría en silencio el historial de cobros de clientes reales — el
 * registro que este módulo existe para conservar. Por eso la FK es RESTRICT y
 * no CASCADE, y por eso la negativa es 409 con la salida escrita en el mensaje:
 * desactivar el tipo lo saca del catálogo para cobros NUEVOS sin tocar nada de
 * lo ya cobrado.
 *
 * El conteo y el DELETE van en la MISMA transacción con la fila del tipo
 * bloqueada: si no, un rubro creado entre el `count` y el `delete` haría que el
 * borrado sí se llevara historial. Igual se traduce la violación de FK, que es
 * la red que el motor tiende si algo se cuela por debajo del bloqueo.
 */
export async function eliminarTipo(
  tipo_id: number,
  { usuario_id }: { usuario_id?: number | null }
) {
  exigirUsuario(usuario_id);

  try {
    return await db.transaction(async (tx) => {
      const [tipo] = await tx
        .select({ tipo_id: rubros_tipos.tipo_id, nombre: rubros_tipos.nombre })
        .from(rubros_tipos)
        .where(eq(rubros_tipos.tipo_id, tipo_id))
        .limit(1)
        .for("update");

      if (!tipo) throw new RubroError(404, "El tipo de rubro no existe.");

      // Cuentan TODOS los rubros, no sólo los vivos: un rubro completado es
      // precisamente un cobro ya hecho, y su historial es lo que hay que
      // proteger.
      const [{ usos }] = await tx
        .select({ usos: count() })
        .from(rubros)
        .where(eq(rubros.tipo_id, tipo_id));

      if (Number(usos) > 0) {
        throw new RubroError(
          409,
          `No se puede borrar el tipo "${tipo.nombre}": ${usos} rubro(s) lo usan y borrarlo se llevaría su historial de cobros. Para sacarlo del catálogo sin perder nada, desactivalo (PUT /rubros/tipos/${tipo_id} con activo: false).`
        );
      }

      await tx.delete(rubros_tipos).where(eq(rubros_tipos.tipo_id, tipo_id));

      return { tipo_id: tipo.tipo_id, nombre: tipo.nombre };
    });
  } catch (e) {
    if (e instanceof RubroError) throw e;
    if (esViolacionFk(e)) {
      throw new RubroError(
        409,
        "No se puede borrar el tipo: hay rubros que lo usan y borrarlo se llevaría su historial de cobros. Desactivalo en vez de borrarlo."
      );
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Rubros de un crédito
// ---------------------------------------------------------------------------

/**
 * TODOS los rubros del crédito, activos e inactivos: la ficha muestra también
 * los ya completados, que son parte del historial de cobro del cliente — y la
 * única explicación de por qué se puede volver a crear un rubro del mismo tipo.
 *
 * `abonado` se deriva acá (monto_original − saldo_pendiente) en vez de en SQL
 * para que el cálculo pase por `Big` y salga con la misma escala que los otros
 * montos.
 */
export async function listarRubrosDeCredito(credito_id: number) {
  // Un crédito inexistente NO es una lista vacía: sin este chequeo, pedir los
  // rubros de un id equivocado responde 200 con [] y la pantalla dice "no hay
  // rubros" — indistinguible de un crédito que de verdad no tiene ninguno, que
  // es como se esconde un bug de enrutamiento en vez de verlo.
  const [credito] = await db
    .select({ credito_id: creditos.credito_id })
    .from(creditos)
    .where(eq(creditos.credito_id, credito_id))
    .limit(1);

  if (!credito) throw new RubroError(404, "El crédito no existe.");

  const filas = await db
    .select({
      rubro: rubros,
      tipo_nombre: rubros_tipos.nombre,
    })
    .from(rubros)
    .innerJoin(rubros_tipos, eq(rubros.tipo_id, rubros_tipos.tipo_id))
    .where(eq(rubros.credito_id, credito_id))
    .orderBy(desc(rubros.created_at));

  return filas.map(({ rubro, tipo_nombre }) => ({
    ...rubro,
    tipo_nombre,
    // El anulado es un caso aparte: `anularRubro` deja `saldo_pendiente = 0`
    // para sacarlo del índice de rubros vivos, pero ese cero significa "ya no
    // se cobra", no "ya se pagó" — son dos hechos distintos que la resta de
    // abajo colapsaría en el mismo número. En esta fase nada le abona todavía
    // a un rubro (el consumo del disponible llega en una fase posterior), así
    // que lo abonado real de un anulado siempre es 0.
    abonado: rubro.anulado
      ? aMonto(0)
      : aMonto(
          new Big(rubro.monto_original ?? 0).minus(new Big(rubro.saldo_pendiente ?? 0))
        ),
  }));
}

/**
 * Mora activa del crédito: la SUMA de las moras vivas, o "0" si no tiene.
 *
 * Suma en vez de tomar una fila porque las moras duplicadas son un hecho
 * documentado de esta base (el cron de moras corrió sin lock y dejó pares para
 * el mismo crédito). Con el `.limit(1)` SIN `ORDER BY` que había acá, Postgres
 * podía devolver cualquiera de las dos: si una quedó en 0 y la otra en 5,000,
 * la mitad de las veces el guard leía 0 y dejaba entrar un rubro OPCIONAL a un
 * crédito con mora viva — justo lo que la regla prohíbe, y de forma
 * intermitente, que es la peor manera de fallar. Sumar es fail-closed: cualquier
 * mora con saldo bloquea, sin importar cuántas filas la representen.
 */
async function moraActivaMonto(
  credito_id: number,
  ejecutor: Ejecutor = db
): Promise<string | null> {
  const [mora] = await ejecutor
    .select({
      // COALESCE porque `sum()` de cero filas es NULL, no 0, y ese NULL
      // atravesaba el `?? 0` de la policy igual que un "sin mora" legítimo —
      // pero mejor que la ambigüedad viaje resuelta desde el SQL.
      monto: sql<string>`COALESCE(SUM(${moras_credito.monto_mora}), 0)`,
    })
    .from(moras_credito)
    .where(
      and(eq(moras_credito.credito_id, credito_id), eq(moras_credito.activa, true))
    );

  return mora?.monto ?? null;
}

export async function crearRubro({
  credito_id,
  tipo_id,
  monto,
  descripcion,
  motivo,
  role,
  usuario_id,
}: {
  credito_id: number;
  tipo_id: number;
  monto: number | string;
  descripcion?: string | null;
  motivo?: string | null;
  /** Rol del TOKEN (nunca del body): decide si puede cobrar un tipo obligatorio. */
  role?: string | null;
  usuario_id?: number | null;
}) {
  const autor = exigirUsuario(usuario_id);

  // La descripción es NOT NULL y con contenido real: el tipo dice QUÉ se cobra
  // ("tarjeta de circulación"), la descripción dice por qué en ESTE crédito, y
  // es lo único que el cliente puede leer cuando reclame el cargo. Un string de
  // espacios pasa el NOT NULL de la columna pero no informa nada, así que el
  // guard mira el texto ya recortado — el mismo que se guarda.
  const descripcionStr = textoLimpio(descripcion);
  if (!descripcionStr) {
    throw new RubroError(400, "La descripción del rubro es obligatoria.");
  }

  // Se redondea ANTES de validar y ese mismo string es el que se guarda: si el
  // guard mirara el crudo, `monto: 0.004` pasaría como "mayor a cero" y la fila
  // nacería en "0.00" y `completado`.
  const montoStr = aMonto(monto);

  const montoValido = puedeUsarMonto(montoStr);
  if (!montoValido.permitido) {
    throw new RubroError(
      montoValido.status ?? 409,
      montoValido.motivo ?? "Monto de rubro inválido."
    );
  }

  /**
   * El candado del CRÉDITO primero, la transacción después — el mismo orden
   * que `editarRubro`, `anularRubro` e `insertPayment`. Invertirlo (tomar la
   * fila y después pedir el lock) es lo que crearía el deadlock.
   *
   * `crearRubro` no lo tomaba: el alta era inofensiva frente a una boleta en
   * vuelo (el rubro nuevo simplemente no entra en el reparto de esa boleta), y
   * la unicidad de "un vivo por crédito+tipo" la garantizaba el índice
   * `rubros_uq_credito_tipo_vivo`. Ese índice se cayó en la migración 0038
   * —afirmaba una invariante permanente que el dominio no sostiene: tras una
   * reversa legítima existen DE VERDAD dos deudas del mismo concepto— y la
   * exclusividad se volvió una regla de ALTA, chequeada acá abajo. Un chequeo
   * "¿ya hay uno vivo?" seguido de un INSERT es exactamente el patrón que dos
   * altas simultáneas del mismo tipo atraviesan juntas: las dos leen "no hay
   * ninguno" y las dos entran. El candado es lo que las serializa, y es lo
   * único que el índice protegía de más.
   */
  try {
    return await withPaymentAdvisoryLock(credito_id, async () => {
    /**
     * LEER, DECIDIR Y ESCRIBIR van en la MISMA transacción, con la fila del
     * crédito bloqueada. Mismo patrón que `editarRubro`.
     *
     * Antes el status del crédito, el tipo y la mora se leían con `db` plano
     * ANTES de abrir la transacción: entre esa lectura y el INSERT cabía el
     * cron de moras marcando el crédito MOROSO, y el rubro OPCIONAL entraba
     * igual en un crédito moroso — exactamente lo que la política prohíbe, y
     * sólo bajo carrera, o sea invisible en pruebas y esporádico en producción.
     * Moverlas adentro no alcanza por sí solo (en READ COMMITTED cada consulta
     * ve el último commit, así que la ventana se achica pero no se cierra): el
     * `FOR UPDATE` sobre el crédito es lo que serializa esto contra quien
     * cambia su status, y lo tiene que soltar antes de que el cron lo toque.
     *
     * Rubro e historial siguen escribiéndose juntos o ninguno: un rubro sin su
     * evento de creación sería un cobro sin autor ni motivo.
     */
    return await db.transaction(async (tx) => {
      const [credito] = await tx
        .select({ statusCredit: creditos.statusCredit })
        .from(creditos)
        .where(eq(creditos.credito_id, credito_id))
        .limit(1)
        .for("update");

      if (!credito) throw new RubroError(404, "El crédito no existe.");

      // Se lee `obligatorio` y `activo`: la naturaleza del cobro vive en el
      // TIPO, no en el body — quien crea el rubro elige el concepto, no si ese
      // concepto se salta los frenos de mora.
      //
      // `FOR KEY SHARE` sobre esta fila: sin bloqueo, la lectura era plana y
      // corría en paralelo con el `FOR UPDATE` de `eliminarTipo` sobre el mismo
      // tipo. Si el borrado alcanzaba a contar CERO usos (todavía no existe
      // ningún rubro de ese tipo) mientras este alta ya había leído el tipo
      // como bueno, el borrado commiteaba y el INSERT de más abajo reventaba
      // contra la FK de `tipo_id` con un 500 — sobre una petición que era
      // válida cuando se hizo. `KEY SHARE` es la cerradura mínima que sirve:
      // no estorba a otro lector ni a otro alta del mismo tipo, pero bloquea
      // un DELETE (o un cambio de llave) sobre esta fila hasta que esta
      // transacción termine, así que el borrado queda esperando y cuando le
      // toca ya cuenta este rubro como uso y se rechaza solo con su propio 409.
      const [tipo] = await tx
        .select({
          tipo_id: rubros_tipos.tipo_id,
          obligatorio: rubros_tipos.obligatorio,
          activo: rubros_tipos.activo,
        })
        .from(rubros_tipos)
        .where(eq(rubros_tipos.tipo_id, tipo_id))
        .limit(1)
        .for("key share");

      if (!tipo) throw new RubroError(404, "El tipo de rubro no existe.");

      // Un tipo dado de baja NO es un 404: el tipo existe y su historial sigue
      // vivo en los rubros ya creados, así que responder "no existe" sería
      // mentira y mandaría a buscar un bug de datos. Es un 409 —el catálogo ya
      // no ofrece ese concepto para cobros NUEVOS—, y el mensaje lo dice para
      // que el front sepa que la salida es reactivar el tipo, no crear otro.
      if (!tipo.activo) {
        throw new RubroError(
          409,
          "El tipo de rubro está inactivo: no se pueden crear rubros nuevos de ese tipo."
        );
      }

      const veredicto = puedeCrearRubro({
        role,
        statusCredit: credito.statusCredit,
        tipoObligatorio: tipo.obligatorio,
        moraActivaMonto: await moraActivaMonto(credito_id, tx),
      });

      if (!veredicto.permitido) {
        throw new RubroError(
          veredicto.status ?? 409,
          veredicto.motivo ?? "No se puede crear el rubro."
        );
      }

      /**
       * UN SOLO RUBRO VIVO POR CRÉDITO Y TIPO — pero como regla de ALTA.
       *
       * Esto lo garantizaba el índice único parcial
       * `rubros_uq_credito_tipo_vivo`, que la migración 0038 eliminó: la base
       * afirmaba que dos cobros vivos del mismo concepto no pueden coexistir
       * NUNCA, y el dominio no lo sostiene. Cuando contabilidad anula la boleta
       * con que se pagó la tarjeta de circulación 2026, la reversa devuelve el
       * saldo de ese rubro y apaga su `completado`: ahí existen de verdad dos
       * deudas, la de 2026 que volvió y la de 2027 que ya se había cargado. El
       * índice lo leía como duplicado y hacía fallar la reversa entera con un
       * 500, dejando el pago atascado en `validated`.
       *
       * La regla que sí vale es más angosta: no se puede CREAR un segundo rubro
       * vivo del mismo tipo. Se juzga acá, adentro de la transacción y bajo el
       * advisory lock del crédito, que es lo que impide que dos altas
       * simultáneas lean las dos "no hay ninguno".
       *
       * `anulado` se excluye aparte de `completado` por prudencia, no porque
       * hoy haga falta: `anularRubro` deja la fila en `completado = true` y
       * `anulado = true` a la vez, así que el primer filtro ya la descarta. Pero
       * el que manda es el hecho —un cobro cancelado no bloquea el alta del
       * correcto— y no el flag que hoy lo acompaña.
       */
      const [vivo] = await tx
        .select({ rubro_id: rubros.rubro_id })
        .from(rubros)
        .where(
          and(
            eq(rubros.credito_id, credito_id),
            eq(rubros.tipo_id, tipo_id),
            eq(rubros.completado, false),
            eq(rubros.anulado, false)
          )
        )
        .limit(1);

      if (vivo) {
        // El MISMO texto que traducía la violación del índice: para quien está
        // del otro lado de la pantalla no cambió nada, y la salida sigue siendo
        // cobrar el rubro que ya existe, no crear un duplicado.
        throw new RubroError(
          409,
          "Este crédito ya tiene un rubro vivo de ese tipo."
        );
      }

      const [rubro] = await tx
        .insert(rubros)
        .values({
          credito_id,
          tipo_id,
          descripcion: descripcionStr,
          monto_original: montoStr,
          saldo_pendiente: montoStr,
          // Sin activación diferida: un rubro se cobra desde que se crea.
          activo: true,
          // Derivado del saldo, no hardcodeado: así el flag no puede contradecir
          // al saldo con el que nace el rubro.
          completado: rubroCompletado(montoStr),
          created_by: autor,
        })
        .returning();

      await tx.insert(rubros_historial).values({
        rubro_id: rubro.rubro_id,
        tipo_evento: "creacion",
        monto_nuevo: montoStr,
        saldo_nuevo: montoStr,
        usuario_id: autor,
        // Del ROL de quien ejecuta, no un literal: desde que el ASESOR puede
        // dar de alta rubros, un "admin" fijo acá volvía irrespondible desde
        // el historial la pregunta "¿qué rubros dio de alta un asesor?".
        origen: origenDeRole(role),
        motivo: textoLimpio(motivo) || null,
      });

      return rubro;
    });
  });
  } catch (e) {
    if (e instanceof RubroError) throw e;
    /**
     * NO hay catch de violación de unicidad, y su ausencia es deliberada.
     *
     * El que vivía acá traducía `rubros_uq_credito_tipo_vivo` a un 409, pero
     * ese índice ya no existe (migración 0038): la exclusividad pasó a ser el
     * chequeo explícito de más arriba, bajo el candado. De las dos tablas que
     * esta función escribe, `rubros` se quedó sin ningún índice único y
     * `rubros_historial` nunca tuvo otro que su PK serial, así que lo único
     * que podría dar un 23505 acá es una secuencia desincronizada — corrupción
     * de la base, que merece el 500 crudo y no un 409 diciéndole al usuario
     * "ya existe ese rubro" sobre algo que no tiene nada que ver.
     *
     * La FK de `tipo_id` sí sigue siendo un freno real: el `FOR KEY SHARE` de
     * arriba cierra la ventana con `eliminarTipo`, pero si algo se colara por
     * debajo (o mañana apareciera otra vía de borrado del tipo), sin esto el
     * asesor vería un 500 por una petición que era válida cuando la hizo.
     */
    if (esViolacionFk(e)) {
      throw new RubroError(
        409,
        "El tipo de rubro dejó de estar disponible mientras se creaba el cobro. Volvé a intentar eligiendo otro tipo."
      );
    }
    throw e;
  }
}


/**
 * A qué crédito pertenece el rubro — lectura previa y DELIBERADAMENTE sin
 * bloqueo, sólo para saber qué advisory lock tomar.
 *
 * `editarRubro` y `anularRubro` reciben `rubro_id`, pero el lock que serializa
 * los escritores del crédito (el mismo que toma `insertPayment`) se toma por
 * `credito_id`, así que hay que averiguarlo antes de poder pedirlo. Esta lectura
 * NO es la autoritativa: la que manda sigue siendo el `SELECT ... FOR UPDATE`
 * de adentro de la transacción. Y no hace falta que lo sea, porque el rubro no
 * cambia de crédito nunca: `credito_id` se escribe en el alta y ninguna ruta lo
 * toca. Lo único que puede pasar entre esta lectura y el lock es que el rubro
 * deje de existir, y ahí el 404 lo da igual la lectura de adentro.
 */
async function creditoDeRubro(rubro_id: number): Promise<number> {
  const [fila] = await db
    .select({ credito_id: rubros.credito_id })
    .from(rubros)
    .where(eq(rubros.rubro_id, rubro_id))
    .limit(1);

  if (!fila) throw new RubroError(404, "El rubro no existe.");
  return fila.credito_id;
}

export async function editarRubro(
  rubro_id: number,
  {
    monto,
    descripcion,
    motivo,
    role,
    usuario_id,
  }: {
    monto?: number | string;
    descripcion?: string | null;
    motivo?: string | null;
    /**
     * Rol del TOKEN: la política lo necesita al re-evaluar un alza de monto, y
     * de él sale el `origen` que queda en el historial.
     */
    role?: string | null;
    usuario_id?: number | null;
  }
) {
  const autor = exigirUsuario(usuario_id);

  /**
   * El motivo es obligatorio en TODA edición, no sólo cuando cambia el monto.
   *
   * Cambiar la descripción de un rubro cambia lo único que el cliente puede
   * leer cuando reclame el cargo, así que "por qué se editó" vale tanto como en
   * un ajuste de monto. Se juzga el texto YA RECORTADO —el mismo que se
   * guarda—, porque el front manda `motivo: ""` cuando el usuario no escribió
   * nada y un string de espacios deja el historial igual de mudo que un vacío.
   */
  const motivoStr = textoLimpio(motivo);
  if (!motivoStr) {
    throw new RubroError(400, "El motivo es obligatorio para editar el rubro.");
  }

  // Misma regla que el alta: la descripción es NOT NULL y con contenido. Sólo
  // se juzga si VINO en el patch — omitirla significa "no la toques", que es
  // distinto de mandarla vacía (eso sería borrar el único texto que le explica
  // el cargo al cliente, y además reventaría el NOT NULL con un 500).
  let descripcionStr: string | undefined;
  if (descripcion !== undefined) {
    descripcionStr = textoLimpio(descripcion);
    if (!descripcionStr) {
      throw new RubroError(400, "La descripción del rubro es obligatoria.");
    }
  }

  /**
   * La comparación es con `Big` y sobre el monto YA REDONDEADO, nunca con
   * strings: del body llega `500` y en la columna está `"500.00"`, que como
   * texto son distintos y como número son el mismo monto.
   */
  const montoPedido =
    monto === undefined || monto === null ? null : aMonto(monto);

  /**
   * 🔒 ADVISORY LOCK POR CRÉDITO — el mismo que toma `insertPayment`.
   *
   * El `FOR UPDATE` de acá abajo NO alcanza para serializar contra el registro
   * de una boleta, y por una razón de tiempos: `insertPayment` calcula el
   * reparto de rubros al principio (`cobrarRubrosParaBoleta`, lectura sin
   * bloqueo) y escribe los reclamos recién al final, después de todo el
   * recorrido de cuotas. En esa ventana ancha la fila del rubro está libre, así
   * que `puedeTocarRubroConReclamosVivos` la ve sin reclamos —el de la boleta
   * en vuelo todavía no existe— y deja pasar la edición. El reparto ya decidido
   * se escribía igual contra un saldo achicado, y el 409 aparecía días después
   * al validar, tumbando la boleta entera.
   *
   * ORDEN DE CANDADOS: primero el advisory lock, DESPUÉS la transacción con el
   * `FOR UPDATE`. Es exactamente el orden de `insertPayment`, y por eso no hay
   * deadlock: nadie toma la fila del rubro y después pide el lock del crédito.
   * Invertirlo sí lo crearía.
   *
   * `crearRubro` también lo toma desde que la unicidad de "un vivo por
   * crédito+tipo" dejó de ser un índice de la base (0038) y pasó a ser un
   * chequeo suyo: no por el saldo —crear un rubro durante la ventana sigue
   * siendo inofensivo, el rubro nuevo simplemente no entra en el reparto de esa
   * boleta— sino para que dos altas simultáneas del mismo tipo no lean las dos
   * "no hay ninguno". Todas toman el lock en el MISMO orden, y por eso siguen
   * sin poder deadlockear entre sí.
   */
  const credito_id = await creditoDeRubro(rubro_id);

  try {
    return await withPaymentAdvisoryLock(credito_id, async () => {
    /**
     * TODO —leer la fila, decidir y escribir— va en UNA transacción, con la
     * fila bloqueada por `FOR UPDATE`. Mismo patrón que `condonarMora`.
     *
     * Antes `actual` se leía con `db` plano y afuera: la decisión se tomaba
     * sobre un snapshot viejo y después se escribía un `saldo_pendiente`
     * ABSOLUTO derivado de esa lectura. Dos ediciones simultáneas se pisaban
     * (la segunda escribía el saldo calculado desde el monto que la primera ya
     * había cambiado), y cuando llegue la fase 2 el daño es peor: un abono que
     * cayera entre el SELECT y el UPDATE quedaba borrado, o sea deuda ya pagada
     * resucitada en la cara del cliente. Con el bloqueo, la segunda edición
     * espera y recalcula sobre el saldo real.
     */
    return await db.transaction(async (tx) => {
      const [actual] = await tx
        .select()
        .from(rubros)
        .where(eq(rubros.rubro_id, rubro_id))
        .limit(1)
        .for("update");

      if (!actual) throw new RubroError(404, "El rubro no existe.");

      // Se juzga ANTES que cualquier otra guarda de esta función: un rubro
      // anulado no admite ningún cambio, así que no tiene sentido calcular
      // "qué difiere" o "sube el monto" sobre una fila que de entrada se
      // rechaza. Editarlo lo reviviría (activo vuelve a true) mientras
      // `anulado` se queda en true, un estado que no puede existir.
      //
      // Va antes que el bloqueo por reclamos vivos de acá abajo por dos
      // razones. Se resuelve con la fila que el `FOR UPDATE` ya trajo, sin la
      // consulta extra que pide el otro; y sobre todo porque el mensaje del
      // otro —"aplique esa boleta o reviértala y vuelva a intentar"— promete
      // una salida que en un rubro anulado no existe: por mucho que se aplique
      // la boleta, el rubro va a seguir sin poder editarse. Un rubro anulado
      // no debería llegar a tener reclamos vivos (anular se bloquea si los
      // hay), así que en la práctica el orden casi nunca se nota; importa el
      // día que esa invariante se rompa.
      const veredictoAnulado = puedeEditarRubro({ anulado: actual.anulado });
      if (!veredictoAnulado.permitido) {
        throw new RubroError(
          veredictoAnulado.status ?? 409,
          veredictoAnulado.motivo ?? "No se puede editar el rubro."
        );
      }

      /**
       * El rubro con una boleta registrada encima está CONGELADO.
       *
       * Con la fila ya bloqueada por el `FOR UPDATE` de arriba: si hay algún
       * reclamo `aplicado = false`, hay una boleta que ya apartó parte de este
       * saldo y espera a contabilidad. Editarla ahora —aunque sea para
       * subirle el monto— es cambiar el cobro por debajo de un pago en vuelo:
       * si el monto baja, al validar esa boleta el saldo ya no alcanzaría y la
       * aplicación fallaría (o, peor, abonaría de menos). Este 409 es lo que
       * vuelve IMPOSIBLE ese descuadre, y por eso el guard ruidoso de
       * `aplicarRubrosDelPago` no debería dispararse nunca.
       *
       * Se rechaza ANTES de calcular si la edición cambia algo: la respuesta a
       * "este rubro está tomado" no depende de qué campo se quiso tocar, y
       * dejar pasar la edición que "no cambia nada" sólo haría que el front
       * descubra el bloqueo recién cuando el usuario sí cambie algo.
       */
      const veredictoReclamos = puedeTocarRubroConReclamosVivos({
        reclamos: await reclamosVivosDeRubro(rubro_id, tx),
      });
      if (!veredictoReclamos.permitido) {
        throw new RubroError(
          veredictoReclamos.status ?? 409,
          veredictoReclamos.motivo ?? "No se puede editar el rubro."
        );
      }

      // `updated_at` NO se pone acá: se agrega recién cuando ya se sabe que la
      // edición cambia algo. Si se inicializa el objeto con él, `cambios` nunca
      // está vacío y toda edición —incluso la que no cambia nada— termina en un
      // UPDATE.
      const cambios: Record<string, unknown> = {};
      if (descripcionStr !== undefined) cambios.descripcion = descripcionStr;

      /**
       * Se compara contra el VALOR ACTUAL, no contra "vino en el body": el
       * front manda el formulario completo, así que volver a guardar la ficha
       * sin tocar nada escribía un evento de auditoría por cada clic. Un
       * historial que crece sin que nada cambie es ruido que termina
       * escondiendo los cambios de verdad.
       */
      const difiere = (pedido: unknown, actualValor: unknown) =>
        pedido !== undefined && String(pedido ?? "") !== String(actualValor ?? "");

      // Lo único editable fuera del monto. `obligatorio` ya no vive en el rubro
      // sino en el tipo, así que no hay nada que voltear acá: cambiar la
      // naturaleza del cobro es editar el CATÁLOGO, no una fila suelta.
      const cambiaOtroCampo = difiere(cambios.descripcion, actual.descripcion);

      /**
       * El monto cambia cuando DIFIERE del guardado, no cuando viene en el
       * body: el modal del front manda siempre `monto`, así que medir presencia
       * convertía cada guardado en un "cambio de monto" y el historial se
       * llenaba de filas `edicion_monto` con `monto_anterior === monto_nuevo`.
       */
      const cambiaMonto =
        montoPedido !== null &&
        !new Big(montoPedido).eq(new Big(actual.monto_original));

      const subeMonto =
        montoPedido !== null &&
        new Big(montoPedido).gt(new Big(actual.monto_original));

      let saldoNuevo: string | null = null;
      if (cambiaMonto) {
        const veredicto = puedeEditarMonto({
          montoOriginal: actual.monto_original,
          saldoPendiente: actual.saldo_pendiente,
          montoNuevo: montoPedido!,
        });

        if (!veredicto.permitido) {
          // El `status` del veredicto manda: la policy es quien sabe si el
          // rechazo es de permisos o de negocio, y aplastarlo en 409 fijo le
          // mentía al front sobre qué hacer con el error.
          throw new RubroError(
            veredicto.status ?? 409,
            veredicto.motivo ?? "No se puede editar el monto."
          );
        }

        saldoNuevo = aMonto(
          nuevoSaldoTrasEdicion({
            montoOriginal: actual.monto_original,
            saldoPendiente: actual.saldo_pendiente,
            montoNuevo: montoPedido!,
          })
        );

        cambios.monto_original = montoPedido;
        cambios.saldo_pendiente = saldoNuevo;
        cambios.completado = rubroCompletado(saldoNuevo);

        /**
         * REVIVIR un rubro saldado también está sujeto a la exclusividad.
         *
         * Subirle el monto a un rubro que estaba en cero lo devuelve a la vida
         * (`completado` vuelve a false). Hasta la migración 0038 eso chocaba
         * contra `rubros_uq_credito_tipo_vivo` y salía como 409; al quitar el
         * índice, el choque dejó de existir y esta puerta quedó abierta: se
         * podían terminar con dos rubros vivos del mismo concepto sin que nadie
         * lo mirara.
         *
         * Se chequea acá y no en cualquier edición porque sólo esta revive. Y
         * la regla es la misma del alta —y por la misma razón—: dos cobros
         * vivos del mismo concepto en un crédito son un error de captura, y la
         * salida es cobrar el que ya existe, no duplicarlo.
         *
         * Ojo con lo que NO cubre, que es deliberado: la RESTITUCIÓN de saldo
         * que hacen la reversa y la desaplicación sí puede dejar dos vivos del
         * mismo tipo, y está bien que lo haga. Ahí no hay nadie capturando un
         * cobro: el sistema está deshaciendo lo suyo, y las dos deudas que
         * quedan son reales (la del año pasado que volvió y la de este año).
         * Esa distinción —persona que captura vs sistema que deshace— es toda
         * la diferencia entre las dos situaciones.
         */
        if (!rubroCompletado(saldoNuevo) && actual.completado) {
          const [otroVivo] = await tx
            .select({ rubro_id: rubros.rubro_id })
            .from(rubros)
            .where(
              and(
                eq(rubros.credito_id, actual.credito_id),
                eq(rubros.tipo_id, actual.tipo_id),
                eq(rubros.completado, false),
                eq(rubros.anulado, false)
              )
            )
            .limit(1);

          if (otroVivo) {
            throw new RubroError(
              409,
              "Este crédito ya tiene un rubro vivo de ese tipo."
            );
          }
        }
      }

      /**
       * La política del alta se RE-APLICA cuando la edición SUBE el monto: sin
       * esto se le podía subir el monto a un rubro de un crédito terminal, o
       * sea crearle deuda nueva por la puerta de atrás — exactamente lo que el
       * POST rechaza.
       *
       * BAJAR el monto NO pasa por acá a propósito, ni siquiera en un crédito
       * CANCELADO o INCOBRABLE: corregir hacia abajo no endeuda a nadie, y
       * "cóbrenle sólo lo que ya pagó" tiene que seguir siendo posible
       * justamente en los créditos terminados. Por eso el gate mira `subeMonto`
       * y no `cambiaMonto`.
       */
      if (subeMonto) {
        const [credito] = await tx
          .select({ statusCredit: creditos.statusCredit })
          .from(creditos)
          .where(eq(creditos.credito_id, actual.credito_id))
          .limit(1);

        // Se lee `activo` además de `obligatorio`, y por la misma razón que lo
        // lee el alta: subir el monto CREA DEUDA NUEVA. Sin esto, retirar un
        // tipo del catálogo (`activo: false`) frenaba el `POST /rubros` con
        // 409 pero dejaba pasar con 200 un alza sobre un rubro existente de ese
        // tipo — la misma deuda nueva de un concepto retirado, por la puerta
        // de al lado.
        const [tipo] = await tx
          .select({
            obligatorio: rubros_tipos.obligatorio,
            activo: rubros_tipos.activo,
          })
          .from(rubros_tipos)
          .where(eq(rubros_tipos.tipo_id, actual.tipo_id))
          .limit(1);

        if (tipo && !tipo.activo) {
          throw new RubroError(
            409,
            "El tipo de rubro está inactivo: no se puede aumentar el monto de un rubro de ese tipo."
          );
        }

        const veredicto = puedeCrearRubro({
          role,
          statusCredit: credito?.statusCredit,
          tipoObligatorio: tipo?.obligatorio ?? false,
          moraActivaMonto: await moraActivaMonto(actual.credito_id, tx),
        });

        if (!veredicto.permitido) {
          throw new RubroError(
            veredicto.status ?? 409,
            veredicto.motivo ?? "No se puede editar el rubro."
          );
        }
      }

      /**
       * `activo` se DERIVA del saldo, no se apaga a mano. Antes sólo existía la
       * rama que lo ponía en false al completarse: un rubro completado (saldo 0,
       * activo false) al que se le subía el monto quedaba con saldo vivo y
       * `activo = false`, y la fase 2 —que recorre por el índice
       * `(credito_id, activo)`— no lo cobraba nunca. Sin activación programada
       * la regla es directa: está activo mientras le quede saldo.
       */
      if (cambiaMonto) {
        // Se mira el SALDO resultante y no el flag `completado` guardado, para
        // que una fila vieja con el flag contradiciendo su saldo no arrastre el
        // error.
        const saldoResultante = saldoNuevo ?? actual.saldo_pendiente;
        cambios.activo = !rubroCompletado(saldoResultante);
      }

      const tipo_evento = eventoDeEdicion({ cambiaMonto, cambiaOtroCampo });

      /**
       * Una edición que no cambia NADA no escribe NADA: se devuelve la fila tal
       * como está.
       *
       * El front manda el formulario completo, así que volver a guardar la
       * ficha sin tocar un campo llegaba acá con `descripcion` y `monto`
       * idénticos a los guardados. El historial ya estaba a salvo (sin evento
       * si nada difiere), pero el UPDATE corría igual y movía `updated_at`: la
       * ficha decía "modificado hace un minuto" por un clic que no modificó
       * nada, y ese campo es lo primero que se mira al reconstruir qué le pasó
       * a un cobro. Sin evento no hay cambio, y sin cambio no hay escritura.
       */
      if (!tipo_evento) return actual;

      cambios.updated_at = SELLO_DE_TIEMPO;

      const [rubro] = await tx
        .update(rubros)
        .set(cambios)
        .where(eq(rubros.rubro_id, rubro_id))
        .returning();

      // Ningún cambio se guarda sin su fila de historial —y ya no hace falta
      // preguntar si hay evento: sin evento la función ya salió sin escribir—.
      // El evento `edicion` no lleva montos porque no los toca; su valor es
      // dejar constancia de que alguien identificado editó el rubro y por qué.
      await tx.insert(rubros_historial).values({
        rubro_id,
        tipo_evento,
        ...(cambiaMonto
          ? {
              monto_anterior: actual.monto_original,
              monto_nuevo: montoPedido,
              saldo_anterior: actual.saldo_pendiente,
              saldo_nuevo: saldoNuevo,
            }
          : {}),
        usuario_id: autor,
        origen: origenDeRole(role),
        motivo: motivoStr,
      });

      return rubro;
      });
    });
  } catch (e) {
    if (e instanceof RubroError) throw e;
    // Subirle el monto a un rubro YA SALDADO lo revive (`completado` vuelve a
    // false) y ahí puede chocar con el rubro vivo que se creó mientras tanto
    // para ese mismo crédito y tipo. Es el mismo choque de negocio que en el
    // alta, no una caída del servidor.
    if (esViolacionUnica(e)) {
      throw new RubroError(
        409,
        "Este crédito ya tiene un rubro vivo de ese tipo."
      );
    }
    throw e;
  }
}

/**
 * Anula un rubro: deja de cobrarse, pero NO desaparece.
 *
 * Es la única salida para el cobro cargado por error, y hasta ahora no existía:
 * no hay DELETE (el historial de un cobro es evidencia y `rubros_historial`
 * cuelga de la fila), editarlo a 0 lo rechaza `puedeUsarMonto` —con razón: un
 * rubro de Q0 no es un rubro—, y `completado` sólo se enciende con un abono,
 * que es fase 2 y todavía no existe. Mientras tanto la exclusividad por
 * crédito+tipo impide crear el rubro CORRECTO de ese mismo tipo, así que un
 * dedazo dejaba el crédito bloqueado para ese concepto para siempre y la única
 * salida era un UPDATE a mano en producción. (Esa exclusividad era el índice
 * único `rubros_uq_credito_tipo_vivo` hasta la migración 0038; hoy es el
 * chequeo de `crearRubro`. Para esta función da igual: lo que la justifica es
 * que el tipo quede bloqueado, no quién lo bloquea.)
 *
 * Qué hace: `saldo_pendiente = 0` (ya no se cobra), `completado = true` (libera
 * el tipo para el cobro del año siguiente) y `activo = false` (el barrido de la fase
 * 2 no lo mira). `monto_original` NO se toca a propósito: es el rastro de
 * cuánto se había llegado a cobrar, y ponerlo en 0 borraría la evidencia del
 * error que la anulación viene a documentar. El evento `anulacion` del
 * historial guarda el saldo anterior y el motivo obligatorio.
 *
 * Sólo ADMIN (lo gatea el router): anular libera el tipo y cierra un cobro,
 * que es la misma clase de decisión que corregir un monto ya cobrado.
 */
export async function anularRubro(
  rubro_id: number,
  {
    motivo,
    role,
    usuario_id,
  }: {
    motivo?: string | null;
    /** Rol del TOKEN: de él sale el `origen` que queda en el historial. */
    role?: string | null;
    usuario_id?: number | null;
  }
) {
  const autor = exigirUsuario(usuario_id);

  // Obligatorio y con contenido real, igual que en la edición: la anulación
  // borra un cobro de la cuenta del cliente y "por qué" es lo único que después
  // explica el hueco. Se juzga el texto ya recortado, que es el que se guarda.
  const motivoStr = textoLimpio(motivo);
  if (!motivoStr) {
    throw new RubroError(400, "El motivo es obligatorio para anular el rubro.");
  }

  // 🔒 Advisory lock por crédito ANTES de la transacción, por la misma razón y
  // en el mismo orden que `editarRubro` (ver el comentario largo allá). Acá
  // pesa todavía más: anular deja el saldo en 0, así que colarse en la ventana
  // del registro de una boleta garantiza que el reclamo que esa boleta escriba
  // sea inaplicable.
  const credito_id = await creditoDeRubro(rubro_id);

  // Leer, decidir y escribir en UNA transacción con la fila bloqueada, igual
  // que `editarRubro`: sin el `FOR UPDATE`, dos anulaciones simultáneas —o una
  // anulación contra un abono de la fase 2— escribirían dos eventos sobre el
  // mismo saldo leído.
  return await withPaymentAdvisoryLock(credito_id, async () =>
    db.transaction(async (tx) => {
    const [actual] = await tx
      .select()
      .from(rubros)
      .where(eq(rubros.rubro_id, rubro_id))
      .limit(1)
      .for("update");

    if (!actual) throw new RubroError(404, "El rubro no existe.");

    // Mismo bloqueo que la edición, y acá es todavía más claro: anular deja el
    // saldo en 0, así que hacerlo con una boleta registrada encima garantiza
    // que al validarla el saldo no alcance. Primero se resuelve esa boleta
    // —aplicándola o revirtiéndola—, después se anula el rubro.
    const veredictoReclamos = puedeTocarRubroConReclamosVivos({
      reclamos: await reclamosVivosDeRubro(rubro_id, tx),
    });
    if (!veredictoReclamos.permitido) {
      throw new RubroError(
        veredictoReclamos.status ?? 409,
        veredictoReclamos.motivo ?? "No se puede anular el rubro."
      );
    }

    const veredicto = puedeAnularRubro({ completado: actual.completado });
    if (!veredicto.permitido) {
      throw new RubroError(
        veredicto.status ?? 409,
        veredicto.motivo ?? "No se puede anular el rubro."
      );
    }

    const [rubro] = await tx
      .update(rubros)
      .set({
        saldo_pendiente: aMonto(0),
        completado: true,
        activo: false,
        anulado: true,
        updated_at: SELLO_DE_TIEMPO,
      })
      .where(eq(rubros.rubro_id, rubro_id))
      .returning();

    await tx.insert(rubros_historial).values({
      rubro_id,
      tipo_evento: "anulacion",
      // El monto NO cambia, así que no se registra un "monto nuevo" que sería
      // mentira. Lo que cambia —y lo que hay que poder reconstruir— es el
      // saldo que dejó de cobrarse.
      saldo_anterior: actual.saldo_pendiente,
      saldo_nuevo: aMonto(0),
      usuario_id: autor,
      origen: origenDeRole(role),
      motivo: motivoStr,
    });

      return rubro;
    })
  );
}

/**
 * Historial del rubro, del evento más reciente al más viejo, CON el autor
 * resuelto.
 *
 * El `usuario_id` crudo no sirve para lo que este historial existe: la pregunta
 * real es "¿quién le cobró esto al cliente?", y responderla con un número
 * obliga a ir a consultar la base a mano. Por eso el join.
 *
 * Se devuelven `usuario_email` y `usuario_nombre` porque ninguno alcanza solo:
 * `platform_users` no guarda nombre (solo email y el rol), y el nombre vive en
 * `asesores`, ligado por `asesor_id` — que las cuentas ADMIN no tienen. Para un
 * evento de un ADMIN el nombre viene null y el email ES la identidad; para uno
 * de un ASESOR viene el nombre (y el `origen` de la fila ya dice cuál de los
 * dos fue, sin depender del join). El `leftJoin` (y no `innerJoin`) es
 * deliberado en los dos casos: un evento del job de la fase 2 no tendrá autor,
 * y perder la fila del historial por eso sería peor que mostrarla sin nombre.
 */
export async function listarHistorial(rubro_id: number) {
  const [rubro] = await db
    .select({ rubro_id: rubros.rubro_id })
    .from(rubros)
    .where(eq(rubros.rubro_id, rubro_id))
    .limit(1);

  if (!rubro) throw new RubroError(404, "El rubro no existe.");

  const filas = await db
    .select({
      evento: rubros_historial,
      usuario_email: platform_users.email,
      usuario_nombre: asesores.nombre,
    })
    .from(rubros_historial)
    .leftJoin(platform_users, eq(rubros_historial.usuario_id, platform_users.id))
    .leftJoin(asesores, eq(platform_users.asesor_id, asesores.asesor_id))
    .where(eq(rubros_historial.rubro_id, rubro_id))
    .orderBy(desc(rubros_historial.created_at));

  return filas.map(({ evento, usuario_email, usuario_nombre }) => ({
    ...evento,
    usuario_email: usuario_email ?? null,
    usuario_nombre: usuario_nombre ?? null,
  }));
}

// ---------------------------------------------------------------------------
// FASE 2 — COBRO DE RUBROS EN EL FLUJO DE PAGOS
//
// El pago corre en DOS ETAPAS y este bloque vive en las dos:
//
//   REGISTRAR (`insertPayment`)  → `cobrarRubrosParaBoleta` calcula el reparto
//                                  y `registrarReclamosDeRubros` lo escribe en
//                                  `rubros_pagos` con `aplicado = false`. NO se
//                                  toca `rubros.saldo_pendiente`: registrar
//                                  sólo APARTA.
//   APLICAR (`/aplicar-pago`)    → `aplicarRubrosDelPago` baja el saldo, marca
//                                  el reclamo y escribe el historial.
//   REVERTIR (`reversePayment`)  → `revertirRubrosDelPago` devuelve lo aplicado
//                                  y suelta el reclamo.
//
// Las reglas decidibles (orden de cobro, neteo contra hermanos, guards) están
// en `rubrosPolicy.ts` como funciones puras; acá sólo se lee la base, se le
// pregunta a la policy y se escribe.
// ---------------------------------------------------------------------------

/**
 * Σ de lo APARTADO y todavía sin aplicar por las boletas VIVAS, por rubro.
 *
 * "Vivas" = `paymentFalse = false`, exactamente el mismo filtro con el que
 * `registerPayment.ts` arma su set de `pagosHermanos` para netear el saldo de
 * una cuota. Una boleta anulada dejó de ser un reclamo sobre la plata del
 * cliente, y contarla seguiría restando disponible del rubro —y congelando su
 * edición— por un pago que ya no existe.
 *
 * Es la consulta que responde "¿este rubro tiene reclamos vivos?", y por eso la
 * migración 0037 le puso el índice `(rubro_id, aplicado)`.
 */
export async function reclamosVivosDeRubros(
  rubroIds: number[],
  ejecutor: Ejecutor = db
): Promise<Map<number, { pago_id: number; monto: string }[]>> {
  const porRubro = new Map<number, { pago_id: number; monto: string }[]>();
  if (rubroIds.length === 0) return porRubro;

  const filas = await ejecutor
    .select({
      rubro_id: rubros_pagos.rubro_id,
      pago_id: rubros_pagos.pago_id,
      monto: rubros_pagos.monto,
    })
    .from(rubros_pagos)
    .innerJoin(pagos_credito, eq(rubros_pagos.pago_id, pagos_credito.pago_id))
    .where(
      and(
        inArray(rubros_pagos.rubro_id, rubroIds),
        eq(rubros_pagos.aplicado, false),
        eq(pagos_credito.paymentFalse, false)
      )
    );

  for (const fila of filas) {
    const previos = porRubro.get(fila.rubro_id) ?? [];
    previos.push({ pago_id: fila.pago_id, monto: fila.monto ?? "0" });
    porRubro.set(fila.rubro_id, previos);
  }
  return porRubro;
}

/**
 * Los reclamos vivos de UN rubro — lo que congela su edición.
 *
 * Exportado porque `editarRubro`/`anularRubro` lo consultan con la fila ya
 * bloqueada por `FOR UPDATE`: leer con `db` mientras `tx` la tiene tomada sería
 * decidir sobre un snapshot distinto al que se está por escribir.
 */
async function reclamosVivosDeRubro(
  rubro_id: number,
  ejecutor: Ejecutor = db
): Promise<{ pago_id: number; monto: string }[]> {
  const mapa = await reclamosVivosDeRubros([rubro_id], ejecutor);
  return mapa.get(rubro_id) ?? [];
}

/**
 * Qué rubros cobra esta boleta y por cuánto — SIN escribir nada.
 *
 * Se separa del INSERT porque en el registro el `pago_id` todavía no existe:
 * `insertPayment` necesita el TOTAL para descontarlo del disponible antes de
 * repartir el resto entre las cuotas, y recién cuando una fila de
 * `pagos_credito` quedó persistida se pueden escribir los reclamos (mismo
 * diferimiento que hace el convenio con `commitConvenio`).
 *
 * Trae los rubros VIVOS del crédito —`activo`, no `completado`, no `anulado`—
 * junto con el `obligatorio` de su TIPO (que es donde vive la naturaleza del
 * cobro, ver `puedeCrearRubro`) y lo ya apartado por las boletas hermanas. El
 * orden y el reparto los decide `repartirEnRubros`.
 */
export async function cobrarRubrosParaBoleta({
  credito_id,
  disponible,
  ejecutor = db,
}: {
  credito_id: number;
  disponible: Big | string | number;
  ejecutor?: Ejecutor;
}): Promise<{ cobros: { rubro_id: number; monto: string }[]; total: Big }> {
  if (new Big(disponible ?? 0).lte(0)) {
    return { cobros: [], total: new Big(0) };
  }

  const vivos = await ejecutor
    .select({
      rubro_id: rubros.rubro_id,
      saldo_pendiente: rubros.saldo_pendiente,
      created_at: rubros.created_at,
      obligatorio: rubros_tipos.obligatorio,
    })
    .from(rubros)
    .innerJoin(rubros_tipos, eq(rubros.tipo_id, rubros_tipos.tipo_id))
    .where(
      and(
        eq(rubros.credito_id, credito_id),
        eq(rubros.activo, true),
        eq(rubros.completado, false),
        eq(rubros.anulado, false)
      )
    );

  if (vivos.length === 0) return { cobros: [], total: new Big(0) };

  const reclamos = await reclamosVivosDeRubros(
    vivos.map((r) => r.rubro_id),
    ejecutor
  );

  const reparto = repartirEnRubros({
    disponible,
    rubros: vivos.map((r) => ({
      rubro_id: r.rubro_id,
      obligatorio: r.obligatorio,
      created_at: r.created_at,
      saldoPendiente: r.saldo_pendiente ?? "0",
      // Neteo contra las boletas hermanas: sin esto, tres boletas registradas
      // antes de que conta valide la primera apartarían el saldo COMPLETO cada
      // una (el registro no lo baja) y al aplicar la segunda ya no alcanzaría.
      reclamadoVivo: (reclamos.get(r.rubro_id) ?? []).reduce(
        (acc, c) => acc.plus(new Big(c.monto ?? 0)),
        new Big(0)
      ),
    })),
  });

  return { cobros: reparto.cobros, total: reparto.total };
}

/**
 * Escribe los reclamos de la boleta: `aplicado = false` y `saldo_pendiente`
 * INTACTO.
 *
 * Acá está la regla del dueño del dominio: el saldo del rubro baja al APLICAR,
 * no al registrar. Registrar sólo aparta — y lo apartado es lo que
 * `cobrarRubrosParaBoleta` de la siguiente boleta va a netear, y lo que congela
 * la edición del rubro hasta que contabilidad se pronuncie.
 *
 * No escribe historial: todavía no pasó nada en la cuenta del cliente. El
 * evento `abono` lo escribe la aplicación, que es cuando el saldo se mueve.
 *
 * ANTES DE INSERTAR REVALIDA el reparto contra el saldo actual, con los rubros
 * releídos `FOR UPDATE` en esta misma transacción. Es defensa en profundidad
 * sobre el advisory lock que ahora toman `editarRubro`/`anularRubro`: el lock
 * cierra la carrera, esto se asegura de que si igual se abre —un UPDATE a mano
 * en producción, una ruta futura que se olvide del lock— el daño se vea acá y
 * no en la validación. Fallar en el REGISTRO es barato: el asesor tiene la
 * boleta en la mano y reintenta. Fallar en la VALIDACIÓN no lo es: el 409
 * aborta la transacción que aplica TODO el pago, así que la boleta entera se
 * cae —cuota sin cerrar, capital sin tocar, inversionistas sin repartir— y lo
 * descubre contabilidad días después.
 */
export async function registrarReclamosDeRubros(
  pago_id: number,
  cobros: { rubro_id: number; monto: string }[],
  ejecutor: Ejecutor = db
): Promise<void> {
  if (cobros.length === 0) return;

  const rubroIds = cobros.map((c) => c.rubro_id);

  // `FOR UPDATE` y no una lectura suelta: el saldo que se juzga tiene que ser
  // el mismo que quede congelado hasta que este INSERT commitee, o el guard
  // decide sobre un número que puede cambiar dos líneas más abajo.
  const actuales = await ejecutor
    .select({
      rubro_id: rubros.rubro_id,
      saldo_pendiente: rubros.saldo_pendiente,
      anulado: rubros.anulado,
    })
    .from(rubros)
    .where(inArray(rubros.rubro_id, rubroIds))
    .for("update");

  const porId = new Map(actuales.map((r) => [r.rubro_id, r]));

  // Los reclamos de ESTA boleta todavía no existen (se insertan abajo), así que
  // lo que cuenta acá son sólo los de las boletas hermanas — exactamente el
  // mismo neteo con el que `cobrarRubrosParaBoleta` había decidido el reparto.
  const reclamos = await reclamosVivosDeRubros(rubroIds, ejecutor);

  for (const cobro of cobros) {
    const actual = porId.get(cobro.rubro_id);

    // Anulado o desaparecido: el reparto se decidió sobre un rubro que ya no se
    // cobra. Se trata aparte del guard de saldo porque el motivo es otro y la
    // salida también: no es "quedó menos plata", es "ese cargo se canceló".
    if (!actual || actual.anulado) {
      throw new RubroError(
        409,
        `El cobro adicional #${cobro.rubro_id} se anuló mientras se registraba esta boleta, así que ya no se cobra. La boleta NO se registró. Vuelva a registrarla: el reparto se recalcula sin ese cobro.`
      );
    }

    const veredicto = puedeApartarReclamo({
      rubro_id: cobro.rubro_id,
      saldoPendiente: actual.saldo_pendiente,
      reclamadoVivo: (reclamos.get(cobro.rubro_id) ?? []).reduce(
        (acc, r) => acc.plus(new Big(r.monto ?? 0)),
        new Big(0)
      ),
      montoApartado: cobro.monto,
    });

    if (!veredicto.permitido) {
      throw new RubroError(
        veredicto.status ?? 409,
        veredicto.motivo ?? "No se puede apartar el cobro del rubro."
      );
    }
  }

  await ejecutor.insert(rubros_pagos).values(
    cobros.map((c) => ({
      pago_id,
      rubro_id: c.rubro_id,
      monto: c.monto,
      // NULL hasta que se aplique: un 0 sería indistinguible de "se aplicó y no
      // descontó nada".
      monto_aplicado: null,
      aplicado: false,
    }))
  );
}

/**
 * APLICA los rubros que esta boleta había apartado: baja el saldo, recalcula
 * `completado`/`activo`, escribe el historial y marca el reclamo.
 *
 * Corre DENTRO de la transacción de `/aplicar-pago`: si algo de lo que sigue
 * falla, el rubro tampoco queda cobrado. Cada rubro se relee con `FOR UPDATE`
 * porque entre el registro de la boleta y esta validación pudo pasar cualquier
 * cosa, y el saldo que se decrementa tiene que ser el que está bloqueado.
 *
 * El guard de `puedeAplicarReclamo` es RUIDOSO a propósito: si el saldo ya no
 * alcanza, la aplicación FALLA en vez de abonar de menos. Por diseño no debería
 * pasar —`puedeTocarRubroConReclamosVivos` impide que el saldo se achique
 * mientras el reclamo vive, y el neteo impide apartar de más—, así que si pasa
 * es un agujero que queremos ver, no tapar.
 */
export async function aplicarRubrosDelPago(
  pago_id: number,
  ejecutor: Ejecutor
): Promise<{ rubro_id: number; monto_aplicado: string }[]> {
  const reclamos = await ejecutor
    .select({
      id: rubros_pagos.id,
      rubro_id: rubros_pagos.rubro_id,
      monto: rubros_pagos.monto,
    })
    .from(rubros_pagos)
    .where(
      and(eq(rubros_pagos.pago_id, pago_id), eq(rubros_pagos.aplicado, false))
    );

  const aplicados: { rubro_id: number; monto_aplicado: string }[] = [];

  for (const reclamo of reclamos) {
    const [rubro] = await ejecutor
      .select()
      .from(rubros)
      .where(eq(rubros.rubro_id, reclamo.rubro_id))
      .limit(1)
      .for("update");

    if (!rubro) {
      // El rubro no se borra nunca (se anula), así que esto sólo puede ser un
      // borrado a mano: mismo criterio ruidoso que el guard de abajo.
      throw new RubroError(
        409,
        `Inconsistencia de integridad: el pago ${pago_id} apartó Q${reclamo.monto} del rubro ${reclamo.rubro_id}, que ya no existe. El pago NO se aplica.`
      );
    }

    const veredicto = puedeAplicarReclamo({
      rubro_id: rubro.rubro_id,
      saldoPendiente: rubro.saldo_pendiente,
      montoApartado: reclamo.monto ?? 0,
    });
    if (!veredicto.permitido) {
      throw new RubroError(
        veredicto.status ?? 409,
        veredicto.motivo ?? "No se puede aplicar el cobro del rubro."
      );
    }

    const montoAplicado = aMonto(reclamo.monto ?? 0);
    const saldoNuevo = aMonto(
      new Big(rubro.saldo_pendiente).minus(new Big(montoAplicado))
    );
    const completado = rubroCompletado(saldoNuevo);

    await ejecutor
      .update(rubros)
      .set({
        saldo_pendiente: saldoNuevo,
        completado,
        // `activo` se DERIVA del saldo, igual que en la edición: está activo
        // mientras le quede saldo. Así el barrido del próximo pago no vuelve a
        // ofrecer un rubro ya saldado, y uno que quedó con saldo sigue vivo.
        activo: !completado,
        updated_at: SELLO_DE_TIEMPO,
      })
      .where(eq(rubros.rubro_id, rubro.rubro_id));

    await ejecutor.insert(rubros_historial).values({
      rubro_id: rubro.rubro_id,
      tipo_evento: "abono",
      // El monto del rubro no cambia con un abono; lo que cambia —y lo que hay
      // que poder reconstruir— es el saldo.
      saldo_anterior: aMonto(rubro.saldo_pendiente),
      saldo_nuevo: saldoNuevo,
      pago_id,
      // Sin `usuario_id`: el abono no lo decide una persona, lo produce la
      // validación de una boleta. El `pago_id` es la trazabilidad real.
      origen: "pago",
    });

    await ejecutor
      .update(rubros_pagos)
      .set({ aplicado: true, monto_aplicado: montoAplicado })
      .where(eq(rubros_pagos.id, reclamo.id));

    aplicados.push({ rubro_id: rubro.rubro_id, monto_aplicado: montoAplicado });
  }

  return aplicados;
}

/**
 * REVIERTE los rubros de una boleta que se reversa.
 *
 * Dos casos, que no son simétricos porque las dos etapas del pago no lo son:
 *
 *   * Reclamo YA APLICADO: el saldo del rubro se había bajado de verdad, así
 *     que se devuelve `monto_aplicado` y queda el evento `reversa` en el
 *     historial. La única excepción es el rubro ANULADO, donde el saldo NO se
 *     restituye: ver `saldoTrasReversaDeReclamo`.
 *   * Reclamo SIN APLICAR: nunca se descontó nada, así que no hay saldo que
 *     devolver — sólo se suelta lo apartado.
 *
 * En ambos casos el reclamo se BORRA, y eso es el guard de doble reversa: una
 * segunda reversa del mismo pago no encuentra filas y no devuelve nada. Es el
 * mismo criterio del convenio, que deja su sello en `pagoConvenio = 0` para que
 * la segunda pasada lo vea vacío.
 *
 * Corre DENTRO de la transacción de la reversa y ANTES de que la rama de pago
 * parcial borre la fila de `pagos_credito`: ese DELETE se llevaría los reclamos
 * por cascada sin devolverle el saldo al rubro.
 */
export async function revertirRubrosDelPago(
  pago_id: number,
  ejecutor: Ejecutor
): Promise<{ rubro_id: number; devuelto: string }[]> {
  const reclamos = await ejecutor
    .select({
      id: rubros_pagos.id,
      rubro_id: rubros_pagos.rubro_id,
      monto: rubros_pagos.monto,
      monto_aplicado: rubros_pagos.monto_aplicado,
      aplicado: rubros_pagos.aplicado,
    })
    .from(rubros_pagos)
    .where(eq(rubros_pagos.pago_id, pago_id));

  const revertidos: { rubro_id: number; devuelto: string }[] = [];

  for (const reclamo of reclamos) {
    if (reclamo.aplicado) {
      const [rubro] = await ejecutor
        .select()
        .from(rubros)
        .where(eq(rubros.rubro_id, reclamo.rubro_id))
        .limit(1)
        .for("update");

      if (rubro) {
        const saldoNuevo = aMonto(
          saldoTrasReversaDeReclamo({
            saldoPendiente: rubro.saldo_pendiente,
            // Lo que REALMENTE se descontó, no lo apartado: son el mismo número
            // hoy, pero el que manda es el que movió el saldo.
            montoAplicado: reclamo.monto_aplicado ?? reclamo.monto ?? 0,
            anulado: rubro.anulado,
          })
        );
        const completado = rubroCompletado(saldoNuevo);

        await ejecutor
          .update(rubros)
          .set({
            saldo_pendiente: saldoNuevo,
            completado,
            activo: !completado,
            updated_at: SELLO_DE_TIEMPO,
          })
          .where(eq(rubros.rubro_id, rubro.rubro_id));

        await ejecutor.insert(rubros_historial).values({
          rubro_id: rubro.rubro_id,
          tipo_evento: "reversa",
          saldo_anterior: aMonto(rubro.saldo_pendiente),
          saldo_nuevo: saldoNuevo,
          pago_id,
          origen: "reversa",
          motivo: rubro.anulado
            ? "Reversa de un pago sobre un rubro ANULADO: el saldo no se restituye para no revivir un cargo cancelado."
            : null,
        });

        revertidos.push({
          rubro_id: rubro.rubro_id,
          devuelto: new Big(saldoNuevo)
            .minus(new Big(rubro.saldo_pendiente))
            .toFixed(2),
        });
      }
    }

    // Se borra en los dos casos: es el guard de doble reversa.
    await ejecutor.delete(rubros_pagos).where(eq(rubros_pagos.id, reclamo.id));
  }

  return revertidos;
}

/**
 * DESAPLICA los rubros de un pago que vuelve de `validated` a `pending`
 * ("Revertir Especial"), que NO es lo mismo que revertirlos.
 *
 * La diferencia está en qué pasa con el RECLAMO, no con el saldo:
 *
 *   * `revertirRubrosDelPago` devuelve el saldo y BORRA la fila de
 *     `rubros_pagos`, porque ahí el pago se anula: deja de existir un cobro que
 *     reclame nada.
 *   * acá el pago sigue vivo, sólo retrocedió de etapa. Su reserva tiene que
 *     seguir existiendo, así que la fila se CONSERVA con `aplicado = false` y
 *     `monto_aplicado` en null — que es exactamente el estado en el que la dejó
 *     el registro de la boleta.
 *
 * Conservarla no es cosmético: es lo que devuelve el pago a un estado
 * `pending` legítimo. Sin la fila, `cobrarRubrosParaBoleta` de la siguiente
 * boleta no netearía nada contra este pago y apartaría un saldo ya
 * comprometido, y sobre todo el rubro perdía su congelamiento —
 * `puedeTocarRubroConReclamosVivos` no veía reclamos y dejaba editarlo con 200,
 * cuando en un pago pendiente normal eso se rechaza con 409.
 *
 * Sólo toca los reclamos `aplicado = true`: los que ya estaban apartados sin
 * aplicar no movieron saldo, así que no hay nada que devolver y la fila ya está
 * en el estado destino. Eso también lo vuelve idempotente, igual que el borrado
 * es el guard de doble reversa: una segunda pasada no encuentra aplicados.
 *
 * Corre DENTRO de la transacción de la reversión a pendiente: si algo de lo que
 * sigue falla, el rubro tampoco queda desaplicado.
 */
export async function desaplicarRubrosDelPago(
  pago_id: number,
  ejecutor: Ejecutor
): Promise<{ rubro_id: number; devuelto: string }[]> {
  const reclamos = await ejecutor
    .select({
      id: rubros_pagos.id,
      rubro_id: rubros_pagos.rubro_id,
      monto: rubros_pagos.monto,
      monto_aplicado: rubros_pagos.monto_aplicado,
    })
    .from(rubros_pagos)
    .where(
      and(eq(rubros_pagos.pago_id, pago_id), eq(rubros_pagos.aplicado, true))
    );

  const desaplicados: { rubro_id: number; devuelto: string }[] = [];

  for (const reclamo of reclamos) {
    const [rubro] = await ejecutor
      .select()
      .from(rubros)
      .where(eq(rubros.rubro_id, reclamo.rubro_id))
      .limit(1)
      .for("update");

    if (rubro) {
      // MISMA aritmética que la reversa —y el mismo helper puro—, incluida la
      // regla de que un rubro ANULADO no resucita. Acá esa regla deja el
      // conflicto a la vista a propósito: el reclamo sobrevive, así que un
      // rubro anulado queda en saldo 0 con un reclamo vivo encima y "Revalidar
      // Pago" lo rechaza con el 409 de `puedeAplicarReclamo`, que dice
      // literalmente que el rubro se anuló con la boleta ya registrada. La
      // salida correcta ahí es revertir el pago, no revalidarlo. Restituir el
      // saldo sería volver a cobrarle al cliente un cargo que un admin canceló
      // —y, como el saldo apaga `completado`, dejar dos cobros vivos del mismo
      // tipo: el cancelado y el correcto que se creó después de la anulación.
      // (Antes de la migración 0038 eso además chocaba contra el índice único y
      // reventaba la revalidación entera; hoy no revienta nada, y por eso el
      // `anulado` de `saldoTrasReversaDeReclamo` importa MÁS que antes: es lo
      // único que impide resucitar el cargo cancelado.)
      const saldoNuevo = aMonto(
        saldoTrasReversaDeReclamo({
          saldoPendiente: rubro.saldo_pendiente,
          // Lo que REALMENTE se descontó, no lo apartado: son el mismo número
          // hoy, pero el que manda es el que movió el saldo.
          montoAplicado: reclamo.monto_aplicado ?? reclamo.monto ?? 0,
          anulado: rubro.anulado,
        })
      );
      const completado = rubroCompletado(saldoNuevo);

      await ejecutor
        .update(rubros)
        .set({
          saldo_pendiente: saldoNuevo,
          completado,
          // `activo` se DERIVA del saldo, igual que en el resto del módulo: el
          // rubro vuelve a estar vivo porque volvió a tener saldo.
          activo: !completado,
          updated_at: SELLO_DE_TIEMPO,
        })
        .where(eq(rubros.rubro_id, rubro.rubro_id));

      // Evento `reversa` y no uno propio: el enum `rubro_evento` de la base no
      // tiene un valor para esto y agregarlo pide una migración, que es mucho
      // más riesgo del que justifica la etiqueta. El motivo dice cuál de las
      // dos reversas fue, que es lo que hace falta para leer el historial.
      await ejecutor.insert(rubros_historial).values({
        rubro_id: rubro.rubro_id,
        tipo_evento: "reversa",
        saldo_anterior: aMonto(rubro.saldo_pendiente),
        saldo_nuevo: saldoNuevo,
        pago_id,
        origen: "reversa",
        motivo: rubro.anulado
          ? "El pago volvió a PENDIENTE (Revertir Especial) sobre un rubro ANULADO: el saldo no se restituye para no revivir un cargo cancelado."
          : "El pago volvió a PENDIENTE (Revertir Especial): el saldo se devuelve y la boleta conserva su reserva sobre el rubro.",
      });

      desaplicados.push({
        rubro_id: rubro.rubro_id,
        devuelto: new Big(saldoNuevo)
          .minus(new Big(rubro.saldo_pendiente))
          .toFixed(2),
      });
    }

    // El reclamo NO se borra: vuelve al estado en que lo dejó el registro de la
    // boleta. `monto_aplicado` a null y no a 0 por la misma razón que en el
    // registro: un 0 sería indistinguible de "se aplicó y no descontó nada".
    await ejecutor
      .update(rubros_pagos)
      .set({ aplicado: false, monto_aplicado: null })
      .where(eq(rubros_pagos.id, reclamo.id));
  }

  return desaplicados;
}
