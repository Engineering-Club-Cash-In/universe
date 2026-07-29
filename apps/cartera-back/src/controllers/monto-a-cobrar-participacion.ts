type SplitValido = {
	valido: true;
	capitalInv: number;
	capitalCube: number;
	interesIvaInv: number;
	interesIvaCube: number;
};

type SplitInvalido = {
	valido: false;
	capitalInv: 0;
	capitalCube: 0;
	interesIvaInv: 0;
	interesIvaCube: 0;
};

const redondearMoneda = (monto: number) => Number(monto.toFixed(2));

export function agregarParticipacionExterna(porcentajes: number[]): number {
	return porcentajes.reduce((total, porcentaje) => total + porcentaje / 100, 0);
}

export function splitMontoSegunParticipacionActual(
	capital: number,
	interesIva: number,
	participacionExternaActual: number,
): SplitValido | SplitInvalido {
	if (
		participacionExternaActual < 0 ||
		participacionExternaActual > 1
	) {
		return {
			valido: false,
			capitalInv: 0,
			capitalCube: 0,
			interesIvaInv: 0,
			interesIvaCube: 0,
		};
	}

	const capitalInv = redondearMoneda(capital * participacionExternaActual);
	const interesIvaInv = redondearMoneda(
		interesIva * participacionExternaActual,
	);
	return {
		valido: true,
		capitalInv,
		capitalCube: capital - capitalInv,
		interesIvaInv,
		interesIvaCube: interesIva - interesIvaInv,
	};
}
