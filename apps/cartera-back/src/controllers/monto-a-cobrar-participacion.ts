import Big from "big.js";
import {
	calcularPropiedadesPorMonto,
} from "../cofidi/splitInteresPci";

export type ParticipacionReporteInversionista = {
	montoAportado: string | Big;
	esExterno: boolean;
	spreadHistorico: string | Big;
};

export type SplitParticipacionReporte = {
	capitalInv: Big;
	capitalCube: Big;
	interesInv: Big;
	interesCube: Big;
	ivaInv: Big;
	ivaCube: Big;
	interesIvaInv: Big;
	interesIvaCube: Big;
};

const cero = new Big(0);
const aCentavos = (monto: Big) => monto.round(2, Big.roundHalfUp);

export function seleccionarSpreadHistorico({
	porcentajeParticipacionInversionista,
	modalidadFacturacionSpreadId,
	spreadCatalogo,
}: {
	porcentajeParticipacionInversionista: string | Big;
	modalidadFacturacionSpreadId: number | null;
	spreadCatalogo: string | Big | null;
}): Big {
	return modalidadFacturacionSpreadId !== null && spreadCatalogo !== null
		? new Big(spreadCatalogo)
		: new Big(porcentajeParticipacionInversionista);
}

/**
 * Misma semántica de interés PCI: monto_aportado / total_aportado × spread.
 * Para el reporte, CUBE absorbe el residuo de cada rubro después de redondear.
 */
export function calcularSplitParticipacionReporte({
	capital,
	interes,
	iva,
	inversionistas,
}: {
	capital: string | Big;
	interes: string | Big;
	iva: string | Big;
	inversionistas: ParticipacionReporteInversionista[];
}): SplitParticipacionReporte {
	const ownerships = calcularPropiedadesPorMonto(
		inversionistas.map((inversionista) => ({
			montoAportado: inversionista.montoAportado,
		})),
	);
	const factorCapital = ownerships.reduce(
		(total, ownership, index) =>
			inversionistas[index]?.esExterno ? total.plus(ownership) : total,
		cero,
	);
	const totalAportado = inversionistas.reduce(
		(total, inversionista) => total.plus(inversionista.montoAportado),
		cero,
	);
	const capitalTotal = new Big(capital);
	const interesTotal = new Big(interes);
	const ivaTotal = new Big(iva);
	const capitalInv = aCentavos(capitalTotal.times(factorCapital));
	const interesInv = inversionistas.reduce(
		(total, inversionista) =>
			inversionista.esExterno
				? total.plus(
					aCentavos(
						totalAportado.gt(0)
							? interesTotal
								.times(new Big(inversionista.spreadHistorico).div(100))
								.times(inversionista.montoAportado)
								.div(totalAportado)
							: cero,
					),
				)
				: total,
		cero,
	);
	const ivaInv = inversionistas.reduce(
		(total, inversionista) =>
			inversionista.esExterno
				? total.plus(
					aCentavos(
						totalAportado.gt(0)
							? ivaTotal
								.times(new Big(inversionista.spreadHistorico).div(100))
								.times(inversionista.montoAportado)
								.div(totalAportado)
							: cero,
					),
				)
				: total,
		cero,
	);
	const interesIvaInv = interesInv.plus(ivaInv);

	return {
		capitalInv,
		capitalCube: capitalTotal.minus(capitalInv),
		interesInv,
		interesCube: interesTotal.minus(interesInv),
		ivaInv,
		ivaCube: ivaTotal.minus(ivaInv),
		interesIvaInv,
		interesIvaCube: interesTotal.plus(ivaTotal).minus(interesIvaInv),
	};
}
