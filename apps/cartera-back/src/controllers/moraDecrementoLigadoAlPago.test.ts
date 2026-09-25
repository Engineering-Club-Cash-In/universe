/**
 * EL DECREMENTO DE MORA LIGADO A SU PAGO.
 *
 * Los tres defectos que estas pruebas fijan, todos consecuencia de que el
 * `DECREMENTO` de mora no estaba ligado al pago que lo causó:
 *
 *  (A) EL ANCLA ESTABA MAL. La reconciliación anclaba en
 *      `pagos_credito.createdat`, pero el descuento de mora corre al principio
 *      de `registerPayment` y la fila del pago se inserta mucho después: el
 *      `createdat` es POSTERIOR al evento que pretendía anclar. Una corrida del
 *      cron en ese hueco quedaba ANTES del ancla, se ignoraba, y revertir
 *      volvía a dejar el doble.
 *
 *  (B) EL PROXY ERA DEMASIADO GRUESO. "¿Hubo algún CREACION/RECALCULO del cron
 *      después?" decía que sí aunque ese evento no hubiera repuesto ESTE
 *      decremento —o hubiera repuesto solo una parte—, y la restitución
 *      legítima quedaba salteada: el crédito subcobrado, el error contrario.
 *
 *  (C) SI EL CRON YA HABÍA REPUESTO, NO QUEDABA NINGÚN RASTRO. La regla
 *      devolvía `null` y la anulación no dejaba marca. El reporte seguía viendo
 *      el `DECREMENTO` y el `RECALCULO` sin marcar y contaba lo repuesto como
 *      mora NUEVA: una foto de Q100 terminaba en Q200 de esperado.
 *
 * Se ejercen las funciones de verdad contra un ejecutor falso: la consulta no
 * toca la base y lo que se verifica es qué filtra y cómo traduce las filas a la
 * decisión.
 */
import { describe, expect, it } from "bun:test";
import {
	MARCA_DECREMENTO_ANULADO,
	marcaPagoDelDecremento,
} from "../utils/motivoReversaMora";
import { restitucionMoraDePago } from "../utils/restitucionMoraDePago";
import { estadoMoraTrasElPago } from "./moraDecrementoDePago";
import {
	esReseteoDeNivel,
	moraGeneradaEnPeriodo,
	nivelSembrado,
} from "./moraRecuperacion";

const CREDITO_ID = 980;
const PAGO_ID = 152172;
const DECREMENTO = new Date("2026-08-05T20:09:00.000Z");
/** El `createdat` de la fila del pago: se escribe DESPUÉS del decremento. */
const FILA_ESCRITA = new Date("2026-08-05T20:09:04.000Z");

type Fila = Record<string, unknown>;

/**
 * Un ejecutor que responde por ORDEN DE LECTURA, que es lo que la función fija:
 * primero busca el decremento marcado; si lo encuentra, recorre lo que pasó
 * DESPUÉS; si no, cae al proxy viejo y pregunta por los eventos del cron.
 */
function executorFalso({
	decremento = [] as Fila[],
	posteriores = [] as Fila[],
	eventosDelCron = [] as Fila[],
}) {
	let lectura = 0;
	const select = () => {
		const n = lectura++;
		const resolver = (): Promise<Fila[]> =>
			Promise.resolve(
				n === 0
					? decremento
					: decremento.length
						? posteriores
						: eventosDelCron,
			);
		const b: any = {
			from: () => b,
			where: () => b,
			orderBy: () => b,
			limit: () => b,
			then: (res: any, rej: any) => resolver().then(res, rej),
		};
		return b;
	};
	return { executor: { select } as any };
}

/**
 * Una RE-FIJACIÓN POR FÓRMULA del cron: la única clase de evento que puede
 * deshacer el decremento de un pago, porque REEMPLAZA el monto ignorando el
 * pago (`procesarMoras`, ramas CREACION/RECALCULO, las dos `PROCESO_AUTO`).
 */
const refijacionDelCron = (
	anterior: string,
	nuevo: string,
	tipo_evento: "RECALCULO" | "CREACION" = "RECALCULO",
) => ({
	monto_anterior: anterior,
	monto_nuevo: nuevo,
	origen: "PROCESO_AUTO",
	tipo_evento,
});

/** El ajuste a mano de un analista desde `POST /mora/update`. */
const incrementoManual = (anterior: string, nuevo: string) => ({
	monto_anterior: anterior,
	monto_nuevo: nuevo,
	origen: "API_MANUAL",
	tipo_evento: "INCREMENTO",
});

