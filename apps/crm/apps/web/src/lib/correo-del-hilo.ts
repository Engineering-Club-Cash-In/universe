import { toast } from "sonner";

/** Lo que devuelve el servidor sobre el correo al hilo de la compra. */
export interface CorreoDelHilo {
	enviado: boolean;
	enHilo: boolean;
	error?: string;
}

/**
 * Dice en pantalla qué pasó con el correo al hilo de la compra.
 *
 * Emitir, subir o reemplazar después del "Listo" manda el contrato al hilo; si
 * ese correo no sale, el contrato igual quedó emitido, y jurídico tiene que
 * saberlo para no dar por hecho que la gente del hilo lo tiene. Antes del Listo
 * no sale nada y el servidor devuelve `null`: no hay nada que decir.
 */
export function avisarCorreoDelHilo(correo: CorreoDelHilo | null | undefined) {
	if (!correo) return;

	if (!correo.enviado) {
		toast.warning(
			`No se pudo mandar al hilo de la compra (${correo.error ?? "sin detalle"}). El contrato sí quedó emitido.`,
		);
		return;
	}

	toast.success(
		correo.enHilo
			? "Se mandó al hilo del correo de la compra"
			: "Se mandó por correo, fuera del hilo: la compra es anterior al hilo automático",
	);
}
