// El interruptor "¿Es empresa?" NO tiene columna propia en
// `cartera.inversionistas`: lo único que existe es `dpi_rep_legal` con valor o
// sin él. Por eso el estado del interruptor se DERIVA de ese campo al abrir el
// formulario, y estas funciones son la única fuente de esa derivación (las
// comparte el modal de crear/editar de cartera).

/** Mensaje del campo cuando el interruptor está marcado y no hay DPI. */
export const REP_LEGAL_REQUERIDO =
  "El DPI del representante legal es obligatorio para una empresa";

/**
 * Estado inicial del interruptor: marcado solo si la fila ya trae el DPI de un
 * representante. En modo crear (sin fila previa) siempre arranca sin marcar.
 */
export const esEmpresaInicial = (
  dpiRepLegal: string | null | undefined,
): boolean => (dpiRepLegal ?? "").trim() !== "";

/**
 * Validación de cliente: con el interruptor marcado el DPI es obligatorio.
 * Sin marcar, el campo ni se muestra, así que su contenido no importa.
 */
export const errorRepLegal = (
  esEmpresa: boolean,
  valor: string | null | undefined,
): string | undefined =>
  esEmpresa && (valor ?? "").trim() === "" ? REP_LEGAL_REQUERIDO : undefined;

/**
 * Valor a mandar en el payload. `null` = borrar (cartera trata la llave
 * presente con valor vacío como borrado). Desmarcar el interruptor en un
 * inversionista que SÍ tenía representante borra el dato y con él el acceso de
 * esa persona al portal: por eso el borrado pasa antes por `requiereConfirmacionBorrado`.
 */
export const valorRepLegalAEnviar = (
  esEmpresa: boolean,
  valor: string | null | undefined,
): string | null => {
  if (!esEmpresa) return null;
  const limpio = (valor ?? "").trim();
  return limpio === "" ? null : limpio;
};

/**
 * ¿Guardar así le quita el representante a alguien que ya lo tenía? Es el
 * único caso que merece confirmación: borra en silencio el acceso al portal de
 * un tercero que no está frente a la pantalla.
 */
export const requiereConfirmacionBorrado = (
  repLegalOriginal: string | null | undefined,
  esEmpresa: boolean,
): boolean => esEmpresaInicial(repLegalOriginal) && !esEmpresa;
