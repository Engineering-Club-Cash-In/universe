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
 * ¿Guardar así le quita el representante a alguien que ya lo tenía? Es el
 * único caso que merece confirmación: borra en silencio el acceso al portal de
 * un tercero que no está frente a la pantalla.
 */
export const requiereConfirmacionBorrado = (
	repLegalOriginal: string | null | undefined,
	esEmpresa: boolean,
	dpiDeLaFila: string | number | null | undefined,
): boolean => esEmpresaInicial(repLegalOriginal, dpiDeLaFila) && !esEmpresa;

/**
 * La forma vieja, que sigue viva por UNA sola llamada: el alta de
 * `liquidaciones.index.tsx`.
 *
 * No se migró con el resto a propósito. Ese formulario se reescribe entero en la
 * rama de detección de empresa por DPI —ahí el interruptor "¿Es empresa?"
 * desaparece, y esta llamada con él— y tocarlo desde aquí, aunque fuera para
 * cambiarle el nombre a la función, le mete un conflicto a un PR ya aprobado por
 * un cambio que no le aporta nada.
 *
 * Y no le aporta nada porque al CREAR no hay fila anterior: sin
 * `repLegalOriginal` ni `dpiOriginal`, `valorRepLegalAlGuardar` hace exactamente
 * esto. Lo que aquella añade —seguirle el DPI al que es su propio
 * representante— solo existe al editar.
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
 * ¿Esta fila era su propio representante? (`dpi = 4036613`,
 * `dpi_rep_legal = '04036613'`: el inversionista 187.)
 *
 * Es el complemento exacto de `esEmpresaInicial` cuando hay valor guardado: con
 * `dpi_rep_legal` puesto, o representa a OTRO —empresa— o se representa a sí
 * mismo. El valor guardado significa cosas distintas en cada caso: en el
 * primero es el acceso al portal de un tercero; en el segundo es una copia del
 * DPI de la propia fila, y tiene que seguir siéndolo.
 */
const esAutorrepresentado = (
	repLegalOriginal: string | null | undefined,
	dpiDeLaFila: string | number | null | undefined,
): boolean => {
	const rep = normalizarDpiParaComparar(repLegalOriginal);
	return rep !== null && rep === normalizarDpiParaComparar(dpiDeLaFila);
};

/**
 * Valor para el input `dpiRepLegal` del router. `undefined` = llave ausente,
 * cartera no toca el campo (lo correcto al crear); `""` = llave presente vacía,
 * cartera BORRA el representante (lo correcto al editar).
 *
 * Los tres casos de "no es empresa", que no son lo mismo:
 *
 * 1. ANTES SÍ ERA. Se desmarcó el interruptor a propósito: se borra, y eso le
 *    quita el acceso al portal a un tercero, por lo que pasa antes por
 *    `requiereConfirmacionBorrado`.
 *
 * 2. SE REPRESENTA A SÍ MISMO. Abre con el interruptor apagado, así que
 *    cualquier edición suya —cambiar un banco— llegaba aquí; borrar era
 *    vaciarle un campo que no es decorativo (`getInvestors` lo prefiere como
 *    DPI de retorno en las búsquedas por correo). Por eso no se toca... salvo
 *    que lo que se esté editando sea EL DPI. Ahí "no tocar" deja
 *    `dpi_rep_legal` con el DPI viejo y `dpi` con el nuevo, o sea dos números
 *    distintos, y eso es exactamente la definición de empresa que usa el
 *    backend (`esEmpresaRepresentada`): la fila deja de recibir cuenta propia y
 *    pasa a estar "representada" por una identidad anterior que ya no es la
 *    suya. El valor guardado era una copia de su DPI, así que sigue al DPI: si
 *    el nuevo está vacío se borra, porque conservar el viejo es justo lo que
 *    convierte la fila en una empresa falsa.
 *
 * 3. NUNCA TUVO. No hay nada que borrar ni que seguir: llave ausente. Es
 *    también el caso de crear.
 */
export const valorRepLegalAlGuardar = ({
	esEmpresa,
	valor,
	repLegalOriginal,
	dpiOriginal,
	dpiDelFormulario,
}: {
	esEmpresa: boolean;
	valor: string | null | undefined;
	repLegalOriginal: string | null | undefined;
	dpiOriginal: string | number | null | undefined;
	dpiDelFormulario: string | number | null | undefined;
}): string | undefined => {
	if (esEmpresa) {
		const limpio = (valor ?? "").trim();
		return limpio === "" ? undefined : limpio;
	}

	if (requiereConfirmacionBorrado(repLegalOriginal, esEmpresa, dpiOriginal)) {
		return "";
	}

	if (!esAutorrepresentado(repLegalOriginal, dpiOriginal)) return undefined;

	const nuevo = normalizarDpiParaComparar(dpiDelFormulario);
	if (nuevo === normalizarDpiParaComparar(dpiOriginal)) return undefined;

	// Sin DPI nuevo, conservar el viejo es lo que convierte la fila en empresa.
	return nuevo ?? "";
};
