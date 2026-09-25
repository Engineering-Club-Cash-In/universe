import { describe, expect, it } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
	MARCA_DECREMENTO_ANULADO,
	MOTIVOS_RESTITUCION_MORA_PREFIJOS,
	MOTIVO_ANULACION_MORA_PREFIJO,
	MOTIVO_REVERSA_MORA_PREFIJO,
	marcaPagoDelDecremento,
	motivoAnulacionMora,
	motivoReversaMora,
} from "../utils/motivoReversaMora";
import {
	type MoraLevelEvent,
	type MoraRecoverySourceRow,
	CLAVES_EVENTO_MORA_RECOVERY_CRUDO,
	CREDITOS_POR_LOTE,
	acumularMoraRecoveryRows,
	buildMoraRecoveryCreditosQuery,
	buildMoraRecoveryQuery,
	buildMoraRecoveryReport,
	esReseteoDeNivel,
	finalizarMoraRecoveryReport,
	getMoraRecoveryPeriod,
	moraGeneradaEnPeriodo,
	nivelSembrado,
	nuevoMoraRecoveryAccumulator,
	partirEnLotes,
	plegarNivel,
} from "./moraRecuperacion";

const evento = (
	tipoEvento: string,
	montoAnterior: number,
	montoNuevo: number,
): MoraLevelEvent => ({ tipoEvento, montoAnterior, montoNuevo });

/** La restitución de una reversa de pago: repone el techo, no genera. */
const reverso = (montoAnterior: number, montoNuevo: number): MoraLevelEvent => ({
	tipoEvento: "INCREMENTO",
	montoAnterior,
	montoNuevo,
	reverso: true,
});

/** Un `DECREMENTO` ligado a SU pago por la marca `[pago #N]`. */
const pagoDe = (
	montoAnterior: number,
	montoNuevo: number,
	pagoId: number,
): MoraLevelEvent => ({
	tipoEvento: "DECREMENTO",
	montoAnterior,
	montoNuevo,
	pagoId: String(pagoId),
});

/** La restitución de ESE pago: la reversa o la anulación firman con su id. */
const reversoDe = (
	montoAnterior: number,
	montoNuevo: number,
	pagoId: number,
): MoraLevelEvent => ({
	...reverso(montoAnterior, montoNuevo),
	pagoId: String(pagoId),
});

/** El mismo evento, pero ocurrido ANTES del corte: solo siembra el nivel. */
const previo = (
	tipoEvento: string,
	montoAnterior: number,
	montoNuevo: number,
): MoraLevelEvent => ({
	tipoEvento,
	montoAnterior,
	montoNuevo,
	previo: true,
});

const rows: MoraRecoverySourceRow[] = [
	{
		asesorId: 1,
		nombre: "Ana",
		esperado: "100.00",
		eventos: [],
		cobrado: "120.00",
	},
	{
		asesorId: null,
		nombre: "Sin asignar",
		esperado: "50.00",
		eventos: [],
		cobrado: "20.00",
	},
	{
		asesorId: 2,
		nombre: "Beto",
		esperado: "0.00",
		eventos: [],
		cobrado: "40.00",
	},
];

