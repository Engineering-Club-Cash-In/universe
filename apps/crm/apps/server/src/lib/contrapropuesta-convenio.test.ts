import { describe, expect, test } from "bun:test";
import {
	cuotaMensualDe,
	motivoContrapropuestaInvalida,
	puedeResponderContrapropuesta,
} from "./contrapropuesta-convenio";

const base = {
	numeroMeses: 4,
	primerPago: "2026-10-20",
	hoy: "2026-10-12",
	maxMeses: 6,
	actual: { numeroMeses: 6, primerPago: "2026-10-15" },
};

describe("cuotaMensualDe", () => {
	test("el total no cambia: se divide entre las cuotas", () => {
		expect(cuotaMensualDe(12000, 4)).toBe(3000);
		expect(cuotaMensualDe(1000, 3)).toBe(333.33);
	});
});

describe("motivoContrapropuestaInvalida", () => {
	test("acepta un plan distinto y razonable", () => {
		expect(motivoContrapropuestaInvalida(base)).toBeNull();
	});

	test("el primer pago tiene que ser posterior al día del convenio", () => {
		expect(
			motivoContrapropuestaInvalida({
				...base,
				primerPago: "2026-10-12",
				diaConvenio: "2026-10-12",
			}),
		).toContain("posterior");
		expect(
			motivoContrapropuestaInvalida({
				...base,
				primerPago: "2026-10-13",
				diaConvenio: "2026-10-12",
			}),
		).toBeNull();
		// Sin el día del convenio no se aplica la regla.
		expect(
			motivoContrapropuestaInvalida({ ...base, primerPago: "2026-10-12" }),
		).toBeNull();
	});

	test("respeta el tope de cuotas", () => {
		expect(
			motivoContrapropuestaInvalida({ ...base, numeroMeses: 7 }),
		).toContain("entre 1 y 6");
		expect(
			motivoContrapropuestaInvalida({ ...base, numeroMeses: 0 }),
		).toContain("entre 1 y 6");
		expect(
			motivoContrapropuestaInvalida({ ...base, numeroMeses: 3.5 }),
		).toContain("entre 1 y 6");
		expect(
			motivoContrapropuestaInvalida({ ...base, numeroMeses: 7, maxMeses: 12 }),
		).toBeNull();
	});

	test("la fecha del primer pago no puede estar en el pasado ni muy lejos", () => {
		expect(
			motivoContrapropuestaInvalida({ ...base, primerPago: "2026-10-11" }),
		).toContain("pasado");
		expect(
			motivoContrapropuestaInvalida({ ...base, primerPago: "2026-10-12" }),
		).toBeNull();
		expect(
			motivoContrapropuestaInvalida({ ...base, primerPago: "2027-02-01" }),
		).toContain("90 días");
		expect(
			motivoContrapropuestaInvalida({ ...base, primerPago: "12/10/2026" }),
		).toContain("no es válida");
	});

	test("no deja enviar un plan igual al propuesto", () => {
		expect(
			motivoContrapropuestaInvalida({
				...base,
				numeroMeses: 6,
				primerPago: "2026-10-15",
			}),
		).toContain("igual al plan");
	});
});

describe("puedeResponderContrapropuesta", () => {
	const quien = {
		esSupervisor: false,
		emailSesion: " Ana@Cash.com ",
		emailAsesorDelCredito: "ana@cash.com",
	};
	test("el asesor que lleva el crédito acepta o descarta", () => {
		expect(puedeResponderContrapropuesta({ ...quien, accion: "aceptar" })).toBe(
			true,
		);
		expect(
			puedeResponderContrapropuesta({ ...quien, accion: "descartar" }),
		).toBe(true);
	});
	test("otro asesor no puede", () => {
		expect(
			puedeResponderContrapropuesta({
				...quien,
				emailSesion: "otro@cash.com",
				accion: "aceptar",
			}),
		).toBe(false);
	});
	test("un supervisor solo la retira", () => {
		const sup = {
			esSupervisor: true,
			emailSesion: "sup@cash.com",
			emailAsesorDelCredito: "ana@cash.com",
		};
		expect(puedeResponderContrapropuesta({ ...sup, accion: "descartar" })).toBe(
			true,
		);
		expect(puedeResponderContrapropuesta({ ...sup, accion: "aceptar" })).toBe(
			false,
		);
	});
	test("sin correo del asesor del crédito, solo la retira el supervisor", () => {
		expect(
			puedeResponderContrapropuesta({
				...quien,
				emailAsesorDelCredito: null,
				accion: "aceptar",
			}),
		).toBe(false);
	});
});