/** Otro pago cobrando mora: baja, no repone. */
const decrementoDeOtroPago = (anterior: string, nuevo: string) => ({
	monto_anterior: anterior,
	monto_nuevo: nuevo,
	origen: "API_MANUAL",
	tipo_evento: "DECREMENTO",
});

const filaDecremento = (anterior: string, nuevo: string, extra = "") => [
	{
		historial_id: 5001,
		fecha: DECREMENTO,
		monto_anterior: anterior,
		monto_nuevo: nuevo,
		motivo: `Pago aplicado a mora (crédito 980)${marcaPagoDelDecremento(PAGO_ID)}${extra}`,
	},
];

const reconciliar = async (
	pago: { mora: string },
	filas: Parameters<typeof executorFalso>[0],
) => {
	const { executor } = executorFalso(filas);
	const { estado, decremento } = await estadoMoraTrasElPago(executor, {
		credito_id: CREDITO_ID,
		pago_id: PAGO_ID,
		createdAt: FILA_ESCRITA,
	});
	return {
		decremento,
		restitucion: restitucionMoraDePago(pago, PAGO_ID, "REVERSA", estado),
	};
};

describe("(A) el hueco entre el decremento y la fila del pago", () => {
	it("el cron que corrió EN el hueco ya no se ignora: no se restituye de más", async () => {
		// El cron repuso la mora a las 20:09:02, DESPUÉS del decremento (20:09:00)
		// pero ANTES de que la fila del pago existiera (20:09:04). Con el ancla
		// vieja —`createdat`— ese evento caía fuera de la ventana, el proxy decía
		// "el cron no pasó" y la reversa sumaba Q333.95 sobre una mora que ya
		// estaba repuesta: Q667.90. Anclando en el EVENTO, el hueco desaparece.
		const { restitucion } = await reconciliar(
			{ mora: "333.95" },
			{
				decremento: filaDecremento("333.95", "0.00"),
				posteriores: [refijacionDelCron("0.00", "333.95")],
			},
		);

		expect(restitucion).toBeNull();
	});

	it("y el evento del cron ANTERIOR al decremento sigue sin contar", async () => {
		// Un evento viejo no repone nada: el recorrido arranca DESPUÉS del
		// decremento, así que ni se lo trae.
		const { restitucion } = await reconciliar(
			{ mora: "333.95" },
			{
				decremento: filaDecremento("333.95", "0.00"),
				posteriores: [],
			},
		);

		expect(restitucion?.monto_cambio).toBe(333.95);
	});
});

describe("(B) el delta real en vez del proxy", () => {
	it("reposición PARCIAL: restituye la diferencia, no todo ni nada", async () => {
		// El pago bajó Q100 y además bajó el capital, así que el cron recalculó a
		// Q60 en vez de a Q100. El proxy viejo veía "hubo un RECALCULO" y no
		// restituía NADA: el crédito quedaba Q40 subcobrado.
		const { restitucion } = await reconciliar(
			{ mora: "100.00" },
			{
				decremento: filaDecremento("100.00", "0.00"),
				posteriores: [refijacionDelCron("0.00", "60.00")],
			},
		);

		expect(restitucion?.monto_cambio).toBe(40);
	});

	it("el cron que recalculó por OTRAS cuotas no suprime esta restitución", async () => {
		// Pago parcial: la mora bajó de Q100 a Q40 (bajó Q60). Después el cron
		// recalculó de Q40 a Q50 por una cuota distinta que venció. El proxy viejo
		// leía ese RECALCULO como "ya repuso" y se saltaba la restitución entera.
		// Lo repuesto de VERDAD son Q10: quedan Q50.
		const { restitucion } = await reconciliar(
			{ mora: "60.00" },
			{
				decremento: filaDecremento("100.00", "40.00"),
				posteriores: [refijacionDelCron("40.00", "50.00")],
			},
		);

		expect(restitucion?.monto_cambio).toBe(50);
	});

	it("nunca restituye más de lo que el decremento bajó", async () => {
		// La boleta cobró Q100 de mora pero el saldo solo tenía Q80 (updateMora no
		// deja la mora bajo cero). Devolver los Q100 le inventaría al crédito Q20
		// de mora que nunca tuvo.
		const { restitucion } = await reconciliar(
			{ mora: "100.00" },
			{
				decremento: filaDecremento("80.00", "0.00"),
				posteriores: [],
			},
		);

		expect(restitucion?.monto_cambio).toBe(80);
	});

	it("una bajada posterior NO cuenta como reposición pendiente", async () => {
		// El cron repuso los Q100 y OTRO pago los cobró. Esa deuda se saldó de
		// verdad: restituir acá se la cobraría dos veces al mismo cliente.
		const { restitucion } = await reconciliar(
			{ mora: "100.00" },
			{
				decremento: filaDecremento("100.00", "0.00"),
				posteriores: [
					refijacionDelCron("0.00", "100.00"),
					decrementoDeOtroPago("100.00", "0.00"),
				],
			},
		);

		expect(restitucion).toBeNull();
	});

	it("una bajada posterior a una reposición PARCIAL tampoco la borra", async () => {
		// El caso que distingue "sumar las subidas" de "sumar el delta neto": el
		// cron repuso Q60 de los Q100 y otro pago se llevó esos Q60. Con el delta
		// neto el saldo vuelve a 0 y se restituirían los Q100 enteros —los Q60 que
		// el otro pago ya cobró, cobrados otra vez—. Lo repuesto fueron Q60:
		// quedan Q40.
		const { restitucion } = await reconciliar(
			{ mora: "100.00" },
			{
				decremento: filaDecremento("100.00", "0.00"),
				posteriores: [
					refijacionDelCron("0.00", "60.00"),
					decrementoDeOtroPago("60.00", "0.00"),
				],
			},
		);

		expect(restitucion?.monto_cambio).toBe(40);
	});

	it("un decremento YA marcado como anulado no se restituye dos veces", async () => {
		const { restitucion } = await reconciliar(
			{ mora: "100.00" },
			{
				decremento: filaDecremento("100.00", "0.00", MARCA_DECREMENTO_ANULADO),
				posteriores: [],
			},
		);

		expect(restitucion).toBeNull();
	});
});

