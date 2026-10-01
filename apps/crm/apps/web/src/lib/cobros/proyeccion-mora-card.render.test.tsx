import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
	debeMostrarProyeccionMora,
	ProyeccionMoraCard,
} from "../../components/cobros/proyeccion-mora-card";

const dia = (
	n: number,
	mora: string,
	incremento: string,
	acumuladoMes: string,
	tipo: "real" | "hoy" | "proyeccion",
	cuotasSumando: number | null,
) => ({
	fecha: `2026-10-${String(n).padStart(2, "0")}`,
	mora,
	incremento,
	acumuladoMes,
	cuotasSumando,
	tipo,
});

const proyeccion = {
	mes: "2026-10",
	hoy: "2026-10-03",
	cargoDiario: "3.73",
	moraInicioMes: "1018.67",
	moraHoy: "1013.73",
	moraFinMes: "1024.93",
	dias: [
		dia(1, "1022.40", "3.73", "3.73", "real", null),
		dia(2, "1013.73", "-8.67", "-4.94", "real", null),
		dia(3, "1017.46", "3.73", "-1.21", "hoy", 2),
		dia(4, "1021.20", "3.74", "2.53", "proyeccion", 2),
		dia(5, "1024.93", "3.73", "6.26", "proyeccion", 1),
	],
};

const pintar = (
	props: Partial<Parameters<typeof ProyeccionMoraCard>[0]> = {},
) =>
	renderToStaticMarkup(
		<ProyeccionMoraCard
			montoEnMora="1013.73"
			cuotasVencidas={2}
			proyeccion={proyeccion}
			{...props}
		/>,
	);

describe("ProyeccionMoraCard", () => {
	test("muestra las tres cifras del mes", () => {
		const html = pintar();
		expect(html).toContain("Proyección de mora del mes");
		expect(html).toMatch(/Mora al iniciar el mes<\/p><p[^>]*>Q1,018\.67</);
		expect(html).toMatch(/Mora hoy<\/p><p[^>]*>Q1,013\.73</);
		expect(html).toMatch(/A fin de mes si no paga<\/p><p[^>]*>Q1,024\.93</);
		expect(html).toContain("suma Q3.73 por día");
	});

	test("abre en hoy, marcado como hoy, y solo deja elegir días del mes", () => {
		const html = pintar();
		expect(html).toContain('value="2026-10-03"');
		expect(html).toContain('min="2026-10-01"');
		expect(html).toContain('max="2026-10-05"');
		expect(html).toMatch(/>Hoy<\//);
		expect(html).toMatch(/Mora estimada ese día<\/p><p[^>]*>Q1,017\.46</);
		expect(html).toMatch(/Sube ese día<\/p><p[^>]*>\+Q3\.73</);
		expect(html).toMatch(/Acumulado desde el día 1<\/p><p[^>]*>−Q1\.21</);
		expect(html).toMatch(/Cuotas que siguen sumando<\/p><p[^>]*>2</);
	});

	test("un día pasado se muestra como real, con la baja del pago y sin cuotas sumando", () => {
		const html = pintar({ diaInicial: "2026-10-02" });
		expect(html).toContain('value="2026-10-02"');
		expect(html).toMatch(/>Real<\//);
		expect(html).not.toMatch(/>Hoy<\//);
		expect(html).toMatch(/Mora al cierre de ese día<\/p><p[^>]*>Q1,013\.73</);
		expect(html).toMatch(
			/Bajó ese día<\/p><p[^>]*text-green-600[^>]*>−Q8\.67</,
		);
		expect(html).toMatch(/Cuotas que siguen sumando<\/p><p[^>]*>—</);
	});

	test("un día futuro se muestra como proyección", () => {
		const html = pintar({ diaInicial: "2026-10-05" });
		expect(html).toMatch(/>Proyección<\//);
		expect(html).toMatch(/Mora estimada ese día<\/p><p[^>]*>Q1,024\.93</);
		expect(html).toMatch(/Acumulado desde el día 1<\/p><p[^>]*>\+Q6\.26</);
		expect(html).toMatch(/Cuotas que siguen sumando<\/p><p[^>]*>1</);
	});

	test("un día fuera del mes cae en hoy", () => {
		expect(pintar({ diaInicial: "2026-11-02" })).toContain(
			'value="2026-10-03"',
		);
	});

	test("no se muestra si no hay mora ni cuotas vencidas", () => {
		expect(pintar({ montoEnMora: "0.00", cuotasVencidas: 0 })).toBe("");
		expect(pintar({ montoEnMora: null, cuotasVencidas: null })).toBe("");
		expect(
			debeMostrarProyeccionMora({ montoEnMora: "0.00", cuotasVencidas: 0 }),
		).toBe(false);
		// Mora en cero pero con cuotas vencidas: mañana vuelve a subir.
		expect(
			debeMostrarProyeccionMora({ montoEnMora: "0.00", cuotasVencidas: 1 }),
		).toBe(true);
		expect(
			debeMostrarProyeccionMora({ montoEnMora: "5.00", cuotasVencidas: 0 }),
		).toBe(true);
	});

	test("cargando y con error no inventa cifras", () => {
		const cargando = pintar({ proyeccion: undefined, isLoading: true });
		expect(cargando).toContain("animate-pulse");
		expect(cargando).not.toContain("Mora hoy");
		const error = pintar({ proyeccion: undefined, isError: true });
		expect(error).toContain("No se pudo cargar la proyección de mora.");
		expect(error).not.toContain("Mora hoy");
	});
});

describe("pantalla del caso de cobros", () => {
	const fuente = readFileSync(
		new URL("../../routes/cobros/$id.tsx", import.meta.url),
		"utf8",
	);

	test("la tarjeta va debajo de «Información del Caso» y antes de «Información de Contacto»", () => {
		const caso = fuente.indexOf("Información del Caso");
		const tarjeta = fuente.indexOf("<ProyeccionMoraCard");
		const contacto = fuente.indexOf("{/* Información de Contacto */}");
		expect(caso).toBeGreaterThan(-1);
		expect(tarjeta).toBeGreaterThan(caso);
		expect(contacto).toBeGreaterThan(tarjeta);
	});

	test("solo consulta la proyección cuando la tarjeta se va a mostrar", () => {
		const consulta = fuente.slice(
			fuente.indexOf("orpc.getProyeccionMoraCarteraBack.queryOptions"),
			fuente.indexOf("// Obtener historial de contactos"),
		);
		expect(consulta).toContain(
			"numeroSifco: casoDetails.data?.numeroCreditoSifco",
		);
		expect(consulta).toContain("debeMostrarProyeccionMora(casoDetails.data)");
	});
});
