/** Lo mínimo de un tipo para juzgar si se puede cobrar ahora. */
export type TipoJuzgable = { tipo_id: number; nombre: string; obligatorio: boolean };

/** Lo mínimo de un rubro ya existente del crédito. */
export type RubroExistente = { tipo_id: number; completado: boolean };

/**
 * Estados en los que el crédito sólo admite tipos OBLIGATORIOS.
 *
 * Espeja `puedeCrearRubro` del backend. No es la lista completa de lo que ese
 * gate rechaza —ver la advertencia de abajo—, es lo que el front puede saber.
 */
const SOLO_OBLIGATORIOS = new Set(["MOROSO", "EN_CONVENIO"]);

/**
 * Por qué este tipo NO se puede cobrar ahora en este crédito, o `null` si sí.
 *
 * Cierra el patrón "la pantalla ofrece una acción que el backend va a rechazar":
 * el desplegable de crear ofrecía todos los tipos activos y el envío se comía un
 * 409 con el formulario lleno. El texto que devuelve se muestra en la opción
 * misma, **deshabilitada**, no se filtra — y esa diferencia no es estética:
 *
 *   * si todos los tipos activos fueran opcionales, la lista filtrada queda
 *     vacía y la pantalla imprime "No hay tipos de rubro activos configurados",
 *     que es falso y manda a crear un tipo duplicado;
 *   * y al que ya había elegido un tipo se le borraría la selección sola,
 *     porque el efecto que limpia el borrador no distingue "desapareció" de "no
 *     se puede ahora".
 *
 * ## ⚠️ Es una comodidad, no una garantía
 *
 * El backend sigue siendo la autoridad y su 409 viene redactado. Este gate es
 * incompleto **por construcción**, por dos razones:
 *
 *   * el `statusCredit` que llega es la foto de la FILA con que se abrió el
 *     modal, no una lectura fresca, y el cron de moras mueve esa columna por
 *     atrás;
 *   * el front **nunca** ve `moraActivaMonto`, así que un crédito `ACTIVO` con
 *     mora viva también rechaza los opcionales y desde acá es invisible.
 *
 * Por eso ante la duda se OFRECE: el falso permisivo cuesta un formulario y un
 * mensaje redactado; el falso restrictivo deja al ADMIN sin poder hacer algo
 * legítimo **y sin salida desde la pantalla**, porque una opción deshabilitada
 * no tiene "intentar igual".
 */
export function motivoTipoNoCobrable(entrada: {
  tipo: TipoJuzgable;
  statusCredit: string | null;
  rubros: RubroExistente[];
}): string | null {
  const { tipo, statusCredit, rubros } = entrada;

  /**
   * Primero el duplicado, porque es el único rechazo que sabemos SEGURO: el
   * índice único es sobre `(credito_id, tipo_id) WHERE completado = false`, y el
   * dato está en memoria. El estado del crédito, en cambio, es una foto.
   *
   * Mira `completado` y no `anulado`: anular deja el rubro `completado = true`,
   * así que un anulado libera el lugar. Y un cobro ya saldado tampoco estorba —
   * tras cobrar la tarjeta de un año puede hacer falta la del siguiente.
   */
  if (rubros.some((r) => r.tipo_id === tipo.tipo_id && !r.completado)) {
    return "Este crédito ya tiene un cobro vivo de ese tipo. Cobralo o anulalo antes de crear otro.";
  }

  if (!tipo.obligatorio && statusCredit && SOLO_OBLIGATORIOS.has(statusCredit)) {
    return `El crédito está ${statusCredit}: solo entran los tipos obligatorios.`;
  }

  return null;
}
