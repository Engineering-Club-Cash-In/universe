import { describe, expect, it } from "bun:test";
import {
	contarPorFiltro,
	cortePeriodoActual,
	type EventoHistorial,
	enPeriodo,
	eventoDeDecisionConvenio,
	eventoDeGrupoPagalo,
	eventoDeHito,
	eventoDeRecordatorio,
	eventosDeBot,
	eventosDeContactos,
	eventosDelPeriodo,
	eventosDePagos,
	filtrarEventos,
	horizonteDeCarga,
	instanteHoraGT,
	mezclarEventos,
} from "./historial-unificado";

const AHORA = new Date("2026-10-15T18:00:00Z");

describe("eventosDeContactos", () => {
	it("una gestión conserva canal, resultado, W1 y detalles", () => {
		const [e] = eventosDeContactos([
			{
				id: "g1",
				fechaContacto: "2026-10-14T16:30:00Z",
				metodoContacto: "llamada",
				direccionContacto: "entrante",
				estadoContacto: "contactado",
				participanteTipo: "codeudor",
				participanteNombre: "Juan Pérez",
				telefonoContactado: "5555-1234",
				realizadoPor: "Caren Rivera",
				comentarios: "Pagará el viernes",
				acuerdosAlcanzados: "Pago parcial",
				fechaProximoContacto: "2026-10-20",
				horaProximoContacto: "10:30:00",
				medioProximoContacto: "whatsapp",
				duracionLlamada: 125,
			},
		]);
		expect(e.tipo).toBe("gestion");
		expect(e.titulo).toBe("Llamada entrante");
		expect(e.icono).toBe("llamada_entrante");
		expect(e.cuando).toBe("14 oct 2026 · 10:30");
		expect(e.badges).toEqual([{ etiqueta: "Contactado", tono: "success" }]);
		expect(e.subtitulo).toBe("Por: Caren Rivera");
		expect(e.contacto).toEqual({
			participante: "Habló con: Juan Pérez (codeudor)",
			telefono: "5555-1234",
		});
		expect(e.tono).toBe("logrado");
		expect(e.nota).toBe("Pagará el viernes");
		expect(e.filtros).toEqual(["gestiones", "efectivas"]);
		expect(e.detalles).toEqual([
			{ label: "Acuerdos", valor: "Pago parcial" },
			{
				label: "Seguimiento programado",
				valor: "20 oct 2026 · 10:30 · por WhatsApp",
			},
			{ label: "Duración", valor: "2:05 min" },
		]);
	});

	it("no contesta no es un contacto efectivo", () => {
		const [e] = eventosDeContactos([
			{
				id: "g2",
				fechaContacto: "2026-10-14T16:30:00Z",
				metodoContacto: "whatsapp",
				estadoContacto: "no_contesta",
			},
		]);
		expect(e.filtros).toEqual(["gestiones"]);
		expect(e.tono).toBe("sin-contacto");
		expect(e.subtitulo).toBe("Por: Sin asignar");
	});

	it("una promesa usa el estado recalculado y marca la vencida", () => {
		const [e] = eventosDeContactos(
			[
				{
					id: "p1",
					fechaContacto: "2026-10-01T15:00:00Z",
					metodoContacto: "llamada",
					estadoContacto: "promesa_pago",
					estadoPromesa: "pendiente",
					fechaProximoContacto: "2026-10-10T06:00:00Z",
					cuotaInicio: 3,
					cuotaFin: 5,
					incluyeMora: true,
					montoComprometido: "3600",
					realizadoPor: "Ana",
				},
			],
			{ p1: "incumplida" },
			AHORA,
		);
		expect(e.tipo).toBe("promesa");
		expect(e.filtros).toEqual(["gestiones", "efectivas", "promesas"]);
		expect(e.titulo).toBe("Promesa de pago · Cuotas #3 a #5 + mora");
		expect(e.badges.map((b) => b.etiqueta)).toEqual(["Incumplida", "Vencida"]);
		expect(e.derecha).toBe("Q3,600.00");
		expect(e.subtitulo).toBe("Para el 10 oct 2026 · Por: Ana");
		expect(e.tono).toBe("fallido");
	});

	it("una promesa vieja sin rango ni mora no inventa lo prometido", () => {
		const [e] = eventosDeContactos(
			[
				{
					id: "p2",
					fechaContacto: "2026-10-14T15:00:00Z",
					estadoContacto: "promesa_pago",
					fechaProximoContacto: "2026-10-20T06:00:00Z",
				},
			],
			undefined,
			AHORA,
		);
		expect(e.titulo).toBe("Promesa de pago · Sin rango ni mora especificados");
		expect(e.tituloAtenuado).toBe(true);
		expect(e.badges.map((b) => b.etiqueta)).toEqual(["Pendiente"]);
		expect(e.tono).toBe("sin-contacto");
	});
});

