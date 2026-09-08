// El interruptor "¿Es empresa?" NO tiene columna propia en
// `cartera.inversionistas`: lo único que existe es `dpi_rep_legal` con valor o
// sin él. Por eso el estado del interruptor se DERIVA de ese campo al abrir el
// formulario. Lo comparten los modales de crear y de editar inversionista.

/** Mensaje del campo cuando el interruptor está marcado y no hay DPI. */
export const REP_LEGAL_REQUERIDO =
	"El DPI del representante legal es obligatorio para una empresa";

/**
 * Deja un DPI en forma comparable entre `dpi` (bigint en cartera: nunca trae
 * ceros a la izquierda) y `dpi_rep_legal` (varchar: sí los conserva).
 *
 * Es una COPIA de `normalizarDpiParaComparar` de
 * `cartera-back/src/utils/functions/provisionamientoPortal.ts`, que es la
 * definición canónica. Se compara como texto sin ceros a la izquierda y no
 * convirtiendo a número a propósito: `dpi_rep_legal` admite 20 dígitos y un
 * bigint topa en 19, así que un `BigInt(...)` podría desbordar con un valor mal
 * capturado.
 *
 * NOTA DE MERGE: esta regla vive hoy en TRES sitios —el backend y los dos
 * fronts (`carteraFront` y `crm/apps/web`)— porque ninguno de los dos fronts
 * declara dependencia de `packages/*` y `crm/apps/web` está en un workspace
 * anidado: darle casa común es un cambio de estructura del monorepo, no de esta
 * corrección. Es el mismo compromiso que ya documenta el backend, donde
 * `normalizarDpiParaComparar` está duplicada con `grupoInversionistas.ts`. Si
 * los tres divergen, el front vuelve a etiquetar como empresa a quien el
 * backend trata como persona, que es justo el bug que esto cierra.
 */
const normalizarDpiParaComparar = (valor: unknown): string | null => {
	const texto = String(valor ?? "").trim();
	if (!/^\d+$/.test(texto)) return null;
	const sinCeros = texto.replace(/^0+/, "");
	return sinCeros === "" ? null : sinCeros;
};

/**
 * Estado inicial del interruptor: marcado solo si la fila trae el DPI de un
 * representante DISTINTO de ella misma. En modo crear (sin fila previa) siempre
 * arranca sin marcar.
 *
 * Lo de "distinto de ella misma" no es teórico: el inversionista 187 tiene
 * `dpi = 4036613` y `dpi_rep_legal = '04036613'` — el mismo número con un cero
 * delante. Derivarlo de "el campo no está vacío" lo abría etiquetado como
 * empresa y, al desmarcar, le advertía al operador que iba a quitarle el acceso
 * a otra persona que no existe. Es la MISMA comparación que hace
 * `esEmpresaRepresentada` en el backend, y tiene que seguir siéndolo.
 */
export const esEmpresaInicial = (
	dpiRepLegal: string | null | undefined,
	dpiDeLaFila: string | number | null | undefined,
): boolean => {
	const rep = normalizarDpiParaComparar(dpiRepLegal);
	if (rep === null) return false;
	return rep !== normalizarDpiParaComparar(dpiDeLaFila);
};

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
 * Valor para el input `dpiRepLegal` del router. `undefined` = llave ausente,
 * cartera no toca el campo (lo correcto al crear); `""` = llave presente vacía,
 * cartera BORRA el representante (lo correcto al editar).
 */
export const valorRepLegalAEnviar = (
	esEmpresa: boolean,
	valor: string | null | undefined,
	{ borrarSiNoEsEmpresa }: { borrarSiNoEsEmpresa: boolean },
): string | undefined => {
	if (!esEmpresa) return borrarSiNoEsEmpresa ? "" : undefined;
	const limpio = (valor ?? "").trim();
	return limpio === "" ? undefined : limpio;
};

/**
 * ¿Guardar así le quita el representante a alguien que ya lo tenía? Es el
 * único caso que merece confirmación: borra en silencio el acceso al portal de
 * un tercero que no está frente a la pantalla.
 */
export const requiereConfirmacionBorrado = (
	repLegalOriginal: string | null | undefined,
	esEmpresa: boolean,
	dpiDeLaFila: string | number | null | undefined,
): boolean => esEmpresaInicial(repLegalOriginal, dpiDeLaFila) && !esEmpresa;
