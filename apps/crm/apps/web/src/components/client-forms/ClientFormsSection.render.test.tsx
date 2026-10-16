import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { ClientFormsSection } from "./ClientFormsSection";

const OPP = "11111111-1111-4111-8111-111111111111";

function tarjeta(personId: string, nombre: string) {
	return {
		personType: "lead",
		personId,
		displayName: nombre,
		roleLabel: "Titular",
		email: null,
		phone: null,
		canGenerateLink: true,
		latestToken: null,
		creditApplication: null,
		financialStatement: null,
		creditApplicationExists: false,
		creditHasSignature: false,
		financialStatementExists: false,
	};
}

function pintar(participants: unknown[], alertaReferencias: unknown) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	queryClient.setQueryData(["clientFormData", OPP], {
		opportunityId: OPP,
		vehicle: null,
		participants,
		alertaReferencias,
	});
	// Render del servidor con los datos ya en el caché: sin DOM global ni red.
	return renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
			<ClientFormsSection opportunityId={OPP} />
		</QueryClientProvider>,
	);
}

const repetida = {
	tipo: "familiar",
	indice: 0,
	nombre: "Rosa",
	dpi: "",
	total: 1,
	coincidencias: [
		{
			tipo: "cobros",
			leadId: "otro-lead",
			oportunidadId: null,
			clienteNombre: "Ana López",
			referenciaNombre: "Rosa M.",
			parentesco: "tio_a",
			dadaPor: { nombre: "Ana López", rol: "titular" },
			coincidePor: "telefono",
		},
	],
};
type ParticipanteDeAlerta = {
	personId: string;
	personType?: string;
	nombre?: string;
	etiqueta?: string;
	referencias: unknown[];
};
const alerta = (
	participantes: ParticipanteDeAlerta[],
	extra: Record<string, unknown> = {},
) => ({
	nivel: "detalle",
	error: false,
	participantes: participantes.map((p) => ({
		personType: "lead",
		nombre: "",
		etiqueta: "Titular",
		...p,
	})),
	...extra,
});

describe("ClientFormsSection: alerta de referencias repetidas", () => {
	test("pinta la alerta en la tarjeta del participante que tiene coincidencias", () => {
		const html = pintar(
			[tarjeta("p1", "Pedro Titular"), tarjeta("p2", "Carla Codeudora")],
			alerta([{ personId: "p2", referencias: [repetida] }]),
		);
		expect(html).toContain(
			"La referencia familiar «Rosa» ya aparece como referencia de otro cliente:",
		);
		expect(html).toContain(
			"Ana López — registrada en cobros como «Rosa M.» (Tío/a) · coincide por teléfono",
		);
		expect(html.match(/ya aparece como referencia de/g)).toHaveLength(1);
		// dentro de la tarjeta de Carla, no de Pedro
		expect(html.indexOf("ya aparece como referencia de")).toBeGreaterThan(
			html.indexOf("Carla Codeudora"),
		);
	});

	test("sin coincidencias, o sin permiso para la alerta (null), no pinta nada de ella", () => {
		for (const sinNada of [alerta([]), null]) {
			const html = pintar([tarjeta("p1", "Pedro Titular")], sinNada);
			expect(html).toContain("Pedro Titular");
			expect(html).not.toContain("ya aparece como referencia de");
			expect(html).not.toContain("No se pudo verificar");
		}
	});

	test("sin detalle, la tarjeta muestra solo el aviso", () => {
		const { coincidencias: _, ...aviso } = repetida;
		const html = pintar(
			[tarjeta("p1", "Pedro Titular")],
			alerta([{ personId: "p1", referencias: [aviso] }], { nivel: "aviso" }),
		);
		expect(html).toContain(
			"La referencia familiar «Rosa» ya aparece como referencia de otro cliente.",
		);
		expect(html).not.toContain("Ana López");
	});

	test("si la búsqueda falló, lo dice", () => {
		const html = pintar(
			[tarjeta("p1", "Pedro Titular")],
			alerta([], { error: true }),
		);
		expect(html).toContain(
			"No se pudo verificar si las referencias están repetidas.",
		);
	});

	test("quien ya no tiene tarjeta (codeudor borrado sin enlace) aparece aparte, con quién es", () => {
		const html = pintar(
			[tarjeta("p1", "Pedro Titular")],
			alerta([
				{
					personType: "coDebtor",
					personId: "borrado",
					nombre: "Beto Gómez",
					etiqueta: "Co-firmante historico",
					referencias: [repetida],
				},
			]),
		);
		expect(html).toContain(
			"Referencias de la solicitud · Co-firmante historico: Beto Gómez",
		);
		expect(html).toContain("ya aparece como referencia de otro cliente:");
	});
});
