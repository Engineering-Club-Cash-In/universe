import Big from "big.js";
import { calcularAjusteFechaIdeal } from "./fecha-ideal-pago-ajuste";
import { calculateMonthlyPayment } from "./quotation-calculations";

export interface RegenerarCotizacionFechaIdealParams {
	adminCost: number;
	totalFinanced: number;
	extraAdminCost: number;
	interestRate: number;
	termMonths: number;
	insuranceCost: number;
	gpsCost: number;
	ajusteAnterior: number;
	ajusteNuevo: number;
}

export interface RegeneracionCotizacionFechaIdeal {
	adminCost: number;
	totalFinanced: number;
	extraAdminCost: number;
	monthlyPayment: number;
	delta: number;
}

export function calcularFinanciamientoFechaIdeal<
	T extends { monto_aportado?: number; porcentaje_participacion?: number },
>(params: {
	diaPagoOriginalSistema: number;
	diaPagoMensualElegido: number;
	fechaReferencia: Date;
	membershipCost: number;
	investors: T[];
	quotation: Omit<
		RegenerarCotizacionFechaIdealParams,
		"ajusteAnterior" | "ajusteNuevo"
	> & {
		idealPaymentDateAdjustment: number;
	};
}) {
	const ajusteAnterior = params.quotation.idealPaymentDateAdjustment;
	const baseCapital = params.quotation.totalFinanced - ajusteAnterior;
	if (baseCapital <= 0) {
		throw new Error("El monto base de la cotización no es válido");
	}
	const adjustment = calcularAjusteFechaIdeal({
		diaPagoOriginalSistema: params.diaPagoOriginalSistema,
		diaPagoMensualElegido: params.diaPagoMensualElegido,
		capital: baseCapital,
		porcentajeInteres: params.quotation.interestRate,
		membresiaMensual: params.membershipCost,
		seguroMensual: params.quotation.insuranceCost,
		gpsMensual: params.quotation.gpsCost,
		fechaReferencia: params.fechaReferencia,
	});
	const regenerated = calcularRegeneracionCotizacionFechaIdeal({
		...params.quotation,
		ajusteAnterior,
		ajusteNuevo: adjustment?.montoTotal ?? 0,
	});
	return {
		adjustment,
		regenerated,
		investors: aplicarDeltaMontosInversionistas(
			params.investors,
			regenerated.delta,
		),
	};
}

export function aplicarDeltaMontosInversionistas<
	T extends { monto_aportado?: number; porcentaje_participacion?: number },
>(inversionistas: T[], delta: number): Array<T & { monto_aportado: number }> {
	const totalPorcentaje = inversionistas.reduce(
		(total, inversionista) =>
			total.plus(inversionista.porcentaje_participacion ?? 0),
		new Big(0),
	);
	if (totalPorcentaje.lte(0)) {
		throw new Error("La participación total debe ser mayor a cero");
	}

	const deltaCentavos = new Big(delta).times(100).round(0, Big.roundHalfUp);
	const signo = deltaCentavos.lt(0) ? -1 : 1;
	const centavosARepartir = deltaCentavos.abs();
	const asignaciones = inversionistas.map((inversionista, index) => {
		const exacto = centavosARepartir
			.times(inversionista.porcentaje_participacion ?? 0)
			.div(totalPorcentaje);
		const centavos = exacto.round(0, Big.roundDown);
		return { index, centavos, residuo: exacto.minus(centavos) };
	});
	let restantes = centavosARepartir
		.minus(
			asignaciones.reduce(
				(total, asignacion) => total.plus(asignacion.centavos),
				new Big(0),
			),
		)
		.toNumber();
	for (const asignacion of [...asignaciones].sort(
		(a, b) => b.residuo.cmp(a.residuo) || a.index - b.index,
	)) {
		if (restantes-- <= 0) break;
		asignacion.centavos = asignacion.centavos.plus(1);
	}

	return inversionistas.map((inversionista, index) => {
		const montoActualCentavos = new Big(inversionista.monto_aportado ?? 0)
			.times(100)
			.round(0, Big.roundHalfUp);
		const nuevoMontoCentavos = montoActualCentavos.plus(
			asignaciones[index].centavos.times(signo),
		);
		if (nuevoMontoCentavos.lt(0)) {
			throw new Error("El delta no puede dejar aportaciones negativas");
		}
		return {
			...inversionista,
			monto_aportado: nuevoMontoCentavos.div(100).toNumber(),
		};
	});
}

export function calcularRegeneracionCotizacionFechaIdeal(
	params: RegenerarCotizacionFechaIdealParams,
): RegeneracionCotizacionFechaIdeal {
	const deltaBig = new Big(params.ajusteNuevo)
		.minus(params.ajusteAnterior)
		.round(2);
	const adminCost = new Big(params.adminCost).plus(deltaBig).round(2);
	const totalFinanced = new Big(params.totalFinanced).plus(deltaBig).round(2);
	const extraAdminCost = new Big(params.extraAdminCost).plus(deltaBig).round(2);

	return {
		adminCost: Number(adminCost.toString()),
		totalFinanced: Number(totalFinanced.toString()),
		extraAdminCost: Number(extraAdminCost.toString()),
		monthlyPayment: calculateMonthlyPayment(
			Number(totalFinanced.toString()),
			params.interestRate,
			params.termMonths,
			params.insuranceCost,
			params.gpsCost,
		),
		delta: Number(deltaBig.toString()),
	};
}
