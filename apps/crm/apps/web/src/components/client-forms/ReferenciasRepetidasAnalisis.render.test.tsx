import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { orpc } from "@/utils/orpc";
import { ReferenciasRepetidasAnalisis } from "./ReferenciasRepetidasAnalisis";

const OPP = "22222222-2222-4222-8222-222222222222";
const opciones = () =>
	orpc.getReferenciasRepetidas.queryOptions({ input: { opportunityId: OPP } });

const referencia = {
	tipo: "personal",
	indice: 0,
	nombre: "Rosa",
	dpi: "",
	total: 1,
	coincidencias: [
		{
			tipo: "personal",
			leadId: "otro",
			oportunidadId: "opp-otro",
			clienteNombre: "Ana López",
			referenciaNombre: "Rosa M.",
			parentesco: "tía",
			dadaPor: { nombre: "Carlos Pérez", rol: "codeudor" },
			coincidePor: "dpi",
		},
	],
};
const alerta = (participantes: unknown[], extra = {}) => ({
	nivel: "detalle",
	error: false,
	participantes,
	...extra,
});

function pintar(preparar: (queryClient: QueryClient) => void = () => {}) {
	const queryClient = new QueryClient({
		// Sin reintento al montar: así se ve el estado de error que quedó en caché.
		defaultOptions: { queries: { retry: false, retryOnMount: false } },
	});
	preparar(queryClient);
	return renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
			<ReferenciasRepetidasAnalisis opportunityId={OPP} />
		</QueryClientProvider>,
	);
}
const conDatos = (datos: unknown) =>
	pintar((q) => q.setQueryData(opciones().queryKey, datos as never));

describe("ReferenciasRepetidasAnalisis", () => {
	test("pinta un bloque por participante, en el orden del servidor, con su etiqueta y nombre", () => {
		const html = conDatos(
			alerta([
				{
					personType: "lead",
					personId: "l1",
					nombre: "Pedro Titular",
					etiqueta: "Titular",
					referencias: [referencia],
				},
				{
					personType: "coDebtor",
					personId: "c1",
					nombre: "Co-firmante historico",
					etiqueta: "Co-firmante historico",
					referencias: [referencia],
				},
			]),
		);
		const titular = html.indexOf(
			"Referencias de la solicitud · Titular: Pedro Titular",
		);
		expect(titular).toBeGreaterThan(-1);
		expect(
			html.indexOf("Referencias de la solicitud · Co-firmante historico"),
		).toBeGreaterThan(titular);
		expect(html).not.toContain("Co-firmante historico: Co-firmante historico");
		expect(html).toContain(
			"Ana López — en su solicitud la dio su codeudor Carlos Pérez como referencia personal «Rosa M.» (tía) · coincide por DPI",
		);
	});

	test("sin detalle muestra solo el aviso", () => {
		const { coincidencias: _, ...aviso } = referencia;
		const html = conDatos(
			alerta(
				[
					{
						personType: "lead",
						personId: "l1",
						nombre: "Pedro Titular",
						etiqueta: "Titular",
						referencias: [aviso],
					},
				],
				{ nivel: "aviso" },
			),
		);
		expect(html).toContain(
			"La referencia personal «Rosa» ya aparece como referencia de otro cliente.",
		);
		expect(html).not.toContain("Ana López");
	});

	test("no pinta nada sin coincidencias, sin permiso (null) ni mientras carga", () => {
		expect(conDatos(alerta([]))).toBe("");
		expect(conDatos(null)).toBe("");
		expect(pintar()).toBe("");
	});

	test("si el servidor no pudo verificar, o la consulta falló, lo dice", () => {
		const texto = "No se pudo verificar si las referencias están repetidas.";
		expect(conDatos(alerta([], { error: true }))).toContain(texto);
		const fallida = pintar((q) =>
			q
				.getQueryCache()
				.build(q, opciones())
				.setState({ status: "error", error: new Error("boom") }),
		);
		expect(fallida).toContain(texto);
	});

	test("la consulta se queda fresca cinco minutos", () => {
		const queryClient = new QueryClient();
		renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<ReferenciasRepetidasAnalisis opportunityId={OPP} />
			</QueryClientProvider>,
		);
		const consulta = queryClient
			.getQueryCache()
			.find({ queryKey: opciones().queryKey });
		expect((consulta?.options as { staleTime?: number }).staleTime).toBe(
			5 * 60 * 1000,
		);
	});
});