describe("marca de la reversa de pago", () => {
	it("el motivo que escribe la reversa es el que el reporte busca", () => {
		// Si alguien cambia la redacción en reversePayment sin tocar el prefijo,
		// esta prueba sigue verde; si cambia el prefijo, el reporte dejaría de
		// reconocer las restituciones y acá se cae.
		const motivo = motivoReversaMora(4321);
		expect(motivo.startsWith(MOTIVO_REVERSA_MORA_PREFIJO)).toBe(true);
		expect(motivo).toContain("4321");
		// El LIKE del SQL es exactamente `${prefijo}%`.
		const patron = new RegExp(
			`^${MOTIVO_REVERSA_MORA_PREFIJO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
		);
		expect(patron.test(motivo)).toBe(true);
	});

	it("la anulación firma con su PROPIO prefijo, y el lector reconoce a los dos", () => {
		// Anular no es revertir: son hechos distintos y el historial tiene que
		// poder distinguirlos. Pero para la mora los dos son una RESTITUCIÓN, así
		// que los dos tienen que estar en la lista que lee el reporte.
		const motivo = motivoAnulacionMora(4321);
		expect(motivo.startsWith(MOTIVO_ANULACION_MORA_PREFIJO)).toBe(true);
		expect(motivo).toContain("4321");
		expect(motivo.startsWith(MOTIVO_REVERSA_MORA_PREFIJO)).toBe(false);
		expect(MOTIVOS_RESTITUCION_MORA_PREFIJOS).toContain(
			MOTIVO_ANULACION_MORA_PREFIJO,
		);
		expect(MOTIVOS_RESTITUCION_MORA_PREFIJOS).toContain(
			MOTIVO_REVERSA_MORA_PREFIJO,
		);
		for (const prefijo of MOTIVOS_RESTITUCION_MORA_PREFIJOS) {
			expect(prefijo.length).toBeGreaterThan(0);
		}
	});
});

describe("el pago anulado y su restitución, de punta a punta", () => {
	it("foto Q100 + pago falseado + RECALCULO → esperado Q100, no Q200", () => {
		// El defecto completo: `falsePayment` dejaba el DECREMENTO huérfano y el
		// RECALCULO de la mañana siguiente entraba como mora nueva. Ahora la
		// anulación escribe su restitución marcada, el plegado la reconoce, y el
		// RECALCULO que la sigue ya no supera el nivel.
		const reporte = buildMoraRecoveryReport(
			[
				{
					asesorId: 1,
					nombre: "Ana",
					esperado: "100",
					eventos: [
						evento("DECREMENTO", 100, 0),
						reverso(0, 100),
						evento("RECALCULO", 100, 100),
					],
					cobrado: "0",
				},
			],
			{ inicio: "2026-07-06", fin: "2026-08-06", alcance: "historico" },
		);
		expect(reporte.totales.esperado).toBe("100.00");
		expect(reporte.totales.esperado).not.toBe("200.00");
	});

	it("la reversa de un pago ANTERIOR al ciclo genera, y el cobro cae DENTRO del alcance", () => {
		// Foto 0 porque el pago ya la había bajado antes del corte. La reversa
		// revive Q100 que el asesor tiene vivos hoy; si el esperado quedara en 0,
		// el cobro de esos Q100 se contaría como "fuera del alcance" y el reporte
		// premiaría un cobro que ni siquiera esperaba.
		const reporte = buildMoraRecoveryReport(
			[
				{
					asesorId: 1,
					nombre: "Ana",
					esperado: "0",
					eventos: [reverso(0, 100)],
					cobrado: "100",
				},
			],
			{ inicio: "2026-07-06", fin: "2026-08-06", alcance: "historico" },
		);
		expect(reporte.totales.esperado).toBe("100.00");
		expect(reporte.totales.cobradoEnSnapshot).toBe("100.00");
		expect(reporte.totales.cobradoFueraSnapshot).toBe("0.00");
		expect(reporte.totales.pendiente).toBe("0.00");
	});
});

describe("la marca de decremento anulado solo vale DENTRO del ciclo", () => {
	/**
	 * El crédito llega al ciclo con la mora ya cobrada por un pago de un ciclo
	 * ANTERIOR (foto 0). Adentro del ciclo ese pago se cae y el decremento viejo
	 * queda marcado como anulado. Esos Q100 vuelven a estar vivos y cobrables:
	 * son oportunidad REAL del asesor, no la reposición de algo que el ciclo ya
	 * contó.
	 */
	const previosConDecrementoAnulado: MoraLevelEvent[] = [
		evento("CREACION", 0, 100),
		{ ...evento("DECREMENTO", 100, 0), anulado: true },
	];

	const reporteDelCiclo = (eventos: MoraLevelEvent[], cobrado: string) =>
		buildMoraRecoveryReport(
			[
				{
					asesorId: 1,
					nombre: "Ana",
					esperado: "0",
					eventos,
					nivelSembrado: String(nivelSembrado(previosConDecrementoAnulado)),
					cobrado,
				},
			],
			{ inicio: "2026-07-06", fin: "2026-08-06", alcance: "historico" },
		);

	it("el decremento de la víspera SIGUE siendo el ancla de la siembra", () => {
		// Si la marca lo sacara del ancla, el techo sembrado quedaría en 100 y la
		// reposición de adentro no generaría nada.
		expect(nivelSembrado(previosConDecrementoAnulado)).toBe(0);
	});

	it("(a) la restitución de adentro genera: esperado 100, pendiente 100", () => {
		const reporte = reporteDelCiclo([reverso(0, 100)], "0");
		expect(reporte.totales.esperado).toBe("100.00");
		expect(reporte.totales.pendiente).toBe("100.00");
	});

	it("(a bis) sin evento de restitución, el RECALCULO del cron también genera", () => {
		// Si el cron ya había repuesto, la reconciliación restituye 0 y no queda
		// ningún evento marcado como reverso: lo único de adentro es la
		// re-fijación del cron. Tiene que contar igual.
		const reporte = reporteDelCiclo([evento("RECALCULO", 0, 100)], "0");
		expect(reporte.totales.esperado).toBe("100.00");
		expect(reporte.totales.pendiente).toBe("100.00");
	});

	it("(c) si el cliente paga esos Q100, el cobro NO cae fuera del alcance", () => {
		const reporte = reporteDelCiclo([reverso(0, 100)], "100");
		expect(reporte.totales.cobradoEnSnapshot).toBe("100.00");
		expect(reporte.totales.cobradoFueraSnapshot).toBe("0.00");
		expect(reporte.totales.pendiente).toBe("0.00");
	});

	it("el camino viejo (eventos `previo`) siembra igual que el agregado", () => {
		// El plegado fila por fila del tramo previo es la ESPECIFICACIÓN del
		// agregado que hoy calcula el SQL: si una de las dos piezas honrara la
		// marca y la otra no, la siembra diría dos cosas distintas.
		const conPrevios = moraGeneradaEnPeriodo(0, [
			...previosConDecrementoAnulado.map((e) => ({ ...e, previo: true })),
			reverso(0, 100),
		]);
		const conAgregado = moraGeneradaEnPeriodo(
			0,
			[reverso(0, 100)],
			nivelSembrado(previosConDecrementoAnulado),
		);

		expect(conPrevios).toBe(100);
		expect(conAgregado).toBe(100);
	});

	it("(b) el caso que la marca vino a resolver sigue dando 100, no 200", () => {
		// Pago y anulación DENTRO del mismo ciclo: el decremento marcado es una
		// bajada que este recorrido vio, y saltarlo es lo que impide que la
		// reposición del cron se cobre como mora nueva.
		const reporte = buildMoraRecoveryReport(
			[
				{
					asesorId: 1,
					nombre: "Ana",
					esperado: "100",
					eventos: [
						{ ...evento("DECREMENTO", 100, 0), anulado: true },
						evento("RECALCULO", 0, 100),
					],
					nivelSembrado: String(nivelSembrado([evento("CREACION", 0, 100)])),
					cobrado: "0",
				},
			],
			{ inicio: "2026-07-06", fin: "2026-08-06", alcance: "historico" },
		);
		expect(reporte.totales.esperado).toBe("100.00");
		expect(reporte.totales.esperado).not.toBe("200.00");
	});
});

/**
 * Los dos defectos, en QUETZALES y sobre el reporte entero: el plegado devuelve
 * un número suelto, pero lo que el asesor ve es el esperado y el pendiente.
 */
describe("el techo y la identidad del pago, en el reporte", () => {
	const reporte = (
		eventos: MoraLevelEvent[],
		{
			foto,
			cobrado,
			sembrado = "0",
		}: { foto: string; cobrado: string; sembrado?: string },
	) =>
		buildMoraRecoveryReport(
			[
				{
					asesorId: 1,
					nombre: "Ana",
					esperado: foto,
					eventos,
					nivelSembrado: sembrado,
					cobrado,
				},
			],
			{ inicio: "2026-07-06", fin: "2026-08-06", alcance: "historico" },
		);

	it("un pago de Q20 ya no derrumba el techo: esperado 120, no 200", () => {
		// Foto 120, la empresa condona, el cron repone 60, el cliente paga 20 y
		// el cron termina de reponer hasta 120. Debe 120 y pagó 20: el esperado
		// es 120 y el pendiente 100. Antes el reporte reclamaba 200 de esperado
		// y 180 de pendiente por un pago de Q20.
		const totales = reporte(
			[
				evento("CONDONACION", 120, 0),
				evento("RECALCULO", 0, 60),
				pagoDe(60, 40, 7),
				evento("RECALCULO", 40, 120),
			],
			{ foto: "120", cobrado: "20" },
		).totales;
		expect(totales.esperado).toBe("120.00");
		expect(totales.esperado).not.toBe("200.00");
		expect(totales.pendiente).toBe("100.00");
	});

	it("lo mismo sin condonación, con el techo SEMBRADO: esperado 60, no 140", () => {
		// Foto 60 y techo sembrado en 120 (la condonación quedó del otro lado del
		// corte). El pago de Q20 tampoco derrumba ese techo.
		const totales = reporte([pagoDe(60, 40, 7), evento("RECALCULO", 40, 120)], {
			foto: "60",
			cobrado: "20",
			sembrado: "120",
		}).totales;
		expect(totales.esperado).toBe("60.00");
		expect(totales.esperado).not.toBe("140.00");
	});

	it("el pago ajeno ya no tapa la reversa de un pago anterior: esperado 200", () => {
		// Foto 100. Adentro el cliente paga esos Q100 (pago 7) y además se
		// revierte un pago ANTERIOR al ciclo (pago 9), que le devuelve Q100 de
		// mora que nunca se contaron y que hoy están vivos. Antes el pago 7
		// llenaba el contador común y tapaba entera la reversa del 9: el reporte
		// decía pendiente 0.00 con Q100 vivos y cobrables.
		const totales = reporte([pagoDe(100, 0, 7), reversoDe(0, 100, 9)], {
			foto: "100",
			cobrado: "100",
		}).totales;
		expect(totales.esperado).toBe("200.00");
		expect(totales.cobradoEnSnapshot).toBe("100.00");
		expect(totales.pendiente).toBe("100.00");
		expect(totales.pendiente).not.toBe("0.00");
	});

	it("cobrar dos veces la misma mora en el ciclo aparece como EXCEDENTE", () => {
		// La consecuencia declarada de que el techo no baje: si el cliente paga
		// la mora, el cron la repone y la vuelve a pagar, el asesor cobró Q200
		// sobre una oportunidad de Q100. El esperado ya no se infla para
		// acompañar al cobro —era el defecto—: el sobrante sale por
		// `excedenteEnSnapshot`, que es donde se puede ver.
		const totales = reporte(
			[pagoDe(100, 0, 7), evento("RECALCULO", 0, 100), pagoDe(100, 0, 8)],
			{ foto: "100", cobrado: "200" },
		).totales;
		expect(totales.esperado).toBe("100.00");
		expect(totales.cobradoEnSnapshot).toBe("200.00");
		expect(totales.excedenteEnSnapshot).toBe("100.00");
		expect(totales.pendiente).toBe("0.00");
	});

	it("y la reversa del pago que SÍ bajó adentro sigue sin inventar esperado", () => {
		const totales = reporte([pagoDe(100, 0, 7), reversoDe(0, 100, 7)], {
			foto: "100",
			cobrado: "0",
		}).totales;
		expect(totales.esperado).toBe("100.00");
		expect(totales.pendiente).toBe("100.00");
	});
});

describe("moraGeneradaEnPeriodo", () => {
	it("no cuenta dos veces la deuda que la empresa condonó y el cron repuso", () => {
		// El ejemplo del negocio, tal cual: solo el crecimiento real de 100 a 120
		// es oportunidad de cobro nueva.
		expect(
			moraGeneradaEnPeriodo(100, [
				evento("CONDONACION", 100, 0),
				evento("RECALCULO", 0, 100),
				evento("RECALCULO", 100, 120),
				evento("CONDONACION", 120, 0),
				evento("RECALCULO", 0, 120),
			]),
		).toBe(20);
	});

	it("después de un pago, reponer la mora YA CONTADA no es oportunidad nueva", () => {
		// EL TECHO NO BAJA POR UN PAGO. El cliente pagó los Q100 que la foto ya
		// contó; que la mora vuelva a nacer hasta Q60 es la misma deuda de
		// siempre, no una oportunidad de cobro NUEVA. Antes esto daba 60 y el
		// esperado del asesor terminaba en 160 por una deuda de 60.
		expect(
			moraGeneradaEnPeriodo(100, [
				evento("DECREMENTO", 100, 0),
				evento("CREACION", 0, 60),
			]),
		).toBe(0);
	});

	it("lo que SUPERA el techo ya contado sí cuenta, aunque haya habido un pago", () => {
		// El otro lado de la misma regla: el techo contado era 100, la mora
		// rebota a 160 y esos 60 de más sí son deuda que nadie contó nunca.
		expect(
			moraGeneradaEnPeriodo(100, [
				evento("DECREMENTO", 100, 0),
				evento("CREACION", 0, 160),
			]),
		).toBe(60);
	});

	it("condonación seguida de crecimiento real: solo cuenta el crecimiento", () => {
		expect(
			moraGeneradaEnPeriodo(200, [
				evento("CONDONACION", 200, 0),
				evento("RECALCULO", 0, 200),
				evento("RECALCULO", 200, 245),
			]),
		).toBe(45);
	});

	it("el rebote parcial tampoco reabre lo ya condonado", () => {
		// El cron puede reponer en varios pasos: ninguno supera el nivel, así que
		// ninguno cuenta. Si el primer paso bajara el nivel a 60, el segundo
		// facturaría otra vez la mora condonada.
		expect(
			moraGeneradaEnPeriodo(120, [
				evento("CONDONACION", 120, 0),
				evento("RECALCULO", 0, 60),
				evento("RECALCULO", 60, 120),
			]),
		).toBe(0);
	});

	it("pago parcial: el techo se queda arriba y el rebote hasta ahí no cuenta", () => {
		// El cliente pagó Q60 de los Q100 de la foto y el cron repone hasta Q70:
		// todo eso está dentro de lo ya contado. Con el techo bajando al saldo
		// vivo esto daba 30, y el esperado subía a 130 por una deuda de 70.
		expect(
			moraGeneradaEnPeriodo(100, [
				evento("DECREMENTO", 100, 40),
				evento("RECALCULO", 40, 70),
			]),
		).toBe(0);
	});

	it("pago parcial: lo que pasa del techo sí cuenta", () => {
		expect(
			moraGeneradaEnPeriodo(100, [
				evento("DECREMENTO", 100, 40),
				evento("RECALCULO", 40, 130),
			]),
		).toBe(30);
	});

	it("tras una DESACTIVACION la mora nueva cuenta entera", () => {
		expect(
			moraGeneradaEnPeriodo(80, [
				evento("DESACTIVACION", 80, 0),
				evento("CREACION", 0, 95),
			]),
		).toBe(95);
	});

	it("la DESACTIVACION reinicia el nivel aunque venga de una condonación", () => {
		// `desactivarMora` registra monto_anterior = monto_mora de la fila, que una
		// condonación previa ya dejó en 0: el evento es un "0 → 0" que no baja nada
		// por sí solo. Sin reiniciar el nivel en DESACTIVACION, el crédito que se
		// puso al día y volvió a atrasarse arrastraría el techo viejo y su mora
		// nueva no se contaría.
		expect(
			moraGeneradaEnPeriodo(100, [
				evento("CONDONACION", 100, 0),
				evento("DESACTIVACION", 0, 0),
				evento("CREACION", 0, 90),
			]),
		).toBe(90);
	});

	it("un crédito sin foto inicial que genera mora adentro la cuenta toda", () => {
		expect(
			moraGeneradaEnPeriodo(0, [
				evento("CREACION", 0, 40),
				evento("RECALCULO", 40, 55),
			]),
		).toBe(55);
	});

	it("sin eventos no hay nada generado", () => {
		expect(moraGeneradaEnPeriodo(100, [])).toBe(0);
	});

	it("la condonación masiva se comporta igual que la individual", () => {
		// Ambas se registran como tipo_evento CONDONACION; solo cambia el `origen`,
		// que el nivel no mira.
		expect(
			moraGeneradaEnPeriodo(305041, [
				evento("CONDONACION", 305041, 0),
				evento("RECALCULO", 0, 305041),
			]),
		).toBe(0);
	});

	it("MUTACIÓN: si la CONDONACION bajara el nivel, el rebote se contaría de nuevo", () => {
		// Con la regla correcta el rebote no suma; con la mutación sumaría 100.
		const generado = moraGeneradaEnPeriodo(100, [
			evento("CONDONACION", 100, 0),
			evento("RECALCULO", 0, 100),
		]);
		expect(generado).toBe(0);
		expect(generado).not.toBe(100);
	});

	it("la condonación que quedó justo AFUERA del corte no revive con el rebote", () => {
		// El borde que el reporte medía mal: el 5 la empresa condona (queda fuera
		// del ciclo) y la foto del día 6 dice cero; el 6 el cron repone los 100.
		// Sin siembra el nivel arrancaba en 0 y el rebote se contaba entero.
		expect(
			moraGeneradaEnPeriodo(0, [
				previo("CONDONACION", 100, 0),
				evento("RECALCULO", 0, 100),
			]),
		).toBe(0);
	});

	it("el PAGO justo antes del corte sí deja contar la mora nueva de adentro", () => {
		// El borde simétrico: acá el cliente saldó, así que lo que nazca adentro es
		// deuda nueva y el asesor sí tuvo que cobrarla.
		expect(
			moraGeneradaEnPeriodo(0, [
				previo("DECREMENTO", 100, 0),
				evento("RECALCULO", 0, 100),
			]),
		).toBe(100);
	});

	it("condonación afuera y crecimiento real adentro: solo cuenta el crecimiento", () => {
		expect(
			moraGeneradaEnPeriodo(0, [
				previo("CONDONACION", 100, 0),
				evento("RECALCULO", 0, 100),
				evento("RECALCULO", 100, 130),
			]),
		).toBe(30);
	});

	it("sin eventos previos el nivel arranca en la foto, como antes", () => {
		expect(
			moraGeneradaEnPeriodo(100, [evento("RECALCULO", 100, 140)]),
		).toBe(40);
	});

	it("la siembra nunca deja el nivel POR DEBAJO de la foto", () => {
		// Si el tramo previo dejara el nivel en 40 y la foto dice 100, el primer
		// RECALCULO del ciclo sumaría 60 de una mora que la foto ya contó.
		expect(
			moraGeneradaEnPeriodo(100, [
				previo("DECREMENTO", 90, 40),
				evento("RECALCULO", 100, 100),
			]),
		).toBe(0);
	});

	it("MUTACIÓN: sin siembra, el rebote del borde se contaría entero", () => {
		const conSiembra = moraGeneradaEnPeriodo(0, [
			previo("CONDONACION", 100, 0),
			evento("RECALCULO", 0, 100),
		]);
		// La mutación "ignorar los previos" es exactamente esta llamada.
		const sinSiembra = moraGeneradaEnPeriodo(0, [evento("RECALCULO", 0, 100)]);
		expect(conSiembra).toBe(0);
		expect(sinSiembra).toBe(100);
		expect(conSiembra).not.toBe(sinSiembra);
	});

	it("MUTACIÓN: si la siembra también sostuviera el nivel tras un pago, la mora nueva se perdería", () => {
		// Sembrar "a lo bruto" —quedarse con el monto más alto de la ventana sin
		// mirar POR QUÉ bajó— daría 0 acá, y el asesor perdería 100 de esperado.
		const generado = moraGeneradaEnPeriodo(0, [
			previo("DECREMENTO", 100, 0),
			evento("RECALCULO", 0, 100),
		]);
		expect(generado).toBe(100);
		expect(generado).not.toBe(0);
	});

	it("revertir un pago no inventa oportunidad de cobro", () => {
		// Q100 de foto, el cliente paga, y el pago se revierte: la mora vuelve a
		// estar viva, pero es la MISMA deuda de siempre. Sin esto el plegado veía
		// "bajó y volvió a subir" y el crédito terminaba con Q200 de esperado.
		expect(
			moraGeneradaEnPeriodo(100, [
				evento("DECREMENTO", 100, 0),
				reverso(0, 100),
			]),
		).toBe(0);
	});

	it("la restitución de la reversa repone el techo, así que el RECALCULO siguiente tampoco cobra dos veces", () => {
		expect(
			moraGeneradaEnPeriodo(100, [
				evento("DECREMENTO", 100, 0),
				reverso(0, 100),
				evento("RECALCULO", 100, 100),
			]),
		).toBe(0);
	});

	it("después de una reversa, la mora que crece de verdad SÍ se cuenta", () => {
		// Solo los 30 de crecimiento real posterior a la restitución.
		expect(
			moraGeneradaEnPeriodo(100, [
				evento("DECREMENTO", 100, 0),
				reverso(0, 100),
				evento("RECALCULO", 100, 130),
			]),
		).toBe(30);
	});

	it("la restitución de un pago AJENO no se confunde con el rebote del cron", () => {
		// El matiz que no se puede perder, ahora del lado que importa: el cliente
		// pagó adentro (pago 7) y lo que sube después es la reversa de OTRO pago,
		// anterior al ciclo (pago 9). Esos Q100 nunca se contaron y están vivos:
		// son oportunidad. El mismo movimiento hecho por el cron —la misma deuda
		// de siempre volviendo a nacer— no lo es.
		const restitucionAjena = moraGeneradaEnPeriodo(100, [
			pagoDe(100, 0, 7),
			reversoDe(0, 100, 9),
		]);
		const reboteDelCron = moraGeneradaEnPeriodo(100, [
			pagoDe(100, 0, 7),
			evento("RECALCULO", 0, 100),
		]);
		expect(restitucionAjena).toBe(100);
		expect(reboteDelCron).toBe(0);
	});

	it("la reversa de un pago ANTERIOR al ciclo SÍ es oportunidad", () => {
		// El pago fue antes del día 6, así que su DECREMENTO ya bajó la foto: la
		// foto dice 0 y la siembra dice 0. La reversa de adentro deja al cliente
		// debiendo Q100 que NUNCA se contaron y que el asesor tiene vivos hoy;
		// suprimirla hacía desaparecer una oportunidad real.
		expect(moraGeneradaEnPeriodo(0, [reverso(0, 100)])).toBe(100);
	});

	it("la restitución parcial: suprime lo que bajó ADENTRO y genera el resto", () => {
		// Adentro del ciclo el cliente pagó Q40 (100 → 60). Después se revierte un
		// pago de Q100 —Q40 de adentro y Q60 de un pago anterior al corte—: solo
		// los Q40 estaban contados, los otros Q60 son oportunidad nueva.
		expect(
			moraGeneradaEnPeriodo(100, [
				evento("DECREMENTO", 100, 60),
				reverso(60, 160),
			]),
		).toBe(60);
	});

	it("la restitución no puede suprimir más de una vez lo que bajó adentro", () => {
		// Un solo DECREMENTO de Q100 adentro y DOS restituciones: la primera
		// consume el crédito de supresión, la segunda genera entera.
		expect(
			moraGeneradaEnPeriodo(100, [
				evento("DECREMENTO", 100, 0),
				reverso(0, 100),
				evento("DECREMENTO", 100, 100),
				reverso(100, 200),
			]),
		).toBe(100);
	});

	it("MUTACIÓN: suprimir SIEMPRE borra la oportunidad del pago anterior al ciclo", () => {
		// La regla vieja —`if (reverso) { subir el nivel; continue; }`— aplicada
		// al caso de afuera del ciclo.
		const suprimirSiempre = (foto: number, eventos: MoraLevelEvent[]) => {
			let nivel = foto;
			let generado = 0;
			for (const e of eventos) {
				if (e.reverso) {
					if (e.montoNuevo > nivel) nivel = e.montoNuevo;
					continue;
				}
				if (e.montoNuevo > nivel) {
					generado += e.montoNuevo - nivel;
					nivel = e.montoNuevo;
				} else if (e.montoNuevo < e.montoAnterior) nivel = e.montoNuevo;
			}
			return generado;
		};
		const eventos = [reverso(0, 100)];
		expect(moraGeneradaEnPeriodo(0, eventos)).toBe(100);
		expect(suprimirSiempre(0, eventos)).toBe(0);
	});

	it("MUTACIÓN: sin la identidad del pago, la restitución ajena se tapa", () => {
		// EL DEFECTO DEL POOL, en una línea: los mismos montos, en el mismo
		// orden, y lo único que cambia es DE QUÉ PAGO habla la restitución.
		//   * pago 7: es la reversa del pago que bajó la mora adentro → no genera.
		//   * pago 9: es la reversa de un pago ANTERIOR al ciclo → genera 100.
		// Con un contador común de "lo que bajó adentro" los dos daban 0, y los
		// Q100 vivos del segundo caso desaparecían del esperado.
		const mismoPago = moraGeneradaEnPeriodo(100, [
			pagoDe(100, 0, 7),
			reversoDe(0, 100, 7),
		]);
		const pagoAjeno = moraGeneradaEnPeriodo(100, [
			pagoDe(100, 0, 7),
			reversoDe(0, 100, 9),
		]);
		expect(mismoPago).toBe(0);
		expect(pagoAjeno).toBe(100);
		expect(mismoPago).not.toBe(pagoAjeno);
	});

	it("MUTACIÓN: suprimir la restitución del MISMO pago sigue haciendo falta", () => {
		// El lado que no se puede romper al arreglar el otro: si la restitución
		// del pago 7 generara igual, la deuda se contaría dos veces (esperado
		// 200 por Q100 vivos).
		const eventos = [pagoDe(100, 0, 7), reversoDe(0, 100, 7)];
		const generarSiempre = (foto: number, lista: MoraLevelEvent[]) => {
			let nivel = foto;
			let generado = 0;
			for (const e of lista) {
				const sube = Math.max(0, e.montoNuevo - e.montoAnterior);
				if (e.reverso) {
					generado += sube;
					nivel += sube;
				} else if (e.montoNuevo > nivel) {
					generado += e.montoNuevo - nivel;
					nivel = e.montoNuevo;
				}
			}
			return generado;
		};
		expect(moraGeneradaEnPeriodo(100, eventos)).toBe(0);
		expect(generarSiempre(100, eventos)).toBe(100);
	});

	it("la desactivación entre el pago y su reversa no vuelve a cobrar lo restituido", () => {
		// EL CASO: el pago pone el crédito al día (DECREMENTO 100 → 0), eso lo saca
		// del universo de mora (DESACTIVACION), y DESPUÉS el pago se cae y la
		// reversa le devuelve los Q100. Esa deuda ya estaba contada en la foto, así
		// que la restitución no genera; pero el techo tiene que volver a subir con
		// ella, porque el RECALCULO de la mañana siguiente la ve viva otra vez.
		const eventos = [
			pagoDe(100, 0, 7),
			evento("DESACTIVACION", 0, 0),
			reversoDe(0, 100, 7),
			evento("RECALCULO", 100, 100),
		];
		expect(moraGeneradaEnPeriodo(100, eventos)).toBe(0);
		// Y el techo queda en los Q100 restituidos, no en el cero que dejó la
		// desactivación.
		expect(plegarNivel(100, eventos).nivel).toBe(100);

		// Lo que SÍ crece por encima de lo restituido sigue siendo mora nueva: el
		// piso repone el techo, no lo infla.
		expect(
			moraGeneradaEnPeriodo(100, [...eventos, evento("RECALCULO", 100, 130)]),
		).toBe(30);
	});

	it("MUTACIÓN: sin el piso, la deuda restituida tras una desactivación se cobra dos veces", () => {
		// La mutación es la línea vieja: `nivel += restituido - suprimido`, sin el
		// `Math.max` contra `montoNuevo`. Con la generación suprimida, el techo se
		// quedaba en el cero de la DESACTIVACION y el RECALCULO siguiente cobraba
		// los Q100 como mora nueva: foto 100 → esperado 200.
		const eventos = [
			pagoDe(100, 0, 7),
			evento("DESACTIVACION", 0, 0),
			reversoDe(0, 100, 7),
			evento("RECALCULO", 100, 100),
		];
		const sinPiso = (foto: number, lista: MoraLevelEvent[]) => {
			let nivel = foto;
			let generado = 0;
			const bajado = new Map<string, number>();
			for (const e of lista) {
				if (e.tipoEvento === "DESACTIVACION") {
					nivel = 0;
					continue;
				}
				if (e.tipoEvento === "CONDONACION") continue;
				if (e.reverso) {
					const restituido = Math.max(0, e.montoNuevo - e.montoAnterior);
					const clave = e.pagoId ?? "";
					const suprimido = Math.min(restituido, bajado.get(clave) ?? 0);
					bajado.set(clave, (bajado.get(clave) ?? 0) - suprimido);
					generado += restituido - suprimido;
					nivel += restituido - suprimido;
					continue;
				}
				if (e.montoNuevo > nivel) {
					generado += e.montoNuevo - nivel;
					nivel = e.montoNuevo;
				} else if (e.montoNuevo < e.montoAnterior) {
					const bajada = e.montoAnterior - e.montoNuevo;
					const clave = e.pagoId ?? "";
					bajado.set(clave, (bajado.get(clave) ?? 0) + bajada);
				}
			}
			return generado;
		};
		expect(moraGeneradaEnPeriodo(100, eventos)).toBe(0);
		expect(sinPiso(100, eventos)).toBe(100);
	});

	it("MUTACIÓN: ignorar la marca de restitución borra la oportunidad viva", () => {
		// Con el techo sostenido, perder la marca ya no duplica la deuda: la
		// esconde. Sin marca la subida es un rebote cualquiera por debajo del
		// techo y no genera nada, y el asesor pierde Q100 de esperado que tiene
		// vivos y cobrables.
		const eventos = [pagoDe(100, 0, 7), reversoDe(0, 100, 9)];
		const conMarca = moraGeneradaEnPeriodo(100, eventos);
		const sinMarca = moraGeneradaEnPeriodo(
			100,
			eventos.map(({ reverso: _, ...resto }) => resto),
		);
		expect(conMarca).toBe(100);
		expect(sinMarca).toBe(0);
	});

	it("la condonación anterior al ciclo sostiene el techo aunque la foto diga menos", () => {
		// El ejemplo del defecto: CONDONACION 100→0 antes del corte, un RECALCULO
		// parcial que deja la foto en 60, y adentro el rebote completo a 100. Los
		// 40 de diferencia son deuda YA condonada, no mora nueva.
		expect(
			moraGeneradaEnPeriodo(60, [
				previo("CONDONACION", 100, 0),
				previo("RECALCULO", 0, 60),
				evento("RECALCULO", 60, 100),
			]),
		).toBe(0);
	});

	it("una condonación de semanas atrás también sostiene el techo", () => {
		// Mismo caso con un tramo previo largo: mientras no haya un reseteo, el
		// techo sigue siendo el de la condonación vieja.
		expect(
			moraGeneradaEnPeriodo(60, [
				previo("CONDONACION", 100, 0),
				previo("RECALCULO", 0, 20),
				previo("RECALCULO", 20, 40),
				previo("RECALCULO", 40, 60),
				evento("RECALCULO", 60, 100),
			]),
		).toBe(0);
	});

	it("un pago anterior al ciclo sí reabre la oportunidad de adentro", () => {
		// El reseteo manda sobre el techo viejo: el cliente saldó, así que la mora
		// que nace adentro se cuenta entera.
		expect(
			moraGeneradaEnPeriodo(0, [
				previo("CONDONACION", 500, 0),
				previo("RECALCULO", 0, 100),
				previo("DECREMENTO", 100, 0),
				evento("RECALCULO", 0, 100),
			]),
		).toBe(100);
	});

	it("MUTACIÓN: si el pago bajara el techo, el rebote se cobraría como mora nueva", () => {
		// EL DEFECTO DEL TECHO, con el caso del negocio: foto 120, la empresa
		// condona, el cron repone 60, el cliente paga 20 y el cron termina de
		// reponer hasta 120. La mora viva es 120 y ya estaba contada: cero mora
		// nueva. Con el techo pisado por el saldo vivo daban 80, y el esperado
		// del asesor salía en 200 por una deuda de 120.
		const eventos = [
			evento("CONDONACION", 120, 0),
			evento("RECALCULO", 0, 60),
			pagoDe(60, 40, 7),
			evento("RECALCULO", 40, 120),
		];
		const conTechoSostenido = moraGeneradaEnPeriodo(120, eventos);
		// La mutación es exactamente la línea vieja: `nivel = evento.montoNuevo`.
		const conTechoPisado = (foto: number, lista: MoraLevelEvent[]) => {
			let nivel = foto;
			let generado = 0;
			for (const e of lista) {
				if (e.tipoEvento === "CONDONACION") continue;
				if (e.montoNuevo > nivel) {
					generado += e.montoNuevo - nivel;
					nivel = e.montoNuevo;
				} else if (e.montoNuevo < e.montoAnterior) nivel = e.montoNuevo;
			}
			return generado;
		};
		expect(conTechoSostenido).toBe(0);
		expect(conTechoPisado(120, eventos)).toBe(80);
	});

	it("el mismo caso SIN condonación: la siembra tampoco se derrumba con un pago", () => {
		// Foto 60 con el techo sembrado en 120 (una condonación de la víspera).
		// El cliente paga 20 y el cron repone hasta 120: todo ya estaba contado.
		// Antes el pago dejaba el techo en 40 y el rebote cobraba 80.
		expect(
			moraGeneradaEnPeriodo(
				60,
				[pagoDe(60, 40, 7), evento("RECALCULO", 40, 120)],
				120,
			),
		).toBe(0);
	});

	it("la bajada que se anota es lo que el cliente PAGÓ, no lo que el techo tenía", () => {
		// Cómo se mira por fuera un contador interno: con lo que anotó. El
		// cliente pagó Q20 (60 → 40) con el techo en 120, y después se revierte
		// ESE pago por Q100. Solo los Q20 que el ciclo vio bajar pueden
		// suprimirse; los otros Q80 son deuda que nunca se contó.
		//   * anotando 20 (correcto): genera 80.
		//   * anotando `nivel - montoNuevo` = 80 (el defecto): generaría 20, y el
		//     reporte se comería 60 de oportunidad viva.
		expect(
			moraGeneradaEnPeriodo(120, [
				evento("CONDONACION", 120, 0),
				evento("RECALCULO", 0, 60),
				pagoDe(60, 40, 7),
				evento("RECALCULO", 40, 120),
				reversoDe(120, 220, 7),
			]),
		).toBe(80);
	});

	it("lo que la restitución genera SUBE el techo: el cron no lo vuelve a cobrar", () => {
		// Foto 100, el cliente paga esos 100 (pago 7) y se revierte un pago
		// anterior al ciclo (pago 9) que repone 100: eso sí es oportunidad, y
		// pasa a estar CONTADO. Cuando la mora proporcional crece a 150 al día
		// siguiente, esos 150 ya están dentro de los 200 contados. Si la
		// restitución no subiera el techo, el RECALCULO cobraría 50 de la misma
		// deuda por segunda vez.
		const eventos = [
			pagoDe(100, 0, 7),
			reversoDe(0, 100, 9),
			evento("RECALCULO", 100, 150),
		];
		expect(moraGeneradaEnPeriodo(100, eventos)).toBe(100);
		expect(moraGeneradaEnPeriodo(100, eventos)).not.toBe(150);
	});

	it("la restitución con id gasta PRIMERO su propia bajada, no la bolsa anónima", () => {
		// Conviven una bajada identificada (pago 7, Q60) y una vieja sin marca
		// (Q40). La reversa del pago 7 tiene que consumir SU bajada; si se
		// sirviera primero de la bolsa anónima, se comería los Q40 del historial
		// viejo y la restitución vieja que viene después —que es justamente la de
		// esa bajada— se contaría como mora nueva.
		expect(
			moraGeneradaEnPeriodo(100, [
				pagoDe(100, 40, 7),
				evento("DECREMENTO", 40, 0),
				reversoDe(0, 60, 7),
				reverso(60, 100),
			]),
		).toBe(0);
	});

	it("una bajada sin id de pago sigue suprimiendo: el historial viejo no se rompe", () => {
		// Las filas anteriores a la marca `[pago #N]` no tienen con qué ligarse.
		// Caen a la bolsa anónima, que es el comportamiento de antes: sin esto,
		// toda reversa de un ciclo pasado se habría contado como mora nueva.
		expect(
			moraGeneradaEnPeriodo(100, [
				evento("DECREMENTO", 100, 0),
				reverso(0, 100),
			]),
		).toBe(0);
	});
});

/** Un evento del historial ANTERIOR al ciclo, con el día en que ocurrió. */
type EventoFechado = MoraLevelEvent & { diasAntes: number };

const fechado = (
	diasAntes: number,
	tipoEvento: string,
	montoAnterior: number,
	montoNuevo: number,
	extra: Partial<MoraLevelEvent> = {},
): EventoFechado => ({
	diasAntes,
	tipoEvento,
	montoAnterior,
	montoNuevo,
	...extra,
});

/**
 * La MUTACIÓN: volver a acotar la siembra por días. Es exactamente lo que hacía
 * el tope de 31 días, y lo que hacía antes la ventana fija de 3.
 */
const conTopeDeDias = (historial: EventoFechado[], topeDias: number) =>
	historial.filter((evento) => evento.diasAntes <= topeDias);

/**
 * El plegado fila por fila: la ESPECIFICACIÓN de la regla. El agregado
 * (`nivelSembrado`) tiene que dar siempre esto mismo.
 */
const nivelPlegado = (previos: MoraLevelEvent[]) =>
	previos.length === 0
		? 0
		: plegarNivel((previos[0] as MoraLevelEvent).montoAnterior, previos, {
				// El tramo previo NO es el del ciclo: la marca de decremento anulado
				// no se honra acá, igual que en `nivelSembrado` y en el ancla del SQL.
				tramoDelCiclo: false,
			}).nivel;

describe("nivelSembrado", () => {
	// El caso del defecto: la condonación quedó 32 días antes del corte, o sea
	// un día más vieja que el viejo tope de 31. El RECALCULO parcial de adentro
	// del tope dejó la foto en 60, y el del ciclo repone los 100. Esos 40 son
	// deuda YA condonada, no mora nueva.
	const historialDelDefecto: EventoFechado[] = [
		fechado(40, "RECALCULO", 0, 100),
		fechado(32, "CONDONACION", 100, 0),
		fechado(20, "RECALCULO", 0, 60),
	];

	it("la condonación de hace 32 días sostiene el techo: no hay mora nueva", () => {
		expect(nivelSembrado(historialDelDefecto)).toBe(100);
		expect(
			moraGeneradaEnPeriodo(
				60,
				[evento("RECALCULO", 60, 100)],
				nivelSembrado(historialDelDefecto),
			),
		).toBe(0);
	});

	it("MUTACIÓN: con un tope de 31 días la condonación se pierde y aparecen Q40 de mora inventada", () => {
		const mutado = conTopeDeDias(historialDelDefecto, 31);
		// El tope deja afuera la condonación Y el evento que había levantado el
		// techo a 100: el techo cae a 60 y el rebote de adentro cobra los 40.
		expect(nivelSembrado(mutado)).toBe(60);
		expect(
			moraGeneradaEnPeriodo(
				60,
				[evento("RECALCULO", 60, 100)],
				nivelSembrado(mutado),
			),
		).toBe(40);
		// Y con cualquier otro tope pasa lo mismo, solo que con otra condonación:
		// por eso el arreglo no es agrandar el número sino quitarlo.
		expect(nivelSembrado(conTopeDeDias(historialDelDefecto, 90))).toBe(100);
		expect(nivelSembrado(conTopeDeDias(historialDelDefecto, 35))).toBe(100);
		expect(nivelSembrado(conTopeDeDias(historialDelDefecto, 25))).toBe(60);
	});

	it("ya no importa cuán vieja sea la condonación: a seis meses da lo mismo", () => {
		const aSeisMeses: EventoFechado[] = [
			fechado(200, "RECALCULO", 0, 100),
			fechado(180, "CONDONACION", 100, 0),
			fechado(20, "RECALCULO", 0, 60),
		];
		expect(nivelSembrado(aSeisMeses)).toBe(100);
		expect(
			moraGeneradaEnPeriodo(
				60,
				[evento("RECALCULO", 60, 100)],
				nivelSembrado(aSeisMeses),
			),
		).toBe(0);
		// Mismo resultado que a 32 días: la edad dejó de ser una variable.
		expect(nivelSembrado(aSeisMeses)).toBe(nivelSembrado(historialDelDefecto));
	});

	it("un PAGO antes del ciclo resetea el techo y la mora nueva se cuenta entera", () => {
		const historial: EventoFechado[] = [
			fechado(200, "RECALCULO", 0, 500),
			fechado(180, "CONDONACION", 500, 0),
			fechado(40, "RECALCULO", 0, 100),
			fechado(10, "DECREMENTO", 100, 0),
		];
		expect(nivelSembrado(historial)).toBe(0);
		expect(
			moraGeneradaEnPeriodo(
				0,
				[evento("RECALCULO", 0, 100)],
				nivelSembrado(historial),
			),
		).toBe(100);
	});

	it("un pago PARCIAL deja el techo en lo que quedó, no en cero", () => {
		const historial: EventoFechado[] = [
			fechado(40, "RECALCULO", 0, 120),
			fechado(10, "DECREMENTO", 120, 45),
			fechado(8, "RECALCULO", 45, 50),
		];
		expect(nivelSembrado(historial)).toBe(50);
		expect(
			moraGeneradaEnPeriodo(
				50,
				[evento("RECALCULO", 50, 80)],
				nivelSembrado(historial),
			),
		).toBe(30);
	});

	it("la DESACTIVACION también ancla, y ancla en cero", () => {
		const historial: EventoFechado[] = [
			fechado(200, "RECALCULO", 0, 900),
			fechado(150, "CONDONACION", 900, 0),
			fechado(60, "RECALCULO", 0, 400),
			fechado(30, "DESACTIVACION", 400, 0),
			fechado(5, "CREACION", 0, 25),
		];
		expect(nivelSembrado(historial)).toBe(25);
		expect(
			moraGeneradaEnPeriodo(
				25,
				[evento("RECALCULO", 25, 70)],
				nivelSembrado(historial),
			),
		).toBe(45);
	});

	it("un crédito SIN ningún reseteo en toda su historia siembra con su máximo entero", () => {
		// Correcto por definición: sin reseteo NADA bajó nunca el techo, así que
		// el techo vigente es el más alto que alcanzó. No hace falta ningún tope
		// para acotarlo —el ancla ausente no es un caso excepcional, es el tramo
		// que arranca en el primer evento del crédito— y es justo el caso que el
		// tope de días trataba peor: le recortaba el pico sin motivo.
		const historial: EventoFechado[] = [
			fechado(300, "CREACION", 0, 80),
			fechado(200, "RECALCULO", 80, 240),
			fechado(150, "CONDONACION", 240, 0),
			fechado(100, "RECALCULO", 0, 90),
			fechado(2, "CONDONACION", 90, 0),
		];
		expect(nivelSembrado(historial)).toBe(240);
		// Y nada de lo que el cron reponga adentro es mora nueva.
		expect(
			moraGeneradaEnPeriodo(
				0,
				[evento("RECALCULO", 0, 90), evento("RECALCULO", 90, 240)],
				nivelSembrado(historial),
			),
		).toBe(0);
	});

	it("sin historial previo la siembra es cero y manda la foto", () => {
		expect(nivelSembrado([])).toBe(0);
		expect(moraGeneradaEnPeriodo(100, [evento("RECALCULO", 100, 140)], 0)).toBe(
			40,
		);
	});

	it("la siembra nunca deja el nivel POR DEBAJO de la foto", () => {
		// Si el techo sembrado fuera 40 y la foto dice 100, el primer RECALCULO
		// del ciclo sumaría 60 de una mora que la foto ya contó.
		expect(moraGeneradaEnPeriodo(100, [evento("RECALCULO", 100, 100)], 40)).toBe(
			0,
		);
	});

	it("EQUIVALENCIA: el agregado da lo mismo que plegar el tramo fila por fila", () => {
		const casos: MoraLevelEvent[][] = [
			[],
			[evento("CREACION", 0, 100)],
			historialDelDefecto,
			[
				evento("RECALCULO", 0, 100),
				evento("CONDONACION", 100, 0),
				evento("RECALCULO", 0, 60),
				evento("RECALCULO", 60, 80),
			],
			[
				evento("RECALCULO", 0, 300),
				evento("DECREMENTO", 300, 0),
				evento("RECALCULO", 0, 120),
				evento("CONDONACION", 120, 0),
				evento("RECALCULO", 0, 45),
			],
			[
				evento("RECALCULO", 0, 500),
				evento("CONDONACION", 500, 0),
				evento("DESACTIVACION", 0, 0),
				evento("CREACION", 0, 30),
			],
			[
				evento("RECALCULO", 0, 200),
				evento("DECREMENTO", 200, 0),
				reverso(0, 200),
				evento("RECALCULO", 200, 210),
			],
			[
				evento("CONDONACION", 90, 0),
				evento("RECALCULO", 0, 20),
				evento("DECREMENTO", 20, 5),
				evento("CONDONACION", 5, 0),
				evento("RECALCULO", 0, 5),
			],
			[evento("DESACTIVACION", 400, 0)],
			[evento("CONDONACION", 400, 0)],
			// Un decremento marcado como anulado en el tramo PREVIO: ni el agregado
			// ni el plegado honran la marca ahí, así que los dos lo toman como el
			// reseteo que fue.
			[
				evento("RECALCULO", 0, 100),
				{ ...evento("DECREMENTO", 100, 0), anulado: true },
			],
		];
		for (const caso of casos) {
			expect({ caso, nivel: nivelSembrado(caso) }).toEqual({
				caso,
				nivel: nivelPlegado(caso),
			});
		}
	});

	it("EQUIVALENCIA: también sobre historiales mezclados generados al azar", () => {
		// El argumento de por qué son equivalentes —entre dos reseteos el nivel
		// solo sube, así que el plegado es un máximo— se prueba, no se explica.
		let semilla = 20260922;
		const azar = () => {
			semilla = (semilla * 1103515245 + 12345) % 2147483648;
			return semilla / 2147483648;
		};
		const tipos = [
			"RECALCULO",
			"CONDONACION",
			"DESACTIVACION",
			"DECREMENTO",
			"INCREMENTO",
			"CREACION",
		];
		for (let caso = 0; caso < 3000; caso++) {
			const historial: MoraLevelEvent[] = [];
			let monto = Math.floor(azar() * 200);
			const largo = Math.floor(azar() * 12);
			for (let i = 0; i < largo; i++) {
				const tipoEvento = tipos[Math.floor(azar() * tipos.length)] as string;
				const montoNuevo =
					tipoEvento === "CONDONACION" || tipoEvento === "DESACTIVACION"
						? 0
						: Math.floor(azar() * 300);
				const esReverso = tipoEvento === "INCREMENTO" && azar() < 0.4;
				// También decrementos MARCADOS como anulados: en el tramo previo la
				// marca no se honra, así que el agregado y el plegado tienen que
				// seguir dando lo mismo. Si una de las dos piezas volviera a mirarla,
				// la equivalencia se cae acá.
				const esAnulado = tipoEvento === "DECREMENTO" && azar() < 0.4;
				historial.push({
					tipoEvento,
					montoAnterior: monto,
					montoNuevo,
					...(esReverso ? { reverso: true } : {}),
					...(esAnulado ? { anulado: true } : {}),
				});
				monto = montoNuevo;
			}
			expect({ historial, nivel: nivelSembrado(historial) }).toEqual({
				historial,
				nivel: nivelPlegado(historial),
			});
		}
	});
});

describe("buildMoraRecoveryReport", () => {
	it("construye el contrato SQL histórico con el ciclo, FULL JOIN y filtros actuales", () => {
		const period = getMoraRecoveryPeriod({
			mes: 6,
			anio: 2026,
			hoy: "2026-07-29",
		});
		const query = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery({
				...period,
				asesores: [7, 8],
				emailCobrador: "cashin@example.com",
			}),
		);

		expect(period).toEqual({
			inicio: "2026-06-06",
			fin: "2026-07-06",
			fechaSnapshot: "2026-06-06",
			alcance: "historico",
		});
		expect(query.sql).toContain("FULL JOIN pagos_por_credito");
		expect(query.sql).toContain("moras_historial");
		expect(query.sql).toContain("IN ('ACTIVO', 'MOROSO')");
		expect(query.sql).not.toContain("PENDIENTE_CANCELACION");
		expect(query.sql).not.toContain("INCOBRABLE");
		expect(query.sql).not.toContain("EN_CONVENIO");
		expect(query.sql).not.toContain("CANCELADO");
		expect(query.sql).not.toContain("CAIDO");
		expect(query.sql).toContain("LOWER(a.email_cash_in) = LOWER(TRIM($3))");
		expect(query.sql).toContain("a.asesor_id IN ($4, $5)");
		expect(query.sql).toContain("COALESCE(ca.nombre, 'Sin asignar')");
		expect(query.params).toEqual([
			// El corte del snapshot (dos veces: último evento y carry-forward), ya
			// como instante UTC contra la columna cruda.
			"2026-06-06 06:00:00.000",
			"2026-06-06 06:00:00.000",
			"cashin@example.com",
			7,
			8,
			"2026-06-06",
			"2026-07-06",
			// Los límites del ciclo como instantes UTC: el día 6 GT empieza a las 06:00Z.
			// Los prefijos con los que un pago caído firma su restitución —reversa y
			// anulación—, el rango de eventos DEL CICLO, y después la siembra: el
			// corte del ancla, los mismos prefijos (una restitución nunca ancla) y el
			// corte del máximo. Todas las fechas son el inicio o el fin del ciclo: la
			// siembra no tiene fecha propia.
			"Reversa de pago #%",
			"Anulación de pago #%",
			// La marca del decremento cuyo pago se cayó: el reporte la lee para no
			// contar como mora nueva lo que el cron repuso después de una bajada
			// que ya no vale.
			"% [decremento anulado]%",
			// Los patrones que leen de qué PAGO habla cada evento: la marca del
			// decremento y los dos prefijos de restitución, escapados como regex.
			// Es lo que liga una restitución con SU bajada y no con la de otro.
			" \\[pago #([0-9]+)",
			"Reversa de pago #([0-9]+)",
			"Anulación de pago #([0-9]+)",
			"2026-06-06 06:00:00.000",
			"2026-07-06 06:00:00.000",
			"2026-06-06 06:00:00.000",
			// La marca NO vuelve a aparecer: el ancla de la siembra mira solo filas
			// anteriores al ciclo, donde la marca no dice cuándo se anuló el pago.
			"Reversa de pago #%",
			"Anulación de pago #%",
			"2026-06-06 06:00:00.000",
		]);
	});

	it("usa la misma población vigente para recuperación live e histórica", () => {
		const statusPopulation = "'ACTIVO', 'MOROSO'";
		for (const alcance of ["live", "historico"] as const) {
			const query = new PgDialect().sqlToQuery(
				buildMoraRecoveryQuery({
					inicio: "2026-06-06",
					fin: "2026-07-06",
					fechaSnapshot: "2026-06-06",
					alcance,
				}),
			);

			expect(query.sql).toContain(statusPopulation);
		}
	});

	it("usa un snapshot estrictamente anterior al inicio y cuenta el pago del día 6", () => {
		const period = getMoraRecoveryPeriod({
			mes: 6,
			anio: 2026,
			hoy: "2026-07-29",
		});
		const query = new PgDialect().sqlToQuery(buildMoraRecoveryQuery(period));
		const report = buildMoraRecoveryReport(
			[
				{
					asesorId: 1,
					nombre: "Ana",
					esperado: "100",
					eventos: [],
					cobrado: "40",
				},
			],
			period,
		);

		// El snapshot corta ESTRICTAMENTE antes del día 6 y lo hace contra la
		// columna cruda: el día 6 GT empieza a las 06:00Z.
		expect(query.sql).toContain("WHERE h.fecha < $1::timestamp");
		expect(query.sql).not.toContain("AT TIME ZONE");
		expect(query.params[0]).toBe("2026-06-06 06:00:00.000");
		expect(report.totales).toMatchObject({
			esperado: "100.00",
			cobradoEnSnapshot: "40.00",
			cobradoFueraSnapshot: "0.00",
			pendiente: "60.00",
		});
	});

	it("separa cobrado del snapshot, fuera, excedente y pendiente sin truncar", () => {
		const report = buildMoraRecoveryReport(rows, {
			inicio: "2026-06-06",
			fin: "2026-07-06",
			alcance: "historico",
		});

		expect(report.totales).toEqual({
			esperado: "150.00",
			cobradoEnSnapshot: "140.00",
			cobradoFueraSnapshot: "40.00",
			excedenteEnSnapshot: "20.00",
			pendiente: "30.00",
		});
		expect(
			report.porAsesor.find((row) => row.asesorId === 1)?.excedenteEnSnapshot,
		).toBe("20.00");
		expect(report.porAsesor.find((row) => row.asesorId === 2)?.pendiente).toBe(
			"0.00",
		);
	});

	it("conserva asesores exclusivos y representa Sin asignar de forma tipada", () => {
		const report = buildMoraRecoveryReport(rows, {
			inicio: "2026-06-06",
			fin: "2026-07-06",
			alcance: "historico",
		});

		expect(report.porAsesor.map((row) => row.asesorId)).toEqual([1, null, 2]);
		expect(report.porAsesor.find((row) => row.asesorId === null)).toMatchObject(
			{
				nombre: "Sin asignar",
				esperado: "50.00",
				pendiente: "30.00",
			},
		);
		expect(report.metadata).toEqual({
			alcance: "historico",
			atribucionAsesor: "actual",
		});
	});

	it("agrega por asesor sin permitir que excedentes compensen pendientes de otro crédito", () => {
		const report = buildMoraRecoveryReport(
			[
				{
					asesorId: 7,
					nombre: "Cora",
					esperado: "100",
					eventos: [],
					cobrado: "140",
				},
				{
					asesorId: 7,
					nombre: "Cora",
					esperado: "80",
					eventos: [],
					cobrado: "20",
				},
			],
			{ inicio: "2026-06-06", fin: "2026-07-06", alcance: "live" },
		);

		expect(report.porAsesor).toEqual([
			expect.objectContaining({
				asesorId: 7,
				esperado: "180.00",
				cobradoEnSnapshot: "160.00",
				cobradoFueraSnapshot: "0.00",
				excedenteEnSnapshot: "40.00",
				pendiente: "60.00",
			}),
		]);
	});

	it("permite el mes actual provisional antes del día 6 y rechaza ciclos futuros", () => {
		for (const dia of ["01", "02", "03", "04", "05"]) {
			expect(
				getMoraRecoveryPeriod({ mes: 6, anio: 2026, hoy: `2026-06-${dia}` }),
			).toMatchObject({ fechaSnapshot: `2026-06-${dia}`, alcance: "live" });
		}
		expect(() =>
			getMoraRecoveryPeriod({ mes: 7, anio: 2026, hoy: "2026-06-03" }),
		).toThrow("ciclo futuro");
		expect(() =>
			getMoraRecoveryPeriod({ mes: 1, anio: 2027, hoy: "2026-12-20" }),
		).toThrow("ciclo futuro");
	});

	it("usa el snapshot histórico de apertura desde el día 6", () => {
		const period = getMoraRecoveryPeriod({
			mes: 6,
			anio: 2026,
			hoy: "2026-06-06",
		});
		const query = new PgDialect().sqlToQuery(buildMoraRecoveryQuery(period));

		expect(period).toMatchObject({
			fechaSnapshot: "2026-06-06",
			alcance: "historico",
		});
		expect(query.sql).toContain("moras_historial");
		expect(query.sql).not.toContain("mora_activa");
	});

	it("suma al esperado la mora generada dentro del ciclo", () => {
		const report = buildMoraRecoveryReport(
			[
				{
					asesorId: 1,
					nombre: "Ana",
					esperado: "100",
					eventos: [evento("RECALCULO", 100, 250)],
					cobrado: "250",
				},
			],
			{ inicio: "2026-06-06", fin: "2026-07-06", alcance: "historico" },
		);

		expect(report.totales).toEqual({
			esperado: "250.00",
			cobradoEnSnapshot: "250.00",
			cobradoFueraSnapshot: "0.00",
			excedenteEnSnapshot: "0.00",
			pendiente: "0.00",
		});
	});

	it("sin la mora generada el mismo cobro fingía un excedente del asesor", () => {
		const sinGenerado = buildMoraRecoveryReport(
			[
				{
					asesorId: 1,
					nombre: "Ana",
					esperado: "100",
					eventos: [],
					cobrado: "250",
				},
			],
			{ inicio: "2026-06-06", fin: "2026-07-06", alcance: "historico" },
		);

		expect(sinGenerado.totales.excedenteEnSnapshot).toBe("150.00");
	});

	it("el rebote de la condonación no infla el esperado del asesor", () => {
		// Mismo crédito, mismo cobro: antes cada rebote sumaba su mora entera al
		// esperado y el asesor aparecía con un pendiente que nunca pudo cobrar.
		const report = buildMoraRecoveryReport(
			[
				{
					asesorId: 3,
					nombre: "Dina",
					esperado: "100",
					eventos: [
						evento("CONDONACION", 100, 0),
						evento("RECALCULO", 0, 100),
						evento("RECALCULO", 100, 120),
					],
					cobrado: "120",
				},
			],
			{ inicio: "2026-06-06", fin: "2026-07-06", alcance: "historico" },
		);

		expect(report.totales).toMatchObject({
			esperado: "120.00",
			pendiente: "0.00",
			excedenteEnSnapshot: "0.00",
		});
	});

	it("acumula lo generado por asesor sin compensar entre créditos", () => {
		const report = buildMoraRecoveryReport(
			[
				{
					asesorId: 7,
					nombre: "Cora",
					esperado: "100",
					eventos: [evento("RECALCULO", 100, 140)],
					cobrado: "140",
				},
				{
					asesorId: 7,
					nombre: "Cora",
					esperado: "0",
					eventos: [evento("CREACION", 0, 60)],
					cobrado: "10",
				},
			],
			{ inicio: "2026-06-06", fin: "2026-07-06", alcance: "live" },
		);

		expect(report.porAsesor).toEqual([
			expect.objectContaining({
				asesorId: 7,
				esperado: "200.00",
				excedenteEnSnapshot: "0.00",
				pendiente: "50.00",
			}),
		]);
	});

	it("los créditos no se contaminan entre sí: cada uno lleva su propio nivel", () => {
		const report = buildMoraRecoveryReport(
			[
				{
					asesorId: 9,
					nombre: "Eli",
					esperado: "100",
					eventos: [
						evento("CONDONACION", 100, 0),
						evento("RECALCULO", 0, 100),
					],
					cobrado: "0",
				},
				{
					asesorId: 9,
					nombre: "Eli",
					esperado: "0",
					eventos: [evento("CREACION", 0, 70)],
					cobrado: "0",
				},
			],
			{ inicio: "2026-06-06", fin: "2026-07-06", alcance: "historico" },
		);

		// 100 (foto del primero, sin rebote) + 70 (mora nueva del segundo).
		expect(report.totales.esperado).toBe("170.00");
	});

	it("trae los eventos del ciclo en orden y sin filtrar por tipo", () => {
		const query = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery(
				getMoraRecoveryPeriod({ mes: 6, anio: 2026, hoy: "2026-07-29" }),
			),
		);

		// El nivel depende de lo que sube Y de lo que baja: filtrar por tipo en SQL
		// escondería las condonaciones y los pagos, que son justo lo que decide si
		// una mora repuesta vuelve a ser oportunidad.
		expect(query.sql).not.toContain(
			"h.tipo_evento IN ('CREACION', 'RECALCULO', 'INCREMENTO')",
		);
		expect(query.sql).toContain("ORDER BY e.fecha, e.historial_id");
		expect(query.sql).toContain("'tipoEvento', e.tipo_evento");
		expect(query.sql).toContain("'montoAnterior', e.monto_anterior");
		expect(query.sql).toContain("'montoNuevo', e.monto_nuevo");
		expect(query.sql).toContain(
			"h.monto_anterior::numeric::text AS monto_anterior",
		);
		expect(query.sql).toContain("COALESCE(e.eventos, '[]'::json) AS eventos");
	});

	it("filtra los eventos por los límites UTC contra la columna cruda y semiabierto", () => {
		const query = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery(
				getMoraRecoveryPeriod({ mes: 6, anio: 2026, hoy: "2026-07-29" }),
			),
		);

		// Columna CRUDA: envolverla en AT TIME ZONE mataría moras_historial_fecha_idx.
		// El rango de eventos es EL CICLO, semiabierto por la derecha.
		// Sin número de placeholder fijo: el snapshot y el filtro de lote aportan
		// parámetros propios y renumerarlos no es un cambio de contrato. Lo que SÍ
		// es contrato es la COLA: el orden y el contenido de los parámetros que
		// aportan los prefijos de restitución, el ciclo y la siembra.
		expect(query.sql).toMatch(/WHERE h\.fecha >= \$\d+::timestamp/);
		expect(query.sql).toMatch(/AND h\.fecha < \$\d+::timestamp/);
		expect(query.sql).not.toContain(
			"(h.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date >=",
		);
		expect(query.params.slice(-12)).toEqual([
			// los prefijos con los que un pago caído firma su restitución
			"Reversa de pago #%",
			"Anulación de pago #%",
			// y la marca del decremento que ese pago caído invalidó: la lee SOLO el
			// tramo del ciclo, así que aparece UNA vez en toda la consulta.
			"% [decremento anulado]%",
			// los patrones con los que se lee de qué PAGO habla el evento: la marca
			// del decremento y los dos prefijos de restitución, ya escapados como
			// expresión regular.
			" \\[pago #([0-9]+)",
			"Reversa de pago #([0-9]+)",
			"Anulación de pago #([0-9]+)",
			// el ciclo
			"2026-06-06 06:00:00.000",
			"2026-07-06 06:00:00.000",
			// la siembra: corte del ancla, prefijos, corte del máximo. SIN la marca
			// de anulado: acá todas las filas son anteriores al ciclo.
			"2026-06-06 06:00:00.000",
			"Reversa de pago #%",
			"Anulación de pago #%",
			"2026-06-06 06:00:00.000",
		]);
		// Candado explícito: si alguien vuelve a meter la marca en el ancla, este
		// conteo lo delata aunque la cola de parámetros se reacomode.
		expect(
			query.params.filter((p) => p === "% [decremento anulado]%"),
		).toHaveLength(1);
	});

	it("los patrones del pago leen de verdad los motivos que escriben las marcas", () => {
		// El contrato del otro extremo: que el patrón esté armado con la constante
		// no garantiza que EXTRAIGA el id. Acá se toman los patrones tal como
		// viajan a Postgres y se aplican a los motivos reales.
		const query = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery(
				getMoraRecoveryPeriod({ mes: 6, anio: 2026, hoy: "2026-07-29" }),
			),
		);
		const patrones = query.params
			.slice(-12, -6)
			.filter(
				(p): p is string => typeof p === "string" && p.includes("([0-9]+)"),
			);
		const idDe = (motivo: string) => {
			for (const patron of patrones) {
				const encontrado = motivo.match(new RegExp(patron))?.[1];
				if (encontrado) return encontrado;
			}
			return null;
		};

		expect(patrones).toHaveLength(3);
		expect(
			idDe(`Pago aplicado a mora (crédito 980)${marcaPagoDelDecremento(4321)}`),
		).toBe("4321");
		// Con la marca de anulado encima, que es como queda el decremento caído.
		expect(
			idDe(
				`Pago aplicado a mora${marcaPagoDelDecremento(4321)}${MARCA_DECREMENTO_ANULADO}`,
			),
		).toBe("4321");
		expect(idDe(motivoReversaMora(77))).toBe("77");
		expect(idDe(motivoAnulacionMora(77))).toBe("77");
		// Un ajuste a mano no habla de ningún pago.
		expect(idDe("Ajuste manual del analista")).toBe(null);
	});

	it("la siembra viaja como un NÚMERO, no como filas previas", () => {
		const query = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery(
				getMoraRecoveryPeriod({ mes: 6, anio: 2026, hoy: "2026-07-29" }),
			),
		);

		// El tramo anterior al ciclo ya no se trae fila por fila: se agrega en SQL
		// y llega como un solo techo. Por eso `previo` desapareció del JSON.
		expect(query.sql).not.toContain("AS previo");
		expect(query.sql).not.toContain("'previo', e.previo");
		expect(query.sql).toContain("COALESCE(n.nivel, '0') AS nivel_sembrado");
	});

	it("la siembra no amplía el universo de créditos del reporte", () => {
		const query = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery(
				getMoraRecoveryPeriod({ mes: 6, anio: 2026, hoy: "2026-07-29" }),
			),
		);

		// Lo que antes garantizaba el `HAVING BOOL_OR(NOT e.previo)` ahora lo
		// garantiza la FORMA: el techo se calcula SOLO para los créditos que ya
		// tienen un evento adentro del ciclo, así que no puede meter ninguno.
		expect(query.sql).toContain(
			"nivel_sembrado AS (\n      SELECT e.credito_id, COALESCE(techo.nivel, 0)::text AS nivel\n      FROM eventos_por_credito e",
		);
		expect(query.sql).toContain(
			"LEFT JOIN nivel_sembrado n ON n.credito_id = e.credito_id",
		);
		// Y un crédito sin eventos en el ciclo no genera nada por más techo que
		// traiga: no hay nada que plegar.
		expect(
			buildMoraRecoveryReport(
				[
					{
						asesorId: 1,
						nombre: "Ana",
						esperado: "70",
						eventos: [],
						nivelSembrado: "900",
						cobrado: "0",
					},
				],
				{ inicio: "2026-06-06", fin: "2026-07-06", alcance: "historico" },
			).totales.esperado,
		).toBe("70.00");
	});

	it("la siembra no cambia el agregado al plegar por lotes de créditos", () => {
		// El plegado del nivel es POR CRÉDITO, así que partir la lista de créditos
		// en lotes no puede mover el total. Con la siembra sigue siendo cierto:
		// los eventos previos vienen en la MISMA fila del crédito.
		const filas: MoraRecoverySourceRow[] = [
			{
				asesorId: 1,
				nombre: "Ana",
				esperado: "0",
				eventos: [previo("CONDONACION", 100, 0), evento("RECALCULO", 0, 100)],
				cobrado: "0",
			},
			{
				asesorId: 1,
				nombre: "Ana",
				esperado: "0",
				eventos: [previo("DECREMENTO", 80, 0), evento("RECALCULO", 0, 80)],
				cobrado: "30",
			},
			{
				asesorId: 2,
				nombre: "Beto",
				esperado: "50",
				eventos: [evento("RECALCULO", 50, 75)],
				cobrado: "10",
			},
			{
				asesorId: 2,
				nombre: "Beto",
				esperado: "100",
				// Pagó y se revirtió: el esperado vuelve a ser la foto, no el doble.
				eventos: [evento("DECREMENTO", 100, 0), reverso(0, 100)],
				cobrado: "0",
			},
		];
		const periodo = {
			inicio: "2026-06-06",
			fin: "2026-07-06",
			alcance: "historico" as const,
		};
		const unaPasada = buildMoraRecoveryReport(filas, periodo);
		const porLotes = [
			filas.slice(0, 1),
			filas.slice(1, 2),
			filas.slice(2, 3),
			filas.slice(3),
		].map(
			(lote) => buildMoraRecoveryReport(lote, periodo),
		);
		const sumaLotes = porLotes
			.reduce((total, r) => total + Number(r.totales.esperado), 0)
			.toFixed(2);

		// 0 (condonado afuera, rebote adentro) + 80 (pagó y volvió a generar) + 75
		// + 100 (la foto del que se revirtió, sin duplicar).
		expect(unaPasada.totales.esperado).toBe("255.00");
		expect(sumaLotes).toBe(unaPasada.totales.esperado);
	});

	it("un crédito que solo generó mora adentro entra al alcance del esperado", () => {
		const query = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery(
				getMoraRecoveryPeriod({ mes: 6, anio: 2026, hoy: "2026-07-29" }),
			),
		);

		// FULL JOIN: si solo tiene eventos no hay fila en snapshot ni en pagos.
		expect(query.sql).toContain("FULL JOIN eventos_por_credito e");
		expect(query.sql).toContain(
			"ca.credito_id = COALESCE(s.credito_id, p.credito_id, e.credito_id)",
		);

		// Y su cobro cuenta DENTRO del alcance, no fuera.
		const report = buildMoraRecoveryReport(
			[
				{
					asesorId: 4,
					nombre: "Fabi",
					esperado: "0",
					eventos: [evento("CREACION", 0, 80)],
					cobrado: "80",
				},
			],
			{ inicio: "2026-06-06", fin: "2026-07-06", alcance: "historico" },
		);
		expect(report.totales).toMatchObject({
			esperado: "80.00",
			cobradoEnSnapshot: "80.00",
			cobradoFueraSnapshot: "0.00",
		});
	});

	it("el cobro de un crédito sin esperado alguno queda FUERA del alcance", () => {
		const report = buildMoraRecoveryReport(
			[
				{
					asesorId: 5,
					nombre: "Gabo",
					esperado: "0",
					eventos: [],
					cobrado: "45",
				},
			],
			{ inicio: "2026-06-06", fin: "2026-07-06", alcance: "historico" },
		);

		expect(report.totales).toMatchObject({
			esperado: "0.00",
			cobradoEnSnapshot: "0.00",
			cobradoFueraSnapshot: "45.00",
		});
	});

	it("el ancla se busca con UNA fila y sin ventana de tiempo", () => {
		const query = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery(
				getMoraRecoveryPeriod({ mes: 6, anio: 2026, hoy: "2026-07-29" }),
			),
		);

		// El ANCLA es el último evento previo que bajó el techo de verdad: un pago
		// (cualquier baja real) o una DESACTIVACION. La CONDONACION queda fuera a
		// propósito: perdonar no vuelve a abrir la oportunidad de cobro.
		expect(query.sql).toContain(
			"AND (h.tipo_evento = 'DESACTIVACION'\n               OR (h.tipo_evento <> 'CONDONACION'",
		);
		expect(query.sql).toContain("AND h.monto_nuevo < h.monto_anterior))");
		// Una sola fila, por índice: ORDER BY ... DESC + LIMIT 1, no un scan.
		expect(query.sql).toContain(
			"ORDER BY h.fecha DESC, h.historial_id DESC\n        LIMIT 1",
		);
		// Y el techo es un AGREGADO desde el ancla, no las filas plegadas.
		expect(query.sql).toContain(
			"WHEN h.tipo_evento = 'CONDONACION' THEN h.monto_anterior::numeric",
		);
		expect(query.sql).toContain(
			"AND (ancla.fecha IS NULL\n               OR (h.fecha, h.historial_id) >= (ancla.fecha, ancla.historial_id))",
		);
	});

	it("MUTACIÓN: la consulta no tiene NINGÚN corte por días para la siembra", () => {
		const query = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery(
				getMoraRecoveryPeriod({ mes: 6, anio: 2026, hoy: "2026-07-29" }),
			),
		);

		// Cualquier tope por días —31, 90, el que sea— tendría que viajar como un
		// instante propio. Los únicos instantes de la consulta son los DOS límites
		// del ciclo, así que no hay dónde esconder un corte elegido a ojo.
		const instantes = new Set(
			query.params.filter(
				(p): p is string =>
					typeof p === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:/.test(p),
			),
		);
		expect([...instantes].sort()).toEqual([
			"2026-06-06 06:00:00.000",
			"2026-07-06 06:00:00.000",
		]);
		// La siembra solo mira "antes del inicio", nunca "después de tal fecha".
		expect(query.sql).not.toContain("2026-05-06");
		expect(query.sql.match(/h\.fecha >= /g) ?? []).toHaveLength(1);
	});

	it("la restitución de una reversa se reconoce por el motivo y nunca es un ancla", () => {
		const query = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery(
				getMoraRecoveryPeriod({ mes: 6, anio: 2026, hoy: "2026-07-29" }),
			),
		);

		// Las marcas las escriben reversePayment (reversa) y falsePayment
		// (anulación), y las lee el reporte: MISMAS constantes, una por escritor.
		expect(query.params).toContain(`${MOTIVO_REVERSA_MORA_PREFIJO}%`);
		expect(query.params).toContain(`${MOTIVO_ANULACION_MORA_PREFIJO}%`);
		// Ninguna se puede quedar afuera del lector: la lista es la fuente.
		for (const prefijo of MOTIVOS_RESTITUCION_MORA_PREFIJOS) {
			expect(query.params).toContain(`${prefijo}%`);
		}
		// Sin número de placeholder fijo: los lotes y el snapshot renumeran, pero
		// la FORMA —un LIKE por prefijo, unidos por OR, sobre el motivo con
		// COALESCE— es la que decide si una restitución se cuenta como mora nueva.
		expect(query.sql).toMatch(
			/\(h\.tipo_evento = 'INCREMENTO' AND \(COALESCE\(h\.motivo, ''\) LIKE \$\d+ OR COALESCE\(h\.motivo, ''\) LIKE \$\d+\)\) AS reverso/,
		);
		expect(query.sql).toContain("'reverso', e.reverso");
		// Y el ancla las excluye EXPLÍCITAMENTE, igual que `esReseteoDeNivel`: una
		// restitución repone un techo, nunca lo baja.
		expect(query.sql).toMatch(
			/AND NOT \(h\.tipo_evento = 'INCREMENTO'\n {28}AND \(COALESCE\(h\.motivo, ''\) LIKE \$\d+ OR COALESCE\(h\.motivo, ''\) LIKE \$\d+\)\)/,
		);
		expect(
			esReseteoDeNivel({
				tipoEvento: "INCREMENTO",
				montoAnterior: 100,
				montoNuevo: 40,
				reverso: true,
			}),
		).toBe(false);
	});

	it("rechaza un ciclo con límites que no son un día real", () => {
		expect(() =>
			buildMoraRecoveryQuery({
				inicio: "2026-02-31",
				fin: "2026-07-06",
				fechaSnapshot: "2026-06-06",
				alcance: "historico",
			}),
		).toThrow("Período de recuperación de mora inválido");
		expect(() =>
			buildMoraRecoveryQuery({
				inicio: "2026-06-06",
				fin: "no-es-fecha",
				fechaSnapshot: "2026-06-06",
				alcance: "historico",
			}),
		).toThrow("Período de recuperación de mora inválido");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Lotes de créditos. El plegado del nivel de referencia necesita los eventos
// CRUDOS del ciclo; con el RECALCULO diario eso pasa de ~8.000 a ~45.000 por
// consulta. Se parte por CRÉDITO —no por página de respuesta— porque el
// plegado es por crédito, así que partir ahí no puede cambiar el agregado.
// Estos tests fijan justamente eso.
// ─────────────────────────────────────────────────────────────────────────────
describe("partirEnLotes", () => {
	it("parte en trozos del tamaño pedido y no pierde nada", () => {
		expect(partirEnLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
		expect(partirEnLotes([1, 2, 3, 4], 2)).toEqual([
			[1, 2],
			[3, 4],
		]);
	});

	it("lista vacía = cero lotes (el reporte sale sin tocar la base)", () => {
		expect(partirEnLotes([], 500)).toEqual([]);
	});

	it("una lista más chica que el lote es un solo lote", () => {
		expect(partirEnLotes([7], 500)).toEqual([[7]]);
	});

	it("el número de lotes depende SOLO de cuántos créditos hay", () => {
		// 1.201 créditos con CREDITOS_POR_LOTE = 500 → 3 lotes, tengan los
		// créditos 1 evento o 10.000. Si alguien reintrodujera una paginación por
		// eventos, este número dejaría de ser función del largo de la lista.
		const creditos = Array.from({ length: 1201 }, (_, i) => i + 1);
		expect(partirEnLotes(creditos).length).toBe(
			Math.ceil(1201 / CREDITOS_POR_LOTE),
		);
		expect(partirEnLotes(creditos).flat()).toEqual(creditos);
	});

	it("un tamaño de lote absurdo revienta en vez de colgar el proceso", () => {
		expect(() => partirEnLotes([1], 0)).toThrow(RangeError);
		expect(() => partirEnLotes([1], -3)).toThrow(RangeError);
		expect(() => partirEnLotes([1], 1.5)).toThrow(RangeError);
	});
});

describe("el reporte por lotes es idéntico al de una sola pasada", () => {
	// Filas sintéticas: varios asesores, créditos con eventos y sin ellos,
	// cobrado dentro y fuera de alcance. Lo importante es que haya MÁS créditos
	// que el tamaño de lote que se usa al partir.
	const muchasFilas: MoraRecoverySourceRow[] = Array.from(
		{ length: 23 },
		(_, i) => ({
			asesorId: i % 4 === 3 ? null : (i % 4) + 1,
			nombre: i % 4 === 3 ? "Sin asignar" : `Asesor ${(i % 4) + 1}`,
			esperado: (i * 10).toFixed(2),
			eventos:
				i % 3 === 0
					? []
					: [
							// Ventana de siembra: la mitad de los créditos cruza el
							// corte con una condonación de la víspera y la otra mitad
							// con un pago, que son los dos casos que mueven el nivel
							// de arranque. Van acá para que la identidad por lotes se
							// pruebe CON siembra y no solo con eventos del ciclo.
							i % 2 === 0
								? previo("CONDONACION", i * 10, 0)
								: previo("DECREMENTO", i * 10, 0),
							evento("RECALCULO", i * 10, i * 10 + 5),
							evento("CONDONACION", i * 10 + 5, 0),
							evento("RECALCULO", 0, i * 10 + 5),
							evento("DECREMENTO", i * 10 + 5, 1),
						],
			cobrado: (i % 5).toFixed(2),
		}),
	);

	const periodo = { inicio: "2026-06-06", fin: "2026-07-06", alcance: "historico" as const };

	const porLotes = (tamano: number) => {
		const acc = nuevoMoraRecoveryAccumulator();
		for (const lote of partirEnLotes(muchasFilas, tamano)) {
			acumularMoraRecoveryRows(acc, lote);
		}
		return finalizarMoraRecoveryReport(acc, periodo);
	};

	const unaPasada = buildMoraRecoveryReport(muchasFilas, periodo);

	for (const tamano of [1, 2, 5, 10, 23, 100]) {
		it(`con lotes de ${tamano} da lo mismo que de una`, () => {
			expect(porLotes(tamano)).toEqual(unaPasada);
		});
	}

	it("el caso que importa: más créditos que el tamaño de lote", () => {
		// 23 filas en lotes de 5 = 5 lotes. Si el acumulador pisara en vez de
		// sumar, o si el plegado se reiniciara por lote, los totales cambiarían.
		expect(partirEnLotes(muchasFilas, 5).length).toBe(5);
		expect(porLotes(5).totales).toEqual(unaPasada.totales);
		expect(Number(unaPasada.totales.esperado)).toBeGreaterThan(0);
	});
});

describe("buildMoraRecoveryQuery — el filtro de lote", () => {
	const periodo = getMoraRecoveryPeriod({ mes: 6, anio: 2026, hoy: "2026-07-29" });

	it("acota `creditos_con_asesor`, que es de donde cuelga todo lo demás", () => {
		const { sql: texto, params } = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery({ ...periodo, creditos: [7, 9] }),
		);
		expect(texto).toMatch(/creditos_con_asesor AS \([\s\S]*?c\.credito_id IN \(/);
		expect(params).toContain(7);
		expect(params).toContain(9);
	});

	it("sin lote la consulta es la de siempre (toda la cartera elegible)", () => {
		const { sql: texto } = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery(periodo),
		);
		expect(texto).not.toContain("c.credito_id IN (");
	});

	// EL DEFECTO. El lote acotaba `creditos_con_asesor`, pero la FOTO inicial
	// —`snapCte`, y la CTE de mora viva de la rama `live`— va ANTES y no cuelga
	// de ella: cada lote reconstruía la foto de la cartera COMPLETA y recién
	// descartaba los créditos ajenos en el JOIN final. Con N lotes eso es N veces
	// la foto entera, o sea el batching pagando de más en vez de de menos.
	it("acota TAMBIÉN la foto del snapshot, no solo `creditos_con_asesor`", () => {
		const { sql: texto } = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery({ ...periodo, creditos: [7, 9] }),
		);
		// La foto entra por el lote: un LATERAL por crédito sobre la lista.
		expect(texto).toMatch(/snap_ultimo AS \([\s\S]*?unnest\(/);
		expect(texto).toMatch(/snap_cuotas AS \([\s\S]*?unnest\(/);
		// Y lo que NO puede volver: un barrido de la tabla sin atarse al crédito.
		const snapshot = texto.slice(
			texto.indexOf("snap_ultimo AS ("),
			texto.indexOf("creditos_con_asesor AS ("),
		);
		expect(snapshot).toContain("h.credito_id = l.credito_id");
		expect(snapshot).not.toContain("DISTINCT ON");
	});

	it("la rama `live` acota su propia foto de mora activa", () => {
		// `mora_activa` es la foto de la rama viva y tiene el mismo problema.
		const vivo = getMoraRecoveryPeriod({ mes: 9, anio: 2026, hoy: "2026-09-03" });
		expect(vivo.alcance).toBe("live");
		const { sql: texto, params } = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery({ ...vivo, creditos: [7, 9] }),
		);
		expect(texto).toMatch(
			/mora_activa AS \([\s\S]*?credito_id = ANY \(ARRAY\[/,
		);
		expect(params).toContain(7);
		expect(params).toContain(9);
	});

	it("sin lote la foto sigue siendo la de toda la cartera", () => {
		// Los otros llamadores de `snapCte` dependen de esto.
		const { sql: texto } = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery(periodo),
		);
		expect(texto).toContain("snap_ultimo AS (");
		expect(texto).toContain("DISTINCT ON (h.credito_id)");
		expect(texto).not.toContain("unnest(");
	});

	it("el universo de créditos usa los MISMOS filtros que el reporte", () => {
		// Si divergieran, la partición dejaría créditos afuera del reporte.
		const { sql: universo } = new PgDialect().sqlToQuery(
			buildMoraRecoveryCreditosQuery({ asesores: [3], emailCobrador: "a@b.c" }),
		);
		expect(universo).toContain('c."statusCredit" IN (');
		expect(universo).toContain("LOWER(a.email_cash_in) = LOWER(TRIM(");
		expect(universo).toContain("a.asesor_id IN (");
		expect(universo).toContain("ORDER BY c.credito_id");
	});
});

/**
 * EL CONTRATO DEL MAPEO, EN LA DIRECCIÓN QUE FALTABA.
 *
 * `db.execute<MoraRecoveryFilaCruda>` AFIRMA la forma de lo que devuelve la
 * consulta; no la verifica. El compilador ya cubría una dirección: si el TIPO
 * declara un campo, `TRADUCTORES_EVENTO` obliga a traducirlo (fue lo que cerró
 * el agujero que se abrió tres veces con `nivel_sembrado`, `reverso` y
 * `anulado`). Pero la contraria estaba abierta de par en par: agregar una clave
 * al `JSON_BUILD_OBJECT` del SQL sin agregarla al tipo COMPILA, y el valor se
 * descarta en silencio mientras el reporte dice otra cosa.
 *
 * Esta prueba cierra esa dirección leyendo el SQL RENDERIZADO —la fuente real,
 * no una copia— y comparándolo contra las claves del tipo, que a su vez salen
 * de `TRADUCTORES_EVENTO` (ver `CLAVES_EVENTO_MORA_RECOVERY_CRUDO`). No hay
 * ninguna lista escrita a mano en el medio: si el SQL y el tipo se separan en
 * CUALQUIERA de las dos direcciones, esto se pone rojo.
 */
describe("contrato: JSON_BUILD_OBJECT del SQL ↔ MoraRecoveryEventoCrudo", () => {
	/**
	 * Devuelve los argumentos de primer nivel del `JSON_BUILD_OBJECT` del SQL
	 * renderizado —CRUDOS, claves y valores—, recortando por paréntesis
	 * balanceados (adentro hay llamadas anidadas y comas que NO separan
	 * argumentos del objeto).
	 *
	 * Devuelve la lista ENTERA y no solo las claves a propósito: filtrar los
	 * valores acá dejaba ciega la prueba de paridad. Con `…, 'anulado')` —una
	 * clave sin su valor— los argumentos pares siguen siendo las mismas seis
	 * claves, así que las dos pruebas pasaban y Postgres rechazaba la consulta
	 * del reporte por número IMPAR de argumentos.
	 */
	const argumentosDelJsonBuildObject = (texto: string): string[] => {
		const apariciones = texto.match(/JSON_BUILD_OBJECT\s*\(/gi) ?? [];
		// Si algún día hay más de uno, esta prueba estaría mirando el que no es.
		expect(apariciones.length).toBe(1);

		const inicio = texto.search(/JSON_BUILD_OBJECT\s*\(/i);
		const abre = texto.indexOf("(", inicio);
		let profundidad = 0;
		let cierra = -1;
		for (let i = abre; i < texto.length; i++) {
			if (texto[i] === "(") profundidad++;
			else if (texto[i] === ")") {
				profundidad--;
				if (profundidad === 0) {
					cierra = i;
					break;
				}
			}
		}
		expect(cierra).toBeGreaterThan(abre);

		const cuerpo = texto.slice(abre + 1, cierra);
		const argumentos: string[] = [];
		let actual = "";
		profundidad = 0;
		for (const ch of cuerpo) {
			if (ch === "(") profundidad++;
			else if (ch === ")") profundidad--;
			if (ch === "," && profundidad === 0) {
				argumentos.push(actual.trim());
				actual = "";
			} else actual += ch;
		}
		argumentos.push(actual.trim());

		return argumentos;
	};

	/**
	 * `JSON_BUILD_OBJECT(clave, valor, clave, valor, …)`: las claves son los
	 * argumentos pares, y tienen que ser literales de texto.
	 */
	const clavesDelJsonBuildObject = (texto: string): string[] =>
		argumentosDelJsonBuildObject(texto)
			.filter((_, i) => i % 2 === 0)
			.map((arg) => {
				const m = arg.match(/^'([^']+)'$/);
				expect(m).not.toBeNull();
				return (m as RegExpMatchArray)[1];
			});

	it("las claves que emite el SQL son EXACTAMENTE las del tipo crudo", () => {
		const periodo = getMoraRecoveryPeriod({
			mes: 6,
			anio: 2026,
			hoy: "2026-07-29",
		});
		const { sql: texto } = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery(periodo),
		);

		const delSql = clavesDelJsonBuildObject(texto).sort();
		const delTipo = [...CLAVES_EVENTO_MORA_RECOVERY_CRUDO].sort();

		// Un solo `toEqual` sobre los dos conjuntos ordenados: una clave de más
		// en el SQL (se descartaría en silencio) y una de menos (llegaría
		// `undefined`) fallan las dos por el mismo lado.
		expect(delSql).toEqual(delTipo);
	});

	it("el número de argumentos es PAR: ninguna clave quedó sin valor", () => {
		const periodo = getMoraRecoveryPeriod({
			mes: 6,
			anio: 2026,
			hoy: "2026-07-29",
		});
		const { sql: texto } = new PgDialect().sqlToQuery(
			buildMoraRecoveryQuery(periodo),
		);

		// Sobre los argumentos CRUDOS: una clave sin valor no cambia la lista de
		// claves —los pares siguen siendo los mismos nombres— pero sí deja la
		// cuenta impar, y Postgres rechaza la consulta entera con
		// "argument list must have even number of elements".
		const argumentos = argumentosDelJsonBuildObject(texto);
		expect(argumentos.length % 2).toBe(0);
		// Y son exactamente dos por clave del tipo: ni una de más ni una de menos.
		expect(argumentos.length).toBe(
			CLAVES_EVENTO_MORA_RECOVERY_CRUDO.length * 2,
		);
		// Ningún argumento vacío: `'x', , 'y'` también sería un SQL roto.
		for (const arg of argumentos) expect(arg).not.toBe("");
	});
});
