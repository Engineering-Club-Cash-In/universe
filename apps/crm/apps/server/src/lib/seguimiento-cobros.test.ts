import { describe, expect, it } from "bun:test";
import {
	accionPendienteDe,
	conHoraGT,
	estadoGestionDe,
	type FilaContactoSeguimiento,
	resumirSeguimiento,
} from "./seguimiento-cobros";

// 2026-10-06 15:00 hora Guatemala (UTC-6) = 21:00 UTC.
const AHORA = new Date("2026-10-06T21:00:00Z");
const gt = (fecha: string, hora = "10:00") =>
	new Date(`${fecha}T${hora}:00-06:00`);

function fila(
	parcial: Partial<FilaContactoSeguimiento> & {
		fechaContacto: Date;
		estadoContacto: string;
	},
): FilaContactoSeguimiento {
	return {
		casoCobroId: "caso-1",
		estadoPromesa: null,
		fechaProximoContacto: null,
		comentarios: "Gestión manual",
		...parcial,
	};
}

describe("resumirSeguimiento", () => {
	it("sin gestiones devuelve el seguimiento vacío", () => {
		const s = resumirSeguimiento([], AHORA);
		expect(s.intentosSinContacto).toBe(0);
		expect(s.ultimoIntentoEn).toBeNull();
		expect(s.intentadoHoy).toBe(false);
	});

	it("cuenta los intentos sin contacto seguidos desde el último contacto logrado", () => {
		const s = resumirSeguimiento(
			[
				fila({ fechaContacto: gt("2026-10-01"), estadoContacto: "contactado" }),
				fila({
					fechaContacto: gt("2026-10-02"),
					estadoContacto: "no_contesta",
				}),
				fila({
					fechaContacto: gt("2026-10-04"),
					estadoContacto: "numero_equivocado",
				}),
				fila({
					fechaContacto: gt("2026-10-05"),
					estadoContacto: "no_contesta",
				}),
			],
			AHORA,
		);
		expect(s.intentosSinContacto).toBe(3);
		expect(s.ultimoIntentoEn?.toISOString()).toBe(
			gt("2026-10-05").toISOString(),
		);
		expect(s.intentadoHoy).toBe(false);
	});

	it("la racha es al titular: codeudor y referencia ni suman ni cortan", () => {
		const s = resumirSeguimiento(
			[
				fila({
					fechaContacto: gt("2026-10-01"),
					estadoContacto: "no_contesta",
				}),
				fila({
					fechaContacto: gt("2026-10-02"),
					estadoContacto: "no_contesta",
					participanteTipo: "codeudor",
				}),
				fila({
					fechaContacto: gt("2026-10-03"),
					estadoContacto: "contactado",
					participanteTipo: "referencia",
				}),
				fila({
					fechaContacto: gt("2026-10-04"),
					estadoContacto: "no_contesta",
					participanteTipo: "titular",
				}),
			],
			AHORA,
		);
		// Solo cuentan el 1 y el 4 (el contacto logrado a la referencia no corta).
		expect(s.intentosSinContacto).toBe(2);
	});

	it("ignora los envíos automáticos (no son intentos del asesor)", () => {
		const s = resumirSeguimiento(
			[
				fila({
					fechaContacto: gt("2026-10-06", "08:00"),
					estadoContacto: "mensaje_enviado",
					comentarios: "Envío masivo de WhatsApp — recordatorio",
				}),
				fila({
					fechaContacto: gt("2026-10-05"),
					estadoContacto: "no_contesta",
				}),
			],
			AHORA,
		);
		expect(s.intentosSinContacto).toBe(1);
		expect(s.intentadoHoy).toBe(false);
	});

	it("detecta intento y contacto de hoy (día de Guatemala)", () => {
		const s = resumirSeguimiento(
			[
				fila({
					fechaContacto: gt("2026-10-06", "09:00"),
					estadoContacto: "no_contesta",
				}),
				fila({
					fechaContacto: gt("2026-10-06", "11:00"),
					estadoContacto: "contactado",
				}),
			],
			AHORA,
		);
		expect(s.intentadoHoy).toBe(true);
		expect(s.contactadoHoy).toBe(true);
		expect(s.intentosSinContacto).toBe(0);
	});

	it("toma la próxima llamada de la última gestión que no es promesa, si es hoy o futura", () => {
		const s = resumirSeguimiento(
			[
				fila({
					fechaContacto: gt("2026-10-05"),
					estadoContacto: "no_contesta",
					fechaProximoContacto: gt("2026-10-06", "00:00"),
				}),
			],
			AHORA,
		);
		expect(s.proximaLlamadaEn).not.toBeNull();
		const vieja = resumirSeguimiento(
			[
				fila({
					fechaContacto: gt("2026-10-01"),
					estadoContacto: "no_contesta",
					fechaProximoContacto: gt("2026-10-02", "00:00"),
				}),
			],
			AHORA,
		);
		expect(vieja.proximaLlamadaEn).toBeNull();
	});

	it("promesa vigente y promesa incumplida reciente", () => {
		const vigente = resumirSeguimiento(
			[
				fila({
					fechaContacto: gt("2026-10-03"),
					estadoContacto: "promesa_pago",
					estadoPromesa: "pendiente",
					fechaProximoContacto: gt("2026-10-08", "00:00"),
				}),
			],
			AHORA,
		);
		expect(vigente.promesaVigenteEn).not.toBeNull();
		expect(vigente.promesaIncumplida).toBe(false);

		const incumplida = resumirSeguimiento(
			[
				fila({
					fechaContacto: gt("2026-09-28"),
					estadoContacto: "promesa_pago",
					estadoPromesa: "pendiente",
					fechaProximoContacto: gt("2026-10-02", "00:00"),
				}),
			],
			AHORA,
		);
		expect(incumplida.promesaVigenteEn).toBeNull();
		expect(incumplida.promesaIncumplida).toBe(true);

		const vieja = resumirSeguimiento(
			[
				fila({
					fechaContacto: gt("2026-07-01"),
					estadoContacto: "promesa_pago",
					estadoPromesa: "incumplida",
					fechaProximoContacto: gt("2026-07-05", "00:00"),
				}),
			],
			AHORA,
		);
		expect(vieja.promesaIncumplida).toBe(false);
	});
});

