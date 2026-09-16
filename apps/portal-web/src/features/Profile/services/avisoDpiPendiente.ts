/**
 * El aviso de "quedó sin DPI", guardado para que sobreviva a una recarga.
 *
 * `registroSinDpi.ts` define CUÁNDO un registro quedó sin DPI. Este módulo
 * resuelve lo otro: que ese estado no se evapore. Vivía solo en el estado de
 * React del perfil, así que una recarga —o volver a /profile más tarde— lo
 * borraba, y como la cuenta sigue siendo CLIENT y sin DPI, `Profile.tsx` sacaba
 * otra vez el formulario en blanco: sin la explicación, invitando a reenviar el
 * mismo DPI para nada. El bucle mudo, de vuelta.
 *
 * POR QUÉ EN EL CLIENTE Y NO DERIVADO DEL SERVIDOR. Lo correcto sería
 * preguntárselo al servidor, y se descartó porque HOY no lo sabe. El estado
 * pendiente deja la cuenta en rol CLIENT y sin DPI (`applyRegistrationOutcome`
 * escribe el rol y omite el DPI a propósito), y `users.role` tiene DEFAULT
 * 'CLIENT': una cuenta pendiente es indistinguible, campo por campo, de una que
 * nunca intentó registrarse. Es la misma trampa que ya documenta
 * `rolFueEstablecido`. Nada de lo que el backend devuelve hoy separa los dos
 * casos, y separarlos pedía una columna nueva (migración) o una ruta nueva que
 * consultara el CRM por correo —que es justo el oráculo de fichas que este
 * portal ya eliminó una vez—. Ninguna de las dos cabía aquí.
 *
 * QUÉ SE ASUME DE ESTA SEÑAL. Es del cliente: se puede borrar, editar o no
 * existir. Por eso no decide NADA con consecuencias —ni rol, ni DPI, ni
 * permisos—; solo elige un texto. Perderla devuelve el comportamiento anterior
 * y falsificarla no consigue más que verse un párrafo ámbar.
 *
 * CUÁNDO SE VA. Nunca por un plazo: el asesor puede tardar días y un aviso que
 * caduca solo devuelve a la persona al formulario mudo. Se apaga cuando el
 * problema se resolvió, y de eso manda el SERVIDOR: en cuanto la sesión trae
 * `dpi`, el aviso se borra y no vuelve. También se borra si la cuenta abierta
 * es otra (un navegador compartido) o si un registro posterior sí dejó DPI.
 */

import { registroQuedoSinDpi } from "./registroSinDpi";

export type AvisoDpiPendiente = {
  /** Correo de la cuenta a la que pertenece el aviso. */
  correo: string;
  tipoSolicitado: "CLIENT" | "INVESTOR";
};

/**
 * Solo `getItem`/`setItem`/`removeItem`: así el almacén se puede inyectar en
 * las pruebas sin montar un DOM, y el módulo no depende de `localStorage`.
 */
export type AlmacenDelAviso = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export const CLAVE_DEL_AVISO = "portal.registroDpiPendiente";

/**
 * `localStorage` y no `sessionStorage`: lo que se está esperando es que un
 * humano del equipo complete una ficha, y eso no ocurre dentro de la pestaña.
 * Con `sessionStorage` el aviso moriría al cerrarla y quien volviera al día
 * siguiente —el caso más probable— caería otra vez en el formulario mudo.
 *
 * Se accede dentro de `try`: con cookies de terceros bloqueadas o en modo
 * privado, tocar `localStorage` LANZA. El portal no se cae por un aviso.
 */
const almacenPorDefecto = (): AlmacenDelAviso | null => {
  try {
    if (typeof window === "undefined") {
      return null;
    }

    return window.localStorage ?? null;
  } catch {
    return null;
  }
};

const resolverAlmacen = (
  almacen: AlmacenDelAviso | null | undefined,
): AlmacenDelAviso | null =>
  almacen === undefined ? almacenPorDefecto() : almacen;

const normalizarCorreo = (correo: string | null | undefined): string =>
  typeof correo === "string" ? correo.trim().toLowerCase() : "";

export const olvidarDpiPendiente = (
  almacen?: AlmacenDelAviso | null,
): void => {
  const destino = resolverAlmacen(almacen);

  try {
    destino?.removeItem(CLAVE_DEL_AVISO);
  } catch {
    // Un almacén que no deja escribir no puede tumbar el perfil.
  }
};

