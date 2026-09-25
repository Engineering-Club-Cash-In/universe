import { describe, expect, it } from "bun:test";
import {
	MOTIVOS_RESTITUCION_MORA_PREFIJOS,
	MOTIVO_ANULACION_MORA_PREFIJO,
	MOTIVO_REVERSA_MORA_PREFIJO,
} from "./motivoReversaMora";
import { restitucionMoraDePago } from "./restitucionMoraDePago";

describe("restitucionMoraDePago: la anulación por boleta falsa", () => {
	it("devuelve la mora del pago, marcada con el motivo de anulación", () => {
		const restitucion = restitucionMoraDePago(
			{ mora: "100.00", paymentFalse: false },
			301,
			"ANULACION",
		);
		expect(restitucion).not.toBeNull();
		expect(restitucion?.monto_cambio).toBe(100);
		// El motivo es CONTRATO: el reporte de recuperación lo lee por prefijo.
		expect(
			restitucion?.motivo.startsWith(MOTIVO_ANULACION_MORA_PREFIJO),
		).toBe(true);
		expect(restitucion?.motivo).toContain("301");
	});

	it("anular no es revertir: el prefijo es el suyo, no el de la reversa", () => {
		const restitucion = restitucionMoraDePago({ mora: "100.00" }, 301, "ANULACION");
		expect(restitucion?.motivo.startsWith(MOTIVO_REVERSA_MORA_PREFIJO)).toBe(
			false,
		);
		// Pero el lector tiene que reconocer a los dos escritores.
		expect(
			MOTIVOS_RESTITUCION_MORA_PREFIJOS.some((prefijo) =>
				restitucion?.motivo.startsWith(prefijo),
			),
		).toBe(true);
	});

	it("restituye SOLO la mora, no el monto de la boleta", () => {
		// La boleta traía capital, interés e IVA además de la mora: devolver el
		// total le inventaría al cliente una deuda de mora que nunca tuvo.
		const restitucion = restitucionMoraDePago(
			{ mora: "37.50", paymentFalse: false, monto_boleta: "1500.00" } as never,
			301,
			"ANULACION",
		);
		expect(restitucion?.monto_cambio).toBe(37.5);
		expect(restitucion?.monto_cambio).not.toBe(1500);
	});

	it("un pago sin mora no deja ajuste", () => {
		expect(restitucionMoraDePago({ mora: "0.00" }, 301, "ANULACION")).toBeNull();
		expect(restitucionMoraDePago({ mora: null }, 301, "ANULACION")).toBeNull();
		expect(restitucionMoraDePago({}, 301, "ANULACION")).toBeNull();
	});

	it("anular dos veces no restituye dos veces", () => {
		// El UPDATE que marca el pago pasa igual sobre una fila ya falsa y su
		// `rowCount` no distingue los dos casos: lo único que corta la repetición
		// es haber leído `paymentFalse` antes.
		expect(
			restitucionMoraDePago(
				{ mora: "100.00", paymentFalse: true },
				301,
				"ANULACION",
			),
		).toBeNull();
	});

	it("un pago que no existe no deja ajuste", () => {
		expect(restitucionMoraDePago(undefined, 301, "ANULACION")).toBeNull();
		expect(restitucionMoraDePago(null, 301, "ANULACION")).toBeNull();
	});
});

describe("el pago pendiente que sobrevivió una corrida del cron", () => {
	// La cadena del sobrecobro, verificada en el código:
	//   (a) registrar un pago baja la mora EN EL ACTO — insertPayment llama a
	//       procesarPagoMora → updateMora DECREMENTO antes de insertar la fila,
	//       que nace con validationStatus "pending";
	//   (b) el criterio de cobertura del cron solo cuenta pagos
	//       validated/no_required, así que esa cuota SIGUE contada como vencida
	//       y procesarMoras vuelve a FIJAR la mora completa (REEMPLAZA el monto,
	//       no lo acumula);
	//   (c) la restitución sumaba siempre `pagos_credito.mora`.
	// Las tres juntas dejaban el doble: Q100 → Q0 → Q100 del cron → Q200.

	it("si el cron ya repuso la mora, anular NO vuelve a sumarla", () => {
		expect(
			restitucionMoraDePago(
				{ mora: "100.00", paymentFalse: false },
				301,
				"ANULACION",
				{ moraRepuestaPorElCron: true },
			),
		).toBeNull();
	});

	it("si el cron NO pasó, se restituye completa: el cliente no pagó", () => {
		const restitucion = restitucionMoraDePago(
			{ mora: "100.00", paymentFalse: false },
			301,
			"ANULACION",
			{ moraRepuestaPorElCron: false },
		);
		expect(restitucion?.monto_cambio).toBe(100);
	});

	it("sin decir nada, la regla restituye (no se pierde mora por omisión)", () => {
		// El default importa: si el caller no puede saber si el cron pasó
		// —p. ej. la fila no trae fecha—, el riesgo que se corre es el
		// sobrecobro, que el cron corrige en su próxima corrida; perderle la
		// mora al crédito no lo corrige nadie.
		expect(
			restitucionMoraDePago({ mora: "100.00" }, 301, "ANULACION")?.monto_cambio,
		).toBe(100);
	});
});

