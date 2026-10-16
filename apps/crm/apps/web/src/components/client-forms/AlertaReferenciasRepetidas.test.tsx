import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	AlertaReferenciasRepetidas,
	AlertaSinVerificar,
	type ReferenciaRepetida,
	ReferenciasPorParticipante,
	tituloDelParticipante,
} from "./AlertaReferenciasRepetidas";

const ref: ReferenciaRepetida = {
	tipo: "familiar",
	indice: 1,
	nombre: "Rosa",
	dpi: "",
	total: 12,
	coincidencias: [
		{
			tipo: "cobros",
			leadId: "lead-1",
			oportunidadId: null,
			clienteNombre: "Ana López",
			referenciaNombre: "Rosa M.",
			parentesco: "padre_madre",
			dadaPor: { nombre: "Ana López", rol: "titular" },
			coincidePor: "dpi",
		},
	],
};
const { coincidencias: _, ...aviso } = ref;

describe("AlertaReferenciasRepetidas", () => {
	test("sin coincidencias no muestra nada", () => {
		expect(
			renderToStaticMarkup(<AlertaReferenciasRepetidas referencias={[]} />),
		).toBe("");
	});

	test("con detalle: el encabezado, cada coincidencia y «y N más»", () => {
		const html = renderToStaticMarkup(
			<AlertaReferenciasRepetidas referencias={[ref]} />,
		);
		expect(html).toContain(
			"La referencia familiar «Rosa» ya aparece como referencia de otros 12 clientes:",
		);
		expect(html).toContain(
			"Ana López — registrada en cobros como «Rosa M.» (Padre/Madre) · coincide por DPI",
		);
		expect(html).toContain("y 11 más");
	});

	test("sin detalle (el servidor no lo manda): solo el aviso, sin nada de otros clientes", () => {
		const html = renderToStaticMarkup(
			<AlertaReferenciasRepetidas referencias={[aviso]} />,
		);
		expect(html).toContain(
			"La referencia familiar «Rosa» ya aparece como referencia de otros 12 clientes.",
		);
		expect(html).not.toContain("Ana López");
		expect(html).not.toContain("y 11 más");
	});

	test("si la búsqueda falló lo dice", () => {
		expect(renderToStaticMarkup(<AlertaSinVerificar />)).toContain(
			"No se pudo verificar si las referencias están repetidas.",
		);
	});
});

describe("ReferenciasPorParticipante", () => {
	test("cada participante con su título y su alerta", () => {
		const html = renderToStaticMarkup(
			<ReferenciasPorParticipante
				participantes={[
					{
						personType: "coDebtor",
						personId: "c9",
						nombre: "Beto Gómez",
						etiqueta: "Co-firmante historico",
						referencias: [aviso],
					},
				]}
			/>,
		);
		expect(html).toContain(
			"Referencias de la solicitud · Co-firmante historico: Beto Gómez",
		);
		expect(html).toContain("ya aparece como referencia de otros 12 clientes.");
	});

	test("título: «Etiqueta: Nombre», o solo la etiqueta si el nombre es la etiqueta", () => {
		expect(
			tituloDelParticipante({ nombre: "Ana López", etiqueta: "Titular" }),
		).toBe("Titular: Ana López");
		expect(
			tituloDelParticipante({
				nombre: "Titular historico",
				etiqueta: "Titular historico",
			}),
		).toBe("Titular historico");
		expect(tituloDelParticipante({ nombre: "", etiqueta: "Titular" })).toBe(
			"Titular",
		);
	});
});
