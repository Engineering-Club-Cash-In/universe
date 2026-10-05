import { describe, expect, it } from "bun:test";
import {
	DIAS_RECHAZADA_VISIBLE,
	estadoPasos,
	leTocaAlUsuario,
	motivoSinSolicitud,
	pasosPendientes,
	rechazadaReciente,
	siguientePaso,
} from "./inmovilizacion-siguiente-paso";

const base = {
	solicitudAbierta: null,
	pendienteLlamar: false,
	pendienteLlamarReactivacion: false,
	rechazadaReciente: null,
	esSupervisor: false,
};

describe("siguientePaso", () => {
	it("sin trámite: null", () => {
		expect(siguientePaso(base)).toBeNull();
	});

	it("pendiente de aprobación: asesor espera, supervisor decide", () => {
		const solicitudAbierta = {
			accion: "apagado" as const,
			estado: "pendiente_aprobacion",
		};
		const asesor = siguientePaso({ ...base, solicitudAbierta });
		expect(asesor?.pasoActual).toBe("aprobacion");
		expect(asesor?.actua).toBe("supervisor");
		expect(asesor?.accionSugerida).toBeNull();
		const sup = siguientePaso({
			...base,
			solicitudAbierta,
			esSupervisor: true,
		});
		expect(sup?.accionSugerida).toBe("decidir");
	});

	it("aprobada: pide a LEGION y registrar la ejecución", () => {
		const r = siguientePaso({
			...base,
			solicitudAbierta: { accion: "reactivacion", estado: "aprobada" },
		});
		expect(r?.pasoActual).toBe("legion");
		expect(r?.accionSugerida).toBe("registrar_ejecucion");
		expect(r?.instruccion).toContain("la reactivación");
	});

	it("ejecutada con llamada pendiente: paso llamada, según la acción", () => {
		expect(siguientePaso({ ...base, pendienteLlamar: true })?.accion).toBe(
			"apagado",
		);
		expect(
			siguientePaso({ ...base, pendienteLlamarReactivacion: true })?.accion,
		).toBe("reactivacion");
	});

	it("rechazada reciente: sugiere volver a solicitar", () => {
		const r = siguientePaso({
			...base,
			rechazadaReciente: { accion: "apagado" },
		});
		expect(r?.accionSugerida).toBe("volver_a_solicitar");
	});

	it("una solicitud abierta manda sobre la llamada pendiente", () => {
		const r = siguientePaso({
			...base,
			pendienteLlamar: true,
			solicitudAbierta: { accion: "reactivacion", estado: "aprobada" },
		});
		expect(r?.pasoActual).toBe("legion");
	});
});

describe("pasosPendientes", () => {
	it("sin nada pendiente: vacío", () => {
		expect(pasosPendientes(base)).toEqual([]);
	});

	it("un rechazo reciente convive con la llamada pendiente del apagado", () => {
		const r = pasosPendientes({
			...base,
			pendienteLlamar: true,
			rechazadaReciente: { accion: "reactivacion" },
		});

		expect(r.map((p) => p.accionSugerida)).toEqual([
			"registrar_llamada",
			"volver_a_solicitar",
		]);
		expect(r[1]?.accion).toBe("reactivacion");
	});

	it("un rechazo reciente convive con la llamada de la reactivación", () => {
		const r = pasosPendientes({
			...base,
			pendienteLlamarReactivacion: true,
			rechazadaReciente: { accion: "apagado" },
		});

		expect(r.map((p) => p.accionSugerida)).toEqual([
			"registrar_llamada",
			"volver_a_solicitar",
		]);
	});

	it("solo el rechazo: un único pendiente", () => {
		const r = pasosPendientes({
			...base,
			rechazadaReciente: { accion: "apagado" },
		});

		expect(r.map((p) => p.accionSugerida)).toEqual(["volver_a_solicitar"]);
	});

	it("siguientePaso sigue devolviendo el más importante", () => {
		expect(
			siguientePaso({
				...base,
				pendienteLlamar: true,
				rechazadaReciente: { accion: "reactivacion" },
			})?.accionSugerida,
		).toBe("registrar_llamada");
	});
});

