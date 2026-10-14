import { describe, expect, it } from "bun:test";
import {
	type ConsultaGps,
	derivarVistaGps,
	type GpsVehiculoOutput,
} from "./gps-derivar";

const vinculado = (lat: number): GpsVehiculoOutput => ({
	estado: "vinculado",
	auditada: true,
	unitId: 7,
	unitName: "P-472GST",
	vinculoOrigen: "persistido",
	placa: "P-472GST",
	telemetria: {
		latitude: lat,
		longitude: -90.5,
		speedKmh: 0,
		ultimaSenalAt: new Date("2026-10-14T16:00:00Z"),
		ultimaPosicionAt: new Date("2026-10-14T16:00:00Z"),
	},
});

const sinVinculo: GpsVehiculoOutput = {
	estado: "sin_vinculo",
	auditada: true,
	motivo: "sin_coincidencia",
	placa: "P-472GST",
	candidatos: [],
};

const noDisponible: GpsVehiculoOutput = {
	estado: "no_disponible",
	auditada: true,
	error: { code: "WIALON_TIMEOUT", message: "Wialon no respondió" },
	referencia: null,
};

let n = 0;
function consulta(
	snapshot: GpsVehiculoOutput | null,
	origen: string | null = "telemetria",
): ConsultaGps {
	n += 1;
	const createdAt = new Date(Date.UTC(2026, 9, 14, 12, 60 - n));
	return {
		id: `c${n}`,
		motivo: `Motivo ${n}`,
		origen,
		unitName: "P-472GST",
		userNombre: "Ana Gómez",
		createdAt,
		snapshot,
		consultas: [
			{ id: `c${n}`, motivo: `Motivo ${n}`, userNombre: "Ana", createdAt },
		],
	} as ConsultaGps;
}

describe("derivarVistaGps — sin consulta en esta sesión", () => {
	it("sin historial no muestra nada", () => {
		const v = derivarVistaGps({
			entradas: [],
			enVivo: null,
			historialActualizado: false,
		});
		expect(v.ubicacion).toBeNull();
		expect(v.aviso).toBeNull();
		expect(v.anteriores).toEqual([]);
	});

	it("la última consulta con ubicación va arriba y no se repite abajo", () => {
		const a = consulta(vinculado(14.6));
		const b = consulta(vinculado(14.7));
		const v = derivarVistaGps({
			entradas: [a, b],
			enVivo: null,
			historialActualizado: false,
		});
		expect(v.ubicacion?.tipo).toBe("historial");
		expect(v.ubicacion?.tipo === "historial" && v.ubicacion.entrada.id).toBe(
			a.id,
		);
		expect(v.anteriores.map((e) => e.id)).toEqual([b.id]);
	});

	it("una consulta de ubicaciones frecuentes no cuenta como última ubicación", () => {
		const clave = consulta(null, "ubicaciones_clave");
		const a = consulta(vinculado(14.6));
		const v = derivarVistaGps({
			entradas: [clave, a],
			enVivo: null,
			historialActualizado: false,
		});
		expect(v.ubicacion?.tipo === "historial" && v.ubicacion.entrada.id).toBe(
			a.id,
		);
		expect(v.aviso).toBeNull();
		expect(v.anteriores.map((e) => e.id)).toEqual([clave.id]);
	});

	it("si la más reciente no trajo ubicación, avisa y debajo deja la última conocida", () => {
		const fallo = consulta(noDisponible);
		const a = consulta(vinculado(14.6));
		const v = derivarVistaGps({
			entradas: [fallo, a],
			enVivo: null,
			historialActualizado: false,
		});
		expect(v.aviso?.tipo === "historial" && v.aviso.entrada.id).toBe(fallo.id);
		expect(v.ubicacion?.tipo === "historial" && v.ubicacion.entrada.id).toBe(
			a.id,
		);
		expect(v.anteriores).toEqual([]);
	});

	it("un fallo viejo (anterior a la última ubicación) no es aviso", () => {
		const a = consulta(vinculado(14.6));
		const fallo = consulta(sinVinculo);
		const v = derivarVistaGps({
			entradas: [a, fallo],
			enVivo: null,
			historialActualizado: false,
		});
		expect(v.aviso).toBeNull();
		expect(v.anteriores.map((e) => e.id)).toEqual([fallo.id]);
	});
});

describe("derivarVistaGps — consulta de esta sesión", () => {
	it("mientras consulta, todo el historial queda abajo", () => {
		const a = consulta(vinculado(14.6));
		const v = derivarVistaGps({
			entradas: [a],
			enVivo: { estado: "cargando", motivo: "Ubicar" },
			historialActualizado: false,
		});
		expect(v.cargandoEnVivo).toBe(true);
		expect(v.ubicacion).toBeNull();
		expect(v.anteriores).toEqual([a]);
	});

	it("con ubicación y el historial sin releer, muestra la respuesta en vivo", () => {
		const a = consulta(vinculado(14.6));
		const v = derivarVistaGps({
			entradas: [a],
			enVivo: {
				estado: "listo",
				motivo: "Ubicar",
				datos: vinculado(14.9),
				at: new Date(),
			},
			historialActualizado: false,
		});
		expect(v.ubicacion?.tipo).toBe("en-vivo");
		expect(v.anteriores).toEqual([a]);
	});

	it("con el historial ya releído usa su fila (marcada en vivo) y no la repite", () => {
		const nueva = consulta(vinculado(14.9));
		const a = consulta(vinculado(14.6));
		const v = derivarVistaGps({
			entradas: [nueva, a],
			enVivo: {
				estado: "listo",
				motivo: "Ubicar",
				datos: vinculado(14.9),
				at: new Date(),
			},
			historialActualizado: true,
		});
		expect(v.ubicacion?.tipo).toBe("historial");
		expect(v.ubicacion?.tipo === "historial" && v.ubicacion.esEnVivo).toBe(
			true,
		);
		expect(v.anteriores.map((e) => e.id)).toEqual([a.id]);
	});

	it("sin unidad vinculada: avisa en vivo y deja la última ubicación conocida", () => {
		const a = consulta(vinculado(14.6));
		const v = derivarVistaGps({
			entradas: [a],
			enVivo: {
				estado: "listo",
				motivo: "Ubicar",
				datos: sinVinculo,
				at: new Date(),
			},
			historialActualizado: false,
		});
		expect(v.aviso?.tipo).toBe("en-vivo");
		expect(v.ubicacion?.tipo === "historial" && v.ubicacion.entrada.id).toBe(
			a.id,
		);
		expect(v.anteriores).toEqual([]);
	});

	it("si la petición falló (sin fila en la bitácora) el historial no se recorta", () => {
		const a = consulta(vinculado(14.6));
		const b = consulta(vinculado(14.7));
		const v = derivarVistaGps({
			entradas: [a, b],
			enVivo: { estado: "error", motivo: "Ubicar", mensaje: "Sin acceso" },
			historialActualizado: true,
		});
		expect(v.aviso?.tipo).toBe("en-vivo");
		expect(v.ubicacion?.tipo === "historial" && v.ubicacion.entrada.id).toBe(
			a.id,
		);
		expect(v.anteriores.map((e) => e.id)).toEqual([b.id]);
	});
});