describe("eventoDeRecordatorio", () => {
	it("traduce el tipo y marca la variante de mora, la prueba y el error", () => {
		const e = eventoDeRecordatorio({
			id: "r1",
			tipo: "premora_3_mora",
			telefono: "5555-0000",
			enviado: false,
			error: "Número inválido",
			modoPrueba: true,
			fecha: "2026-10-12T14:00:00Z",
		});
		expect(e.titulo).toBe("Recordatorio de pago D-3");
		expect(e.badges.map((b) => b.etiqueta)).toEqual([
			"Falló",
			"Variante mora",
			"Prueba",
		]);
		expect(e.nota).toBe("Número inválido");
		expect(e.tono).toBe("fallido");
		expect(e.filtros).toEqual(["recordatorios"]);
	});
});

describe("instanteHoraGT", () => {
	it("lee la hora de cartera como hora de Guatemala aunque traiga Z", () => {
		const i = instanteHoraGT("2026-10-03T10:15:00.000Z");
		expect(i?.conHora).toBe(true);
		expect(new Date(i?.ms ?? 0).toISOString()).toBe("2026-10-03T16:15:00.000Z");
	});

	it("medianoche o solo fecha = sin hora", () => {
		expect(instanteHoraGT("2026-10-03")?.conHora).toBe(false);
		expect(instanteHoraGT("2026-10-03 00:00:00")?.conHora).toBe(false);
		expect(instanteHoraGT(null)).toBeNull();
	});
});

describe("eventosDePagos", () => {
	it("junta un pago repartido en varias cuotas", () => {
		const eventos = eventosDePagos([
			{
				numeroCuota: 5,
				pagos: [
					{
						pagoId: 77,
						montoBoleta: "2000",
						montoAplicado: "1200",
						fechaPago: "2026-10-03T00:00:00",
						validationStatus: "validated",
						estado: "validado",
					},
				],
			},
			{
				numeroCuota: 6,
				pagos: [
					{
						pagoId: 77,
						montoBoleta: "2000",
						montoAplicado: "800",
						fechaPago: "2026-10-03T00:00:00",
						validationStatus: "validated",
						estado: "parcial",
					},
				],
			},
			{ numeroCuota: 7, pagos: [] },
		]);
		expect(eventos).toHaveLength(1);
		const [e] = eventos;
		expect(e.id).toBe("pago-77");
		expect(e.cuando).toBe("3 oct 2026");
		expect(e.derecha).toBe("Q2,000.00");
		expect(e.subtitulo).toBe("Pago #77 · Cuotas #5 y #6");
		expect(e.badges.map((b) => b.etiqueta)).toEqual([
			"Validado",
			"Pago parcial",
		]);
		expect(e.detalles).toEqual([
			{ label: "Aplicado a la cuota #5", valor: "Q1,200.00" },
			{ label: "Aplicado a la cuota #6", valor: "Q800.00" },
		]);
	});

	it("un pago sin validar va en ámbar", () => {
		const [e] = eventosDePagos([
			{
				numeroCuota: 1,
				pagos: [
					{
						pagoId: 1,
						montoBoleta: "500",
						montoAplicado: "450",
						fechaPago: "2026-10-03T09:30:00",
						validationStatus: "pending",
					},
				],
			},
		]);
		expect(e.badges[0]).toEqual({
			etiqueta: "Pendiente de validar",
			tono: "warning",
		});
		expect(e.tono).toBe("sin-contacto");
		expect(e.cuando).toBe("3 oct 2026 · 09:30");
		expect(e.detalles[0]).toEqual({
			label: "Monto de la boleta",
			valor: "Q500.00",
		});
	});
});

describe("eventoDeGrupoPagalo", () => {
	const base = {
		id: "g1",
		status: "COMPLETED",
		origen: "ASESOR" as const,
		totalAmount: "1500",
		carteraImportId: 12,
		lastDispatchError: null,
		createdAt: "2026-10-05T15:00:00Z",
		creadoPor: "Caren Rivera",
		links: [{}, {}],
	};

	it("conserva estado, monto, autor y el aviso de aplicado", () => {
		const e = eventoDeGrupoPagalo(base);
		expect(e.badges).toEqual([{ etiqueta: "Completado", tono: "success" }]);
		expect(e.derecha).toBe("Q1,500.00");
		expect(e.subtitulo).toBe("Por: Caren Rivera");
		expect(e.avisos?.[0]?.tono).toBe("success");
		expect(e.detalleEtiqueta).toBe("Ver los 2 links, cuotas y bitácora");
		expect(e.filtros).toEqual(["links"]);
		expect(e.datos?.tipo).toBe("link_pago");
	});

	it("un grupo del bot también cuenta como actividad del bot", () => {
		const e = eventoDeGrupoPagalo({
			...base,
			origen: "BOT",
			creadoPor: null,
			status: "REVIEW_REQUIRED",
			lastDispatchError: "PAGALO_LIVE_DEBT_REVIEW",
		});
		expect(e.subtitulo).toBe("Por: Bot de WhatsApp");
		expect(e.filtros).toEqual(["links", "bot"]);
		expect(e.tono).toBe("fallido");
		expect(e.avisos).toEqual([
			{ tono: "danger", texto: "La deuda viva no coincide con el snapshot" },
		]);
	});
});