describe("(D) solo repone quien de verdad pudo reponer", () => {
	// El delta real no alcanzaba: contaba como «restitución de este pago»
	// CUALQUIER subida posterior de la mora, sin mirar de dónde venía ni
	// cuántas eran. Las dos mitades del criterio —el filtro por origen/tipo y
	// el corte en la PRIMERA re-fijación— se prueban acá con números.

	it("el ajuste manual de un analista no descuenta de la restitución", async () => {
		// La mora bajó de Q100 a Q40 (bajó Q60). Después un analista la subió a
		// mano de Q40 a Q50 —deuda distinta, decisión suya—. Contar esos Q10 como
		// «ya repuesto» dejaba la restitución en Q50 y al crédito con Q100 de mora
		// en vez de Q110: Q10 del cliente que nadie le devuelve.
		const { restitucion } = await reconciliar(
			{ mora: "60.00" },
			{
				decremento: filaDecremento("100.00", "40.00"),
				posteriores: [incrementoManual("40.00", "50.00")],
			},
		);

		expect(restitucion?.monto_cambio).toBe(60);
	});

	it("y si además pasó el cron, repone el cron, no el ajuste", async () => {
		// Mismo caso con la re-fijación del cron DESPUÉS del ajuste manual: la
		// que repone es ella (Q50 → Q60, Q10), no la subida ajena que la precede.
		const { restitucion } = await reconciliar(
			{ mora: "60.00" },
			{
				decremento: filaDecremento("100.00", "40.00"),
				posteriores: [
					incrementoManual("40.00", "50.00"),
					refijacionDelCron("50.00", "60.00"),
				],
			},
		);

		expect(restitucion?.monto_cambio).toBe(50);
	});

	it("los recálculos de las noches siguientes no se acumulan hasta borrarla", async () => {
		// Mora proporcional: el cron recalcula TODAS las noches y el monto sube
		// por cuotas que van venciendo (Q40 → 55 → 70 → 85 → 100). Sumando las
		// cuatro subidas, lo «repuesto» llegaba a Q60 —todo lo que el pago había
		// bajado— y la restitución se iba a CERO: a unos días del pago, cualquier
		// reversa se comía la devolución entera. Repone la PRIMERA (Q15); las
		// otras son deuda NUEVA, no devolución de nada.
		const { restitucion } = await reconciliar(
			{ mora: "60.00" },
			{
				decremento: filaDecremento("100.00", "40.00"),
				posteriores: [
					refijacionDelCron("40.00", "55.00"),
					refijacionDelCron("55.00", "70.00"),
					refijacionDelCron("70.00", "85.00"),
					refijacionDelCron("85.00", "100.00"),
				],
			},
		);

		expect(restitucion?.monto_cambio).toBe(45);
	});

	it("una DESACTIVACION no repone, y la CREACION que le sigue sí", async () => {
		// Apagar la mora es lo contrario de reponerla. La mora vuelve a nacer por
		// fórmula en Q100: ahí sí quedó repuesto todo lo que el pago bajó.
		const { restitucion } = await reconciliar(
			{ mora: "100.00" },
			{
				decremento: filaDecremento("100.00", "0.00"),
				posteriores: [
					{
						monto_anterior: "0.00",
						monto_nuevo: "0.00",
						origen: "PROCESO_AUTO",
						tipo_evento: "DESACTIVACION",
					},
					refijacionDelCron("0.00", "100.00", "CREACION"),
				],
			},
		);

		expect(restitucion).toBeNull();
	});
});