describe("estadoGestionDe", () => {
	const base = resumirSeguimiento([], AHORA);
	it("convenio gana sobre todo", () => {
		expect(estadoGestionDe({ ...base, promesaIncumplida: true }, true)).toBe(
			"convenio_vigente",
		);
	});
	it("promesa vigente antes que incumplida", () => {
		expect(
			estadoGestionDe(
				{
					...base,
					promesaVigenteEn: gt("2026-10-08"),
					promesaIncumplida: true,
				},
				false,
			),
		).toBe("promesa_vigente");
		expect(estadoGestionDe({ ...base, promesaIncumplida: true }, false)).toBe(
			"promesa_incumplida",
		);
		expect(estadoGestionDe(base, false)).toBe("sin_acuerdo");
	});
});

describe("accionPendienteDe", () => {
	const base = resumirSeguimiento([], AHORA);
	it("SLA primero, luego promesa de hoy, llamada de hoy y cuota de hoy", () => {
		expect(accionPendienteDe(base, { slaHoy: true }, AHORA)?.tipo).toBe(
			"gestionar_sla",
		);
		expect(
			accionPendienteDe(
				{
					...base,
					promesaVigenteEn: gt("2026-10-06", "00:00"),
					proximaLlamadaEn: gt("2026-10-06", "00:00"),
				},
				{ venceHoy: true },
				AHORA,
			)?.tipo,
		).toBe("promesa_hoy");
		expect(
			accionPendienteDe(
				{ ...base, proximaLlamadaEn: gt("2026-10-06", "00:00") },
				{ venceHoy: true },
				AHORA,
			)?.tipo,
		).toBe("llamar");
		expect(accionPendienteDe(base, { venceHoy: true }, AHORA)?.tipo).toBe(
			"cuota_vence_hoy",
		);
	});
	it("promesa por vencer solo dentro de 3 días", () => {
		expect(
			accionPendienteDe(
				{ ...base, promesaVigenteEn: gt("2026-10-08", "00:00") },
				{},
				AHORA,
			)?.tipo,
		).toBe("promesa_por_vencer");
		expect(
			accionPendienteDe(
				{ ...base, promesaVigenteEn: gt("2026-10-20", "00:00") },
				{},
				AHORA,
			),
		).toBeNull();
	});
	it("sin nada pendiente devuelve null", () => {
		expect(accionPendienteDe(base, {}, AHORA)).toBeNull();
	});
});

describe("hora del próximo contacto (B8)", () => {
	it("proximaLlamadaEn lleva la hora que agendó el asesor", () => {
		const s = resumirSeguimiento(
			[
				fila({
					fechaContacto: gt("2026-10-06", "09:00"),
					estadoContacto: "no_contesta",
					fechaProximoContacto: gt("2026-10-06", "00:00"),
					horaProximoContacto: "15:30:00",
				}),
			],
			AHORA,
		);
		expect(s.proximaLlamadaEn?.toISOString()).toBe(
			gt("2026-10-06", "15:30").toISOString(),
		);
	});

	it("una llamada de hoy con hora ya pasada sigue pendiente (se decide por el día)", () => {
		const s = resumirSeguimiento(
			[
				fila({
					fechaContacto: gt("2026-10-05"),
					estadoContacto: "no_contesta",
					fechaProximoContacto: gt("2026-10-06", "00:00"),
					horaProximoContacto: "09:00",
				}),
			],
			AHORA,
		);
		expect(s.proximaLlamadaEn?.toISOString()).toBe(
			gt("2026-10-06", "09:00").toISOString(),
		);
		expect(accionPendienteDe(s, {}, AHORA)?.tipo).toBe("llamar");
	});

	it("sin hora queda la medianoche GT del día", () => {
		const s = resumirSeguimiento(
			[
				fila({
					fechaContacto: gt("2026-10-05"),
					estadoContacto: "no_contesta",
					fechaProximoContacto: gt("2026-10-07", "00:00"),
				}),
			],
			AHORA,
		);
		expect(s.proximaLlamadaEn?.toISOString()).toBe(
			gt("2026-10-07", "00:00").toISOString(),
		);
	});

	it("conHoraGT ignora una hora inválida", () => {
		const dia = gt("2026-10-07", "00:00");
		expect(conHoraGT(dia, "25:00").toISOString()).toBe(dia.toISOString());
		expect(conHoraGT(dia, "abc").toISOString()).toBe(dia.toISOString());
		expect(conHoraGT(dia, null).toISOString()).toBe(dia.toISOString());
	});
});

describe("pago por confirmar (B6)", () => {
	const base = resumirSeguimiento([], AHORA);
	it("va después del SLA y antes de la promesa de hoy", () => {
		expect(
			accionPendienteDe(base, { slaHoy: true, pagoPorConfirmar: true }, AHORA)
				?.tipo,
		).toBe("gestionar_sla");
		expect(
			accionPendienteDe(
				{ ...base, promesaVigenteEn: gt("2026-10-06", "00:00") },
				{ pagoPorConfirmar: true },
				AHORA,
			)?.tipo,
		).toBe("confirmar_pago");
	});
});
