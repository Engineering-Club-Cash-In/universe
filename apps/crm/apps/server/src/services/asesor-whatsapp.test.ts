import { describe, expect, mock, test } from "bun:test";
import { resolverContactoAsesor } from "./asesor-whatsapp";

describe("resolverContactoAsesor", () => {
	test("prioriza contacto completo recibido sin consultar cartera", async () => {
		const obtener = mock(async () => ({
			nombre: "Ignorado",
			telefono: "00000000",
		}));

		const contacto = await resolverContactoAsesor(
			"SIFCO-001",
			{ nombre: "  Carlos Ruiz  ", telefono: " 41234567 " },
			obtener,
		);

		expect(contacto).toEqual({ nombre: "Carlos Ruiz", telefono: "41234567" });
		expect(obtener).not.toHaveBeenCalled();
	});

	test("contacto preferido incompleto usa asesor del resumen", async () => {
		const contacto = await resolverContactoAsesor(
			"SIFCO-001",
			{ nombre: "Carlos", telefono: null },
			async () => ({ nombre: "Ana Pérez", telefono: "49998888" }),
		);

		expect(contacto).toEqual({ nombre: "Ana Pérez", telefono: "49998888" });
	});

	test("asesor incompleto o fallo de cartera devuelve null", async () => {
		await expect(
			resolverContactoAsesor("SIFCO-001", null, async () => ({
				nombre: "Ana Pérez",
				telefono: null,
			})),
		).resolves.toBeNull();
		await expect(
			resolverContactoAsesor("SIFCO-001", null, async () => {
				throw new Error("cartera caída");
			}),
		).resolves.toBeNull();
	});
});
