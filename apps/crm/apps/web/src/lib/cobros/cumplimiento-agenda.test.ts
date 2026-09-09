import { expect, test } from "bun:test";
import { etiquetaEnAgenda, etiquetaMotivoAgenda } from "./cumplimiento-agenda";

test("traduce motivos técnicos de agenda a texto visible", () => {
	expect(etiquetaMotivoAgenda("D-0")).toBe("Pago programado");
	expect(etiquetaMotivoAgenda("sla_hoy")).toBe("Gestión SLA programada");
	expect(etiquetaMotivoAgenda("promesa_hoy")).toBe("Promesa programada");
});

test("distingue en-agenda, fuera-de-agenda y desconocido", () => {
	expect(etiquetaEnAgenda(true)).toBe("En agenda");
	expect(etiquetaEnAgenda(false)).toBe("Fuera de agenda");
	expect(etiquetaEnAgenda(null)).toBe("—");
	expect(etiquetaEnAgenda(undefined)).toBe("—");
});

test("CB-114: una cuenta cubierta dice de quién era la agenda", () => {
	expect(etiquetaEnAgenda(false, "Octavio Rosales")).toBe(
		"En agenda de Octavio Rosales",
	);
	// Sin snapshot propio evaluado, el titular resuelto sigue mandando: que
	// exista un nombre prueba que sí había agenda ese día.
	expect(etiquetaEnAgenda(null, "Octavio Rosales")).toBe(
		"En agenda de Octavio Rosales",
	);
	// La agenda propia gana: si estaba en la suya, no es una cobertura.
	expect(etiquetaEnAgenda(true, "Octavio Rosales")).toBe("En agenda");
	// Titular vacío no debe degradar el mensaje conocido.
	expect(etiquetaEnAgenda(false, null)).toBe("Fuera de agenda");
	expect(etiquetaEnAgenda(false, "")).toBe("Fuera de agenda");
});
