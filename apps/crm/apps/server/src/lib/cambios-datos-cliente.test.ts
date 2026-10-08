import { describe, expect, test } from "bun:test";
import { cambioFicha, diferenciasDatos } from "./cambios-datos-cliente";
import { trabajoEfectivo } from "./direcciones-caso";

describe("diferenciasDatos", () => {
	test("solo registra los campos que cambiaron", () => {
		expect(
			diferenciasDatos(
				{ telefono_principal: "5555-1111", correo: "a@x.com" },
				{ telefono_principal: "5555-2222", correo: "a@x.com" },
			),
		).toEqual([
			{ campo: "telefono_principal", antes: "5555-1111", despues: "5555-2222" },
		]);
	});
	test("vacío y null son lo mismo; los espacios no cuentan", () => {
		expect(
			diferenciasDatos(
				{ telefono_alternativo: null, correo: " a@x.com " },
				{ telefono_alternativo: "", correo: "a@x.com" },
			),
		).toEqual([]);
	});
	test("un campo que no viene en «después» no se toca", () => {
		expect(
			diferenciasDatos({ correo: "a@x.com" }, { telefono_principal: "1" }),
		).toEqual([{ campo: "telefono_principal", antes: null, despues: "1" }]);
	});
	test("borrar un dato se registra con «después» vacío", () => {
		expect(
			diferenciasDatos(
				{ telefono_alternativo: "1" },
				{ telefono_alternativo: null },
			),
		).toEqual([{ campo: "telefono_alternativo", antes: "1", despues: null }]);
	});
});

describe("cambioFicha", () => {
	const base = {
		id: "x",
		campo: "direccion_trabajo",
		categoria: "direcciones",
		valorAnterior: "Zona 1",
		valorNuevo: "Zona 10",
		origen: "ficha_360",
		createdAt: new Date("2026-10-08T15:00:00Z"),
		autorNombre: "Ana Gómez",
		autorRol: "cobros",
	};
	test("arma los textos que pinta la ficha", () => {
		expect(cambioFicha(base)).toEqual({
			id: "x",
			campo: "Dirección de trabajo",
			categoria: "Direcciones",
			antes: "Zona 1",
			despues: "Zona 10",
			autor: "Ana Gómez (asesor)",
			fecha: "2026-10-08T15:00:00.000Z",
			origen: "Ficha 360",
		});
	});
	test("sin autor es «Sistema» y un dato borrado es «Sin dato»", () => {
		const r = cambioFicha({
			...base,
			valorNuevo: null,
			autorNombre: null,
			autorRol: null,
		});
		expect(r.autor).toBe("Sistema");
		expect(r.despues).toBe("Sin dato");
	});
	test("un rol sin etiqueta muestra solo el nombre", () => {
		expect(cambioFicha({ ...base, autorRol: "sales" }).autor).toBe("Ana Gómez");
	});
});

describe("trabajoEfectivo", () => {
	const solicitud = {
		empresa: "Acme",
		puesto: "Piloto",
		direccion: "Zona 4",
		telefono: "2222",
		horario: "8 a 5",
	};
	test("lo corregido gana campo por campo", () => {
		expect(
			trabajoEfectivo(solicitud, { empresa: null, direccion: "Zona 9" }),
		).toEqual({ ...solicitud, direccion: "Zona 9" });
	});
	test("sin solicitud, solo lo corregido", () => {
		expect(trabajoEfectivo(null, { empresa: "Beta", direccion: null })).toEqual(
			{
				empresa: "Beta",
				puesto: null,
				direccion: null,
				telefono: null,
				horario: null,
			},
		);
	});
	test("sin nada → null", () => {
		expect(trabajoEfectivo(null, { empresa: " ", direccion: null })).toBeNull();
	});
});
