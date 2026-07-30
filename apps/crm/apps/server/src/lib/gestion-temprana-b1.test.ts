import { describe, expect, spyOn, test } from "bun:test";
import {
	type ContactoParaGestionB1,
	esContactoAutomatico,
	etiquetaMetodoContacto,
	evaluarGestionTempranaB1,
	PREFIJO_PREMORA_AUTO,
	PREFIJO_WSP_MASIVO,
} from "./gestion-temprana-b1";

// El crédito entró a B1 el 2026-07-20. Todo lo anterior queda fuera de la
// ventana; todo lo posterior cuenta.
const ENTRADA_B1 = new Date("2026-07-20T12:00:00.000Z");
const ANTES = new Date("2026-07-19T12:00:00.000Z");
const DESPUES = new Date("2026-07-21T12:00:00.000Z");
const MAS_TARDE = new Date("2026-07-22T12:00:00.000Z");

function contacto(
	overrides: Partial<ContactoParaGestionB1> = {},
): ContactoParaGestionB1 {
	return {
		metodoContacto: "whatsapp",
		estadoContacto: "no_contesta",
		fechaContacto: DESPUES,
		comentarios: "Se intentó contactar al cliente",
		...overrides,
	};
}

function evaluar(
	contactos: ContactoParaGestionB1[],
	overrides: {
		bucket?: number | null;
		fechaEntradaBucket?: Date | string | null;
	} = {},
) {
	return evaluarGestionTempranaB1({
		bucket: overrides.bucket !== undefined ? overrides.bucket : 1,
		fechaEntradaBucket:
			overrides.fechaEntradaBucket !== undefined
				? overrides.fechaEntradaBucket
				: ENTRADA_B1,
		contactos,
	});
}

/** Estrecha el resultado a la variante aplicable (falla el test si no aplica). */
function aplicable(resultado: ReturnType<typeof evaluar>) {
	if (!resultado.aplica) {
		throw new Error(
			`Se esperaba aplica:true, llegó motivo=${resultado.motivo}`,
		);
	}
	return resultado;
}

describe("evaluarGestionTempranaB1 — aplicabilidad", () => {
	test("bucket 0 (Cartera Sana) → no aplica", () => {
		const r = evaluar([], { bucket: 0 });
		expect(r).toEqual({ aplica: false, motivo: "no_es_b1" });
	});

	test("bucket 2 (Gestión Activa) → no aplica: la regla es solo de gestión temprana", () => {
		const r = evaluar([], { bucket: 2 });
		expect(r).toEqual({ aplica: false, motivo: "no_es_b1" });
	});

	test("bucket null (fuera del funnel, p.ej. en convenio) → no aplica", () => {
		const r = evaluar([], { bucket: null });
		expect(r).toEqual({ aplica: false, motivo: "no_es_b1" });
	});

	test("B1 sin fecha de entrada → no aplica: no se inventa la ventana", () => {
		const r = evaluar([], { fechaEntradaBucket: null });
		expect(r).toEqual({ aplica: false, motivo: "sin_fecha_entrada" });
	});

	test("B1 con fecha de entrada malformada (no parseable) → no aplica, no revienta", () => {
		const r = evaluar([], { fechaEntradaBucket: "no-es-una-fecha" });
		expect(r).toEqual({ aplica: false, motivo: "sin_fecha_entrada" });
	});

	test("B1 con fecha de entrada → aplica", () => {
		expect(evaluar([]).aplica).toBe(true);
	});
});

