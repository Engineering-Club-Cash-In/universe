import { describe, expect, test } from "bun:test";
import {
	buscarAsesorCarteraPorEmail,
	filtrarAsesoresAgenda,
	obtenerAgendaAsesor,
	resolverAsesoresAgenda,
} from "./agenda-cobros-source";

describe("resolverAsesoresAgenda", () => {
	test("busca asesor por email_cash_in normalizado", () => {
		expect(
			buscarAsesorCarteraPorEmail(
				[
					{
						asesor_id: 7,
						nombre: "José",
						email_cash_in: " jose@ejemplo.com ",
						activo: true,
						buckets: [0],
					},
				],
				"JOSE@EJEMPLO.COM",
			)?.asesor_id,
		).toBe(7);
	});

	test("cruza email_cash_in normalizado con user.email", () => {
		expect(
			resolverAsesoresAgenda(
				[
					{
						id: "crm-1",
						email: "JOSE@EJEMPLO.COM",
						role: "cobros",
						banned: false,
					},
				],
				[
					{
						asesor_id: 7,
						nombre: "José",
						email_cash_in: " jose@ejemplo.com ",
						activo: true,
						buckets: [0, 1],
					},
				],
			),
		).toEqual([{ userId: "crm-1", asesorCarteraId: 7, nombre: "José" }]);
	});

	test("excluye usuario baneado aunque el email coincida", () => {
		expect(
			resolverAsesoresAgenda(
				[
					{
						id: "crm-1",
						email: "jose@ejemplo.com",
						role: "cobros",
						banned: true,
					},
				],
				[
					{
						asesor_id: 7,
						nombre: "José",
						email_cash_in: "jose@ejemplo.com",
						activo: true,
						buckets: [0, 1],
					},
				],
			),
		).toEqual([]);
	});

	test("excluye usuario con role fuera de cobros/cobros_supervisor/admin", () => {
		expect(
			resolverAsesoresAgenda(
				[
					{
						id: "crm-1",
						email: "jose@ejemplo.com",
						role: "sales",
						banned: false,
					},
				],
				[
					{
						asesor_id: 7,
						nombre: "José",
						email_cash_in: "jose@ejemplo.com",
						activo: true,
						buckets: [0, 1],
					},
				],
			),
		).toEqual([]);
	});
});

test("filtra captura manual al asesor CRM indicado", () => {
	expect(
		filtrarAsesoresAgenda(
			[
				{ userId: "crm-octavio", asesorCarteraId: 8, nombre: "Octavio" },
				{ userId: "crm-ana", asesorCarteraId: 9, nombre: "Ana" },
			],
			"crm-octavio",
		),
	).toEqual([{ userId: "crm-octavio", asesorCarteraId: 8, nombre: "Octavio" }]);
});

describe("obtenerAgendaAsesor", () => {
	test("pagina solo D0: vencimientos de hoy", async () => {
		const llamadas: Array<{ dia: number; page: number }> = [];
		const fetchPage = async (dia: number, page: number) => {
			llamadas.push({ dia, page });
			const data =
				dia === 0 && page === 1
					? [
							{
								numero_credito_sifco: "S-1",
								bucket: 1,
							},
						]
					: dia === 0 && page === 2
						? [
								{
									numero_credito_sifco: "S-2",
									bucket: 2,
								},
							]
						: dia === 3
							? [
									{
										numero_credito_sifco: "S-1",
										bucket: 4,
									},
								]
							: [];
			return {
				data,
				page,
				totalPages: dia === 0 ? 2 : 1,
			};
		};

		const resultado = await obtenerAgendaAsesor(
			{ userId: "crm-1", asesorCarteraId: 7, nombre: "José" },
			fetchPage,
		);

		expect(llamadas).toEqual([
			{ dia: 0, page: 1 },
			{ dia: 0, page: 2 },
		]);
		expect(resultado).toEqual([
			{
				asesorId: "crm-1",
				asesorNombre: "José",
				numeroCreditoSifco: "S-1",
				casoCobroId: null,
				bucketSnapshot: 1,
				motivoAgenda: "D-0",
			},
			{
				asesorId: "crm-1",
				asesorNombre: "José",
				numeroCreditoSifco: "S-2",
				casoCobroId: null,
				bucketSnapshot: 2,
				motivoAgenda: "D-0",
			},
		]);
	});
});
