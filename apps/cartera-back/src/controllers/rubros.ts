/**
 * Rubros — cobros adicionales por crédito (tarjeta de circulación, traspaso…).
 *
 * FASE 1: sólo catálogo, alta y corrección manual. El consumo del disponible de
 * cada pago llega después; por eso acá nunca se toca `pagos_credito` ni se
 * escribe `pago_id` en el historial.
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
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "../database";
import {
  asesores,
  creditos,
  moras_credito,
  platform_users,
  rubros,
  rubros_historial,
  rubros_tipos,
} from "../database/db";
import {
  eventoDeEdicion,
  nuevoSaldoTrasEdicion,
  origenDeRole,
  puedeActuar,
  puedeAnularRubro,
  puedeCrearRubro,
  puedeEditarMonto,
  puedeUsarMonto,
  redondearMonto,
  rubroCompletado,
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

  const [actual] = await db
    .select({ tipo_id: rubros_tipos.tipo_id })
    .from(rubros_tipos)
    .where(eq(rubros_tipos.tipo_id, tipo_id))
    .limit(1);

  if (!actual) throw new RubroError(404, "El tipo de rubro no existe.");

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
    const [tipo] = await db
      .update(rubros_tipos)
      .set(cambios)
      .where(eq(rubros_tipos.tipo_id, tipo_id))
      .returning();

    return tipo;
  } catch (e) {
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
    abonado: aMonto(
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

  try {
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
      const [tipo] = await tx
        .select({
          tipo_id: rubros_tipos.tipo_id,
          obligatorio: rubros_tipos.obligatorio,
          activo: rubros_tipos.activo,
        })
        .from(rubros_tipos)
        .where(eq(rubros_tipos.tipo_id, tipo_id))
        .limit(1);

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
  } catch (e) {
    if (e instanceof RubroError) throw e;
    // `rubros_uq_credito_tipo_vivo`: ya hay un rubro SIN SALDAR de ese tipo en
    // el crédito. Es un choque de negocio (409), no una caída del servidor —
    // y la salida es cobrar el que ya existe, no crear un duplicado.
    if (esViolacionUnica(e)) {
      throw new RubroError(
        409,
        "Este crédito ya tiene un rubro vivo de ese tipo."
      );
    }
    throw e;
  }
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

  try {
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
 * que es fase 2 y todavía no existe. Mientras tanto el índice único
 * `rubros_uq_credito_tipo_vivo` impide crear el rubro CORRECTO de ese mismo
 * tipo, así que un dedazo dejaba el crédito bloqueado para ese concepto para
 * siempre y la única salida era un UPDATE a mano en producción.
 *
 * Qué hace: `saldo_pendiente = 0` (ya no se cobra), `completado = true` (sale
 * del índice único y libera el tipo) y `activo = false` (el barrido de la fase
 * 2 no lo mira). `monto_original` NO se toca a propósito: es el rastro de
 * cuánto se había llegado a cobrar, y ponerlo en 0 borraría la evidencia del
 * error que la anulación viene a documentar. El evento `anulacion` del
 * historial guarda el saldo anterior y el motivo obligatorio.
 *
 * Sólo ADMIN (lo gatea el router): anular libera el índice y cierra un cobro,
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

  // Leer, decidir y escribir en UNA transacción con la fila bloqueada, igual
  // que `editarRubro`: sin el `FOR UPDATE`, dos anulaciones simultáneas —o una
  // anulación contra un abono de la fase 2— escribirían dos eventos sobre el
  // mismo saldo leído.
  return await db.transaction(async (tx) => {
    const [actual] = await tx
      .select()
      .from(rubros)
      .where(eq(rubros.rubro_id, rubro_id))
      .limit(1)
      .for("update");

    if (!actual) throw new RubroError(404, "El rubro no existe.");

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
  });
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
