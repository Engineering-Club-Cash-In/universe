import { describe, expect, test } from "bun:test";
import type { EstadoDocumentoFirma } from "../services/legal-docs-api";
import {
	type FirmanteEsperado,
	guiaParaVincular,
	revisarDocumento,
} from "./vincular-documento-weetrust";

const ESPERADOS: FirmanteEsperado[] = [
	{ role: "TITULAR", email: "ana@x.com", name: "ANA" },
	{ role: "COFIRMANTE", email: "beto@x.com", name: "BETO" },
	{ role: "REP_LEGAL", email: "andres@x.com", name: "ANDRÉS" },
];

const firmante = (emailID: string, isSigned = false) => ({
	emailID,
	name: `nombre en WeeTrust de ${emailID}`,
	signatoryID: `id-${emailID}`,
	isSigned,
	signingUrl: `https://app.weetrust.mx/signatory/doc/id-${emailID}/1/x`,
	expiry: null as number | null,
});

const estado = (
	signatories: ReturnType<typeof firmante>[],
	status = "PENDING",
): EstadoDocumentoFirma => ({
	success: true,
	documentID: "doc",
	status,
	signatories,
});

describe("revisar el documento que se va a vincular", () => {
	test("empareja por correo, sin importar mayúsculas, con el nombre del CRM", () => {
		const revision = revisarDocumento(
			ESPERADOS,
			estado([
				firmante("ANDRES@x.com"),
				firmante("ana@x.com", true),
				firmante("beto@x.com"),
			]),
		);

		expect(revision.problema).toBeNull();
		expect(revision.faltan).toEqual([]);
		expect(revision.enviados.map((f) => [f.role, f.email, f.name])).toEqual([
			["REP_LEGAL", "andres@x.com", "ANDRÉS"],
			["TITULAR", "ana@x.com", "ANA"],
			["COFIRMANTE", "beto@x.com", "BETO"],
		]);
		expect(revision.firmantes.find((f) => f.role === "TITULAR")?.firmo).toBe(
			true,
		);
	});

	test("lleva lo que dijo WeeTrust: quién ya firmó y cuándo vence su enlace", () => {
		const revision = revisarDocumento(
			ESPERADOS,
			estado([
				{ ...firmante("ana@x.com", true), expiry: 1_792_864_976_203 },
				firmante("andres@x.com"),
			]),
		);

		expect(revision.enviados.map((f) => [f.email, f.firmo, f.expiry])).toEqual([
			["ana@x.com", true, 1_792_864_976_203],
			["andres@x.com", false, null],
		]);
	});

	test("que falte un codeudor se avisa pero no impide", () => {
		const revision = revisarDocumento(
			ESPERADOS,
			estado([firmante("ana@x.com"), firmante("andres@x.com")]),
		);

		expect(revision.problema).toBeNull();
		expect(revision.faltan.map((f) => f.role)).toEqual(["COFIRMANTE"]);
	});

	test("sin el titular no se vincula", () => {
		const revision = revisarDocumento(
			ESPERADOS,
			estado([firmante("beto@x.com"), firmante("andres@x.com")]),
		);
		expect(revision.problema).toMatch(/no está ANA/);
	});

	test("alguien que no es del contrato lo impide, y se dice quién", () => {
		const revision = revisarDocumento(
			ESPERADOS,
			estado([firmante("ana@x.com"), firmante("intruso@x.com")]),
		);
		expect(revision.desconocidos).toEqual(["intruso@x.com"]);
		expect(revision.problema).toMatch(/intruso@x\.com/);
	});

	test("un borrador todavía no se mandó a firmar", () => {
		const revision = revisarDocumento(
			ESPERADOS,
			estado([firmante("ana@x.com")], "DRAFT"),
		);
		expect(revision.problema).toMatch(/borrador/);
	});
});

describe("la guía para armarlo en WeeTrust", () => {
	test("a los representantes nunca se les pide verificación", () => {
		expect(
			guiaParaVincular(ESPERADOS, "Selfie y DPI").map((f) => [
				f.role,
				f.verificacion,
			]),
		).toEqual([
			["TITULAR", "Selfie y DPI"],
			["COFIRMANTE", "Selfie y DPI"],
			["REP_LEGAL", "Ninguna"],
		]);
	});
});