describe("CABLEADO: falsePayment anula y restituye en UNA transacción", () => {
	// La regla pura no sirve de nada si nadie la llama, y `payments.ts` no se
	// puede importar en una prueba: varios archivos de la suite registran un
	// `mock.module("./payments")` global y el módulo real deja de estar
	// disponible en una corrida completa. Por eso el cuerpo vive en
	// `controllers/anularPagoMora.ts` —que SÍ se ejerce de verdad, en
	// `anularPagoMora.test.ts`— y lo único que queda por verificar acá es el
	// último eslabón: que `falsePayment` lo llame, y que lo llame ADENTRO de una
	// transacción. Eso se mira sobre el TEXTO, que es lo que esos mocks no
	// pueden tapar.
	const cuerpoFalsePayment = async () => {
		const texto = await Bun.file(
			new URL("../controllers/payments.ts", import.meta.url).pathname,
		).text();
		const desde = texto.indexOf("export async function falsePayment(");
		expect(desde).toBeGreaterThan(-1);
		const hasta = texto.indexOf("\nexport ", desde + 1);
		return texto.slice(desde, hasta === -1 ? undefined : hasta);
	};

	it("delega el cuerpo entero adentro de db.transaction", async () => {
		// La transacción ya no se abre acá: la abre
		// `anularPagoYRestituirMoraSerializado`, que además la envuelve en el
		// advisory lock por crédito —la misma cola que hacen `insertPayment` y
		// `reversePayment`— para que anular y revertir no restituyan la mora
		// cada uno por su lado. `falsePayment` solo la llama.
		const cuerpo = await cuerpoFalsePayment();
		expect(cuerpo).toContain("anularPagoYRestituirMoraSerializado({");

		const texto = await Bun.file(
			new URL("../controllers/anularPagoMora.ts", import.meta.url).pathname,
		).text();
		const desde = texto.indexOf(
			"export async function anularPagoYRestituirMoraSerializado(",
		);
		expect(desde).toBeGreaterThan(-1);
		const cuerpoSerializado = texto.slice(desde);

		// El candado ABRAZA la transacción: si se invirtieran, la otra ruta se
		// cuela entre la lectura del estado y la restitución.
		const lock = cuerpoSerializado.indexOf("deps.withCreditLock(credito_id");
		const tx = cuerpoSerializado.indexOf("deps.runTransaction(");
		const llamada = cuerpoSerializado.indexOf("deps.anular(tx");
		expect(lock).toBeGreaterThan(-1);
		expect(tx).toBeGreaterThan(lock);
		expect(llamada).toBeGreaterThan(tx);
	});

	it("no quedó ningún write suelto fuera de esa transacción", async () => {
		const cuerpo = await cuerpoFalsePayment();
		// Los dos pasos que antes iban sueltos, cada uno con su commit: el UPDATE
		// que marcaba la boleta y la llamada a `updateMora`. Si reaparecen acá
		// —por `db`, fuera de la tx— el agujero vuelve.
		expect(cuerpo).not.toContain("db\n    .update(pagos_credito)");
		expect(cuerpo).not.toContain("await updateMora(");
	});
});

