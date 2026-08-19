import { expect, mock, test } from "bun:test";

const getCuotasProximasVencer = mock(async () => {
	throw new Error("cartera-back no disponible");
});
const getColaDiaSLA = mock(async () => {
	throw new Error("cartera-back no disponible");
});

mock.module("../db", () => ({
	db: {
		select: () => ({
			from: () =>
				Promise.resolve([
					{
						id: "asesor-crm-1",
						email: "asesor@cashin.com",
						role: "cobros",
						banned: false,
					},
				]),
		}),
	},
}));

mock.module("./cartera-back-client", () => ({
	carteraBackClient: {
		getPoolPorAsesor: mock(async () => [
			{
				asesor_id: 7,
				nombre: "Asesor",
				email_cash_in: "asesor@cashin.com",
				buckets: [0],
			},
		]),
		getCuotasProximasVencer,
		getColaDiaSLA,
	},
}));

const { obtenerAgendaTodosAsesores } = await import("./agenda-cobros-source");

test("aborta captura cuando asesor falla también en reintento final", async () => {
	await expect(
		obtenerAgendaTodosAsesores(undefined, "2026-08-19"),
	).rejects.toThrow("asesor-crm-1");
	expect(getCuotasProximasVencer).toHaveBeenCalledTimes(2);
	expect(getColaDiaSLA).toHaveBeenCalledTimes(2);
});