describe("el decremento VIEJO, sin marca", () => {
	it("cae al criterio de antes: si el cron pasó, no restituye", async () => {
		// Es el camino que se midió contra el dump (crédito 980, pago 152172) y el
		// único disponible para los decrementos anteriores a la marca. NO se
		// endurece: cambiarlo a "restituir siempre" devolvería el doble cobro que
		// esta cadena vino a arreglar.
		const { restitucion, decremento } = await reconciliar(
			{ mora: "333.95" },
			{ decremento: [], eventosDelCron: [{ historial_id: 9001 }] },
		);

		expect(decremento).toBeNull();
		expect(restitucion).toBeNull();
	});

	it("y si el cron no pasó, restituye completa", async () => {
		const { restitucion } = await reconciliar(
			{ mora: "333.95" },
			{ decremento: [], eventosDelCron: [] },
		);

		expect(restitucion?.monto_cambio).toBe(333.95);
	});
});

describe("(C) el reporte deja de contar lo repuesto como mora nueva", () => {
	// El ciclo completo, plegado como lo pliega el reporte: foto Q100, el pago
	// baja la mora a Q0 y a la mañana siguiente el cron la repone a Q100.
	const foto = 100;
	const decremento = {
		tipoEvento: "DECREMENTO",
		montoAnterior: 100,
		montoNuevo: 0,
	};
	const reposicionDelCron = {
		tipoEvento: "RECALCULO",
		montoAnterior: 0,
		montoNuevo: 100,
	};

	it("sin marcar el decremento, la foto de Q100 termina en Q200 de esperado", () => {
		const generado = moraGeneradaEnPeriodo(foto, [
			decremento,
			reposicionDelCron,
		]);

		expect(foto + generado).toBe(200);
	});

	it("con el decremento marcado como anulado, el esperado vuelve a Q100", () => {
		// El pago se cayó: esa bajada nunca debió existir. El nivel no baja, así
		// que la reposición del cron no supera nada y no genera.
		const generado = moraGeneradaEnPeriodo(foto, [
			{ ...decremento, anulado: true },
			reposicionDelCron,
		]);

		expect(foto + generado).toBe(100);
	});

	it("y sigue valiendo aunque la restitución sí haya ocurrido", () => {
		// El cron repuso solo Q60 y la reversa restituyó los Q40 que faltaban. El
		// esperado sigue siendo la foto: nada de esto es oportunidad nueva.
		const generado = moraGeneradaEnPeriodo(foto, [
			{ ...decremento, anulado: true },
			{ tipoEvento: "RECALCULO", montoAnterior: 0, montoNuevo: 60 },
			{
				tipoEvento: "INCREMENTO",
				montoAnterior: 60,
				montoNuevo: 100,
				reverso: true,
			},
		]);

		expect(foto + generado).toBe(100);
	});

	it("la mora que nace DESPUÉS del decremento anulado sí se cuenta", () => {
		// Marcar el decremento no puede tapar deuda nueva de verdad: si el crédito
		// se atrasa otra cuota y la mora sube por encima del techo, eso es
		// oportunidad de cobro.
		const generado = moraGeneradaEnPeriodo(foto, [
			{ ...decremento, anulado: true },
			{ tipoEvento: "RECALCULO", montoAnterior: 0, montoNuevo: 150 },
		]);

		expect(foto + generado).toBe(150);
	});
});

