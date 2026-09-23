import { describe, expect, it } from "bun:test";
import {
	MOTIVOS_RESTITUCION_MORA_PREFIJOS,
	MOTIVO_ANULACION_MORA_PREFIJO,
	MOTIVO_REVERSA_MORA_PREFIJO,
} from "./motivoReversaMora";
import { restitucionMoraDePagoAnulado } from "./restitucionMoraPagoAnulado";

describe("restitucionMoraDePagoAnulado", () => {
	it("devuelve la mora del pago, marcada con el motivo de anulación", () => {
		const restitucion = restitucionMoraDePagoAnulado(
			{ mora: "100.00", paymentFalse: false },
			301,
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
		const restitucion = restitucionMoraDePagoAnulado({ mora: "100.00" }, 301);
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
		const restitucion = restitucionMoraDePagoAnulado(
			{ mora: "37.50", paymentFalse: false, monto_boleta: "1500.00" } as never,
			301,
		);
		expect(restitucion?.monto_cambio).toBe(37.5);
		expect(restitucion?.monto_cambio).not.toBe(1500);
	});

	it("un pago sin mora no deja ajuste", () => {
		expect(restitucionMoraDePagoAnulado({ mora: "0.00" }, 301)).toBeNull();
		expect(restitucionMoraDePagoAnulado({ mora: null }, 301)).toBeNull();
		expect(restitucionMoraDePagoAnulado({}, 301)).toBeNull();
	});

	it("anular dos veces no restituye dos veces", () => {
		// El UPDATE que marca el pago pasa igual sobre una fila ya falsa y su
		// `rowCount` no distingue los dos casos: lo único que corta la repetición
		// es haber leído `paymentFalse` antes.
		expect(
			restitucionMoraDePagoAnulado({ mora: "100.00", paymentFalse: true }, 301),
		).toBeNull();
	});

	it("un pago que no existe no deja ajuste", () => {
		expect(restitucionMoraDePagoAnulado(undefined, 301)).toBeNull();
		expect(restitucionMoraDePagoAnulado(null, 301)).toBeNull();
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
			restitucionMoraDePagoAnulado({ mora: "100.00", paymentFalse: false }, 301, {
				moraRepuestaPorElCron: true,
			}),
		).toBeNull();
	});

	it("si el cron NO pasó, se restituye completa: el cliente no pagó", () => {
		const restitucion = restitucionMoraDePagoAnulado(
			{ mora: "100.00", paymentFalse: false },
			301,
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
			restitucionMoraDePagoAnulado({ mora: "100.00" }, 301)?.monto_cambio,
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
		const cuerpo = await cuerpoFalsePayment();
		const tx = cuerpo.indexOf("await db.transaction((tx) =>");
		expect(tx).toBeGreaterThan(-1);
		const llamada = cuerpo.indexOf("anularPagoYRestituirMora(tx");
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