describe("eventosDeBot", () => {
	it("una fila por sesión y los accesos fallidos juntos por día", () => {
		const eventos = eventosDeBot({
			sesiones: [
				{
					numero: 2,
					referenciaSufijo: "abc123",
					inicio: "2026-10-10T15:00:00Z",
					operadoPor: "codeudor",
					codeudorNombre: "Luis",
					interacciones: [
						{
							id: "i1",
							accion: "menu_credito",
							exito: true,
							codigo: null,
							numeroSifco: null,
							detalle: {},
							creadoEn: "2026-10-10T15:00:00Z",
						},
						{
							id: "i2",
							accion: "boleta_leer",
							exito: false,
							codigo: "BOLETA_ILEGIBLE",
							numeroSifco: null,
							detalle: {},
							creadoEn: "2026-10-10T15:01:00Z",
						},
					],
				},
			],
			accesosFallidos: [
				{
					id: "a1",
					accion: "acceso_fallido",
					exito: false,
					codigo: "DEMASIADOS_ENVIOS",
					numeroSifco: null,
					detalle: {},
					creadoEn: "2026-10-09T20:00:00Z",
				},
				{
					id: "a2",
					accion: "acceso_fallido",
					exito: false,
					codigo: "DEMASIADOS_ENVIOS",
					numeroSifco: null,
					detalle: {},
					creadoEn: "2026-10-09T16:00:00Z",
				},
				{
					id: "a3",
					accion: "acceso_fallido",
					exito: false,
					codigo: "OTP_NO_ENVIADO",
					numeroSifco: null,
					detalle: {},
					creadoEn: "2026-10-01T16:00:00Z",
				},
			],
		});
		expect(eventos).toHaveLength(3);
		expect(eventos[0].titulo).toBe("Bot de WhatsApp · Referencia 2");
		expect(eventos[0].badges[0].etiqueta).toBe("Codeudor: Luis");
		expect(eventos[0].subtitulo).toBe("2 interacciones · 1 con error");
		expect(eventos[0].tono).toBe("sin-contacto");
		expect(eventos[1].subtitulo).toBe("2 intentos");
		expect(eventos[1].fecha).toBe(Date.parse("2026-10-09T20:00:00Z"));
		expect(eventos[2].subtitulo).toBe("1 intento");
	});
});

describe("vida del crédito", () => {
	it("hitos y decisiones de convenio van a «Vida del crédito»", () => {
		const hito = eventoDeHito({
			id: "bucket-1",
			descripcion: "Subió a Bucket B2 · Gestión activa (desde B1)",
			fecha: "2026-10-03T06:00:00.000Z",
			tipo: "bucket",
		});
		expect(hito.filtros).toEqual(["vida"]);
		expect(hito.icono).toBe("bucket");
		expect(hito.cuando).toBe("3 oct 2026");

		const cumplida = eventoDeHito({
			id: "promesa-1",
			descripcion: "Promesa de pago cumplida",
			fecha: "2026-10-04T06:00:00.000Z",
			tipo: "promesa",
		});
		expect(cumplida.filtros).toEqual(["vida", "promesas"]);

		const decision = eventoDeDecisionConvenio({
			decisionId: 9,
			decision: "rechazado",
			motivo: "Ingresos insuficientes",
			origen: "cartera_front",
			decididoPorEmail: "sup@cashin.gt",
			decididoEn: "2026-10-05T15:00:00Z",
			snapshot: { monto_total_convenio: "12000", numero_meses: 6 },
		});
		expect(decision.titulo).toBe("Convenio de pago por Q12,000.00 · 6 meses");
		expect(decision.badges.map((b) => b.etiqueta)).toEqual([
			"Rechazado",
			"Desde cartera",
		]);
		expect(decision.nota).toBe("Motivo: Ingresos insuficientes");
		expect(decision.tono).toBe("fallido");
	});
});

/** Evento mínimo para probar mezcla, periodo y filtros. */
function ev(
	id: string,
	fecha: string | null,
	filtros: EventoHistorial["filtros"] = ["gestiones"],
): EventoHistorial {
	return {
		id,
		fecha: fecha ? Date.parse(fecha) : null,
		tipo: "gestion",
		filtros,
		icono: "llamada",
		cuando: "",
		titulo: id,
		badges: [],
		tono: "neutro",
		detalles: [],
	};
}

