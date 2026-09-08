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
 * Módulo puro a propósito: es la única parte con reglas y así se puede probar
 * sin levantar la base ni el resto del servidor. Lo único que importa es la
 * normalización de correo, que también es pura y que comparte con la capa de
 * SQL para que las dos no puedan divergir.
 */

import { normalizarCorreo } from "../utils/email-normalization";

/** Quita separadores para poder comparar DPIs guardados con formatos distintos. */
export const normalizarParaComparar = (
	dpi: string | null | undefined,
): string => (dpi ?? "").replace(/\D/g, "");

/**
 * Deja los correos comparables entre sí.
 *
 * Es exactamente la misma normalización que aplica la búsqueda en base
 * (`eqEmail`), y por eso se toma de ahí en vez de repetirla: cuando el registro
 * normaliza y la consulta compara exacto, la cuenta se da de alta con éxito y
 * después no encuentra su propia ficha.
 */
export const normalizarCorreoParaComparar = normalizarCorreo;

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

/**
 * Cuál de las fichas encontradas es la de quien está entrando al portal.
 *
 * `leads.email` no tiene índice único, así que dos fichas pueden colgar del
 * mismo correo con solo diferir en la caja o en un espacio —"Ana@x.com" y
 * "ana@x.com"—, y la búsqueda normaliza los dos lados, de modo que las trae a
 * las dos. Antes se tomaba la primera en silencio, y a partir de ahí TODO lo
 * que el portal hace colgado de la sesión —perfil, documentos, contratos,
 * créditos y actualizaciones— leía y escribía sobre una ficha elegida por
 * antigüedad. Con dos personas distintas capturadas bajo el mismo correo (pasa:
 * el contacto de una empresa, un familiar), eso es enseñarle a una los datos de
 * la otra.
 *
 * El DPI sí desempata, y no es un dato que elija quien llama: auth-google manda
 * el de la CUENTA. Además solo se usa para escoger entre fichas que YA cuelgan
 * de ese correo, así que no puede traer una ajena.
 *
 * Sin desempate se responde "ambiguo" y no se elige ninguna. Es lo mismo que
 * decide el registro un poco más arriba —correo y DPI, o nada— y por la misma
 * razón: quedarse sin ver el perfil se arregla unificando dos fichas; haber
 * escrito en la de otra persona, no.
 *
 * El camino sin correo no cambia: ahí no hay identidad de sesión que anclar y
 * los empates son los duplicados de DPI con formatos distintos, entre los que
 * la más antigua es la que arrastra el historial.
 */
export interface LeadCandidato {
	id: unknown;
	email: string | null;
	dpi: string | null;
}

export type EleccionDeLead<T extends LeadCandidato> =
	| { tipo: "uno"; lead: T }
	| { tipo: "ninguno" }
	| { tipo: "ambiguo"; ids: unknown[] };

export const elegirLeadDelPortal = <T extends LeadCandidato>(
	/** Candidatos YA ordenados de más antiguo a más nuevo. */
	candidatos: T[],
	busqueda: { correo?: string | null; dpi?: string | null },
): EleccionDeLead<T> => {
	const correo = normalizarCorreoParaComparar(busqueda.correo);

	if (correo) {
		const porCorreo = candidatos.filter(
			(c) => normalizarCorreoParaComparar(c.email) === correo,
		);

		if (porCorreo.length === 1) return { tipo: "uno", lead: porCorreo[0] };

		if (porCorreo.length > 1) {
			const dpi = normalizarParaComparar(busqueda.dpi);
			const porDpi = dpi
				? porCorreo.filter((c) => normalizarParaComparar(c.dpi) === dpi)
				: [];

			if (porDpi.length === 1) return { tipo: "uno", lead: porDpi[0] };

			return { tipo: "ambiguo", ids: porCorreo.map((c) => c.id) };
		}
	}

	const masAntigua = candidatos[0];
	return masAntigua ? { tipo: "uno", lead: masAntigua } : { tipo: "ninguno" };
};