describe("evaluarGestionTempranaB1 — ventana temporal", () => {
	test("contacto ANTERIOR a la entrada al bucket no cuenta", () => {
		const r = aplicable(evaluar([contacto({ fechaContacto: ANTES })]));
		expect(r.canalesFaltantes).toEqual(["whatsapp", "llamada", "sms"]);
	});

	test("contacto EXACTAMENTE en la fecha de entrada sí cuenta (bound inclusivo)", () => {
		const r = aplicable(evaluar([contacto({ fechaContacto: ENTRADA_B1 })]));
		expect(r.canalesFaltantes).toEqual(["llamada", "sms"]);
	});

	test("contacto posterior a la entrada cuenta", () => {
		const r = aplicable(evaluar([contacto({ fechaContacto: DESPUES })]));
		expect(r.canalesFaltantes).toEqual(["llamada", "sms"]);
	});

	test("ciclo B1→B2→B1: la gestión del ciclo viejo NO suprime la alerta del nuevo", () => {
		// Los 3 canales se agotaron ANTES de reentrar a B1. Si la ventana no
		// filtrara, esto diría "agotada" y el asesor no volvería a gestionar.
		const r = aplicable(
			evaluar([
				contacto({ metodoContacto: "whatsapp", fechaContacto: ANTES }),
				contacto({ metodoContacto: "llamada", fechaContacto: ANTES }),
				contacto({ metodoContacto: "sms", fechaContacto: ANTES }),
			]),
		);
		expect(r.estado).toBe("incompleta");
		expect(r.canalesFaltantes).toEqual(["whatsapp", "llamada", "sms"]);
	});

	test("contacto sin fecha se descarta en vez de asumirlo dentro de la ventana", () => {
		const r = aplicable(evaluar([contacto({ fechaContacto: null })]));
		expect(r.canalesFaltantes).toEqual(["whatsapp", "llamada", "sms"]);
	});

	test("contacto con fecha corrupta (string no parseable) se descarta sin reventar", () => {
		const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
		try {
			const r = aplicable(
				evaluar([contacto({ fechaContacto: "no-es-una-fecha" as any })]),
			);
			expect(r.canalesFaltantes).toEqual(["whatsapp", "llamada", "sms"]);
			expect(warnSpy).toHaveBeenCalledTimes(1);
		} finally {
			warnSpy.mockRestore();
		}
	});
});

describe("evaluarGestionTempranaB1 — cobertura de canales", () => {
	test("sin contactos → faltan los 3, incompleta", () => {
		const r = aplicable(evaluar([]));
		expect(r.canalesFaltantes).toEqual(["whatsapp", "llamada", "sms"]);
		expect(r.estado).toBe("incompleta");
	});

	test("solo WhatsApp sin respuesta → faltan llamada y sms", () => {
		const r = aplicable(evaluar([contacto({ metodoContacto: "whatsapp" })]));
		expect(r.canalesFaltantes).toEqual(["llamada", "sms"]);
		expect(r.estado).toBe("incompleta");
	});

	test("WhatsApp + llamada sin respuesta → falta SMS (caso del criterio de aceptación)", () => {
		const r = aplicable(
			evaluar([
				contacto({ metodoContacto: "whatsapp" }),
				contacto({ metodoContacto: "llamada" }),
			]),
		);
		expect(r.canalesFaltantes).toEqual(["sms"]);
		expect(r.estado).toBe("incompleta");
	});

	test("los 3 canales intentados sin respuesta → agotada", () => {
		const r = aplicable(
			evaluar([
				contacto({ metodoContacto: "whatsapp" }),
				contacto({ metodoContacto: "llamada" }),
				contacto({ metodoContacto: "sms" }),
			]),
		);
		expect(r.canalesFaltantes).toEqual([]);
		expect(r.estado).toBe("agotada");
	});

	test("3 intentos TODOS por WhatsApp ≠ 3 canales: sigue incompleta", () => {
		const r = aplicable(
			evaluar([
				contacto({ metodoContacto: "whatsapp" }),
				contacto({ metodoContacto: "whatsapp" }),
				contacto({ metodoContacto: "whatsapp" }),
			]),
		);
		expect(r.canales[0].intentos).toBe(3);
		expect(r.canalesFaltantes).toEqual(["llamada", "sms"]);
		expect(r.estado).toBe("incompleta");
	});

	test("ultimoIntento por canal = el más reciente dentro de la ventana", () => {
		const r = aplicable(
			evaluar([
				contacto({ metodoContacto: "whatsapp", fechaContacto: MAS_TARDE }),
				contacto({ metodoContacto: "whatsapp", fechaContacto: DESPUES }),
			]),
		);
		expect(r.canales[0].ultimoIntento).toEqual(MAS_TARDE);
	});
});