describe("mezcla, periodo y horizonte", () => {
	const corte = {
		fecha: Date.parse("2026-10-03T12:00:00Z"),
		bucket: "B2",
		origen: "bucket_actual" as const,
	};

	it("ordena lo más reciente primero y deja lo sin fecha al final", () => {
		const lista = mezclarEventos(
			[ev("a", "2026-10-01T00:00:00Z"), ev("sin", null)],
			[ev("b", "2026-10-05T00:00:00Z")],
		);
		expect(lista.map((e) => e.id)).toEqual(["b", "a", "sin"]);
	});

	it("actual = desde la entrada al bucket; histórico = lo anterior", () => {
		expect(enPeriodo(ev("x", "2026-10-03T12:00:00Z"), "actual", corte)).toBe(
			true,
		);
		expect(enPeriodo(ev("y", "2026-10-03T11:59:00Z"), "actual", corte)).toBe(
			false,
		);
		expect(enPeriodo(ev("y", "2026-10-03T11:59:00Z"), "historico", corte)).toBe(
			true,
		);
		expect(enPeriodo(ev("sin", null), "historico", corte)).toBe(true);
	});

	it("sin corte, todo es actual y el histórico queda vacío", () => {
		expect(enPeriodo(ev("x", "2020-01-01T00:00:00Z"), "actual", null)).toBe(
			true,
		);
		expect(enPeriodo(ev("x", "2020-01-01T00:00:00Z"), "historico", null)).toBe(
			false,
		);
	});

	it("el corte sale del motor y, si no, del último hito de bucket", () => {
		expect(
			cortePeriodoActual({
				fechaEntradaBucket: "2026-10-03T12:00:00Z",
				bucket: "B2",
			}),
		).toEqual(corte);
		expect(
			cortePeriodoActual({
				fechaEntradaBucket: null,
				hitos: [
					{
						id: "1",
						descripcion: "",
						fecha: "2026-09-01T00:00:00Z",
						tipo: "bucket",
					},
					{
						id: "2",
						descripcion: "",
						fecha: "2026-09-20T00:00:00Z",
						tipo: "bucket",
					},
					{
						id: "3",
						descripcion: "",
						fecha: "2026-09-25T00:00:00Z",
						tipo: "convenio",
					},
				],
			}),
		).toEqual({
			fecha: Date.parse("2026-09-20T00:00:00Z"),
			bucket: null,
			origen: "ultimo_hito",
		});
		expect(cortePeriodoActual({ fechaEntradaBucket: null })).toBeNull();
	});

	it("el horizonte es lo más viejo cargado de la fuente truncada más corta", () => {
		expect(
			horizonteDeCarga([
				{ truncada: true, masAntiguo: 100 },
				{ truncada: true, masAntiguo: 300 },
				{ truncada: false, masAntiguo: 900 },
			]),
		).toBe(300);
		expect(horizonteDeCarga([{ truncada: false, masAntiguo: 5 }])).toBeNull();
	});

	it("oculta lo anterior al horizonte y lo sin fecha mientras falte cargar", () => {
		const eventos = [
			ev("nuevo", "2026-10-10T00:00:00Z"),
			ev("viejo", "2026-09-01T00:00:00Z"),
			ev("sin", null),
		];
		const horizonte = Date.parse("2026-09-15T00:00:00Z");
		expect(
			eventosDelPeriodo(eventos, {
				periodo: "actual",
				corte: null,
				horizonte,
			}).map((e) => e.id),
		).toEqual(["nuevo"]);
		expect(
			eventosDelPeriodo(eventos, {
				periodo: "historico",
				corte,
				horizonte: null,
			}).map((e) => e.id),
		).toEqual(["viejo", "sin"]);
	});

	it("cuenta y filtra por chip (un evento puede ir en varios)", () => {
		const eventos = [
			ev("a", "2026-10-10T00:00:00Z", ["gestiones", "efectivas"]),
			ev("b", "2026-10-09T00:00:00Z", ["links", "bot"]),
			ev("c", "2026-10-08T00:00:00Z", ["gestiones"]),
		];
		const conteo = contarPorFiltro(eventos);
		expect(conteo.todo).toBe(3);
		expect(conteo.gestiones).toBe(2);
		expect(conteo.efectivas).toBe(1);
		expect(conteo.bot).toBe(1);
		expect(conteo.pagos).toBe(0);
		expect(filtrarEventos(eventos, "bot").map((e) => e.id)).toEqual(["b"]);
		expect(filtrarEventos(eventos, "todo")).toHaveLength(3);
	});
});
