import { describe, expect, test } from "bun:test";
import Big from "big.js";
import { calcularAjusteFechaIdeal } from "./fecha-ideal-pago-ajuste";

const round2 = (value: Big): Big => value.round(2, Big.roundHalfUp);

const calcularReferencia = ({
	capital,
	tasa,
	membresia,
	seguro,
	gps,
	diasDelMes,
	diaOriginal,
	diaElegido,
}: {
	capital: string;
	tasa: string;
	membresia: string;
	seguro: string;
	gps: string;
	diasDelMes: number;
	diaOriginal: number;
	diaElegido: number;
}) => {
	const diasDiferencia = Math.max(
		0,
		Math.min(diaElegido, diasDelMes) - diaOriginal,
	);
	if (diasDiferencia === 0) return null;

	const interesBaseMensual = round2(new Big(capital).times(tasa).div(100));
	const ivaInteresMensual = round2(interesBaseMensual.times("0.12"));
	const prorratear = (monto: Big) =>
		round2(monto.times(diasDiferencia).div(diasDelMes));
	const montoInteres = prorratear(interesBaseMensual.plus(ivaInteresMensual));
	const montoMembresia = prorratear(new Big(membresia));
	const montoServicios = round2(
		new Big(seguro).plus(gps).times(diasDiferencia).div(diasDelMes),
	);

	return {
		diasDiferencia,
		diasDelMes,
		montoInteres: Number(montoInteres.toString()),
		montoMembresia: Number(montoMembresia.toString()),
		montoServicios: Number(montoServicios.toString()),
		montoTotal: Number(
			montoInteres.plus(montoMembresia).plus(montoServicios).toString(),
		),
	};
};

describe("calcularAjusteFechaIdeal contra referencia decimal", () => {
	test("coincide en al menos 10,000 combinaciones contables", () => {
		const fechasReferencia = [
			new Date(2026, 0, 10, 12),
			new Date(2026, 1, 10, 12),
			new Date(2026, 2, 10, 12),
			new Date(2026, 3, 10, 12),
			new Date(2028, 0, 10, 12),
			new Date(2028, 1, 10, 12),
			new Date(2028, 2, 10, 12),
			new Date(2028, 3, 10, 12),
		];
		const capitalesYTasas = [
			["0.5", "1"],
			["10000.01", "3.333"],
			["89286", "1"],
			["12345.67", "2.875"],
		] as const;
		const membresias = ["0.01", "79.99", "123.45"];
		const servicios = [
			["0.01", "0.02"],
			["45.67", "18.91"],
		] as const;
		let combinaciones = 0;

		for (const fechaReferencia of fechasReferencia) {
			const diasDelMes = new Date(
				fechaReferencia.getFullYear(),
				fechaReferencia.getMonth() + 2,
				0,
			).getDate();
			for (const diaOriginal of [15, 30]) {
				for (let diaElegido = 1; diaElegido <= 31; diaElegido++) {
					for (const [capital, tasa] of capitalesYTasas) {
						for (const membresia of membresias) {
							for (const [seguro, gps] of servicios) {
								const esperado = calcularReferencia({
									capital,
									tasa,
									membresia,
									seguro,
									gps,
									diasDelMes,
									diaOriginal,
									diaElegido,
								});
								const actual = calcularAjusteFechaIdeal({
									diaPagoOriginalSistema: diaOriginal,
									diaPagoMensualElegido: diaElegido,
									capital: Number(capital),
									porcentajeInteres: Number(tasa),
									membresiaMensual: Number(membresia),
									seguroMensual: Number(seguro),
									gpsMensual: Number(gps),
									fechaReferencia,
								});

								expect(
									actual,
									JSON.stringify({
										fechaReferencia,
										diaOriginal,
										diaElegido,
										capital,
										tasa,
										membresia,
										seguro,
										gps,
									}),
								).toEqual(esperado);
								if (actual) {
									expect(actual.montoTotal).toBe(
										Number(
											new Big(actual.montoInteres)
												.plus(actual.montoMembresia)
												.plus(actual.montoServicios)
												.toString(),
										),
									);
								}
								combinaciones++;
							}
						}
					}
				}
			}
		}

		expect(combinaciones).toBe(11904);
	});
});
