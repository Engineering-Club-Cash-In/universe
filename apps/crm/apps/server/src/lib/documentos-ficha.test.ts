import { describe, expect, test } from "bun:test";
import {
	armarDocumentos,
	combinarDatosMensaje,
	construirMensajeDocumento,
	decidirOportunidadMensaje,
	decidirVehiculoCaso,
	nombresDeActores,
} from "./documentos-ficha";

describe("armarDocumentos", () => {
	test("envíos según archivo; solicitudes según pendientes", () => {
		const r = armarDocumentos({
			archivos: { "tarjeta-circulacion": true, seguro: false },
			pendientes: ["expertaje"],
		});
		expect(r.map((d) => [d.clave, d.modo, d.disponible])).toEqual([
			["tarjeta-circulacion", "enviar", true],
			["seguro", "enviar", false],
			["contrato", "solicitar", true],
			["carta-poder", "solicitar", true],
			["cambio-placas", "solicitar", true],
			["expertaje", "solicitar", false],
		]);
	});
});

describe("construirMensajeDocumento", () => {
	const vehiculo = {
		marca: "Toyota",
		modelo: "Hilux",
		year: 2020,
		placa: "P123ABC",
	};
	test("tarjeta con vehículo y asesor", () => {
		expect(
			construirMensajeDocumento("tarjeta-circulacion", "Ana", vehiculo, "S-1", {
				nombre: "Luis",
				telefono: "5555-0000",
			}),
		).toBe(
			"Ana, te compartimos la tarjeta de circulación de tu Toyota Hilux 2020, placas P123ABC en el documento adjunto. Cualquier duda, llama a tu asesor Luis al 5555-0000.",
		);
	});
	test("seguro sin nombre ni vehículo usa el crédito", () => {
		expect(
			construirMensajeDocumento(
				"seguro",
				null,
				{ marca: null, modelo: null, year: null, placa: null },
				"S-1",
			),
		).toBe(
			"Te compartimos la información del seguro del vehículo de tu crédito S-1 en el documento adjunto. Cualquier duda, comunícate con tu asesor.",
		);
	});
});

describe("combinarDatosMensaje", () => {
	const sin = {
		clienteNombre: null,
		vehiculoMarca: null,
		vehiculoModelo: null,
		vehiculoYear: null,
		vehiculoPlaca: null,
	};
	const opp = {
		clienteNombre: "Juan Pérez",
		vehiculoMarca: "Toyota",
		vehiculoModelo: "Hilux",
		vehiculoYear: 2021,
		vehiculoPlaca: "P123ABC",
	};
	test("sin contrato (56% de los casos) usa la oportunidad y el lead", () => {
		expect(combinarDatosMensaje(sin, opp, "S-1")).toEqual({
			numeroCreditoSifco: "S-1",
			...opp,
		});
	});
	test("el contrato manda y la oportunidad solo completa lo que falta", () => {
		const r = combinarDatosMensaje(
			{ ...sin, clienteNombre: "Ana López", vehiculoPlaca: " " },
			opp,
			"S-1",
		);
		expect(r.clienteNombre).toBe("Ana López");
		expect(r.vehiculoMarca).toBe("Toyota");
		expect(r.vehiculoPlaca).toBe("P123ABC");
	});
	test("sin nada queda en null", () => {
		expect(combinarDatosMensaje(sin, sin, null).clienteNombre).toBeNull();
	});
});

describe("decidirVehiculoCaso", () => {
	test("sin contrato manda la oportunidad y sus documentos valen", () => {
		expect(
			decidirVehiculoCaso({
				tieneContrato: false,
				vehiculoContrato: null,
				vehiculoOportunidad: "v-opp",
			}),
		).toEqual({ vehicleId: "v-opp", usarOportunidad: true });
	});

	test("con contrato manda su vehículo aunque la oportunidad apunte a otro", () => {
		expect(
			decidirVehiculoCaso({
				tieneContrato: true,
				vehiculoContrato: "v-contrato",
				vehiculoOportunidad: "v-viejo",
			}),
		).toEqual({ vehicleId: "v-contrato", usarOportunidad: false });
	});

	test("con contrato, los documentos de la oportunidad valen si es el mismo vehículo", () => {
		expect(
			decidirVehiculoCaso({
				tieneContrato: true,
				vehiculoContrato: "v1",
				vehiculoOportunidad: "v1",
			}),
		).toEqual({ vehicleId: "v1", usarOportunidad: true });
	});

	test("con contrato sin vehículo no se cae a la oportunidad", () => {
		expect(
			decidirVehiculoCaso({
				tieneContrato: true,
				vehiculoContrato: null,
				vehiculoOportunidad: "v-opp",
			}),
		).toEqual({ vehicleId: null, usarOportunidad: false });
	});
});

describe("decidirOportunidadMensaje", () => {
	const base = {
		vehiculoContrato: "v1",
		vehiculoOportunidad: "v1",
		oportunidadDelCliente: "o1",
		oportunidadResuelta: "o1",
	};
	test("sin contrato la oportunidad rellena todo", () => {
		expect(
			decidirOportunidadMensaje({
				...base,
				tieneContrato: false,
				vehiculoContrato: null,
				oportunidadDelCliente: null,
			}),
		).toEqual({ usarOportunidad: true, usarNombreOportunidad: true });
	});
	test("con contrato y oportunidad del cliente con el mismo vehículo, todo", () => {
		expect(decidirOportunidadMensaje({ ...base, tieneContrato: true })).toEqual(
			{ usarOportunidad: true, usarNombreOportunidad: true },
		);
	});
	test("con contrato, oportunidad hallada por SIFCO: ni nombre aunque el vehículo coincida", () => {
		expect(
			decidirOportunidadMensaje({
				...base,
				tieneContrato: true,
				oportunidadDelCliente: null,
			}),
		).toEqual({ usarOportunidad: true, usarNombreOportunidad: false });
	});
	test("con contrato y otro vehículo, la oportunidad no aporta el vehículo", () => {
		expect(
			decidirOportunidadMensaje({
				...base,
				tieneContrato: true,
				vehiculoOportunidad: "v-viejo",
			}),
		).toEqual({ usarOportunidad: false, usarNombreOportunidad: true });
	});
});

describe("nombresDeActores", () => {
	test("pendiente sin resolutor: sigue siendo null", () => {
		expect(
			nombresDeActores({ estado: "pendiente", solicitadoPor: "Ana", resueltoPor: null }),
		).toEqual({ solicitadoPor: "Ana", resueltoPor: null });
	});
	test("resuelta sin resolutor: el usuario fue eliminado", () => {
		for (const estado of ["aprobada", "rechazada"]) {
			expect(
				nombresDeActores({ estado, solicitadoPor: "Ana", resueltoPor: null }),
			).toEqual({ solicitadoPor: "Ana", resueltoPor: "Usuario eliminado" });
		}
	});
	test("solicitante eliminado y resolutor vigente", () => {
		expect(
			nombresDeActores({ estado: "aprobada", solicitadoPor: null, resueltoPor: "Luis" }),
		).toEqual({ solicitadoPor: "Usuario eliminado", resueltoPor: "Luis" });
	});
});
