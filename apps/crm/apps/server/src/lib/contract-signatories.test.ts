import { describe, expect, test } from "bun:test";
import {
	documentIdDesdeLink,
	filasDeFirmantes,
	linksPorRol,
} from "./contract-signatories";

describe("linksPorRol", () => {
	test("el rep legal va a su columna aunque no sea el segundo", () => {
		// Este era el bug: con cofirmante, signing_links[1] era del cofirmante y
		// terminaba guardado como link del representante legal.
		const links = linksPorRol(
			[
				{ role: "TITULAR", email: "a@x.com", name: "A", signingUrl: "u/1" },
				{ role: "COFIRMANTE", email: "b@x.com", name: "B", signingUrl: "u/2" },
				{ role: "REP_LEGAL", email: "c@x.com", name: "C", signingUrl: "u/3" },
			],
			["u/1", "u/2", "u/3"],
		);

		expect(links.clientSigningLink).toBe("u/1");
		expect(links.representativeSigningLink).toBe("u/3");
		expect(links.additionalSigningLinks).toEqual(["u/2"]);
	});

	test("sin roles se cae al reparto por posición de antes", () => {
		const links = linksPorRol(undefined, ["u/1", "u/2", "u/3"]);
		expect(links.clientSigningLink).toBe("u/1");
		expect(links.representativeSigningLink).toBe("u/2");
		expect(links.additionalSigningLinks).toEqual(["u/3"]);
	});

	test("un contrato sin firmantes ni links no inventa nada", () => {
		expect(linksPorRol(undefined, undefined)).toEqual({
			clientSigningLink: null,
			representativeSigningLink: null,
			additionalSigningLinks: null,
		});
	});
});

describe("filasDeFirmantes", () => {
	test("deduplica por correo: la tabla tiene único (contrato, email)", () => {
		const filas = filasDeFirmantes("c1", [
			{ role: "TITULAR", email: "a@x.com", name: "A", signingUrl: "u/1" },
			{ role: "COFIRMANTE", email: "a@x.com", name: "A", signingUrl: "u/1" },
		]);
		expect(filas).toHaveLength(1);
		expect(filas[0].role).toBe("TITULAR");
	});

	test("sin firmantes no produce filas", () => {
		expect(filasDeFirmantes("c1", undefined)).toEqual([]);
	});
});

describe("documentIdDesdeLink", () => {
	test("lo saca de un link de firma guardado", () => {
		expect(
			documentIdDesdeLink(
				"https://app.weetrust.mx/signatory/DOC123/SIG456/es?x=1",
			),
		).toBe("DOC123");
	});

	test("devuelve null cuando el link no tiene la forma esperada", () => {
		expect(documentIdDesdeLink("https://app.weetrust.mx/otra/cosa")).toBeNull();
		expect(documentIdDesdeLink(null)).toBeNull();
	});
});
