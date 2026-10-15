import { describe, expect, test } from "bun:test";
import {
	type CoincidenciaDeReferencia,
	encabezadoReferencia,
	textoAvisoReferencia,
	textoCoincidencia,
	textoMas,
} from "./texto-referencia-repetida";

const base: CoincidenciaDeReferencia = {
	tipo: "personal",
	clienteNombre: "Ana López",
	referenciaNombre: "Rosa",
	parentesco: "tía",
	dadaPor: { nombre: "Carlos Pérez", rol: "codeudor" },
	coincidePor: "telefono",
};

describe("textoCoincidencia", () => {
	test("referencia personal de la solicitud, dada por un codeudor", () => {
		expect(textoCoincidencia(base)).toBe(
			"Ana López — en su solicitud la dio su codeudor Carlos Pérez como referencia personal «Rosa» (tía) · coincide por teléfono",
		);
	});
	test("referencia personal dada por el titular", () => {
		expect(
			textoCoincidencia({
				...base,
				dadaPor: { nombre: "Ana López", rol: "titular" },
			}),
		).toBe(
			"Ana López — en su solicitud la dio el titular como referencia personal «Rosa» (tía) · coincide por teléfono",
		);
	});
	test("referencia familiar de la solicitud", () => {
		expect(
			textoCoincidencia({
				...base,
				tipo: "familiar",
				parentesco: null,
				dadaPor: { nombre: "Ana López", rol: "titular" },
				coincidePor: "dpi",
			}),
		).toBe(
			"Ana López — en su solicitud la dio el titular como referencia familiar «Rosa» · coincide por DPI",
		);
	});
	test("cobros usa la etiqueta legible del parentesco", () => {
		expect(
			textoCoincidencia({
				...base,
				tipo: "cobros",
				parentesco: "padre_madre",
				coincidePor: "dpi",
			}),
		).toBe(
			"Ana López — registrada en cobros como «Rosa» (Padre/Madre) · coincide por DPI",
		);
	});
	test("la relación de la solicitud se muestra tal cual, aunque parezca un enum", () => {
		expect(textoCoincidencia({ ...base, parentesco: "padre_madre" })).toContain(
			"(padre_madre)",
		);
	});
	test("si falta un nombre se omite esa parte, sin relleno", () => {
		const vacio = {
			clienteNombre: null,
			referenciaNombre: null,
			parentesco: null,
			dadaPor: { nombre: null, rol: "codeudor" as const },
			coincidePor: "dpi" as const,
		};
		const t = textoCoincidencia({ ...vacio, tipo: "familiar" });
		expect(t).toBe(
			"Otro cliente — en su solicitud la dio su codeudor como referencia familiar · coincide por DPI",
		);
		expect(t).not.toContain("Sin nombre");
		expect(textoCoincidencia({ ...vacio, tipo: "cobros" })).toBe(
			"Otro cliente — registrada en cobros · coincide por DPI",
		);
	});
});

describe("encabezadoReferencia y textoMas", () => {
	const ref = {
		tipo: "personal" as const,
		indice: 0,
		nombre: "Rosa",
		dpi: "",
		total: 1,
		coincidencias: [{}],
	};
	test("singular y plural", () => {
		expect(encabezadoReferencia(ref)).toBe(
			"La referencia personal «Rosa» ya aparece como referencia de otro cliente:",
		);
		expect(encabezadoReferencia({ ...ref, total: 3 })).toBe(
			"La referencia personal «Rosa» ya aparece como referencia de otros 3 clientes:",
		);
	});
	test("dice «familiar» o «personal» según la lista revisada", () => {
		expect(encabezadoReferencia({ ...ref, tipo: "familiar" })).toBe(
			"La referencia familiar «Rosa» ya aparece como referencia de otro cliente:",
		);
	});
	test("sin nombre usa el número, y muestra el DPI si lo hay", () => {
		expect(
			encabezadoReferencia({
				...ref,
				tipo: "familiar",
				indice: 1,
				nombre: " ",
				dpi: "1234567030101",
			}),
		).toBe(
			"La referencia familiar #2 (DPI 1234567030101) ya aparece como referencia de otro cliente:",
		);
	});
	test("«y N más» solo cuando se recortó", () => {
		const larga = { ...ref, total: 12, coincidencias: new Array(10).fill({}) };
		expect(textoMas(larga)).toBe("y 2 más");
		expect(textoMas({ ...larga, total: 10 })).toBeNull();
	});
});

describe("textoAvisoReferencia (sin detalle de los otros clientes)", () => {
	const ref = {
		tipo: "personal" as const,
		indice: 0,
		nombre: "Rosa",
		dpi: "1234567030101",
		total: 1,
	};

	test("singular y plural", () => {
		expect(textoAvisoReferencia(ref)).toBe(
			"La referencia personal «Rosa» (DPI 1234567030101) ya aparece como referencia de otro cliente.",
		);
		expect(textoAvisoReferencia({ ...ref, total: 3 })).toBe(
			"La referencia personal «Rosa» (DPI 1234567030101) ya aparece como referencia de otros 3 clientes.",
		);
	});

	test("familiar, sin nombre ni DPI", () => {
		expect(
			textoAvisoReferencia({
				...ref,
				tipo: "familiar",
				indice: 1,
				nombre: " ",
				dpi: "",
			}),
		).toBe("La referencia familiar #2 ya aparece como referencia de otro cliente.");
	});
});
