/**
 * El tipo de usuario con el que ya se creó una cuenta, recordado entre recargas.
 *
 * `useRegister` lo guarda en un `useRef` para que el reintento no pueda cambiar
 * de sistema externo a mitad de camino: si el primer intento creó la fila de
 * inversionista en cartera y falló después, elegir CLIENT crearía además un
 * lead de CRM y dejaría la fila huérfana.
 *
 * El ref no alcanza. El caso que lo rompe es justo el que motiva todo esto: el
 * alta salió, `register-external-auth` creó la fila y falló antes de escribir la
 * identidad. Ahí es normal que la persona recargue `/register` — y al recargar
 * el ref se pierde, Formik vuelve a su `userType` por defecto (CLIENT) y la
 * sesión sigue viva, así que `decidirAlta` dice "reintentar" y el reintento sale
 * hacia el OTRO sistema. El ref protege la pestaña; esto protege el caso real.
 *
 * Se guarda junto al CORREO de esa cuenta, no suelto: si la persona vuelve a
 * `/register` para dar de alta a otra, el tipo recordado no tiene que atarla.
 */

export type TipoDelPortal = "CLIENT" | "INVESTOR";

export interface AltaRecordada {
  correo: string;
  tipo: TipoDelPortal;
}

/**
 * Solo lo que se usa, para poder inyectar un almacén falso en las pruebas sin
 * montar un DOM. Mismo criterio que `avisoDpiPendiente`.
 */
export type AlmacenDelAlta = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const CLAVE_DEL_ALTA = "portal.tipoDelAlta";

/**
 * Se accede dentro de `try`: con cookies de terceros bloqueadas o en modo
 * privado, tocar `localStorage` LANZA. Quedarse sin memoria degrada al
 * comportamiento anterior; tumbar el registro no es una opción.
 */
const almacenPorDefecto = (): AlmacenDelAlta | null => {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
};

const resolverAlmacen = (
  almacen: AlmacenDelAlta | null | undefined,
): AlmacenDelAlta | null =>
  almacen === undefined ? almacenPorDefecto() : almacen;

const normalizarCorreo = (correo: string | null | undefined): string =>
  typeof correo === "string" ? correo.trim().toLowerCase() : "";

const esTipo = (valor: unknown): valor is TipoDelPortal =>
  valor === "CLIENT" || valor === "INVESTOR";

export const recordarTipoDelAlta = (
  alta: AltaRecordada,
  almacen?: AlmacenDelAlta | null,
): void => {
  const destino = resolverAlmacen(almacen);
  if (!destino) return;

  try {
    destino.setItem(
      CLAVE_DEL_ALTA,
      JSON.stringify({
        correo: normalizarCorreo(alta.correo),
        tipo: alta.tipo,
      }),
    );
  } catch {
    // Un almacén que no deja escribir no puede tumbar el registro.
  }
};

export const olvidarTipoDelAlta = (almacen?: AlmacenDelAlta | null): void => {
  const destino = resolverAlmacen(almacen);

  try {
    destino?.removeItem(CLAVE_DEL_ALTA);
  } catch {
    // Ídem.
  }
};

/**
 * El tipo recordado para ESTE correo, o `null`.
 *
 * Devuelve `null` en cuanto algo no cuadra —otro correo, JSON roto, un tipo que
 * ya no existe— porque el valor solo sirve para RESTRINGIR: ante la duda, se
 * cae al comportamiento de antes en vez de atar a alguien a un tipo inventado.
 */
export const tipoRecordadoDelAlta = (
  correoDelFormulario: string,
  almacen?: AlmacenDelAlta | null,
): TipoDelPortal | null => {
  const origen = resolverAlmacen(almacen);
  if (!origen) return null;

  const correo = normalizarCorreo(correoDelFormulario);
  if (correo === "") return null;

  let crudo: string | null = null;
  try {
    crudo = origen.getItem(CLAVE_DEL_ALTA);
  } catch {
    return null;
  }

  if (!crudo) return null;

  try {
    const guardado = JSON.parse(crudo) as unknown;
    if (typeof guardado !== "object" || guardado === null) return null;

    const { correo: correoGuardado, tipo } = guardado as {
      correo?: unknown;
      tipo?: unknown;
    };

    if (normalizarCorreo(correoGuardado as string) !== correo) return null;

    return esTipo(tipo) ? tipo : null;
  } catch {
    return null;
  }
};
