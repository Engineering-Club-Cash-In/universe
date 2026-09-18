/** La apertura vigente del modal de rubros. */
export type SesionRubros = {
  /** Si la apertura vigente sigue abierta. */
  abierta: boolean;
  /** Crédito con el que se abrió. Se RETIENE al cerrar. */
  creditoId: number | null;
};

export type Apertura = {
  /** La sesión que corresponde a estas props (la misma instancia si no cambia). */
  sesion: SesionRubros;
  /** Si esta render estrena apertura y hay que volver la vista a la lista. */
  reiniciar: boolean;
  /** El crédito que la UI tiene que pintar EN ESTA MISMA render. */
  creditoVisible: number | null;
};

/**
 * Qué crédito pinta el modal y si le toca volver a la lista — decidido EN LA
 * RENDER, no en un efecto.
 *
 * Esa distinción es todo el punto de esta función. El modal no se desmonta
 * entre créditos: el llamador lo deja montado y sólo le mueve `open` y
 * `creditoId`. Cuando el crédito visible se sincronizaba en un `useEffect`, el
 * efecto corría DESPUÉS de que la render ya se había pintado, así que reabrirlo
 * sobre el crédito B alcanzaba a mostrar un cuadro con el encabezado de B y los
 * rubros de A. En una pantalla de dinero eso es enseñarle a un asesor la deuda
 * de un cliente atribuida a otro.
 *
 * Y como el reinicio de vista TAMBIÉN era un efecto, el cuadro podía reabrirse
 * directamente en el formulario de editar o en el historial del rubro anterior:
 * un formulario cargado con datos del cliente equivocado y listo para enviarse.
 * Por eso las dos decisiones —qué se pinta y en qué vista— salen de acá juntas.
 *
 * Es pura y sin React a propósito: `carteraFront` no tiene testing-library, así
 * que la única forma de fijar esta conducta con tests es que la decisión no viva
 * dentro del componente.
 *
 * El llamador la invoca en la render y hace `setState` sólo si `sesion` cambió
 * de identidad — por eso una render estable devuelve EL MISMO objeto y no una
 * copia: devolver uno nuevo cada vez sería un bucle de renders.
 */
export function ajustarApertura(
  sesion: SesionRubros,
  { open, creditoId }: { open: boolean; creditoId: number | null }
): Apertura {
  // ESTRENA apertura: o estaba cerrado, o le cambiaron el crédito en caliente.
  // Las dos cuentan como entrar de nuevo, así que las dos vuelven a la lista —
  // incluso reabrir el MISMO crédito, porque cerrar en "editar" y volver a
  // entrar tiene que caer en la lista.
  if (open && (!sesion.abierta || sesion.creditoId !== creditoId)) {
    return {
      sesion: { abierta: true, creditoId },
      reiniciar: true,
      // El crédito nuevo se pinta YA, en esta misma render. Y si el llamador
      // abrió sin crédito, se pinta el vacío y no el anterior: retener es para
      // la salida, no para la entrada.
      creditoVisible: creditoId,
    };
  }

  // Se está cerrando. Acá SÍ se retiene el último crédito, y es para lo único
  // que el id retenido existe: `open` y `creditoId` salen del mismo estado del
  // llamador, así que al cerrar los dos cambian en el mismo commit mientras el
  // diálogo todavía corre su animación de salida. Sin retenerlo, esos ~200ms
  // muestran el cartel de "no se pudo identificar el crédito" en la cara del
  // usuario que acaba de cerrar bien.
  if (!open && sesion.abierta) {
    return {
      sesion: { ...sesion, abierta: false },
      reiniciar: false,
      creditoVisible: sesion.creditoId,
    };
  }

  return { sesion, reiniciar: false, creditoVisible: sesion.creditoId };
}
