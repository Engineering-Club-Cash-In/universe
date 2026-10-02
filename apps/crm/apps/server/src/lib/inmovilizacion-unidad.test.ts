import { describe, expect, it } from "bun:test";
import {
	advertenciaEnMarcha,
	BUCKETS_INMOVILIZACION,
	bucketsInmovilizacionTexto,
	componerMotivoApagado,
	componerMotivoReactivacion,
	errorDetalleReactivacion,
	erroresEvidenciaEjecucion,
	erroresMotivosInmovilizacion,
	erroresRespaldoReactivacion,
	erroresUbicacionSolicitud,
	estadoUnidad,
	MOTIVOS_INMOVILIZACION,
	pagosPosterioresAlApagado,
	puedeSolicitar,
	QUE_PASO_REACTIVACION,
	quePasoRequierePago,
	quePasoRequierePromesa,
	reactivacionSinRespaldo,
	siguienteEstado,
	transicionValida,
} from "./inmovilizacion-unidad";

describe("transicionValida / siguienteEstado", () => {
	it("pendiente_aprobacion acepta aprobar, rechazar y cancelar", () => {
		expect(transicionValida("pendiente_aprobacion", "aprobar")).toBe(true);
		expect(transicionValida("pendiente_aprobacion", "rechazar")).toBe(true);
		expect(transicionValida("pendiente_aprobacion", "cancelar")).toBe(true);
		expect(siguienteEstado("pendiente_aprobacion", "aprobar")).toBe("aprobada");
		expect(siguienteEstado("pendiente_aprobacion", "rechazar")).toBe(
			"rechazada",
		);
		expect(siguienteEstado("pendiente_aprobacion", "cancelar")).toBe(
			"cancelada",
		);
	});

	it("pendiente_aprobacion NO acepta marcar_ejecutada", () => {
		expect(transicionValida("pendiente_aprobacion", "marcar_ejecutada")).toBe(
			false,
		);
		expect(siguienteEstado("pendiente_aprobacion", "marcar_ejecutada")).toBe(
			null,
		);
	});

	it("aprobada solo acepta marcar_ejecutada", () => {
		expect(transicionValida("aprobada", "marcar_ejecutada")).toBe(true);
		expect(siguienteEstado("aprobada", "marcar_ejecutada")).toBe("ejecutada");
		expect(transicionValida("aprobada", "aprobar")).toBe(false);
		expect(transicionValida("aprobada", "rechazar")).toBe(false);
		expect(transicionValida("aprobada", "cancelar")).toBe(false);
	});

	it("rechazada, ejecutada y cancelada son estados terminales", () => {
		for (const estado of ["rechazada", "ejecutada", "cancelada"] as const) {
			for (const evento of [
				"aprobar",
				"rechazar",
				"marcar_ejecutada",
				"cancelar",
			] as const) {
				expect(transicionValida(estado, evento)).toBe(false);
			}
		}
	});
});

describe("estadoUnidad", () => {
	it("sin historial ejecutado, la unidad está activa", () => {
		expect(estadoUnidad([])).toBe("activa");
		expect(
			estadoUnidad([
				{
					accion: "apagado",
					estado: "pendiente_aprobacion",
					ejecutadoAt: null,
				},
				{ accion: "apagado", estado: "rechazada", ejecutadoAt: null },
			]),
		).toBe("activa");
	});

	it("último ejecutado es apagado → inmovilizada", () => {
		expect(
			estadoUnidad([
				{
					accion: "apagado",
					estado: "ejecutada",
					ejecutadoAt: new Date("2026-01-01"),
				},
			]),
		).toBe("inmovilizada");
	});

	it("último ejecutado es reactivacion → activa", () => {
		expect(
			estadoUnidad([
				{
					accion: "apagado",
					estado: "ejecutada",
					ejecutadoAt: new Date("2026-01-01"),
				},
				{
					accion: "reactivacion",
					estado: "ejecutada",
					ejecutadoAt: new Date("2026-01-05"),
				},
			]),
		).toBe("activa");
	});

	it("usa ejecutadoAt real, no el orden del arreglo", () => {
		// La reactivación es CRONOLÓGICAMENTE más vieja aunque venga después en
		// el arreglo — no debe confundirse con la más reciente.
		expect(
			estadoUnidad([
				{
					accion: "reactivacion",
					estado: "ejecutada",
					ejecutadoAt: new Date("2026-01-01"),
				},
				{
					accion: "apagado",
					estado: "ejecutada",
					ejecutadoAt: new Date("2026-01-10"),
				},
			]),
		).toBe("inmovilizada");
	});

	it("ignora filas no ejecutadas al calcular la última", () => {
		expect(
			estadoUnidad([
				{
					accion: "apagado",
					estado: "ejecutada",
					ejecutadoAt: new Date("2026-01-01"),
				},
				{
					accion: "reactivacion",
					estado: "pendiente_aprobacion",
					ejecutadoAt: null,
				},
			]),
		).toBe("inmovilizada");
	});
});

