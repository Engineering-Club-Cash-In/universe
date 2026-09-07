/**
 * Decisión de idempotencia del registro del portal sobre un lead del CRM.
 *
 * Es el espejo de lo que hace cartera con `creado_por_usuario_portal` para el
 * camino de INVESTOR: el registro del portal toca dos sistemas y no es atómico,
 * así que un alta puede haber quedado hecha en el CRM y fallar después en
 * auth-google, antes de escribir el DPI y el rol de la cuenta. El reintento
 * tiene que poder terminar.
 *
 * `createPortalRegisterLead` ya devolvía el lead existente cuando coincidía el
 * correo O el DPI, y eso es justo la idempotencia que hace falta. Lo que le
 * faltaba es fallar cerrado cuando el reintento NO pide lo mismo:
 *
 * - Si el lead se encontró por correo y su DPI es otro, el CRM lo devolvía como
 *   éxito sin actualizarlo mientras auth-google escribía en la cuenta el DPI
 *   nuevo, y los dos sistemas quedaban asociados a identidades distintas. Ese
 *   DPI nuevo puede además pertenecer a otra persona.
 * - Si el lead se encontró SOLO por el DPI, la ficha puede no tener nada que ver
 *   con quien pregunta. Un CLIENT que manda el DPI de un lead ajeno —todavía no
 *   dado de alta en `users.dpi`, que es lo único que revisa auth-google antes de
 *   llamar aquí— casaba esa ficha, y como los DPIs coincidían se aceptaba como
 *   reintento propio: `register-external-auth` grababa el DPI de la víctima en
 *   la cuenta del atacante y le devolvía los datos del lead ajeno.
 *
 * Por eso el ancla son las DOS cosas: el lead tiene que colgar del correo de la
 * sesión —la identidad de la cuenta sobre la que se van a escribir rol y DPI, y
 * el único dato del registro que no lo elige quien llama— y además pedir el
 * mismo DPI que la ficha ya guarda. La solución estructural es una marca de
 * procedencia como la de cartera, pero los leads no tienen esa columna.
 *
 * Módulo puro y sin dependencias a propósito: es la única parte con reglas y
 * así se puede probar sin levantar la base ni el resto del servidor.
 */

/** Quita separadores para poder comparar DPIs guardados con formatos distintos. */
export const normalizarParaComparar = (
	dpi: string | null | undefined,
): string => (dpi ?? "").replace(/\D/g, "");

/**
 * Deja los correos comparables entre sí.
 *
 * La búsqueda en base es un `=` exacto, así que un lead guardado como
 * "Ana@Ejemplo.com " no casa por correo y solo aparece por el DPI. Sin
 * normalizar, esa ficha —que SÍ es de quien pregunta— se rechazaría como ajena.
 */
export const normalizarCorreoParaComparar = (
	correo: string | null | undefined,
): string => (correo ?? "").trim().toLowerCase();

export type DecisionDeLead =
	| { tipo: "aceptar" }
	| { tipo: "aceptar_sin_dpi" }
	| { tipo: "conflicto_dpi" }
	| { tipo: "conflicto_correo" };

/**
 * ¿Se puede dar por bueno este lead como respuesta al registro que se pide?
 *
 * Primero el correo, que es de quién es la ficha; después el DPI, que es qué se
 * está pidiendo escribir.
 *
 * - Lead que NO cuelga del correo de la sesión: se rechaza. Incluye el lead sin
 *   correo, que es el caso que encontraba el atacante: una ficha vieja que
 *   ventas creó con DPI y sin correo no tiene forma de estar ligada a nadie, y
 *   rellenarle el correo de quien acierte el DPI es regalar la ficha. Ponerle el
 *   correo a una ficha existente es trabajo de back office.
 * - Lead sin DPI: se acepta, pero como `aceptar_sin_dpi`. RELLENARLO sería
 *   peor: con el correo todavía sin verificar (`requireEmailVerification` sigue
 *   en `false`), quien controle un correo podría estamparle su DPI al lead de
 *   otra persona. Pero tampoco puede pasar como un éxito liso: la ficha se
 *   queda sin DPI para siempre y el portal creería que quedó registrado, así
 *   que el caso se distingue para que la respuesta lo diga.
 * - Lead con el MISMO DPI: se acepta. Es el reintento del mismo registro, que
 *   es exactamente el caso que hay que dejar terminar.
 * - Lead con OTRO DPI: se rechaza. Aceptarlo dejaría el CRM con un DPI y la
 *   cuenta del portal con otro. No se actualiza el lead: cambiar el DPI de una
 *   ficha existente es una operación de back office, no un efecto colateral de
 *   reintentar un registro.
 */
export const decidirLeadDelPortal = (
	dpiDelLead: string | null | undefined,
	dpiSolicitado: string,
	correoDelLead: string | null | undefined,
	correoDeLaSesion: string | null | undefined,
): DecisionDeLead => {
	const correoGuardado = normalizarCorreoParaComparar(correoDelLead);
	const correoPedido = normalizarCorreoParaComparar(correoDeLaSesion);

	// Sin correo de sesión no hay nada contra qué probar la propiedad de la
	// ficha, así que se rechaza en vez de caer en el `"" === ""` de un lead que
	// tampoco tiene correo.
	if (!correoPedido || correoGuardado !== correoPedido) {
		return { tipo: "conflicto_correo" };
	}

	const guardado = normalizarParaComparar(dpiDelLead);
	const pedido = normalizarParaComparar(dpiSolicitado);

	if (!guardado) {
		return { tipo: "aceptar_sin_dpi" };
	}

	return guardado === pedido ? { tipo: "aceptar" } : { tipo: "conflicto_dpi" };
};