describe("(C) la siembra tampoco puede apoyarse en una bajada que no ocurrió", () => {
	it("un decremento anulado no es el ancla del techo vigente", () => {
		// El ancla es el ÚLTIMO evento que bajó el techo DE VERDAD. Si una bajada
		// que se cayó pudiera serlo, el techo vigente quedaría en el monto de un
		// pago que nunca existió y el rebote del cron se contaría como mora nueva
		// por el borde de la siembra.
		expect(
			esReseteoDeNivel({
				tipoEvento: "DECREMENTO",
				montoAnterior: 100,
				montoNuevo: 0,
			}),
		).toBe(true);
		expect(
			esReseteoDeNivel({
				tipoEvento: "DECREMENTO",
				montoAnterior: 100,
				montoNuevo: 0,
				anulado: true,
			}),
		).toBe(false);
	});

	it("y el techo sembrado conserva los Q100 que el decremento anulado había bajado", () => {
		// Lo último antes del corte fue el pago, que después se cayó. Con la
		// marca no hay ancla —nada bajó el techo de verdad— y el techo sigue
		// siendo Q100; sin ella el ancla es el decremento y el techo cae a Q0, con
		// lo que el RECALCULO de adentro del ciclo se cuenta ENTERO como mora
		// nueva: el doble conteo metido por el borde de la siembra.
		const previos = [
			{ tipoEvento: "CREACION", montoAnterior: 0, montoNuevo: 100 },
			{ tipoEvento: "DECREMENTO", montoAnterior: 100, montoNuevo: 0 },
		];

		expect(
			nivelSembrado(
				previos.map((e, i) => (i === 1 ? { ...e, anulado: true } : e)),
			),
		).toBe(100);
		expect(nivelSembrado(previos)).toBe(0);
	});
});

describe("registerPayment deja el decremento ligado a su pago", () => {
	it("estampa en TODAS las ramas que pueden escribir la fila con la mora", async () => {
		// Si una rama nueva escribe la mora y no llama al estampador, su
		// decremento nace sin marca y la reconciliación de ese pago vuelve a
		// adivinar. El estampador es de un solo uso, así que llamarlo de más no
		// hace daño; no llamarlo sí.
		const texto = await Bun.file(
			new URL("./registerPayment.ts", import.meta.url).pathname,
		).text();

		expect(texto).toContain("crearEstampadorDecrementoMora(");
		// Las tres ramas de "solo mora", la fila de la cuota, el pago especial y
		// la fila del abono directo a capital.
		expect(
			texto.split("await estamparDecrementoMora(").length - 1,
		).toBeGreaterThanOrEqual(6);
		// Y el de la fila de la cuota cuelga de que ESA fila se haya llevado la
		// mora, no de otra condición: es la única rama que escribe varias filas.
		expect(texto).toContain(
			"if (moraParaPago.gt(0)) {\n            await estamparDecrementoMora(pagoInsertado?.pago_id);",
		);
		// Y el `historial_id` tiene que viajar desde updateMora: sin él el
		// estampador no sabe qué evento marcar.
		expect(texto).toContain("historialIdDecremento");
		expect(texto).toContain(
			"historialIdDecremento: resultadoMora.historial_id ?? null",
		);
	});

	it("la rama del abono directo a capital estampa la fila que se llevó la mora", async () => {
		// Esa rama es la única salida de `registerPayment` que escribe UNA sola
		// fila y retorna sin pasar por el loop de cuotas ni por el else final: si
		// no estampa, el decremento de ese pago nace sin marca y anular o
		// revertir el pago cae al camino de reserva, que ve que el cron tocó la
		// mora después (la toca todas las noches) y restituye CERO. El capital
		// vuelve, la mora no.
		const texto = await Bun.file(
			new URL("./registerPayment.ts", import.meta.url).pathname,
		).text();

		const inicio = texto.indexOf(
			"if ((estaAlDia || permiteAbonoCapital) && abonoCapital.gt(0))",
		);
		const fin = texto.indexOf(
			"Abono directo a capital registrado exitosamente",
		);
		expect(inicio).toBeGreaterThan(0);
		expect(fin).toBeGreaterThan(inicio);
		const rama = texto.slice(inicio, fin);

		// Premisa: esta fila ES la que carga la mora cobrada por la boleta.
		expect(rama).toContain("mora: moraBig");
		// Y el estampado cuelga del `pago_id` recién insertado, no de otra cosa.
		const insercion = rama.indexOf("const [pagoInsertado] = await db");
		const estampado = rama.indexOf(
			"await estamparDecrementoMora(pagoInsertado.pago_id)",
		);
		expect(insercion).toBeGreaterThan(-1);
		expect(estampado).toBeGreaterThan(insercion);
	});
});