describe("evaluarGestionTempranaB1 — early exit (el cliente contestó)", () => {
	test("contactado → respondio, aunque falten 2 canales", () => {
		const r = aplicable(
			evaluar([
				contacto({ metodoContacto: "whatsapp", estadoContacto: "contactado" }),
			]),
		);
		expect(r.estado).toBe("respondio");
		expect(r.canalQueContesto).toBe("whatsapp");
		expect(r.canalesFaltantes).toEqual(["llamada", "sms"]);
	});

	test("acuerdo_parcial → respondio", () => {
		const r = aplicable(
			evaluar([
				contacto({
					metodoContacto: "llamada",
					estadoContacto: "acuerdo_parcial",
				}),
			]),
		);
		expect(r.estado).toBe("respondio");
		expect(r.canalQueContesto).toBe("llamada");
	});

	test("rechaza_pagar → respondio: el cliente atendió, seguir marcando no lo des-niega", () => {
		const r = aplicable(
			evaluar([
				contacto({
					metodoContacto: "llamada",
					estadoContacto: "rechaza_pagar",
				}),
			]),
		);
		expect(r.estado).toBe("respondio");
	});

	test("promesa_pago → respondio y tienePromesa", () => {
		const r = aplicable(
			evaluar([
				contacto({
					metodoContacto: "whatsapp",
					estadoContacto: "promesa_pago",
				}),
			]),
		);
		expect(r.estado).toBe("respondio");
		expect(r.tienePromesa).toBe(true);
	});

	test("no_contesta NO dispara el early exit", () => {
		const r = aplicable(
			evaluar([
				contacto({ metodoContacto: "whatsapp", estadoContacto: "no_contesta" }),
			]),
		);
		expect(r.estado).toBe("incompleta");
		expect(r.canalQueContesto).toBeNull();
	});

	test("numero_equivocado NO es respuesta, pero marca el canal como dato inválido", () => {
		const r = aplicable(
			evaluar([
				contacto({
					metodoContacto: "whatsapp",
					estadoContacto: "numero_equivocado",
				}),
			]),
		);
		expect(r.estado).toBe("incompleta");
		expect(r.canalQueContesto).toBeNull();
		expect(r.canales[0].datoInvalido).toBe(true);
		// Sigue contando como intento: el canal se intentó, no está pendiente.
		expect(r.canales[0].intentos).toBe(1);
	});

	test("respondió Y se intentó por los 3 → respondio gana sobre agotada", () => {
		const r = aplicable(
			evaluar([
				contacto({ metodoContacto: "whatsapp", estadoContacto: "contactado" }),
				contacto({ metodoContacto: "llamada" }),
				contacto({ metodoContacto: "sms" }),
			]),
		);
		expect(r.estado).toBe("respondio");
		expect(r.canalesFaltantes).toEqual([]);
	});

	test("dos canales contestaron → canalQueContesto es el cronológicamente primero", () => {
		const r = aplicable(
			evaluar([
				// Llega primero en el array (el historial viene descendente) pero es
				// el más NUEVO: no debe ganar.
				contacto({
					metodoContacto: "llamada",
					estadoContacto: "contactado",
					fechaContacto: MAS_TARDE,
				}),
				contacto({
					metodoContacto: "whatsapp",
					estadoContacto: "contactado",
					fechaContacto: DESPUES,
				}),
			]),
		);
		expect(r.canalQueContesto).toBe("whatsapp");
	});
});

