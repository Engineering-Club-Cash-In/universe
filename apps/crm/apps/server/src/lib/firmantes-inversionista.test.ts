import { describe, expect, test } from "bun:test";

process.env.CONTRATOS_REP_LEGAL_INVERSIONES_EMAIL = "andres@ejemplo.com";
process.env.CONTRATOS_REP_LEGAL_INVERSIONES_NOMBRE = "ANDRÉS DE PRUEBA";
process.env.CONTRATOS_REP_LEGAL_RDBE_EMAIL = "richard@ejemplo.com";
process.env.CONTRATOS_REP_LEGAL_RDBE_NOMBRE = "RICHARD DE PRUEBA";
process.env.TEST_MESSAGE = "false";

const { firmantesDeContratoDeInversion } = await import(
	"./firmantes-inversionista"
);

const ANA = {
	nombre: "ANA CAROLINA REITER",
	email: "ana@ejemplo.com",
	identificacion: "face" as const,
};

describe("firmantes de un contrato de inversiones", () => {
	test("una carta la firma sólo el inversionista", () => {
		const firmantes = firmantesDeContratoDeInversion(
			"carta_confirmacion_inversion_inicial",
			ANA,
		);

		expect(firmantes).toEqual([
			{
				role: "TITULAR",
				email: "ana@ejemplo.com",
				name: "ANA CAROLINA REITER",
				identification: "face",
			},
		]);
	});

	test("lo que se le pide al inversionista va en su firma, no en la de los representantes", () => {
		const firmantes = firmantesDeContratoDeInversion(
			"contrato_servicios_cash_in_inversor_general",
			{ ...ANA, identificacion: "none" },
		);

		expect(firmantes.map((f) => [f.role, f.identification])).toEqual([
			["TITULAR", "none"],
			["REP_LEGAL", undefined],
			["REP_LEGAL_RDBE", undefined],
		]);
	});

	test("el acuerdo de inversión lleva además al representante de CUBE", () => {
		const firmantes = firmantesDeContratoDeInversion(
			"acuerdo_inversion_cash_in",
			ANA,
		);

		expect(firmantes.map((f) => f.role)).toEqual(["TITULAR", "REP_LEGAL"]);
		expect(firmantes[1].email).toBe("andres@ejemplo.com");
	});

	test("el contrato de servicios lleva a las dos sociedades, con correos distintos", () => {
		const firmantes = firmantesDeContratoDeInversion(
			"contrato_servicios_cash_in_inversor_general",
			ANA,
		);

		expect(firmantes.map((f) => f.role)).toEqual([
			"TITULAR",
			"REP_LEGAL",
			"REP_LEGAL_RDBE",
		]);
		// WeeTrust junta a los firmantes por correo: con el mismo correo en las dos
		// líneas de entidad, una de las dos firmas desaparece del documento.
		const correos = firmantes.map((f) => f.email);
		expect(new Set(correos).size).toBe(correos.length);
	});

	test("la sociedad usa sus propios tipos y firma igual que su equivalente", () => {
		const firmantes = firmantesDeContratoDeInversion(
			"cesion_creditos_sociedad",
			ANA,
		);

		expect(firmantes.map((f) => f.role)).toEqual(["TITULAR", "REP_LEGAL"]);
	});

	test("un contrato de ventas no se emite por esta vía", () => {
		expect(() =>
			firmantesDeContratoDeInversion("garantia_mobiliaria", ANA),
		).toThrow(/no es de inversiones/);
	});

	test("sin correo del inversionista se corta antes de mandar nada", () => {
		expect(() =>
			firmantesDeContratoDeInversion("acuerdo_inversion_cash_in", {
				nombre: "SIN CORREO",
				email: "   ",
				identificacion: "face",
			}),
		).toThrow(/no tiene correo registrado/);
	});

	test("el inversionista no puede compartir correo con el representante", () => {
		expect(() =>
			firmantesDeContratoDeInversion("acuerdo_inversion_cash_in", {
				nombre: "ALGUIEN DE LA CASA",
				email: "andres@ejemplo.com",
				identificacion: "face",
			}),
		).toThrow(/repetido/);
	});
});