describe("puedeSolicitar", () => {
	it("apagado requiere unidad activa y bucket habilitado", () => {
		expect(puedeSolicitar("apagado", "activa", 2)).toBe(true);
		expect(puedeSolicitar("apagado", "activa", 3)).toBe(true);
		expect(puedeSolicitar("apagado", "inmovilizada", 2)).toBe(false);
	});

	it("reactivacion requiere unidad inmovilizada", () => {
		expect(puedeSolicitar("reactivacion", "inmovilizada", 2)).toBe(true);
		expect(puedeSolicitar("reactivacion", "activa", 2)).toBe(false);
	});

	it("reactivacion NO depende del bucket: el cliente que pagó bajó a B0/B1 o salió del funnel", () => {
		expect(puedeSolicitar("reactivacion", "inmovilizada", 0)).toBe(true);
		expect(puedeSolicitar("reactivacion", "inmovilizada", 1)).toBe(true);
		expect(puedeSolicitar("reactivacion", "inmovilizada", null)).toBe(true);
		expect(puedeSolicitar("reactivacion", "inmovilizada", undefined)).toBe(
			true,
		);
	});

	it("B4 (Asesor Especializado) habilita el apagado con unidad activa", () => {
		expect(puedeSolicitar("apagado", "activa", 4)).toBe(true);
		expect(puedeSolicitar("apagado", "inmovilizada", 4)).toBe(false);
	});

	it("bucket fuera de BUCKETS_INMOVILIZACION rechaza, aun con estado correcto", () => {
		expect(puedeSolicitar("apagado", "activa", 0)).toBe(false);
		expect(puedeSolicitar("apagado", "activa", 1)).toBe(false);
		expect(puedeSolicitar("apagado", "activa", 5)).toBe(false);
	});

	it("bucket null o undefined rechaza (fail closed)", () => {
		expect(puedeSolicitar("apagado", "activa", null)).toBe(false);
		expect(puedeSolicitar("apagado", "activa", undefined)).toBe(false);
	});

	it("BUCKETS_INMOVILIZACION es exactamente [2, 3, 4] (CB-120)", () => {
		expect(BUCKETS_INMOVILIZACION).toEqual([2, 3, 4]);
		expect(bucketsInmovilizacionTexto()).toBe("B2/B3/B4");
	});
});

describe("motivos del apagado", () => {
	it("usa el catálogo de la recuperación forzosa, sin 'Se inmovilizó la unidad y no pagó'", () => {
		expect(MOTIVOS_INMOVILIZACION.se_niega_a_pagar).toBe("Se niega a pagar");
		expect(MOTIVOS_INMOVILIZACION.otro).toBe("Otro");
		expect("inmovilizada_sin_pago" in MOTIVOS_INMOVILIZACION).toBe(false);
	});

	it("exige al menos un motivo válido y sin repetir", () => {
		expect(erroresMotivosInmovilizacion([], "x")).not.toBeNull();
		expect(erroresMotivosInmovilizacion(["no_existe"], "x")).not.toBeNull();
		expect(
			erroresMotivosInmovilizacion(["inmovilizada_sin_pago"], "x"),
		).not.toBeNull();
		expect(
			erroresMotivosInmovilizacion(
				["se_niega_a_pagar", "se_niega_a_pagar"],
				"x",
			),
		).not.toBeNull();
		expect(erroresMotivosInmovilizacion(["se_niega_a_pagar"], "x")).toBeNull();
	});

	it("el detalle es obligatorio", () => {
		expect(erroresMotivosInmovilizacion(["otro"], "  ")).not.toBeNull();
		expect(
			erroresMotivosInmovilizacion(["se_niega_a_pagar"], null),
		).not.toBeNull();
		expect(erroresMotivosInmovilizacion(["otro"], "No contesta")).toBeNull();
		expect(errorDetalleReactivacion("  ")).not.toBeNull();
		expect(errorDetalleReactivacion("Pagó en banco")).toBeNull();
	});

	it("compone el texto de la columna `motivo` con etiquetas y detalle", () => {
		expect(componerMotivoApagado(["se_niega_a_pagar"], null)).toBe(
			"Se niega a pagar",
		);
		expect(
			componerMotivoApagado(
				["se_niega_a_pagar", "otro"],
				" Dejó de contestar ",
			),
		).toBe("Se niega a pagar, Otro — Dejó de contestar");
	});
});

