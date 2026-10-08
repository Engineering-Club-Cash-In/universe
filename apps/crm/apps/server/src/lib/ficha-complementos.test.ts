import { describe, expect, test } from "bun:test";
import {
	apellidoDeCasada,
	armarCodeudores,
	armarDatosPersonales,
	armarSeguro,
	type FuenteLead,
	type FuenteRenap,
	fechaISO,
	mismoTelefono,
	nombrePropio,
	textoEstadoCivil,
	textoSexo,
} from "./ficha-complementos";

const renap: FuenteRenap = {
	dpi: "2993062160101",
	firstName: "MARÍA",
	secondName: "JOSÉ",
	thirdName: null,
	firstLastName: "DE LA CRUZ",
	secondLastName: "PÉREZ",
	marriedLastName: "GARCÍA",
	birthDate: "1999-04-03",
	gender: "F",
	civilStatus: "C",
};

const lead: FuenteLead = {
	firstName: "Maria",
	middleName: null,
	lastName: "Cruz",
	secondLastName: "",
	dpi: "2993 06216 0101",
	birthDate: new Date("1998-01-02T00:00:00Z"),
	gender: "male",
	maritalStatus: "single",
};

describe("utilidades", () => {
	test("nombrePropio deja las partículas en minúscula", () => {
		expect(nombrePropio("MARÍA DE LA CRUZ")).toBe("María de la Cruz");
		expect(nombrePropio("DE LEÓN")).toBe("De León");
	});
	test("fechaISO acepta Date, ISO y DD/MM/YYYY", () => {
		expect(fechaISO(new Date("1987-08-31T00:00:00Z"))).toBe("1987-08-31");
		expect(fechaISO("1987-08-31")).toBe("1987-08-31");
		expect(fechaISO("1987-08-31 00:00:00")).toBe("1987-08-31");
		expect(fechaISO("5/3/1990")).toBe("1990-03-05");
		expect(fechaISO("")).toBeNull();
		expect(fechaISO("ayer")).toBeNull();
		expect(fechaISO("31/02/1990")).toBeNull();
		expect(fechaISO("1990-13-40")).toBeNull();
		expect(fechaISO("1990-02-30")).toBeNull();
		expect(fechaISO("29/02/2024")).toBe("2024-02-29");
	});
	test("textoSexo entiende las tres fuentes", () => {
		expect(textoSexo("M")).toBe("Masculino");
		expect(textoSexo("female")).toBe("Femenino");
		expect(textoSexo("masculino")).toBe("Masculino");
		expect(textoSexo("")).toBeNull();
	});
	test("textoEstadoCivil concuerda con el sexo", () => {
		expect(textoEstadoCivil("C", "Femenino")).toBe("Casada");
		expect(textoEstadoCivil("single", "Masculino")).toBe("Soltero");
		expect(textoEstadoCivil("unido", null)).toBe("Unido(a)");
		expect(textoEstadoCivil("viuda", "Femenino")).toBe("Viuda");
		expect(textoEstadoCivil("otro", null)).toBeNull();
	});
});

describe("armarDatosPersonales", () => {
	test("RENAP gana campo por campo", () => {
		expect(armarDatosPersonales({ renap, lead, solicitud: null })).toEqual({
			nombreCompleto: "María José de la Cruz Pérez de García",
			dpi: "2993062160101",
			fechaNacimiento: "1999-04-03",
			sexo: "Femenino",
			estadoCivil: "Casada",
		});
	});
	test("lo que falta en RENAP sale del lead y después de la solicitud", () => {
		const r = armarDatosPersonales({
			renap: { ...renap, birthDate: null, civilStatus: null },
			lead: { ...lead, birthDate: null, maritalStatus: null },
			solicitud: {
				fechaNacimiento: "1990-02-03",
				sexo: "masculino",
				estadoCivil: "unido",
			},
		});
		expect(r?.fechaNacimiento).toBe("1990-02-03");
		expect(r?.sexo).toBe("Femenino");
		expect(r?.estadoCivil).toBe("Unida");
	});
	test("sin RENAP usa el lead", () => {
		expect(
			armarDatosPersonales({ renap: null, lead, solicitud: null }),
		).toEqual({
			nombreCompleto: "Maria Cruz",
			dpi: "2993 06216 0101",
			fechaNacimiento: "1998-01-02",
			sexo: "Masculino",
			estadoCivil: "Soltero",
		});
	});
	test("sin RENAP ni lead → null", () => {
		expect(
			armarDatosPersonales({ renap: null, lead: null, solicitud: null }),
		).toBeNull();
	});
});

