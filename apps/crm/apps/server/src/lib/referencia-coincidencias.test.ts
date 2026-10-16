import { describe, expect, test } from "bun:test";
import {
	coincidenciasDeReferencia,
	type FilaCandidata,
	MAX_COINCIDENCIAS,
} from "./referencia-coincidencias";

const DPI = "1234567030101";

function fila(extra: Partial<FilaCandidata>): FilaCandidata {
	return {
		tipo: "personal",
		lead_id: "lead-1",
		oportunidad_id: "opp-1",
		cliente_nombre: "Ana López",
		referencia_nombre: "Rosa",
		parentesco: "tía",
		referencia_dpi: null,
		referencia_telefono: "55551234",
		dada_por_nombre: "Ana López",
		dada_por_rol: "titular",
		...extra,
	};
}

describe("coincidenciasDeReferencia", () => {
	test("deja solo las filas que son la misma persona, con cómo coincidieron", () => {
		const r = coincidenciasDeReferencia({ telefono: "+502 5555-1234" }, [
			fila({ lead_id: "a" }),
			fila({ lead_id: "b", referencia_telefono: "99990000" }),
			fila({
				lead_id: "c",
				referencia_dpi: DPI,
				referencia_telefono: "99990000",
			}),
		]);
		expect(r.total).toBe(1);
		expect(r.coincidencias[0]).toMatchObject({
			tipo: "personal",
			leadId: "a",
			clienteNombre: "Ana López",
			oportunidadId: "opp-1",
			referenciaNombre: "Rosa",
			parentesco: "tía",
			dadaPor: { nombre: "Ana López", rol: "titular" },
			coincidePor: "telefono",
		});
	});

	test("un cliente sale una vez aunque la tenga en varias listas, titular y codeudor", () => {
		const r = coincidenciasDeReferencia({ telefono: "55551234" }, [
			fila({ tipo: "cobros", referencia_nombre: "Rosa" }),
			fila({ tipo: "personal", referencia_nombre: "Rosa M." }),
			fila({ tipo: "familiar", dada_por_rol: "codeudor" }),
		]);
		expect(r.total).toBe(1);
		expect(r.coincidencias).toHaveLength(1);
		expect(r.coincidencias[0].tipo).toBe("cobros"); // la más reciente (primera)
	});

	test.each([
		["teléfono primero", [false, true]],
		["DPI primero", [true, false]],
	])("coincide por teléfono en una fila y por DPI en otra: queda 'dpi' (%s)", (_n, [
		dpiPrimero,
	]) => {
		const porDpi = fila({
			tipo: "familiar",
			referencia_nombre: "Por Dpi",
			referencia_dpi: DPI,
			referencia_telefono: "10203040",
		});
		const porTelefono = fila({
			tipo: "cobros",
			referencia_nombre: "Por Telefono",
		});
		const r = coincidenciasDeReferencia(
			{ dpi: DPI, telefono: "55551234" },
			dpiPrimero ? [porDpi, porTelefono] : [porTelefono, porDpi],
		);
		expect(r.total).toBe(1);
		expect(r.coincidencias[0]).toMatchObject({
			coincidePor: "dpi",
			referenciaNombre: "Por Dpi",
			tipo: "familiar",
		});
	});

	test("una oportunidad sin lead cuenta como un cliente aparte (por oportunidad)", () => {
		const sinLead = { lead_id: null, cliente_nombre: null };
		const r = coincidenciasDeReferencia({ telefono: "55551234" }, [
			fila({ ...sinLead, oportunidad_id: "opp-a" }),
			fila({ ...sinLead, oportunidad_id: "opp-a", tipo: "familiar" }),
			fila({ ...sinLead, oportunidad_id: "opp-b" }),
		]);
		expect(r.total).toBe(2);
		expect(r.coincidencias.map((c) => c.oportunidadId)).toEqual([
			"opp-a",
			"opp-b",
		]);
		expect(r.coincidencias[0]).toMatchObject({
			leadId: null,
			clienteNombre: null,
		});
	});

	test("recorta a MAX_COINCIDENCIAS pero informa el total real y conserva el orden", () => {
		const candidatas = Array.from({ length: 12 }, (_, i) =>
			fila({ lead_id: `lead-${i}`, referencia_nombre: `Ref ${i}` }),
		);
		const r = coincidenciasDeReferencia({ telefono: "55551234" }, candidatas);
		expect(MAX_COINCIDENCIAS).toBe(10);
		expect(r.total).toBe(12);
		expect(r.coincidencias.map((c) => c.referenciaNombre)).toEqual(
			candidatas.slice(0, 10).map((c) => c.referencia_nombre),
		);
	});

	test("los nombres vacíos vienen null, sin texto de relleno", () => {
		const r = coincidenciasDeReferencia({ telefono: "55551234" }, [
			fila({
				cliente_nombre: null,
				referencia_nombre: "   ",
				dada_por_nombre: null,
				dada_por_rol: "codeudor",
			}),
		]);
		expect(r.coincidencias[0]).toMatchObject({
			clienteNombre: null,
			referenciaNombre: null,
			dadaPor: { nombre: null, rol: "codeudor" },
		});
	});

	test("sin candidatas o sin coincidencias: total 0", () => {
		expect(coincidenciasDeReferencia({ telefono: "55551234" }, [])).toEqual({
			total: 0,
			coincidencias: [],
		});
		expect(
			coincidenciasDeReferencia({ telefono: "12345678" }, [
				fila({ referencia_telefono: "12345678" }),
			]).total,
		).toBe(0);
	});
});
