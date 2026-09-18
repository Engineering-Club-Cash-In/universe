import { describe, expect, it, spyOn } from "bun:test";
import { carteraBackClient } from "../services/cartera-back-client";
import { resolverSifcosPermitidosPagalo } from "./pagalo-supervision";

describe("resolverSifcosPermitidosPagalo", () => {
	it("no consulta cartera-back si el usuario ve todo y no filtra por asesor", async () => {
		const spyPool = spyOn(carteraBackClient, "getPoolPorAsesor");
		spyPool.mockClear();

		const resultado = await resolverSifcosPermitidosPagalo({
			userRole: "cobros_supervisor",
			userEmail: "supervisor@clubcashin.com",
		});

		expect(resultado.forbidden).toBe(false);
		expect(resultado.sifcosPermitidos).toBeNull();
		expect(resultado.bucketsAsignados).toBeNull();
		expect(resultado.asesorSeleccionado).toBeNull();
		expect(spyPool).not.toHaveBeenCalled();
	});

	it("rechaza con forbidden si un rol cobros intenta filtrar por otro asesor", async () => {
		const spyPool = spyOn(carteraBackClient, "getPoolPorAsesor");
		spyPool.mockClear();

		const resultado = await resolverSifcosPermitidosPagalo(
			{
				userRole: "cobros",
				userEmail: "asesor@clubcashin.com",
			},
			10,
		);

		expect(resultado.forbidden).toBe(true);
		expect(resultado.sifcosPermitidos).toBeNull();
		expect(resultado.bucketsAsignados).toBeNull();
		expect(resultado.asesorSeleccionado).toBeNull();
		expect(spyPool).not.toHaveBeenCalled();
	});

	it("reutiliza el catálogo de pool para resolver scope y metadatos con una sola llamada", async () => {
		const spyPool = spyOn(carteraBackClient, "getPoolPorAsesor").mockResolvedValueOnce([
			{
				asesor_id: 15,
				nombre: "Juan Perez",
				email_cash_in: "juan@clubcashin.com",
				activo: true,
				buckets: [1, 2],
			},
		]);
		const spySifcos = spyOn(
			carteraBackClient,
			"getSifcosPoolAutoritativos",
		).mockResolvedValueOnce({
			data: ["1001", "1002"],
		});

		const resultado = await resolverSifcosPermitidosPagalo(
			{
				userRole: "admin",
				userEmail: "admin@clubcashin.com",
			},
			15,
		);

		expect(resultado.forbidden).toBe(false);
		expect(resultado.sifcosPermitidos).toEqual(new Set(["1001", "1002"]));
		expect(resultado.bucketsAsignados).toEqual([1, 2]);
		expect(resultado.asesorSeleccionado).toEqual({
			asesorId: 15,
			nombre: "Juan Perez",
		});
		expect(spyPool).toHaveBeenCalledTimes(1);
		expect(spySifcos).toHaveBeenCalledTimes(1);
	});
});

describe("camposFiltroSupervision - incluirKpis", () => {
	it("asigna true por defecto a incluirKpis cuando se omite", async () => {
		const { camposFiltroSupervision } = await import(
			"../lib/pagalo-supervision-consulta"
		);
		const { z } = await import("zod");
		const esquema = z.object(camposFiltroSupervision);

		const parseado = esquema.parse({});
		expect(parseado.incluirKpis).toBe(true);
	});

	it("acepta incluirKpis: false explícito", async () => {
		const { camposFiltroSupervision } = await import(
			"../lib/pagalo-supervision-consulta"
		);
		const { z } = await import("zod");
		const esquema = z.object(camposFiltroSupervision);

		const parseado = esquema.parse({ incluirKpis: false });
		expect(parseado.incluirKpis).toBe(false);
	});
});
