import { describe, expect, test } from "bun:test";
import {
	puedeAccederDetalleBuro,
	puedeMarcarValidacionManualDetalleBuro,
	puedeReejecutarDetalleBuro,
} from "./permiso-detalle-buro";

const expediente = {
	userRole: "sales",
	userId: "asesor-a",
	assignedTo: "asesor-a",
	porcentaje: 20,
	status: "open",
};

describe("acceso al detalle de Buró", () => {
	test("el asesor asignado puede ver el estudio durante toda la oportunidad", () => {
		expect(puedeAccederDetalleBuro(expediente)).toBe(true);
	});

	test("un asesor ajeno no ve ni re-ejecuta el estudio", () => {
		const ajeno = { ...expediente, userId: "asesor-b" };
		expect(puedeAccederDetalleBuro(ajeno)).toBe(false);
		expect(puedeReejecutarDetalleBuro(ajeno)).toBe(false);
	});

	test("re-ejecutar solo se permite al 20% abierto", () => {
		expect(puedeReejecutarDetalleBuro(expediente)).toBe(true);
		for (const porcentaje of [1, 10, 30, 40, 50, 100]) {
			expect(puedeReejecutarDetalleBuro({ ...expediente, porcentaje })).toBe(
				false,
			);
		}
		expect(puedeReejecutarDetalleBuro({ ...expediente, status: "lost" })).toBe(
			false,
		);
	});

	test("Análisis conserva la lectura, pero tampoco re-ejecuta desde el 30%", () => {
		for (const userRole of ["admin", "analyst", "sales_supervisor"]) {
			expect(puedeAccederDetalleBuro({ ...expediente, userRole })).toBe(true);
			expect(
				puedeReejecutarDetalleBuro({
					...expediente,
					userRole,
					porcentaje: 30,
				}),
			).toBe(false);
		}
	});

	test("el 30% permite reconsulta solo cuando hay una excepción registrada", () => {
		expect(
			puedeReejecutarDetalleBuro({
				...expediente,
				porcentaje: 30,
				buroRevalidacionAl30: true,
			}),
		).toBe(true);
		expect(
			puedeReejecutarDetalleBuro({
				...expediente,
				porcentaje: 40,
				buroRevalidacionAl30: true,
			}),
		).toBe(false);
		expect(
			puedeReejecutarDetalleBuro({
				...expediente,
				porcentaje: 30,
				status: "lost",
				buroRevalidacionAl30: true,
			}),
		).toBe(false);
	});

	test("Jurídico y los roles externos a CRM no ven el estudio ni consultan Infornet", () => {
		for (const userRole of ["juridico", "cobros", "accounting"]) {
			const sinAcceso = { ...expediente, userRole };
			expect(puedeAccederDetalleBuro(sinAcceso)).toBe(false);
			expect(puedeReejecutarDetalleBuro(sinAcceso)).toBe(false);
		}
	});
});

describe("validación manual de Buró", () => {
	test("ventas puede validar Buró del titular o cofirmante solo en su oportunidad al 20%", () => {
		expect(
			puedeMarcarValidacionManualDetalleBuro({ ...expediente, tipo: "buro" }),
		).toBe(true);
		expect(
			puedeMarcarValidacionManualDetalleBuro({
				...expediente,
				userId: "asesor-b",
				tipo: "buro",
			}),
		).toBe(false);
		for (const porcentaje of [10, 30, 40]) {
			expect(
				puedeMarcarValidacionManualDetalleBuro({
					...expediente,
					porcentaje,
					buroRevalidacionAl30: true,
					tipo: "buro",
				}),
			).toBe(false);
		}
		expect(
			puedeMarcarValidacionManualDetalleBuro({
				...expediente,
				status: "lost",
				tipo: "buro",
			}),
		).toBe(false);
	});

	test("ventas no puede validar RENAP manualmente", () => {
		expect(
			puedeMarcarValidacionManualDetalleBuro({ ...expediente, tipo: "renap" }),
		).toBe(false);
	});

	test("admin y analyst conservan su permiso, incluso en la excepción al 30%", () => {
		for (const userRole of ["admin", "analyst"]) {
			expect(
				puedeMarcarValidacionManualDetalleBuro({
					...expediente,
					userRole,
					userId: "otro-usuario",
					tipo: "buro",
				}),
			).toBe(true);
			expect(
				puedeMarcarValidacionManualDetalleBuro({
					...expediente,
					userRole,
					porcentaje: 30,
					buroRevalidacionAl30: true,
					tipo: "renap",
				}),
			).toBe(true);
		}
	});

	test("sales supervisor y Jurídico no pueden validar manualmente", () => {
		for (const userRole of ["sales_supervisor", "juridico"]) {
			expect(
				puedeMarcarValidacionManualDetalleBuro({
					...expediente,
					userRole,
					tipo: "buro",
				}),
			).toBe(false);
		}
	});
});