export const recordarDpiPendiente = (
  aviso: AvisoDpiPendiente,
  almacen?: AlmacenDelAviso | null,
): void => {
  const destino = resolverAlmacen(almacen);

  if (!destino) {
    return;
  }

  try {
    destino.setItem(
      CLAVE_DEL_AVISO,
      JSON.stringify({
        correo: aviso.correo.trim(),
        tipoSolicitado: aviso.tipoSolicitado,
      }),
    );
  } catch {
    // Sin cuota o sin permiso: se pierde el aviso, que es exactamente el
    // comportamiento que había antes de este módulo.
  }
};

const leerAviso = (
  almacen: AlmacenDelAviso,
): AvisoDpiPendiente | "corrupto" | null => {
  let crudo: string | null;

  try {
    crudo = almacen.getItem(CLAVE_DEL_AVISO);
  } catch {
    return null;
  }

  if (!crudo) {
    return null;
  }

  try {
    const dato = JSON.parse(crudo) as Partial<AvisoDpiPendiente>;
    const correo = typeof dato?.correo === "string" ? dato.correo.trim() : "";
    const tipo = dato?.tipoSolicitado;

    if (!correo || (tipo !== "CLIENT" && tipo !== "INVESTOR")) {
      return "corrupto";
    }

    return { correo, tipoSolicitado: tipo };
  } catch {
    return "corrupto";
  }
};

/**
 * El aviso que TOCA mostrarle a esta persona ahora mismo, o `null`.
 *
 * Aquí vive el ciclo de vida entero, para que ninguna pantalla tenga que
 * acordarse de apagarlo:
 *
 * - Sin sesión resuelta todavía no se muestra, pero TAMPOCO se borra: el
 *   primer render del perfil llega con `user` en null y borrarlo ahí tiraría
 *   el aviso antes de que nadie lo viera.
 * - Con DPI en la cuenta se borra: el asesor ya lo completó, el problema se
 *   acabó y el aviso desaparece solo, sin que nadie tenga que limpiarlo.
 * - Con otra cuenta abierta se borra: en un navegador compartido el aviso de
 *   una persona no puede aparecerle a otra.
 */
export const avisoDpiPendienteVigente = (params: {
  usuario?: { email?: string | null; dpi?: string | null } | null;
  almacen?: AlmacenDelAviso | null;
}): AvisoDpiPendiente | null => {
  const almacen = resolverAlmacen(params.almacen);

  if (!almacen) {
    return null;
  }

  const aviso = leerAviso(almacen);

  if (!aviso) {
    return null;
  }

  if (aviso === "corrupto") {
    olvidarDpiPendiente(almacen);
    return null;
  }

  const usuario = params.usuario;

  if (!usuario) {
    return null;
  }

  if (typeof usuario.dpi === "string" && usuario.dpi.trim() !== "") {
    olvidarDpiPendiente(almacen);
    return null;
  }

  if (normalizarCorreo(aviso.correo) !== normalizarCorreo(usuario.email)) {
    olvidarDpiPendiente(almacen);
    return null;
  }

  return aviso;
};

/**
 * Único punto por el que los tres caminos de registro dejan (o retiran) el
 * aviso tras un `register-external-auth` que salió bien.
 *
 * La decisión NO se toma aquí: se delega en `registroQuedoSinDpi`, que sigue
 * siendo la única definición de "quedó sin DPI" —y con ella la regla de mirar
 * `identity.dpi` y nunca `dpiRegistradoEnLead`—. Este módulo solo decide qué
 * hacer con el almacén, y devuelve el veredicto para que quien llame elija su
 * pantalla.
 *
 * Un registro que SÍ dejó DPI borra cualquier aviso anterior: es la otra mitad
 * del ciclo de vida, para el caso en que la persona se destrabe sin recargar.
 */
export const recordarSiQuedoSinDpi = (params: {
  respuesta: Parameters<typeof registroQuedoSinDpi>[0];
  correo: string;
  tipoSolicitado: "CLIENT" | "INVESTOR";
  almacen?: AlmacenDelAviso | null;
}): boolean => {
  if (!registroQuedoSinDpi(params.respuesta)) {
    olvidarDpiPendiente(params.almacen);
    return false;
  }

  recordarDpiPendiente(
    { correo: params.correo, tipoSolicitado: params.tipoSolicitado },
    params.almacen,
  );

  return true;
};