describe("evaluarGestionTempranaB1 — contactos automáticos", () => {
	test("recordatorio automático de premora no cuenta como intento del asesor", () => {
		const r = aplicable(
			evaluar([
				contacto({
					metodoContacto: "whatsapp",
					comentarios: `${PREFIJO_PREMORA_AUTO} — cuota vence en 3 días`,
				}),
			]),
		);
		expect(r.canalesFaltantes).toEqual(["whatsapp", "llamada", "sms"]);
	});

	test("envío masivo de WhatsApp no cuenta como intento del asesor", () => {
		const r = aplicable(
			evaluar([
				contacto({
					metodoContacto: "whatsapp",
					comentarios: `${PREFIJO_WSP_MASIVO} — Plantilla: recordatorio`,
				}),
			]),
		);
		expect(r.canalesFaltantes).toEqual(["whatsapp", "llamada", "sms"]);
	});

	test("un automático que SÍ contestó tampoco dispara el early exit", () => {
		const r = aplicable(
			evaluar([
				contacto({
					metodoContacto: "whatsapp",
					estadoContacto: "contactado",
					comentarios: `${PREFIJO_WSP_MASIVO} — Plantilla: x`,
				}),
			]),
		);
		expect(r.estado).toBe("incompleta");
		expect(r.canalQueContesto).toBeNull();
	});

	test("comentarios null cuenta como manual (no revienta)", () => {
		const r = aplicable(
			evaluar([contacto({ metodoContacto: "whatsapp", comentarios: null })]),
		);
		expect(r.canales[0].intentos).toBe(1);
	});

	test("el prefijo EN MEDIO del texto sí es manual: solo cuenta al inicio", () => {
		const r = aplicable(
			evaluar([
				contacto({
					metodoContacto: "whatsapp",
					comentarios: `El cliente pregunta por el ${PREFIJO_PREMORA_AUTO} que recibió`,
				}),
			]),
		);
		expect(r.canales[0].intentos).toBe(1);
	});
});

describe("evaluarGestionTempranaB1 — canales fuera de los 3", () => {
	test("email cuenta como otro canal, no cubre ninguno de los 3", () => {
		const r = aplicable(evaluar([contacto({ metodoContacto: "email" })]));
		expect(r.otrosCanales).toBe(1);
		expect(r.canalesFaltantes).toEqual(["whatsapp", "llamada", "sms"]);
		expect(r.estado).toBe("incompleta");
	});

	test("visita_domicilio contactado NO dispara el early exit por sí sola", () => {
		const r = aplicable(
			evaluar([
				contacto({
					metodoContacto: "visita_domicilio",
					estadoContacto: "contactado",
				}),
			]),
		);
		expect(r.canalQueContesto).toBeNull();
		expect(r.estado).toBe("incompleta");
	});

	test("una promesa por un canal fuera de los 3 sí satisface el early exit", () => {
		// El compromiso de pago es condición de salida explícita del ticket,
		// sin importar por dónde se consiguió.
		const r = aplicable(
			evaluar([
				contacto({
					metodoContacto: "visita_domicilio",
					estadoContacto: "promesa_pago",
				}),
			]),
		);
		expect(r.tienePromesa).toBe(true);
		expect(r.estado).toBe("respondio");
		expect(r.canalQueContesto).toBeNull();
	});
});

describe("esContactoAutomatico", () => {
	test("null → false", () => {
		expect(esContactoAutomatico(null)).toBe(false);
	});

	test("cada prefijo al inicio → true", () => {
		expect(esContactoAutomatico(`${PREFIJO_PREMORA_AUTO} x`)).toBe(true);
		expect(esContactoAutomatico(`${PREFIJO_WSP_MASIVO} x`)).toBe(true);
	});

	test("texto libre del asesor → false", () => {
		expect(esContactoAutomatico("No contesta, se reintenta mañana")).toBe(
			false,
		);
	});
});

describe("etiquetaMetodoContacto", () => {
	test("sms se rinde en mayúsculas, no 'Sms'", () => {
		expect(etiquetaMetodoContacto("sms")).toBe("SMS");
	});

	test("visita_domicilio se rinde legible, no 'Visita_domicilio'", () => {
		expect(etiquetaMetodoContacto("visita_domicilio")).toBe(
			"Visita a domicilio",
		);
	});

	test("whatsapp conserva su capitalización de marca", () => {
		expect(etiquetaMetodoContacto("whatsapp")).toBe("WhatsApp");
	});

	test("valor desconocido cae al capitalizado en vez de vaciarse", () => {
		expect(etiquetaMetodoContacto("telepatia")).toBe("Telepatia");
	});

	test("string vacío → guion", () => {
		expect(etiquetaMetodoContacto("")).toBe("—");
	});
});
