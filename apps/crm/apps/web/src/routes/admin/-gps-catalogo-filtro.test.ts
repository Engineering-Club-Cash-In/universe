import { describe, expect, it } from "bun:test";
import {
	estadoBuckets,
	estadosDeUnidad,
	FILTRO_BUCKET_SIN_BUCKET,
	FILTRO_BUCKET_SIN_CREDITO,
	FILTRO_BUCKET_TODOS,
	filtrarUnidadesPorBucket,
	pasaFiltroBucket,
} from "./-gps-catalogo-filtro";

const sinCredito = { creditos: [], estadoMoraPorSifco: {} };
const enB2 = {
	creditos: [{ numeroSifco: "1" }],
	estadoMoraPorSifco: { "1": "mora_60" },
};
const sinCaso = {
	creditos: [{ numeroSifco: "CRM-abc" }],
	estadoMoraPorSifco: {},
};
const compartida = {
	creditos: [{ numeroSifco: "1" }, { numeroSifco: "2" }],
	estadoMoraPorSifco: { "1": "mora_60", "2": "mora_90" },
};

describe("pasaFiltroBucket", () => {
	it("todos deja pasar todo", () => {
		for (const u of [sinCredito, enB2, sinCaso, compartida]) {
			expect(pasaFiltroBucket(u, FILTRO_BUCKET_TODOS)).toBe(true);
		}
	});

	it("filtra por el estado de mora del crédito", () => {
		expect(pasaFiltroBucket(enB2, "mora_60")).toBe(true);
		expect(pasaFiltroBucket(enB2, "mora_90")).toBe(false);
		expect(pasaFiltroBucket(sinCredito, "mora_60")).toBe(false);
	});

	it("una unidad compartida pasa por cualquiera de sus créditos", () => {
		expect(pasaFiltroBucket(compartida, "mora_60")).toBe(true);
		expect(pasaFiltroBucket(compartida, "mora_90")).toBe(true);
		expect(pasaFiltroBucket(compartida, "mora_30")).toBe(false);
	});

	it("sin crédito: solo las unidades sin crédito", () => {
		expect(pasaFiltroBucket(sinCredito, FILTRO_BUCKET_SIN_CREDITO)).toBe(true);
		expect(pasaFiltroBucket(enB2, FILTRO_BUCKET_SIN_CREDITO)).toBe(false);
		expect(pasaFiltroBucket(sinCaso, FILTRO_BUCKET_SIN_CREDITO)).toBe(false);
	});

	it("sin bucket: con crédito pero sin caso de cobros", () => {
		expect(pasaFiltroBucket(sinCaso, FILTRO_BUCKET_SIN_BUCKET)).toBe(true);
		expect(pasaFiltroBucket(enB2, FILTRO_BUCKET_SIN_BUCKET)).toBe(false);
		expect(pasaFiltroBucket(sinCredito, FILTRO_BUCKET_SIN_BUCKET)).toBe(false);
	});
});

describe("estadosDeUnidad", () => {
	it("sin repetir y sin los desconocidos", () => {
		expect(
			estadosDeUnidad({
				creditos: [
					{ numeroSifco: "1" },
					{ numeroSifco: "2" },
					{ numeroSifco: "3" },
				],
				estadoMoraPorSifco: { "1": "mora_60", "2": "mora_60" },
			}),
		).toEqual(["mora_60"]);
	});
});

describe("estadoBuckets", () => {
	const base = {
		cantidadSifcos: 3,
		tieneMapa: true,
		esDeBusquedaAnterior: false,
		hayError: false,
	};

	it("con mapa propio de esta búsqueda: listos", () => {
		expect(estadoBuckets(base)).toBe("listos");
	});

	it("sin créditos no hay nada que consultar: listos", () => {
		expect(
			estadoBuckets({ ...base, cantidadSifcos: 0, tieneMapa: false }),
		).toBe("listos");
	});

	it("consulta en vuelo: cargando", () => {
		expect(estadoBuckets({ ...base, tieneMapa: false })).toBe("cargando");
	});

	it("mapa de la búsqueda anterior: cargando, no se usa para clasificar", () => {
		expect(estadoBuckets({ ...base, esDeBusquedaAnterior: true })).toBe(
			"cargando",
		);
	});

	it("falló y no hay mapa: error", () => {
		expect(estadoBuckets({ ...base, tieneMapa: false, hayError: true })).toBe(
			"error",
		);
	});

	it("falló una actualización pero hay mapa de esta búsqueda: sigue usable", () => {
		expect(estadoBuckets({ ...base, hayError: true })).toBe("listos");
	});
});

describe("filtrarUnidadesPorBucket", () => {
	const unidades = [enB2, sinCredito, sinCaso];

	it("listos: aplica el filtro", () => {
		expect(filtrarUnidadesPorBucket(unidades, "mora_60", "listos")).toEqual([
			enB2,
		]);
	});

	it("con la consulta fallida, 'sin bucket' no se traga todas las unidades con crédito", () => {
		expect(
			filtrarUnidadesPorBucket(unidades, FILTRO_BUCKET_SIN_BUCKET, "error"),
		).toEqual(unidades);
	});

	it("con la consulta fallida los buckets no dejan la lista vacía", () => {
		expect(filtrarUnidadesPorBucket(unidades, "mora_60", "error")).toEqual(
			unidades,
		);
	});

	it("mientras carga tampoco filtra con datos incompletos", () => {
		expect(filtrarUnidadesPorBucket(unidades, "mora_60", "cargando")).toEqual(
			unidades,
		);
	});
});