describe("estadoPasos", () => {
	it("marca hechos, actual y pendientes", () => {
		expect(estadoPasos("legion").map((p) => p.estado)).toEqual([
			"hecho",
			"hecho",
			"actual",
			"pendiente",
		]);
	});

	it("todos los pasos del stepper se pueden alcanzar", () => {
		const alcanzables = new Set([
			siguientePaso({
				...base,
				solicitudAbierta: { accion: "apagado", estado: "pendiente_aprobacion" },
			})?.pasoActual,
			siguientePaso({
				...base,
				solicitudAbierta: { accion: "apagado", estado: "aprobada" },
			})?.pasoActual,
			siguientePaso({ ...base, pendienteLlamar: true })?.pasoActual,
			siguientePaso({ ...base, rechazadaReciente: { accion: "apagado" } })
				?.pasoActual,
		]);
		for (const p of estadoPasos("solicitud")) {
			expect(alcanzables.has(p.id)).toBe(true);
		}
	});
});

describe("rechazadaReciente", () => {
	it("solo si la última fue rechazada y no hay abierta", () => {
		const h = [
			{ accion: "apagado" as const, estado: "rechazada" },
			{ accion: "apagado" as const, estado: "ejecutada" },
		];
		expect(rechazadaReciente(h, false)).toBe(h[0]);
		expect(rechazadaReciente(h, true)).toBeNull();
		expect(rechazadaReciente([h[1]], false)).toBeNull();
		expect(rechazadaReciente([], false)).toBeNull();
	});
});

describe("rechazadaReciente: ventana", () => {
	const ahora = new Date("2026-10-20T12:00:00Z");
	const dias = (n: number) => new Date(ahora.getTime() - n * 86_400_000);
	it("se muestra dentro de la ventana y se oculta pasada", () => {
		const fila = (n: number) => [
			{ accion: "apagado" as const, estado: "rechazada", decididoAt: dias(n) },
		];
		expect(rechazadaReciente(fila(1), false, ahora)).not.toBeNull();
		expect(
			rechazadaReciente(fila(DIAS_RECHAZADA_VISIBLE + 1), false, ahora),
		).toBeNull();
	});
});

describe("leTocaAlUsuario", () => {
	const aprobada = siguientePaso({
		...base,
		solicitudAbierta: { accion: "apagado", estado: "aprobada" },
	});
	const pendiente = siguientePaso({
		...base,
		esSupervisor: true,
		solicitudAbierta: { accion: "apagado", estado: "pendiente_aprobacion" },
	});
	it("el asesor solo ve lo del asesor", () => {
		expect(leTocaAlUsuario(aprobada, false)).toBe(true);
		expect(leTocaAlUsuario(pendiente, false)).toBe(false);
	});
	it("el supervisor solo ve lo del supervisor", () => {
		expect(leTocaAlUsuario(pendiente, true)).toBe(true);
		expect(leTocaAlUsuario(aprobada, true)).toBe(false);
	});
	it("sin paso o sin acción: no", () => {
		expect(leTocaAlUsuario(null, false)).toBe(false);
	});
});

describe("motivoSinSolicitud", () => {
	const p = {
		tieneGps: true,
		estadoUnidad: "activa" as const,
		hayAbierta: false,
		bucketNumero: 1,
		bucketsApagado: [2, 3, 4],
	};
	it("explica bucket fuera de rango", () => {
		expect(motivoSinSolicitud(p)).toContain("B2, B3, B4");
		expect(motivoSinSolicitud(p)).toContain("B1");
	});
	it("explica falta de GPS", () => {
		expect(motivoSinSolicitud({ ...p, tieneGps: false })).toContain("GPS");
	});
	it("null si sí puede o hay solicitud abierta", () => {
		expect(motivoSinSolicitud({ ...p, bucketNumero: 3 })).toBeNull();
		expect(motivoSinSolicitud({ ...p, hayAbierta: true })).toBeNull();
		expect(
			motivoSinSolicitud({ ...p, estadoUnidad: "inmovilizada" }),
		).toBeNull();
	});
});
