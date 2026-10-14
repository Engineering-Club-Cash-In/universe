import { describe, expect, it } from "bun:test";
import { filasDocumentos } from "./documentos-caso";

const base = {
	cargandoCatalogo: false,
	motivoSinAcciones: null,
	enviando: null,
	onEnviar: () => undefined,
	onSolicitar: () => undefined,
};

const catalogo = [
	{
		clave: "tarjeta-circulacion",
		nombre: "Tarjeta de circulación",
		descripcion: "Documento vehicular",
		modo: "enviar" as const,
		disponible: true,
	},
	{
		clave: "seguro",
		nombre: "Información de seguro",
		descripcion: "Póliza vigente",
		modo: "enviar" as const,
		disponible: false,
	},
	{
		clave: "contrato",
		nombre: "Contrato de crédito",
		descripcion: "PDF · Documento legal",
		modo: "solicitar" as const,
		disponible: false,
	},
	{
		clave: "expertaje",
		nombre: "Expertaje",
		descripcion: "Avalúo del vehículo",
		modo: "solicitar" as const,
		disponible: true,
	},
];

describe("filasDocumentos", () => {
	it("usa la disponibilidad del catálogo", () => {
		const { enviar, solicitar } = filasDocumentos({ ...base, catalogo });
		expect(enviar.map((d) => d.clave)).toEqual([
			"tarjeta-circulacion",
			"seguro",
		]);
		expect(enviar[0].onClick).toBeDefined();
		expect(enviar[1].onClick).toBeUndefined();
		expect(enviar[1].estado?.etiqueta).toBe("Sin archivo");
		expect(solicitar[0].onClick).toBeUndefined();
		expect(solicitar[0].estado?.etiqueta).toBe("Solicitado");
		expect(solicitar[1].onClick).toBeDefined();
	});

	it("sin catálogo (no se pudo leer) deja actuar con las seis filas", () => {
		const { enviar, solicitar } = filasDocumentos({ ...base, catalogo: null });
		expect(enviar).toHaveLength(2);
		expect(solicitar).toHaveLength(4);
		expect([...enviar, ...solicitar].every((d) => d.onClick)).toBe(true);
	});

	it("mientras carga, o en solo consulta, no hay acciones", () => {
		const cargando = filasDocumentos({
			...base,
			catalogo: undefined,
			cargandoCatalogo: true,
		});
		const consulta = filasDocumentos({
			...base,
			catalogo,
			motivoSinAcciones: "Solo consulta.",
		});
		for (const d of [
			...cargando.enviar,
			...cargando.solicitar,
			...consulta.enviar,
			...consulta.solicitar,
		])
			expect(d.onClick).toBeUndefined();
	});

	it("marca la fila que se está enviando", () => {
		const { enviar } = filasDocumentos({
			...base,
			catalogo,
			enviando: "tarjeta-circulacion",
		});
		expect(enviar[0].cargando).toBe(true);
	});
});
