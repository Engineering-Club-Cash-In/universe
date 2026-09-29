import { describe, expect, it } from "bun:test";
import type { PoolPorAsesorRow } from "../types/cartera-back";
import { asesoresQueTrabaja } from "./acceso-caso-cobro";

const pool: PoolPorAsesorRow[] = [
	{
		asesor_id: 1,
		nombre: "Erik",
		email_cash_in: "erik.r@clubcashin.com",
		activo: true,
		buckets: [4],
	},
	{
		asesor_id: 5,
		nombre: "Jorge",
		email_cash_in: " Jorge.S@ClubCashIn.com ",
		activo: true,
		buckets: [3],
	},
	{
		asesor_id: 8,
		nombre: "Octavio",
		email_cash_in: "octavio.r@clubcashin.com",
		activo: true,
		buckets: [1],
	},
];

const usuarios = [
	{
		id: "u-erik",
		email: "erik.r@clubcashin.com",
		role: "cobros",
		banned: false,
	},
	{
		id: "u-jorge",
		email: "jorge.s@clubcashin.com",
		role: "cobros",
		banned: false,
	},
	{
		id: "u-octavio",
		email: "octavio.r@clubcashin.com",
		role: "cobros",
		banned: false,
	},
];

describe("asesoresQueTrabaja", () => {
	it("el usuario trabaja los créditos de SU asesor de cartera (puente por correo)", () => {
		const r = asesoresQueTrabaja({
			userId: "u-erik",
			emailUsuario: "erik.r@clubcashin.com",
			pool,
			coberturas: [],
			usuarios,
		});
		expect([...r]).toEqual([1]);
	});

	it("el correo se compara sin mayúsculas ni espacios de más", () => {
		const r = asesoresQueTrabaja({
			userId: "u-jorge",
			emailUsuario: "jorge.s@clubcashin.com",
			pool,
			coberturas: [],
			usuarios,
		});
		expect([...r]).toEqual([5]);
	});

	it("sin asesor de cartera con ese correo no trabaja ningún crédito", () => {
		const r = asesoresQueTrabaja({
			userId: "u-x",
			emailUsuario: "nadie@clubcashin.com",
			pool,
			coberturas: [],
			usuarios,
		});
		expect(r.size).toBe(0);
	});

	it("el suplente trabaja además los créditos del titular que cubre hoy", () => {
		const r = asesoresQueTrabaja({
			userId: "u-jorge",
			emailUsuario: "jorge.s@clubcashin.com",
			pool,
			coberturas: [{ titularId: "u-erik", suplenteId: "u-jorge" }],
			usuarios,
		});
		expect([...r].sort()).toEqual([1, 5]);
	});

	it("el titular ausente conserva lo suyo: la cobertura mueve la agenda, no la cartera", () => {
		const r = asesoresQueTrabaja({
			userId: "u-erik",
			emailUsuario: "erik.r@clubcashin.com",
			pool,
			coberturas: [{ titularId: "u-erik", suplenteId: "u-jorge" }],
			usuarios,
		});
		expect([...r]).toEqual([1]);
	});

	it("una cobertura de otros no le suma nada", () => {
		const r = asesoresQueTrabaja({
			userId: "u-octavio",
			emailUsuario: "octavio.r@clubcashin.com",
			pool,
			coberturas: [{ titularId: "u-erik", suplenteId: "u-jorge" }],
			usuarios,
		});
		expect([...r]).toEqual([8]);
	});

	it("un titular sin asesor vinculado no rompe la cobertura del suplente", () => {
		const r = asesoresQueTrabaja({
			userId: "u-jorge",
			emailUsuario: "jorge.s@clubcashin.com",
			pool,
			coberturas: [{ titularId: "u-sin-asesor", suplenteId: "u-jorge" }],
			usuarios,
		});
		expect([...r]).toEqual([5]);
	});
});
