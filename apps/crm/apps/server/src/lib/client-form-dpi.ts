import { normalizarDpi } from "../utils/cui-validation";

/**
 * El DPI que llega por el formulario público tiene que ser el del participante
 * del token, no otro.
 *
 * 🔴 El agujero que tapa. Los formularios de `routers/client-forms.ts` son
 * `publicProcedure`: la única credencial es el token del enlace, que identifica
 * a UNA persona (un lead o un co-deudor). Pero el `dpi` del cuerpo se guardaba
 * tal cual, sin cruzarlo contra esa persona. Con un token vigente —el enlace
 * que se le manda al cliente por WhatsApp— se podía firmar una solicitud de
 * crédito a nombre de otro DPI y quedaba escrita así.
 *
 * Y no es solo un dato mal puesto: puentea el invariante del candado. El
 * candado existe para que la identidad de un expediente no se mueva después
 * del 30%, y esta ruta escribía identidad sin pasar por él.
 *
 * La regla es deliberadamente angosta:
 *
 * - Si el participante YA tiene DPI guardado, el del formulario debe coincidir.
 *   Se compara normalizado porque los DPI viejos quedaron guardados con
 *   espacios ("3460 66638 0101") y un `===` crudo rechazaría a la persona
 *   correcta.
 * - Si el participante NO tiene DPI guardado, se acepta: ese es el caso
 *   legítimo y frecuente —el formulario es justamente donde se captura—.
 * - Si el formulario no manda DPI, no hay nada que contrastar.
 *
 * O sea: esto no captura identidad nueva ni la corrige, solo impide que una
 * solicitud firmada diga ser de alguien distinto al dueño del enlace.
 */
export const MENSAJE_DPI_NO_COINCIDE =
	"El DPI no coincide con el registrado para esta solicitud; contactá a tu asesor para corregirlo.";

export type ResultadoDpiDelFormulario =
	| { coincide: true }
	| { coincide: false; mensaje: string };

export function verificarDpiDelFormulario(
	dpiGuardadoDelParticipante: string | null | undefined,
	dpiDelFormulario: string | null | undefined,
): ResultadoDpiDelFormulario {
	const guardado = (dpiGuardadoDelParticipante ?? "").trim();
	const delFormulario = (dpiDelFormulario ?? "").trim();

	// Captura legítima: el participante todavía no tiene DPI.
	if (guardado === "") return { coincide: true };

	// El formulario no lo manda: no hay identidad que contrastar.
	if (delFormulario === "") return { coincide: true };

	if (normalizarDpi(guardado) === normalizarDpi(delFormulario)) {
		return { coincide: true };
	}

	return { coincide: false, mensaje: MENSAJE_DPI_NO_COINCIDE };
}
