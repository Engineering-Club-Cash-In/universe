import { describe, expect, test } from "bun:test";
import { changePartnerPasswordInputSchema } from "./tracker";

const base = {
	email: "socio@example.com",
	currentPassword: "temporal123",
	newPassword: "nuevaClave1",
	confirmPassword: "nuevaClave1",
};

describe("changePartnerPasswordInputSchema", () => {
	test("acepta una contraseña nueva válida y distinta de la actual", () => {
		expect(changePartnerPasswordInputSchema.safeParse(base).success).toBe(true);
	});

	test("rechaza reusar la contraseña actual como nueva", () => {
		const resultado = changePartnerPasswordInputSchema.safeParse({
			...base,
			newPassword: base.currentPassword,
			confirmPassword: base.currentPassword,
		});

		expect(resultado.success).toBe(false);
		if (!resultado.success) {
			const issue = resultado.error.issues.find((i) =>
				i.path.includes("newPassword"),
			);
			expect(issue?.message).toBe(
				"La contraseña nueva debe ser distinta de la actual",
			);
		}
	});

	test("rechaza cuando newPassword y confirmPassword no coinciden", () => {
		const resultado = changePartnerPasswordInputSchema.safeParse({
			...base,
			confirmPassword: "otraClave1",
		});

		expect(resultado.success).toBe(false);
		if (!resultado.success) {
			const issue = resultado.error.issues.find((i) =>
				i.path.includes("confirmPassword"),
			);
			expect(issue?.message).toBe("Las contraseñas nuevas no coinciden");
		}
	});

	test("reporta ambos problemas si confirmPassword no coincide y newPassword repite la actual", () => {
		// Caso límite: alguien manda currentPassword=X, newPassword=Y=currentPassword
		// no, y confirmPassword=Z. Verifica que un solo refine fallando no oculte al otro.
		const resultado = changePartnerPasswordInputSchema.safeParse({
			...base,
			newPassword: base.currentPassword,
			confirmPassword: "otraClave1",
		});

		expect(resultado.success).toBe(false);
		if (!resultado.success) {
			const paths = resultado.error.issues.map((i) => i.path.join("."));
			expect(paths).toContain("newPassword");
			expect(paths).toContain("confirmPassword");
		}
	});

	test("el intento de reuso exacto del ejemplo del reporte (los 3 campos iguales) se rechaza", () => {
		// El escenario que reportó Codex: alguien manda la misma temporal en los
		// tres campos. confirmPassword===newPassword pasa su propio refine, pero
		// el de newPassword!==currentPassword debe seguir rechazándolo.
		const resultado = changePartnerPasswordInputSchema.safeParse({
			...base,
			newPassword: base.currentPassword,
			confirmPassword: base.currentPassword,
		});

		expect(resultado.success).toBe(false);
	});

	test("sigue validando el largo mínimo y el formato de email", () => {
		expect(
			changePartnerPasswordInputSchema.safeParse({
				...base,
				newPassword: "corta1",
				confirmPassword: "corta1",
			}).success,
		).toBe(false);

		expect(
			changePartnerPasswordInputSchema.safeParse({
				...base,
				email: "no-es-un-email",
			}).success,
		).toBe(false);
	});
});