describe("armarCodeudores", () => {
	test("numera, completa con la solicitud y no repite teléfonos", () => {
		const r = armarCodeudores(
			[
				{ id: "a", fullName: " Ana López ", email: null, phone: "5555-1234" },
				{ id: "b", fullName: "Luis Paz", email: "luis@x.com", phone: null },
			],
			[
				{
					personId: "a",
					email: "ana@x.com",
					telMovil: "55551234",
					telResidencia: "2222-3333",
					direccionResidencia: "Zona 1",
					empresa: "Acme",
					direccionTrabajo: "Zona 10",
				},
			],
		);
		expect(r).toEqual([
			{
				id: "a",
				nombre: "Ana López",
				rol: "Codeudor 1",
				correo: "ana@x.com",
				telefonoPrincipal: "5555-1234",
				celularAlterno: null,
				telefonoCasa: "2222-3333",
				residencia: "Zona 1",
				trabajo: "Acme · Zona 10",
			},
			{
				id: "b",
				nombre: "Luis Paz",
				rol: "Codeudor 2",
				correo: "luis@x.com",
				telefonoPrincipal: null,
				celularAlterno: null,
				telefonoCasa: null,
				residencia: null,
				trabajo: null,
			},
		]);
	});
	test("sin teléfono en co_debtors usa el móvil de la solicitud", () => {
		const [c] = armarCodeudores(
			[{ id: "a", fullName: "Ana", email: null, phone: "" }],
			[
				{
					personId: "a",
					email: null,
					telMovil: "4444-0000",
					telResidencia: null,
					direccionResidencia: null,
					empresa: null,
					direccionTrabajo: "Zona 4",
				},
			],
		);
		expect(c.telefonoPrincipal).toBe("4444-0000");
		expect(c.celularAlterno).toBeNull();
		expect(c.trabajo).toBe("Zona 4");
	});
});

describe("armarSeguro", () => {
	test("traduce el tipo de cobertura y el deducible", () => {
		expect(armarSeguro({ tipoCobertura: "amplia", deducible: "2500" })).toEqual(
			{
				tipoSeguro: "Cobertura amplia",
				coberturas: "Deducible Q2,500.00",
				aseguradora: null,
				telefonoEmergencia: null,
				poliza: null,
				montoAsegurado: null,
				vencimiento: null,
			},
		);
	});
	test("póliza, monto y vencimiento viajan con el mismo vehículo", () => {
		expect(
			armarSeguro({
				tipoCobertura: "total",
				deducible: null,
				numeroPoliza: " POL-123 ",
				montoAsegurado: "85000.00",
				fechaVencimientoSeguro: new Date("2027-03-15T00:00:00Z"),
			}),
		).toMatchObject({
			poliza: "POL-123",
			montoAsegurado: "85000.00",
			vencimiento: "2027-03-15",
		});
	});
	test("columnas vacías → null en cada campo", () => {
		expect(armarSeguro({ tipoCobertura: null, deducible: null })).toEqual({
			tipoSeguro: null,
			coberturas: null,
			aseguradora: null,
			telefonoEmergencia: null,
			poliza: null,
			montoAsegurado: null,
			vencimiento: null,
		});
	});
	test("aseguradora y cabina según el proveedor de la oportunidad", () => {
		const base = { tipoCobertura: null, deducible: null };
		expect(armarSeguro({ ...base, insuranceProvider: "gyt" })).toMatchObject({
			aseguradora: "Seguro GYT",
			telefonoEmergencia: "1778",
		});
		expect(
			armarSeguro({ ...base, insuranceProvider: "universales" }),
		).toMatchObject({
			aseguradora: "Seguros Universales",
			telefonoEmergencia: "2384-7400",
		});
	});
	test("un tipo desconocido se muestra tal cual", () => {
		expect(
			armarSeguro({ tipoCobertura: "Todo riesgo", deducible: "0" }).tipoSeguro,
		).toBe("Todo riesgo");
	});
});

describe("apellidoDeCasada", () => {
	test("no repite la preposición que RENAP ya trae", () => {
		expect(apellidoDeCasada("MÉNDEZ")).toBe("de MÉNDEZ");
		expect(apellidoDeCasada("DE MÉNDEZ")).toBe("DE MÉNDEZ");
		expect(apellidoDeCasada("Del Cid")).toBe("Del Cid");
		expect(apellidoDeCasada("DEL VALLE")).toBe("DEL VALLE");
		expect(apellidoDeCasada("DELGADO")).toBe("de DELGADO");
	});
	test("el nombre completo no lleva «de de»", () => {
		const r = armarDatosPersonales({
			renap: { ...renap, marriedLastName: "DE MENDEZ" },
			lead: null,
			solicitud: null,
		});
		expect(r?.nombreCompleto).toBe("María José de la Cruz Pérez de Mendez");
	});
});

describe("mismoTelefono", () => {
	test("ignora guiones, espacios y el código de país", () => {
		expect(mismoTelefono("5878-3734", "58783734")).toBe(true);
		expect(mismoTelefono("50258783734", "58783734")).toBe(true);
		expect(mismoTelefono("+502 5878 3734", "5878-3734")).toBe(true);
		expect(mismoTelefono("58783734", "58783735")).toBe(false);
		expect(mismoTelefono(null, "58783734")).toBe(false);
	});
});

describe("armarCodeudores · teléfonos repetidos", () => {
	const base = { id: "a", fullName: "Ana", email: null };
	const sol = {
		personId: "a",
		email: null,
		direccionResidencia: null,
		empresa: null,
		direccionTrabajo: null,
	};
	test("el código de país no esconde el número repetido", () => {
		const [c] = armarCodeudores(
			[{ ...base, phone: "58783734" }],
			[{ ...sol, telMovil: "50258783734", telResidencia: "50258783734" }],
		);
		expect(c.telefonoPrincipal).toBe("58783734");
		expect(c.celularAlterno).toBeNull();
		expect(c.telefonoCasa).toBeNull();
	});
	test("celular y casa iguales entre sí salen una sola vez", () => {
		const [c] = armarCodeudores(
			[{ ...base, phone: "55550000" }],
			[{ ...sol, telMovil: "52273737", telResidencia: "5227-3737" }],
		);
		expect(c.celularAlterno).toBe("52273737");
		expect(c.telefonoCasa).toBeNull();
	});
});