describe("ubicación y evidencia del apagado", () => {
	it("la ubicación al solicitar: consulta GPS, dirección o enlace — alguna", () => {
		expect(erroresUbicacionSolicitud({})).not.toBeNull();
		expect(erroresUbicacionSolicitud({ direccion: "  " })).not.toBeNull();
		expect(erroresUbicacionSolicitud({ consultaLogId: "abc" })).toBeNull();
		expect(erroresUbicacionSolicitud({ direccion: "Zona 1" })).toBeNull();
		expect(
			erroresUbicacionSolicitud({ enlace: "https://maps.app/x" }),
		).toBeNull();
	});

	it("la ejecución pide archivo o nota, no ninguno", () => {
		expect(erroresEvidenciaEjecucion({})).not.toBeNull();
		expect(erroresEvidenciaEjecucion({ nota: "   " })).not.toBeNull();
		expect(
			erroresEvidenciaEjecucion({ evidencia: null, nota: null }),
		).not.toBeNull();
		expect(erroresEvidenciaEjecucion({ nota: "LEGION confirmó" })).toBeNull();
		expect(
			erroresEvidenciaEjecucion({ evidencia: { key: "a/b.png" } }),
		).toBeNull();
		expect(
			erroresEvidenciaEjecucion({ evidencia: { key: "a/b.png" }, nota: "ok" }),
		).toBeNull();
	});

	it("advierte si el vehículo va en marcha o con el motor encendido, sin bloquear", () => {
		expect(advertenciaEnMarcha(null)).toBeNull();
		expect(
			advertenciaEnMarcha({ velocidadKmh: 0, ignicion: false }),
		).toBeNull();
		expect(
			advertenciaEnMarcha({ velocidadKmh: 3, ignicion: false }),
		).toBeNull();
		expect(advertenciaEnMarcha({ velocidadKmh: 48.4, ignicion: true })).toBe(
			"El vehículo va en movimiento (48 km/h).",
		);
		expect(advertenciaEnMarcha({ velocidadKmh: 0, ignicion: true })).toBe(
			"El vehículo tiene el motor encendido.",
		);
	});
});

