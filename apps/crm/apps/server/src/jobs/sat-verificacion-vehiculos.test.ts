import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
	titularesDelegadosDelEntorno,
	type VehiculoSatPropio,
} from "../controllers/satVehiculos";
import {
	agregarCruceCrm,
	construirResultados,
	construirUpsertExternos,
	contarPlacasReportadasSat,
	desacoplarVerificacionSat,
	esAlertaSat,
	estadoCorridaDesdeSat,
	estadoLoteDesdeCorridas,
	estadoLoteParaUsuario,
	type ResumenVerificacion,
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
		impuestoCirculacionPagado: true,
		puedeAutorizarTraspaso: true,
		puedeImprimirTarjeta: true,
		puedeImprimirCertificado: true,
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
		expect(filas[0].impuestoCirculacionPagado).toBe(true);
		expect(filas[0].puedeAutorizarTraspaso).toBe(true);
		expect(filas[0].puedeImprimirTarjeta).toBe(true);
		expect(filas[0].puedeImprimirCertificado).toBe(true);
	});

	test("vehículo propio que aparece Inactivo genera alerta de inactivo", () => {
		const filas = construirResultados(
			[{ id: "veh-1", placa: "P-123ABC" }],
			[vehiculoSat("P-123ABC", "Inactivo")],
		);

		expect(filas[0].resultado).toBe("inactivo");
		expect(filas[0].eraEsperado).toBe(true);
	});

	test("vehiculo Activo sin senales de documentos queda como impuesto no pagado", () => {
		const filas = construirResultados(
			[{ id: "veh-1", placa: "P-123ABC" }],
			[
				vehiculoSat("P-123ABC", "Activo", {
					impuestoCirculacionPagado: false,
					puedeAutorizarTraspaso: false,
					puedeImprimirTarjeta: false,
					puedeImprimirCertificado: false,
				}),
			],
		);

		expect(filas[0].resultado).toBe("activo_ok");
		expect(filas[0].impuestoCirculacionPagado).toBe(false);
		expect(filas[0].puedeAutorizarTraspaso).toBe(false);
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
		expect(salido?.impuestoCirculacionPagado).toBeNull();
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

	test("usa el sufijo cuando SAT y CRM tienen distinto prefijo", () => {
		const filas = construirResultados(
			[{ id: "veh-1", placa: "C0-661CDJ" }],
			[vehiculoSat("C-661CDJ", "Activo", { marca: "Foton" })],
		);

		expect(filas).toHaveLength(1);
		expect(filas[0].vehicleId).toBe("veh-1");
		expect(filas[0].resultado).toBe("activo_ok");
		expect(filas[0].placa).toBe("C0-661CDJ");
	});

	test("ignora vehículos propios sin placa registrada", () => {
		const filas = construirResultados(
			[
				{ id: "veh-1", placa: null },
				{ id: "veh-vacio", placa: " - " },
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

	test("preserva la clasificación del fallo que reporta el scraper", () => {
		// Estos estados forman parte de la respuesta estructurada del scraper.
		// respondiera 5xx, el cliente reintentaría y descartaría el cuerpo.
		expect(estadoCorridaDesdeSat("OK")).toBe("ok");
		expect(estadoCorridaDesdeSat("CODIGO_REQUERIDO")).toBe("codigo_requerido");
		expect(estadoCorridaDesdeSat("BLOQUEADO")).toBe("bloqueado");
		expect(estadoCorridaDesdeSat("ERROR")).toBe("error");
	});

	test("un estado desconocido cae en error y no rompe el enum", () => {
		expect(
			estadoCorridaDesdeSat(
				"ALGO_NUEVO" as Parameters<typeof estadoCorridaDesdeSat>[0],
			),
		).toBe("error");
	});

	test("el lote solo queda completado cuando todos los titulares terminan bien", () => {
		expect(estadoLoteDesdeCorridas(["ok", "ok"])).toBe("ok");
		expect(estadoLoteDesdeCorridas(["ok", "error"])).toBe("error");
		expect(estadoLoteDesdeCorridas(["error", "bloqueado"])).toBe("error");
		expect(estadoLoteDesdeCorridas([])).toBe("error");
	});

	test("la interfaz reduce los estados del lote a proceso, completado o error", () => {
		expect(estadoLoteParaUsuario("en_proceso")).toBe("en_proceso");
		expect(estadoLoteParaUsuario("ok")).toBe("ok");
		expect(estadoLoteParaUsuario("parcial")).toBe("error");
		expect(estadoLoteParaUsuario("error")).toBe("error");
	});

	test("responde al registrar el lote sin esperar que termine el trabajo", async () => {
		let resolverTrabajo!: (resumen: ResumenVerificacion) => void;
		let trabajoTerminado = false;
		const trabajo = new Promise<ResumenVerificacion>((resolve) => {
			resolverTrabajo = resolve;
		}).then((resumen) => {
			trabajoTerminado = true;
			return resumen;
		});
		const enProceso: ResumenVerificacion = {
			corridaId: "corrida-1",
			loteId: "lote-1",
			corridaIds: ["corrida-1", "corrida-2"],
			estado: "en_proceso",
			totalEsperados: 100,
			totalReportadosSat: 0,
			totalAlertas: 0,
		};

		const inicio = await desacoplarVerificacionSat(async (alRegistrar) => {
			alRegistrar(enProceso);
			return trabajo;
		});

		expect(inicio).toEqual(enProceso);
		expect(trabajoTerminado).toBe(false);

		resolverTrabajo({ ...enProceso, estado: "ok" });
		await trabajo;
		expect(trabajoTerminado).toBe(true);
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

	test("solo clasifica como alerta los vehículos inactivos o ausentes en SAT", () => {
		expect(esAlertaSat("activo_ok")).toBe(false);
		expect(esAlertaSat("inactivo")).toBe(true);
		expect(esAlertaSat("no_aparece_en_sat")).toBe(true);
		expect(esAlertaSat("no_registrado_interno")).toBe(false);
	});

	test("lee y deduplica los titulares delegados configurados", () => {
		const anterior = process.env.SAT_AV_TITULARES;
		const anteriorNits = process.env.SAT_AV_TITULAR_NITS;
		process.env.SAT_AV_TITULARES = JSON.stringify([
			{ nit: "98766430", nombre: "CUBE INVESTMENTS, SOCIEDAD ANONIMA" },
			{ nit: "114396426", nombre: "RDBE, SOCIEDAD ANONIMA" },
			{ nit: "98766430", nombre: "Duplicado" },
		]);
		delete process.env.SAT_AV_TITULAR_NITS;

		try {
			expect(titularesDelegadosDelEntorno()).toEqual([
				{ nit: "98766430", nombre: "CUBE INVESTMENTS, SOCIEDAD ANONIMA" },
				{ nit: "114396426", nombre: "RDBE, SOCIEDAD ANONIMA" },
			]);
		} finally {
			if (anterior === undefined) delete process.env.SAT_AV_TITULARES;
			else process.env.SAT_AV_TITULARES = anterior;
			if (anteriorNits === undefined) delete process.env.SAT_AV_TITULAR_NITS;
			else process.env.SAT_AV_TITULAR_NITS = anteriorNits;
		}
	});

	test("rechaza titulares vacios y deduplica NIT con formato distinto", () => {
		const anterior = process.env.SAT_AV_TITULARES;
		try {
			process.env.SAT_AV_TITULARES = " ,98766430";
			expect(() => titularesDelegadosDelEntorno()).toThrow();

			process.env.SAT_AV_TITULARES = JSON.stringify([
				{ nit: "9876-6430", nombre: "Titular" },
				{ nit: "98766430", nombre: "Duplicado" },
			]);
			expect(titularesDelegadosDelEntorno()).toEqual([
				{ nit: "9876-6430", nombre: "Titular" },
			]);
		} finally {
			if (anterior === undefined) delete process.env.SAT_AV_TITULARES;
			else process.env.SAT_AV_TITULARES = anterior;
		}
	});

	test("dos vehículos internos con la misma placa siguen siendo dos filas", () => {
		const filas = construirResultados(
			[
				{ id: "veh-1", placa: "P-123ABC" },
				{ id: "veh-2", placa: "P123ABC" },
			],
			[vehiculoSat("P-123ABC")],
		);

		expect(filas).toHaveLength(2);
		expect(filas.map((fila) => fila.vehicleId)).toEqual(["veh-1", "veh-2"]);
	});

	test("cuenta una sola placa SAT aunque el CRM tenga formatos duplicados", () => {
		const filas = [
			{
				corridaId: "corrida-1",
				resultado: "activo_ok",
				placa: "P-123ABC",
			},
			{
				corridaId: "corrida-1",
				resultado: "activo_ok",
				placa: "P123ABC",
			},
			{
				corridaId: "corrida-2",
				resultado: "no_aparece_en_sat",
				placa: "P-999ZZZ",
			},
		];

		expect(contarPlacasReportadasSat(filas)).toBe(1);
		expect(contarPlacasReportadasSat(filas, "corrida-1")).toBe(1);
		expect(contarPlacasReportadasSat(filas, "corrida-2")).toBe(0);
	});

	test("separa el cruce CRM del estado reportado por SAT", () => {
		const filas = agregarCruceCrm(
			[
				{ vehicleId: "veh-propio", placa: "P-111AAA" },
				{ vehicleId: null, placa: "P-222BBB" },
				{ vehicleId: null, placa: "P-333CCC" },
			],
			[
				{ id: "veh-propio", placa: "P111AAA", isOwned: true },
				{ id: "veh-no-propio", placa: "P 222 BBB", isOwned: false },
			],
		);

		expect(filas.map((fila) => fila.cruceCrm)).toEqual([
			"propio",
			"registrado_no_propio",
			"sin_registro",
		]);
	});

	test("expone el control CRM y el titular asociado sin usar el titular SAT", () => {
		const filas = agregarCruceCrm(
			[
				{ vehicleId: "veh-empresa", placa: "P-111AAA" },
				{ vehicleId: "veh-cliente", placa: "P-222BBB" },
				{ vehicleId: null, placa: "P-333CCC" },
			],
			[
				{
					id: "veh-empresa",
					placa: "P111AAA",
					isOwned: true,
				},
				{
					id: "veh-cliente",
					placa: "P222BBB",
					isOwned: false,
					titularNombre: "Ana Cliente",
				},
			],
		);

		expect(filas.map((fila) => fila.titularCrmNombre)).toEqual([
			"CUBE/RDBE",
			"Ana Cliente",
			null,
		]);
	});

	test("prioriza el ID y la marca de propiedad ante placas duplicadas", () => {
		const filas = agregarCruceCrm(
			[
				{ vehicleId: "veh-no-propio", placa: "P-123ABC" },
				{ vehicleId: null, placa: "P123ABC" },
			],
			[
				{ id: "veh-no-propio", placa: "P123ABC", isOwned: false },
				{ id: "veh-propio", placa: "P-123ABC", isOwned: true },
			],
		);

		expect(filas[0].cruceCrm).toBe("registrado_no_propio");
		expect(filas[1].cruceCrm).toBe("propio");
	});

	test("usa el sufijo para cruzar un resultado SAT con el CRM", () => {
		const filas = agregarCruceCrm(
			[{ vehicleId: null, placa: "C-661CDJ" }],
			[{ id: "veh-1", placa: "C0-661CDJ", isOwned: true }],
		);

		expect(filas[0].cruceCrm).toBe("propio");
	});

	test("el upsert externo usa el indice parcial y parámetros", () => {
		const [fila] = construirResultados([], [vehiculoSat("P-123ABC")]);
		const sentencia = new PgDialect().sqlToQuery(
			construirUpsertExternos([
				{
					...fila,
					loteId: "00000000-0000-0000-0000-000000000001",
					corridaId: null,
					consultadoAt: new Date("2026-09-21T12:00:00Z"),
				},
			]),
		);

		expect(sentencia.sql).toContain(
			"ON CONFLICT ((regexp_replace(upper(placa), '[^A-Z0-9]', '', 'g')))",
		);
		expect(sentencia.sql).toContain("WHERE vehicle_id IS NULL");
		expect(sentencia.params).toHaveLength(15);
		expect(sentencia.sql).not.toContain("P-123ABC");
	});
});
