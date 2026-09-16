import type { StatusCreditEnum } from "../types/cartera-back";

// Aparte de sync-casos-cobros.ts para poder probar la regla sin cargar la DB,
// el cliente de cartera ni las notificaciones que aquel arrastra.

/**
 * Determina si un crédito debe tener caso de cobros activo
 */
export function debeCrearCasoCobros(
	statusCredit: StatusCreditEnum,
	diasMora: number,
): boolean {
	// COBROS-02 Fase 4: EN_RECUPERACION SIEMPRE tiene caso, sin importar los
	// días de mora.
	//
	// Estos créditos hasta ayer eran MOROSO (review de Codex, P1): son los de
	// más riesgo de la cartera —se decidió recuperarles la unidad— y sin caso
	// dejaban de tener seguimiento justo cuando más lo necesitan.
	//
	// Y el gate de `diasMora > 0` no les sirve (segunda review, P1). Los días se
	// calculan sobre las CUOTAS vencidas, pero la recuperación solo se levanta
	// cuando no se debe nada —cuotas NI mora (decisión 18,
	// `levantarRecuperacionSiPagoTodo`)—. Un crédito que pagó sus cuotas pero
	// no la mora sigue EN_RECUPERACION a propósito, con 0 días: con el gate, la
	// sync le cerraba el caso mientras la recuperación del vehículo seguía
	// activa. Mientras el estado exista, la decisión de recuperar sigue en pie.
	if (statusCredit === "EN_RECUPERACION") return true;

	// Resto: solo créditos activos o morosos con días de mora > 0.
	return (statusCredit === "ACTIVO" || statusCredit === "MOROSO") && diasMora > 0;
}
