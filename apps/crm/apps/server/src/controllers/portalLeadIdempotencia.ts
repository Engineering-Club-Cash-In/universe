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
 * faltaba es fallar cerrado cuando el reintento NO pide lo mismo: si el lead se
 * encontró por correo y su DPI es otro, el CRM lo devolvía como éxito sin
 * actualizarlo mientras auth-google escribía en la cuenta el DPI nuevo, y los
 * dos sistemas quedaban asociados a identidades distintas. Ese DPI nuevo puede
 * además pertenecer a otra persona.
 *
 * Módulo puro y sin dependencias a propósito: es la única parte con reglas y
 * así se puede probar sin levantar la base ni el resto del servidor.
 */

/** Quita separadores para poder comparar DPIs guardados con formatos distintos. */
export const normalizarParaComparar = (
	dpi: string | null | undefined,
): string => (dpi ?? "").replace(/\D/g, "");

export type DecisionDeLead =
	| { tipo: "aceptar" }
	| { tipo: "aceptar_sin_dpi" }
	| { tipo: "conflicto_dpi" };

/**
 * ¿Se puede dar por bueno este lead como respuesta al registro que se pide?
 *
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
): DecisionDeLead => {
	const guardado = normalizarParaComparar(dpiDelLead);
	const pedido = normalizarParaComparar(dpiSolicitado);

	if (!guardado) {
		return { tipo: "aceptar_sin_dpi" };
	}

	return guardado === pedido ? { tipo: "aceptar" } : { tipo: "conflicto_dpi" };
};
