import { describe, expect, test } from "bun:test";
import {
	documentIdDesdeLink,
	documentIdDesdeLosEnlaces,
	filasDeFirmantes,
	linksPorRol,
	salioPorDocumenso,
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

describe("contratos de antes de guardar el proveedor", () => {
	const SIN_NADA = {
		signingProvider: null,
		clientSigningLink: null,
		representativeSigningLink: null,
		additionalSigningLinks: null,
	};

	test("uno de WeeTrust recupera su documento del enlace", () => {
		const viejo = {
			...SIN_NADA,
			clientSigningLink:
				"https://app.weetrust.mx/signatory/doc-123/firmante-9/abc/0d1f30",
		};
		expect(salioPorDocumenso(viejo)).toBe(false);
		expect(documentIdDesdeLosEnlaces(viejo)).toBe("doc-123");
	});

	test("uno de Documenso se reconoce por el enlace y no da documento de WeeTrust", () => {
		const viejo = {
			...SIN_NADA,
			clientSigningLink:
				"https://documenso.s2.ejemplo.site/sign/akyMR7PGgJuzddsu0dHsq",
		};
		expect(salioPorDocumenso(viejo)).toBe(true);
		expect(documentIdDesdeLosEnlaces(viejo)).toBeNull();
	});

	test("si el proveedor está guardado, manda el proveedor", () => {
		expect(
			salioPorDocumenso({ ...SIN_NADA, signingProvider: "documenso" }),
		).toBe(true);
		expect(
			salioPorDocumenso({
				...SIN_NADA,
				signingProvider: "weetrust",
				clientSigningLink: "https://documenso.s2.ejemplo.site/sign/x",
			}),
		).toBe(false);
	});

	test("sin enlaces no hay nada que recuperar", () => {
		expect(salioPorDocumenso(SIN_NADA)).toBe(false);
		expect(documentIdDesdeLosEnlaces(SIN_NADA)).toBeNull();
	});
});
