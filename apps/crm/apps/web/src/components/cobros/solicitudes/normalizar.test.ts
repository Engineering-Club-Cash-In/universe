import { describe, expect, test } from "bun:test";
import {
	aprobacionesParaDashboard,
	idSolicitante,
	solicitudDeRebaja,
	solicitudesDeFuentes,
} from "./normalizar";

const rebaja = (id: string, estado: string) => ({
	id,
	casoCobroId: `caso-${id}`,
	numeroCreditoSifco: `01${id}`,
	estado,
	moraSnapshot: "1000.00",
	montoSolicitado: "400.00",
	notas: "Motivo de la rebaja",
	solicitadoEn: "2026-10-10T15:00:00.000Z",
	solicitadoPorId: "u1",
	solicitadoPor: "Ana Díaz",
	clienteNombre: "Roberto Cárcamo",
});
const juridico = (id: string, estado: string) => ({
	id,
	casoCobroId: `caso-${id}`,
	numeroCreditoSifco: `02${id}`,
	bucketSnapshot: 4,
	motivo: "no_contacto",
	notaJuridico: "Nota para Jurídico",
	estado,
	solicitadoEn: "2026-10-09T15:00:00.000Z",
	solicitadoPorId: "u2",
	solicitadoPor: "Luis Morales",
	clienteNombre: null,
});
const documento = (id: string) => ({
	id,
	casoCobroId: `caso-${id}`,
	numeroCreditoSifco: `03${id}`,
	comentario: null,
	estado: "pendiente",
	solicitadoEn: "2026-10-11T15:00:00.000Z",
	solicitadoPor: "Carmen Ramírez",
	documento: "Contrato de crédito",
});

const rebajas = [
	rebaja("1", "pendiente"),
	rebaja("2", "error_aplicacion"),
	rebaja("3", "aplicada"),
	rebaja("4", "aprobada"),
];
const escalados = [juridico("5", "pendiente"), juridico("6", "rechazada")];

describe("solicitudesDeFuentes", () => {
	test("rebajas y Jurídico: pendientes y con error al aplicar; documentos pendientes", () => {
		const { pendientes } = solicitudesDeFuentes({
			convenios: [],
			inmovilizaciones: [],
			recuperaciones: [],
			rebajas,
			juridico: escalados,
			documentos: [documento("7")],
		});
		expect(pendientes.map((s) => s.id)).toEqual([
			"juridico-5",
			"rebaja-1",
			"rebaja-2",
			"documento-7",
		]);
		const conError = pendientes.find((s) => s.id === "rebaja-2");
		expect(conError?.tipo === "rebaja" && conError.errorAplicacion).toBe(true);
		const j = pendientes.find((s) => s.id === "juridico-5");
		expect(j?.cliente).toBe("Sin nombre");
		expect(j?.bucket).toBe(4);
	});

	test("el solicitante de la rebaja sirve para los cuatro ojos", () => {
		expect(idSolicitante(solicitudDeRebaja(rebajas[0]))).toBe("u1");
	});
});

describe("aprobacionesParaDashboard", () => {
	const destino = { to: "/cobros/solicitudes" };
	const destinos = {
		convenio: destino,
		recuperacion: destino,
		inmovilizacion: destino,
		rebaja: destino,
		documentos: destino,
		juridico: destino,
	};

	test("cuenta rebajas, Jurídico y documentos igual que la bandeja", () => {
		const r = aprobacionesParaDashboard({
			convenios: { items: [], total: 0 },
			recuperaciones: { pendientes: [] },
			inmovilizaciones: [],
			rebajas,
			juridico: escalados,
			documentos: [documento("7")],
			destinos,
		});
		expect(r.total).toBe(4);
		const cantidad = (clave: string) =>
			r.bandejas.find((b) => b.clave === clave)?.cantidad;
		expect(cantidad("rebajas")).toBe(2);
		expect(cantidad("juridico")).toBe(1);
		expect(cantidad("documentos")).toBe(1);
		expect(r.filas.map((f) => f.tipo)).toEqual([
			"juridico",
			"rebaja",
			"rebaja",
			"documentos",
		]);
	});

	test("una fuente que carga queda en null y no suma", () => {
		const r = aprobacionesParaDashboard({ destinos });
		expect(r.total).toBe(0);
		expect(r.bandejas.every((b) => b.cantidad === null)).toBe(true);
	});
});
