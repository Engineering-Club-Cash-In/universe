import { describe, expect, test } from "bun:test";
import type { VehiculoSatPropio } from "../services/cartera-back-client";
import {
	construirResultados,
	estadoCorridaDesdeSat,
} from "./sat-verificacion-vehiculos";

function vehiculoSat(
	placa: string,
	estado = "Activo",
	extra: Partial<VehiculoSatPropio> = {},
): VehiculoSatPropio {
	return {
		placa,
		tipo: "Automovil",
		marca: "Toyota",
		modelo: "2020",
		color: "Blanco",
		estado,
		...extra,
	};
}

describe("cruce de vehículos contra SAT", () => {
	test("vehículo propio que aparece Activo en SAT queda en orden", () => {
		const filas = construirResultados(
			[{ id: "veh-1", placa: "P-123ABC" }],
			[vehiculoSat("P-123ABC")],
		);

		expect(filas).toHaveLength(1);
		expect(filas[0].resultado).toBe("activo_ok");
		expect(filas[0].eraEsperado).toBe(true);
		expect(filas[0].vehicleId).toBe("veh-1");
		expect(filas[0].estadoSat).toBe("Activo");
	});

	test("vehículo propio que aparece Inactivo genera alerta de inactivo", () => {
		const filas = construirResultados(
			[{ id: "veh-1", placa: "P-123ABC" }],
			[vehiculoSat("P-123ABC", "Inactivo")],
		);

		expect(filas[0].resultado).toBe("inactivo");
		expect(filas[0].eraEsperado).toBe(true);
	});

	test("vehículo propio que NO aparece en SAT es la alerta principal", () => {
		const filas = construirResultados(
			[{ id: "veh-1", placa: "P-789GHI" }],
			[vehiculoSat("P-123ABC")],
		);

		const salido = filas.find((f) => f.placa === "P-789GHI");
		expect(salido?.resultado).toBe("no_aparece_en_sat");
		expect(salido?.eraEsperado).toBe(true);
		// Sin datos de SAT porque no apareció en el listado.
		expect(salido?.estadoSat).toBeNull();
	});

	test("placa que SAT reporta y el CRM no tiene registrada", () => {
		const filas = construirResultados([], [vehiculoSat("P-456DEF")]);

		expect(filas).toHaveLength(1);
		expect(filas[0].resultado).toBe("no_registrado_interno");
		expect(filas[0].eraEsperado).toBe(false);
		expect(filas[0].vehicleId).toBeNull();
	});

	test("empareja aunque el formato de placa difiera entre SAT y el CRM", () => {
		const filas = construirResultados(
			[
				{ id: "veh-1", placa: "m999zzz" },
				{ id: "veh-2", placa: "P 456 DEF" },
			],
			[vehiculoSat("M-999ZZZ"), vehiculoSat("P-456DEF")],
		);

		expect(filas).toHaveLength(2);
		expect(filas.every((f) => f.resultado === "activo_ok")).toBe(true);
		// Se conserva la placa tal como está en el CRM, no la normalizada.
		expect(filas.map((f) => f.placa).sort()).toEqual(["P 456 DEF", "m999zzz"]);
	});

	test("ignora vehículos propios sin placa registrada", () => {
		const filas = construirResultados(
			[
				{ id: "veh-1", placa: null },
				{ id: "veh-2", placa: "P-123ABC" },
			],
			[vehiculoSat("P-123ABC")],
		);

		expect(filas).toHaveLength(1);
		expect(filas[0].vehicleId).toBe("veh-2");
	});

	test("escenario mixto: una de cada señal", () => {
		const filas = construirResultados(
			[
				{ id: "veh-1", placa: "P-111AAA" },
				{ id: "veh-2", placa: "P-222BBB" },
				{ id: "veh-3", placa: "P-333CCC" },
			],
			[
				vehiculoSat("P-111AAA", "Activo"),
				vehiculoSat("P-222BBB", "Inactivo"),
				vehiculoSat("P-999ZZZ", "Activo"),
			],
		);

		const porPlaca = new Map(filas.map((f) => [f.placa, f.resultado]));
		expect(porPlaca.get("P-111AAA")).toBe("activo_ok");
		expect(porPlaca.get("P-222BBB")).toBe("inactivo");
		expect(porPlaca.get("P-333CCC")).toBe("no_aparece_en_sat");
		expect(porPlaca.get("P-999ZZZ")).toBe("no_registrado_interno");
		expect(filas).toHaveLength(4);
	});

	test("preserva la clasificación del fallo que reporta cartera-back", () => {
		// Estos estados llegan en el cuerpo de una respuesta 200: si cartera
		// respondiera 5xx, el cliente reintentaría y descartaría el cuerpo.
		expect(estadoCorridaDesdeSat("OK")).toBe("ok");
		expect(estadoCorridaDesdeSat("CODIGO_REQUERIDO")).toBe("codigo_requerido");
		expect(estadoCorridaDesdeSat("BLOQUEADO")).toBe("bloqueado");
		expect(estadoCorridaDesdeSat("ERROR")).toBe("error");
	});

	test("un estado desconocido cae en error y no rompe el enum", () => {
		expect(
			estadoCorridaDesdeSat("ALGO_NUEVO" as Parameters<typeof estadoCorridaDesdeSat>[0]),
		).toBe("error");
	});

	test("no reporta alertas cuando todo está en orden", () => {
		const filas = construirResultados(
			[
				{ id: "veh-1", placa: "P-111AAA" },
				{ id: "veh-2", placa: "P-222BBB" },
			],
			[vehiculoSat("P-111AAA"), vehiculoSat("P-222BBB")],
		);

		const alertas = filas.filter(
			(f) => f.resultado === "no_aparece_en_sat" || f.resultado === "inactivo",
		);
		expect(alertas).toHaveLength(0);
	});
});
