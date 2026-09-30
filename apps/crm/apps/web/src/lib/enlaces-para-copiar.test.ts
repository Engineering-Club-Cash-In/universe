import { describe, expect, test } from "bun:test";
import {
	enlacesPendientesPorPersona,
	mensajeDeEnlaces,
} from "./enlaces-para-copiar";

const firmante = (
	role: string,
	email: string,
	name: string,
	signingUrl: string | null,
	status: "pending" | "signed" = "pending",
) => ({ role, email, name, signingUrl, status });

describe("enlaces para copiar", () => {
	test("junta por persona los que faltan firmar, titular primero y rep legal al final", () => {
		const personas = enlacesPendientesPorPersona([
			{
				nombre: "Pagaré",
				firmantes: [
					firmante("REP_LEGAL", "andres@x.com", "ANDRÉS", "https://w/r1"),
					firmante("TITULAR", "ana@x.com", "ANA", "https://w/t1"),
					firmante("COFIRMANTE", "beto@x.com", "BETO", "https://w/c1"),
				],
			},
			{
				nombre: "Cartas",
				firmantes: [
					firmante("TITULAR", "ANA@x.com", "ANA", "https://w/t2"),
					// Ya firmó: no va.
					firmante(
						"COFIRMANTE",
						"beto@x.com",
						"BETO",
						"https://w/c2",
						"signed",
					),
					// Sin enlace: no hay qué copiar.
					firmante("REP_LEGAL", "andres@x.com", "ANDRÉS", null),
				],
			},
		]);

		expect(personas.map((p) => [p.etiqueta, p.enlaces.length])).toEqual([
			["Cliente", 2],
			["Codeudor 1", 1],
			["Rep. Legal", 1],
		]);
	});

	test("el mensaje lleva a cada persona con sus contratos y enlaces", () => {
		const mensaje = mensajeDeEnlaces([
			{
				clave: "t",
				etiqueta: "Inversionista",
				nombre: "MARIO",
				enlaces: [
					{ contrato: "Cesión", url: "https://w/1" },
					{ contrato: "Anexos", url: "https://w/2" },
				],
			},
			{
				clave: "r",
				etiqueta: "Rep. Legal CUBE",
				nombre: "ANDRÉS",
				enlaces: [{ contrato: "Cesión", url: "https://w/3" }],
			},
		]);

		expect(mensaje).toBe(
			"*MARIO* (Inversionista)\nCesión:\nhttps://w/1\nAnexos:\nhttps://w/2\n\n*ANDRÉS* (Rep. Legal CUBE)\nCesión:\nhttps://w/3",
		);
	});
});
