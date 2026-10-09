import { describe, expect, test } from "bun:test";
import {
	asegurarVendedorLegal,
	errorDeCambioDeVendedor,
	errorDeMembresias,
	erroresDeVendedor,
	normalizarDatosVendedor,
	vendedorSigueValido,
} from "./agency-sellers";

// Executor mínimo: cualquier select devuelve estas filas.
function executorCon(filas: Array<{ vendorType: string }>) {
	const nodo = {
		from: () => nodo,
		where: () => nodo,
		for: () => nodo,
		limit: async () => filas,
	};
	return { select: () => nodo } as never;
}

describe("erroresDeVendedor", () => {
	test("un vendedor de agencia exige agencia y correo, pero no DPI", () => {
		expect(erroresDeVendedor({ vendorType: "agencia" })).toEqual([
			{
				path: "companyId",
				message: "Selecciona la agencia o predio del vendedor",
			},
			{
				path: "email",
				message: "El correo es requerido para un vendedor de agencia",
			},
		]);
		expect(
			erroresDeVendedor({
				vendorType: "agencia",
				companyId: "agencia-1",
				email: "vendedor@agencia.com",
			}),
		).toEqual([]);
	});

	test("individual y empresa siguen exigiendo DPI de 13 dígitos", () => {
		expect(erroresDeVendedor({ vendorType: "individual" })).toHaveLength(1);
		expect(erroresDeVendedor({ vendorType: "empresa", dpi: "123" })).toEqual([
			{ path: "dpi", message: "DPI debe tener 13 dígitos" },
		]);
		expect(
			erroresDeVendedor({ vendorType: "individual", dpi: "1234567890123" }),
		).toEqual([]);
	});

	test("si un vendedor de agencia trae DPI, se valida el largo", () => {
		expect(
			erroresDeVendedor({
				vendorType: "agencia",
				companyId: "agencia-1",
				email: "a@b.com",
				dpi: "12",
			}),
		).toEqual([{ path: "dpi", message: "DPI debe tener 13 dígitos" }]);
	});
});

describe("normalizarDatosVendedor", () => {
	test("solo un vendedor de agencia conserva la agencia", () => {
		expect(
			normalizarDatosVendedor({
				vendorType: "individual",
				dpi: "1234567890123",
				companyId: "agencia-1",
			}).companyId,
		).toBeNull();
		expect(
			normalizarDatosVendedor({ vendorType: "agencia", companyId: "agencia-1" })
				.companyId,
		).toBe("agencia-1");
	});

	test("un DPI vacío se guarda como null para no chocar con el UNIQUE", () => {
		expect(
			normalizarDatosVendedor({ vendorType: "agencia", dpi: "  " }).dpi,
		).toBeNull();
	});
});

describe("vendedorSigueValido", () => {
	test("solo sigue si la oportunidad queda en la misma agencia del vendedor", () => {
		expect(vendedorSigueValido("agencia-1", "agencia-1")).toBe(true);
		expect(vendedorSigueValido("agencia-1", "agencia-2")).toBe(false);
		expect(vendedorSigueValido("agencia-1", null)).toBe(false);
		expect(vendedorSigueValido(null, null)).toBe(false);
	});
});

describe("errorDeMembresias", () => {
	const vendedores = [
		{ id: "v1", vendorType: "agencia", companyId: "agencia-1" },
		{ id: "v2", vendorType: "individual", companyId: null },
	];

	test("acepta gerentes y vendedores de su propia agencia", () => {
		expect(
			errorDeMembresias(
				[
					{ companyId: "agencia-1", sellerId: "v1" },
					{ companyId: "agencia-2" },
				],
				vendedores,
			),
		).toBeNull();
	});

	test("rechaza un vendedor de otra agencia", () => {
		expect(
			errorDeMembresias(
				[{ companyId: "agencia-2", sellerId: "v1" }],
				vendedores,
			),
		).toBe("Un vendedor asignado no pertenece a la agencia seleccionada");
	});

	test("rechaza un vendedor que no es de agencia o que no existe", () => {
		expect(
			errorDeMembresias(
				[{ companyId: "agencia-1", sellerId: "v2" }],
				vendedores,
			),
		).not.toBeNull();
		expect(
			errorDeMembresias(
				[{ companyId: "agencia-1", sellerId: "v9" }],
				vendedores,
			),
		).not.toBeNull();
	});

	test("rechaza la misma agencia dos veces", () => {
		expect(
			errorDeMembresias(
				[
					{ companyId: "agencia-1" },
					{ companyId: "agencia-1", sellerId: "v1" },
				],
				vendedores,
			),
		).toBe("Una agencia está repetida en la asignación");
	});
});

describe("asegurarVendedorLegal", () => {
	test("rechaza un vendedor de agencia como vendedor del contrato", async () => {
		await expect(
			asegurarVendedorLegal(executorCon([{ vendorType: "agencia" }]), "v1"),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	test("deja pasar individual, empresa, null y ausente", async () => {
		await asegurarVendedorLegal(
			executorCon([{ vendorType: "individual" }]),
			"v1",
		);
		await asegurarVendedorLegal(executorCon([{ vendorType: "empresa" }]), "v1");
		await asegurarVendedorLegal(executorCon([]), null);
		await asegurarVendedorLegal(executorCon([]), undefined);
	});
});

describe("errorDeCambioDeVendedor", () => {
	const sinUso = { comoVendedorLegal: false, comoVendedorDeAgencia: false };
	const legal = { comoVendedorLegal: true, comoVendedorDeAgencia: false };
	const deAgencia = { comoVendedorLegal: false, comoVendedorDeAgencia: true };
	const individual = { vendorType: "individual", companyId: null };
	const agenciaA = { vendorType: "agencia", companyId: "A" };

	test("no deja convertir en vendedor de agencia a un vendedor legal en uso", () => {
		expect(errorDeCambioDeVendedor(individual, agenciaA, legal)).not.toBeNull();
		expect(
			errorDeCambioDeVendedor(
				{ vendorType: "empresa", companyId: null },
				agenciaA,
				legal,
			),
		).not.toBeNull();
	});

	test("no deja mover de agencia ni cambiar de tipo a un vendedor de agencia en uso", () => {
		expect(
			errorDeCambioDeVendedor(
				agenciaA,
				{ vendorType: "agencia", companyId: "B" },
				deAgencia,
			),
		).not.toBeNull();
		expect(
			errorDeCambioDeVendedor(agenciaA, individual, deAgencia),
		).not.toBeNull();
	});

	test("permite los cambios cuando no hay uso que se rompa", () => {
		expect(errorDeCambioDeVendedor(individual, agenciaA, sinUso)).toBeNull();
		expect(errorDeCambioDeVendedor(agenciaA, individual, sinUso)).toBeNull();
		// individual ↔ empresa no toca el tracker: se sigue permitiendo corregirlo
		expect(
			errorDeCambioDeVendedor(
				individual,
				{ vendorType: "empresa", companyId: null },
				legal,
			),
		).toBeNull();
	});
});
