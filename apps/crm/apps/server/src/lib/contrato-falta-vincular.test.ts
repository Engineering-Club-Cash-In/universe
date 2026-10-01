import { describe, expect, test } from "bun:test";
import {
	conMarcaDeFaltaVincular,
	conMarcaDeVinculado,
	documentIdDeWeeTrust,
	faltaVincular,
	vinculadoDesdeWeeTrust,
} from "./contrato-falta-vincular";

const DOC = "6ab565ce3e4e76001f36f6b1";

describe("el documento de WeeTrust desde lo que se pega", () => {
	test("sale del enlace de firma de cualquiera de los firmantes", () => {
		expect(
			documentIdDeWeeTrust(
				`https://app.weetrust.mx/signatory/${DOC}/6ab565d03e4e76001f36f6eb/1790272976203/0d1f30`,
			),
		).toBe(DOC);
	});

	test("y del de observador, con espacios alrededor", () => {
		expect(
			documentIdDeWeeTrust(
				`  https://app.weetrust.mx/observer/${DOC}/6ab565d03e4e76001f36f6ec/0d1f30 `,
			),
		).toBe(DOC);
	});

	test("el ID pelado también sirve", () => {
		expect(documentIdDeWeeTrust(DOC.toUpperCase())).toBe(DOC);
	});

	test("otra dirección de WeeTrust, sólo si trae un único id", () => {
		expect(
			documentIdDeWeeTrust(`https://app.weetrust.mx/documents/${DOC}`),
		).toBe(DOC);
		expect(
			documentIdDeWeeTrust(
				`https://app.weetrust.mx/x/${DOC}/6ab565d03e4e76001f36f6ec`,
			),
		).toBeNull();
	});

	test("lo que no es de WeeTrust no se adivina", () => {
		expect(documentIdDeWeeTrust(`https://otro.com/signatory/${DOC}`)).toBe(DOC);
		expect(
			documentIdDeWeeTrust(`https://otro.com/documents/${DOC}`),
		).toBeNull();
		expect(documentIdDeWeeTrust("hola")).toBeNull();
		expect(documentIdDeWeeTrust("")).toBeNull();
	});
});

describe("marcas del contrato", () => {
	test("falta vincular se lee igual que se escribió", () => {
		const respuesta = conMarcaDeFaltaVincular(
			{ r2Key: "x.pdf", subidoAMano: true },
			{ motivo: "0 líneas", desde: "2026-09-30T10:00:00.000Z" },
		);
		expect(respuesta).toMatchObject({ r2Key: "x.pdf", subidoAMano: true });
		expect(faltaVincular(respuesta)).toEqual({
			motivo: "0 líneas",
			desde: "2026-09-30T10:00:00.000Z",
		});
		expect(faltaVincular({ r2Key: "x.pdf" })).toBeNull();
		expect(faltaVincular(null)).toBeNull();
	});

	test("guarda para quiénes se subió, y descarta lo que no es un firmante", () => {
		const respuesta = conMarcaDeFaltaVincular(
			{},
			{
				motivo: "0 líneas",
				desde: "2026-09-30T10:00:00.000Z",
				firmantes: [
					{ role: "TITULAR", email: "ana@x.com", name: "ANA" },
					{ role: "REP_LEGAL", email: "andres@x.com", name: "ANDRÉS" },
				],
			},
		);
		expect(faltaVincular(respuesta)?.firmantes).toEqual([
			{ role: "TITULAR", email: "ana@x.com", name: "ANA" },
			{ role: "REP_LEGAL", email: "andres@x.com", name: "ANDRÉS" },
		]);
		expect(
			faltaVincular({
				faltaVincular: {
					motivo: "x",
					desde: "2026-09-30T10:00:00.000Z",
					firmantes: [{ role: "TITULAR" }, "basura"],
				},
			})?.firmantes,
		).toBeUndefined();
	});

	test("al vincular se quita el 'falta' y queda quién y qué documento tenía", () => {
		const antes = conMarcaDeFaltaVincular(
			{ r2Key: "x.pdf", subidoAMano: true },
			{ motivo: "0 líneas", desde: "2026-09-30T10:00:00.000Z" },
		);
		const despues = conMarcaDeVinculado(antes, {
			por: "Ana de análisis",
			cuando: "2026-09-30T11:00:00.000Z",
			documentoAnterior: "viejo",
		});

		expect(faltaVincular(despues)).toBeNull();
		expect(despues).toMatchObject({ r2Key: "x.pdf", subidoAMano: true });
		expect(vinculadoDesdeWeeTrust(despues)).toEqual({
			por: "Ana de análisis",
			cuando: "2026-09-30T11:00:00.000Z",
			documentoAnterior: "viejo",
		});
		expect(vinculadoDesdeWeeTrust(antes)).toBeNull();
	});
});
