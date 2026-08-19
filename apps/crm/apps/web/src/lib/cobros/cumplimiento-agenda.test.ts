import { expect, test } from "bun:test";
import { etiquetaMotivoAgenda } from "./cumplimiento-agenda";

test("traduce motivos técnicos de agenda a texto visible", () => {
	expect(etiquetaMotivoAgenda("D-0")).toBe("Pago programado");
	expect(etiquetaMotivoAgenda("sla_hoy")).toBe("Gestión SLA programada");
	expect(etiquetaMotivoAgenda("promesa_hoy")).toBe("Promesa programada");
});
