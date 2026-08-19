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
