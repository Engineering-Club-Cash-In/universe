import { describe, expect, test } from "bun:test";
import { ContractType, SignerRole } from "../types/contract";
import { identificacionDe } from "./WeeTrustService";

const INVERSION = ContractType.CESION_CREDITOS;

describe("identificacionDe", () => {
	test("en inversiones respeta lo que decidió el CRM para la compra", () => {
		expect(
			identificacionDe(
				{ role: SignerRole.TITULAR, identification: "none" },
				INVERSION,
			),
		).toEqual({});
		expect(
			identificacionDe({ role: SignerRole.TITULAR, identification: "id" }, INVERSION),
		).toEqual({ identification: "id" });
		expect(
			identificacionDe(
				{ role: SignerRole.TITULAR, identification: "face" },
				INVERSION,
			),
		).toEqual({ identification: "face" });
	});

	test("en inversiones sin decisión del CRM pide selfie, como antes", () => {
		expect(identificacionDe({ role: SignerRole.TITULAR }, INVERSION)).toEqual({
			identification: "face",
		});
	});

	test("un valor que WeeTrust no conoce no deja al inversionista sin verificar", () => {
		expect(
			identificacionDe(
				// biome-ignore lint/suspicious/noExplicitAny: lo que mandaría un CRM roto
				{ role: SignerRole.TITULAR, identification: "selfie" as any },
				INVERSION,
			),
		).toEqual({ identification: "face" });
	});

	test("en ventas se ignora: el deudor firma con lo de siempre", () => {
		expect(
			identificacionDe(
				{ role: SignerRole.TITULAR, identification: "none" },
				ContractType.RECONOCIMIENTO_DEUDA,
			),
		).toEqual({ identification: "face" });
		expect(
			identificacionDe(
				{ role: SignerRole.COFIRMANTE, identification: "none" },
				ContractType.RECONOCIMIENTO_DEUDA,
			),
		).toEqual({ identification: "face" });
	});

	test("al representante legal nunca se le pide nada", () => {
		expect(
			identificacionDe(
				{ role: SignerRole.REP_LEGAL, identification: "face" },
				INVERSION,
			),
		).toEqual({});
		expect(
			identificacionDe({ role: SignerRole.REP_LEGAL_RDBE }, INVERSION),
		).toEqual({});
	});
});