describe("reactivación: qué pasó y respaldo", () => {
	it("son tres opciones: pago, promesa de pago y pago parcial + promesa", () => {
		expect(Object.keys(QUE_PASO_REACTIVACION)).toEqual([
			"pago",
			"promesa",
			"pago_parcial_promesa",
		]);
		expect(QUE_PASO_REACTIVACION.pago_parcial_promesa.label).toBe(
			"Pago parcial + promesa",
		);
	});

	it("qué respaldo pide cada opción", () => {
		expect(quePasoRequierePago("pago")).toBe(true);
		expect(quePasoRequierePromesa("pago")).toBe(false);
		expect(quePasoRequierePago("promesa")).toBe(false);
		expect(quePasoRequierePromesa("promesa")).toBe(true);
		expect(quePasoRequierePago("pago_parcial_promesa")).toBe(true);
		expect(quePasoRequierePromesa("pago_parcial_promesa")).toBe(true);
	});

	it("valida el respaldo según la opción", () => {
		expect(erroresRespaldoReactivacion("pago", {})).not.toBeNull();
		expect(erroresRespaldoReactivacion("pago", { pago: {} })).toBeNull();
		expect(erroresRespaldoReactivacion("promesa", {})).not.toBeNull();
		expect(erroresRespaldoReactivacion("promesa", { promesa: {} })).toBeNull();
		expect(
			erroresRespaldoReactivacion("pago_parcial_promesa", { pago: {} }),
		).not.toBeNull();
		expect(
			erroresRespaldoReactivacion("pago_parcial_promesa", { promesa: {} }),
		).not.toBeNull();
		expect(
			erroresRespaldoReactivacion("pago_parcial_promesa", {
				pago: {},
				promesa: {},
			}),
		).toBeNull();
	});

	it("compone el motivo con la opción y el detalle", () => {
		expect(componerMotivoReactivacion("promesa", null)).toBe("Promesa de pago");
		expect(componerMotivoReactivacion("pago", " Depositó ")).toBe(
			"Pago — Depositó",
		);
	});

	const pago = (id: number, fecha: string, extra = {}) => ({
		pago_id: id,
		fecha_pago: fecha,
		monto_boleta: "100.00",
		numeroAutorizacion: null,
		paymentFalse: false,
		...extra,
	});

	it("solo cuentan los pagos del día del apagado en adelante, sin anulados, el más reciente primero", () => {
		// 2026-09-20T03:00Z es el 19/09 a las 21:00 en Guatemala (UTC-6).
		const apagadoAt = new Date("2026-09-20T03:00:00.000Z");
		const res = pagosPosterioresAlApagado(
			[
				pago(1, "2026-09-18"),
				pago(2, "2026-09-19"),
				pago(3, "2026-09-25", { paymentFalse: true }),
				pago(4, "2026-09-22T00:00:00.000Z"),
			],
			apagadoAt,
		);
		expect(res.map((p) => p.pagoId)).toEqual([4, 2]);
		expect(res[0]?.fechaPago).toBe("2026-09-22");
	});

	it("ignora las filas de cartera sin fecha o con monto 0 (cuotas sin pagar), sin romperse", () => {
		const res = pagosPosterioresAlApagado(
			[
				pago(10, "2026-09-25", { monto_boleta: "0.00" }),
				{ ...pago(11, "2026-09-25"), fecha_pago: null },
				{ ...pago(12, "2026-09-25"), monto_boleta: null },
				pago(13, "2026-09-25", { monto_boleta: "250.50" }),
			],
			new Date("2026-09-20T15:00:00.000Z"),
		);
		expect(res.map((p) => p.pagoId)).toEqual([13]);
	});

	it("una fecha con hora se pasa al día de Guatemala; una a medianoche UTC se toma tal cual", () => {
		const res = pagosPosterioresAlApagado(
			[
				// 02:00 UTC del 21 = 20:00 del 20 en Guatemala: es del día 20.
				pago(20, "2026-09-21T02:00:00.000Z"),
				// Medianoche UTC = columna `date` del día 21, no del 20.
				pago(21, "2026-09-21T00:00:00.000Z"),
			],
			new Date("2026-09-21T15:00:00.000Z"),
		);
		expect(res.map((p) => p.pagoId)).toEqual([21]);
	});

	it("deja el estado de validación de cada pago, solo para informar", () => {
		const res = pagosPosterioresAlApagado(
			[
				pago(30, "2026-09-25", { validationStatus: "pending" }),
				pago(31, "2026-09-24", { validationStatus: "validated" }),
				pago(32, "2026-09-23", { validationStatus: "reset" }),
				pago(33, "2026-09-22"),
			],
			new Date("2026-09-20T15:00:00.000Z"),
		);
		expect(res.map((p) => p.validacion)).toEqual([
			"pending",
			"validated",
			null,
			null,
		]);
	});

	it("un texto que no es fecha ('pending', 'N/A') no pasa como un día", () => {
		const res = pagosPosterioresAlApagado(
			[
				pago(40, "pending"),
				pago(41, "N/A"),
				pago(42, ""),
				pago(43, "2026-09-25"),
			],
			new Date("2026-09-20T15:00:00.000Z"),
		);
		expect(res.map((p) => p.pagoId)).toEqual([43]);
	});
});

describe("reactivacionSinRespaldo", () => {
	const respaldo = { pago: { id: 1 } };

	it("reactivación sin opción ni respaldo: sin respaldo", () => {
		expect(
			reactivacionSinRespaldo({
				accion: "reactivacion",
				quePaso: null,
				respaldoReactivacion: null,
			}),
		).toBe(true);
	});

	it("reactivación con opción pero sin respaldo guardado: sin respaldo", () => {
		expect(
			reactivacionSinRespaldo({
				accion: "reactivacion",
				quePaso: "pago",
				respaldoReactivacion: null,
			}),
		).toBe(true);
	});

	it("reactivación con opción y respaldo: con respaldo", () => {
		expect(
			reactivacionSinRespaldo({
				accion: "reactivacion",
				quePaso: "pago",
				respaldoReactivacion: respaldo,
			}),
		).toBe(false);
	});

	it("un apagado nunca lleva respaldo: no aplica", () => {
		expect(
			reactivacionSinRespaldo({
				accion: "apagado",
				quePaso: null,
				respaldoReactivacion: null,
			}),
		).toBe(false);
	});
});
