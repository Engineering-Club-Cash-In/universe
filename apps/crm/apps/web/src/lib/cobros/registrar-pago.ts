/**
 * CB-128: mismas fórmulas puras que carteraFront usa para el registro de pago
 * (carteraFront/src/private/cartera/services/installmentContribution.ts y
 * convenioContribution.ts) — reescritas acá porque el CRM no puede importar
 * del paquete de carteraFront, pero el cálculo debe dar el mismo resultado
 * que ve tesorería al registrar el mismo pago desde su propia pantalla.
 */

export interface InstallmentContributionSummary {
	cuota_cerrada: boolean;
	total_aplicado_cuota: string;
	saldo_pendiente: string;
	tiene_abono_parcial: boolean;
}

/** Abonos ya aplicados a la cuota seleccionada, o 0 si no aplica mostrarlos. */
export function getDisplayedPartialContribution(
	summary: InstallmentContributionSummary | null,
): number {
	if (!summary || summary.cuota_cerrada || !summary.tiene_abono_parcial) {
		return 0;
	}

	const applied = Number(summary.total_aplicado_cuota);
	const pending = Number(summary.saldo_pendiente);
	return Number.isFinite(applied) && applied > 0 && pending > 0 ? applied : 0;
}

/**
 * Porción de la boleta que se acredita al convenio activo, después de
 * descontar "otros" y mora del monto disponible. El backend acepta abonos
 * parciales al convenio, así que esto es solo lo que el disponible alcanza a
 * cubrir — cartera-back es quien aplica y persiste el monto real.
 */
export function getConvenioAplicado(
	montoDisponible: number,
	otros: number,
	mora: number,
	cuotaConvenio: number,
): number {
	const disponibleTrasDescuentos = montoDisponible - otros - mora;
	return Math.min(cuotaConvenio, Math.max(0, disponibleTrasDescuentos));
}

export interface DistribucionPagoItem {
	concepto: string;
	monto: number;
}

/**
 * Distribución en cascada Otros → Mora → Convenio → Cuota, igual que el
 * modal de confirmación de carteraFront (PagoForm.tsx). Puramente informativa
 * para el asesor antes de enviar — cartera-back recalcula y aplica el pago
 * real en /newPayment.
 */
export function calcularDistribucionPago(params: {
	montoBoleta: number;
	otros: number;
	mora: number;
	cuotaConvenio: number;
	cuotaBase: number;
	abonosYaHechos: number;
	cuotaSeleccionada: number | undefined;
}): { distribucion: DistribucionPagoItem[]; montoRestante: number } {
	const {
		montoBoleta,
		otros,
		mora,
		cuotaConvenio,
		cuotaBase,
		abonosYaHechos,
		cuotaSeleccionada,
	} = params;

	let montoRestante = montoBoleta;
	const distribucion: DistribucionPagoItem[] = [];

	if (otros > 0) {
		const montoOtros = Math.min(montoRestante, otros);
		montoRestante -= montoOtros;
		distribucion.push({ concepto: "1. Otros", monto: montoOtros });
	}

	if (mora > 0) {
		const montoMora = Math.min(montoRestante, mora);
		montoRestante -= montoMora;
		distribucion.push({ concepto: "2. Mora", monto: montoMora });
	}

	if (cuotaConvenio > 0) {
		// Mismo comportamiento que PagoForm.tsx de carteraFront (líneas
		// 297-298): el convenio SÍ se resta de montoRestante antes de pasar a
		// la cuota normal, y solo se cascada a una cuota (el resto queda como
		// excedente/nuevo saldo a favor). No se cascada a múltiples cuotas
		// pendientes aunque cartera-back lo haga internamente — replica el
		// mismo alcance que ve tesorería hoy desde su propia pantalla.
		const montoConv = getConvenioAplicado(montoRestante, 0, 0, cuotaConvenio);
		montoRestante -= montoConv;
		distribucion.push({ concepto: "3. Cuota Convenio", monto: montoConv });
	}

	const cuotaNormal = Math.max(0, cuotaBase - abonosYaHechos);
	if (cuotaNormal > 0 && montoRestante > 0) {
		const montoCuota = Math.min(montoRestante, cuotaNormal);
		montoRestante -= montoCuota;
		distribucion.push({
			concepto: `4. Cuota #${cuotaSeleccionada ?? "?"}`,
			monto: montoCuota,
		});
	}

	return { distribucion, montoRestante };
}