describe("restitucionMoraDePago: la reversa de un pago", () => {
	it("devuelve la mora del pago, marcada con el motivo de reversa", () => {
		const restitucion = restitucionMoraDePago(
			{ mora: "333.95", paymentFalse: false },
			152172,
			"REVERSA",
		);
		expect(restitucion?.monto_cambio).toBe(333.95);
		expect(restitucion?.motivo.startsWith(MOTIVO_REVERSA_MORA_PREFIJO)).toBe(
			true,
		);
		expect(restitucion?.motivo.startsWith(MOTIVO_ANULACION_MORA_PREFIJO)).toBe(
			false,
		);
		expect(restitucion?.motivo).toContain("152172");
	});

	it("si el cron ya repuso la mora, revertir NO vuelve a sumarla", () => {
		// El caso medido en el dump: crédito 980, pago 152172. El pago bajó la
		// mora de 333.95 a 0.00 el 05-ago 20:09 y el cron —que no cuenta los
		// pagos `pending` como cobertura— la volvió a fijar en 333.95 el 06-ago
		// 05:59. Revertir sumaba otros 333.95 y el crédito quedaba en 667.90.
		expect(
			restitucionMoraDePago(
				{ mora: "333.95", paymentFalse: false },
				152172,
				"REVERSA",
				{ moraRepuestaPorElCron: true },
			),
		).toBeNull();
	});

	it("si el cron NO pasó, se restituye completa: el cliente no pagó", () => {
		expect(
			restitucionMoraDePago(
				{ mora: "333.95", paymentFalse: false },
				152172,
				"REVERSA",
				{ moraRepuestaPorElCron: false },
			)?.monto_cambio,
		).toBe(333.95);
	});

	it("sin saber si el cron pasó, restituye (no se pierde mora por omisión)", () => {
		expect(
			restitucionMoraDePago({ mora: "333.95" }, 152172, "REVERSA")
				?.monto_cambio,
		).toBe(333.95);
	});

	it("revertir una boleta YA anulada no restituye de nuevo", () => {
		// La anulación ya le devolvió su mora al crédito; revertir encima la
		// cobraría dos veces.
		expect(
			restitucionMoraDePago(
				{ mora: "333.95", paymentFalse: true },
				152172,
				"REVERSA",
			),
		).toBeNull();
	});
});

describe("UNA SOLA DEFINICIÓN para los dos caminos", () => {
	// Dos reglas que hacen lo mismo se separan con el tiempo, y la que se
	// quedara atrás volvería a sobrecobrarle al cliente. Por eso el MONTO —y el
	// criterio del cron— tienen que salir del mismo lugar; lo único que cambia
	// entre anular y revertir es la marca que queda en el historial.
	const casos: Array<Parameters<typeof restitucionMoraDePago>[0]> = [
		{ mora: "100.00", paymentFalse: false },
		{ mora: "0.00", paymentFalse: false },
		{ mora: null, paymentFalse: false },
		{ mora: "100.00", paymentFalse: true },
		undefined,
	];

	it("el monto restituido es el MISMO para anulación y reversa", () => {
		for (const pago of casos) {
			for (const repuesta of [true, false]) {
				const anulacion = restitucionMoraDePago(pago, 7, "ANULACION", {
					moraRepuestaPorElCron: repuesta,
				});
				const reversa = restitucionMoraDePago(pago, 7, "REVERSA", {
					moraRepuestaPorElCron: repuesta,
				});
				expect(anulacion?.monto_cambio ?? null).toBe(
					reversa?.monto_cambio ?? null,
				);
			}
		}
	});

	it("solo el motivo los distingue, y los dos prefijos son de restitución", () => {
		const anulacion = restitucionMoraDePago({ mora: "100.00" }, 7, "ANULACION");
		const reversa = restitucionMoraDePago({ mora: "100.00" }, 7, "REVERSA");
		expect(anulacion?.motivo).not.toBe(reversa?.motivo);
		for (const restitucion of [anulacion, reversa]) {
			expect(
				MOTIVOS_RESTITUCION_MORA_PREFIJOS.some((prefijo) =>
					restitucion?.motivo.startsWith(prefijo),
				),
			).toBe(true);
		}
	});

	it("nadie se escribió su propia copia de la regla", async () => {
		// Se mira el TEXTO de los dos caminos: es lo que detecta que alguien
		// volvió a decidir el monto por su cuenta (o a consultar el historial del
		// cron con su propio criterio) en vez de llamar a la regla compartida.
		for (const archivo of [
			"anularPagoMora.ts",
			"reversePayment.ts",
		]) {
			const texto = await Bun.file(
				new URL(`../controllers/${archivo}`, import.meta.url).pathname,
			).text();
			expect(texto).toContain("restitucionMoraDePago(");
			expect(texto).toContain("estadoMoraTrasElPago(");
			// Y la marca del decremento anulado tampoco puede quedar en uno solo
			// de los dos caminos: sin ella el reporte cuenta lo repuesto por el
			// cron como mora nueva.
			expect(texto).toContain("marcarDecrementoAnulado(");
			// La suma a ciegas que tenía `reversePayment`.
			expect(texto).not.toContain("monto_cambio: Number(pago.mora)");
			// Y la consulta del historial vive en un solo módulo.
			expect(texto).not.toContain("PROCESO_AUTO");
			// Tampoco el ancla vieja: anclar en `createdat` es el defecto que la
			// marca del decremento vino a arreglar.
			expect(texto).not.toContain("elCronYaRepusoLaMora(");
		}
	});
});
