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

describe("CABLEADO: falsePayment usa la regla y la manda a updateMora", () => {
	// La regla pura no sirve de nada si nadie la llama, y `payments.ts` no se
	// puede importar en una prueba: varios archivos de la suite registran un
	// `mock.module("./payments")` global y el módulo real deja de estar
	// disponible en una corrida completa. Así que el cableado se verifica sobre
	// el TEXTO de `falsePayment`, que es lo que esas pruebas no pueden tapar.
	const cuerpoFalsePayment = async () => {
		const texto = await Bun.file(
			new URL("../controllers/payments.ts", import.meta.url).pathname,
		).text();
		const desde = texto.indexOf("export async function falsePayment(");
		expect(desde).toBeGreaterThan(-1);
		const hasta = texto.indexOf("\nexport ", desde + 1);
		return texto.slice(desde, hasta === -1 ? undefined : hasta);
	};

	it("lee la fila del pago, consulta la regla y pasa su resultado a updateMora", async () => {
		const cuerpo = await cuerpoFalsePayment();
		// Lee `mora` y `paymentFalse` ANTES de marcar la boleta.
		expect(cuerpo).toContain("mora: pagos_credito.mora");
		expect(cuerpo).toContain("paymentFalse: pagos_credito.paymentFalse");
		// Y le entrega esa fila a la regla, cuyo resultado viaja entero.
		expect(cuerpo).toContain("restitucionMoraDePagoAnulado(pagoPrevio, pago_id)");
		expect(cuerpo).toContain("...restitucionMora");
		expect(cuerpo).toContain('tipo: "INCREMENTO"');
		expect(cuerpo).toContain("await updateMora(");
		// Un fallo al restituir no se traga: el crédito no puede quedar sin su mora.
		expect(cuerpo).toContain("Error al restituir la mora del pago anulado");
	});
});
