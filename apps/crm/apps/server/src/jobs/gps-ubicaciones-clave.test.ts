import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { db } from "../db";
import * as gpsEventosService from "../services/wialon/gps-eventos";
import * as wialonClientModule from "../services/wialon/wialon-client";
import * as gpsEventosPoll from "./gps-eventos-poll";
import { ejecutarCalculoUbicacionesClave } from "./gps-ubicaciones-clave";

describe("CB-119 (D-15) — ejecutarCalculoUbicacionesClave", () => {
	let txCalled = false;

	beforeEach(() => {
		txCalled = false;
		spyOn(gpsEventosPoll, "sifcosEnB4").mockResolvedValue(
			["01010214100000"],
		);
		spyOn(gpsEventosPoll, "unidadesConCasoActivo").mockResolvedValue([
			{ wialonUnitId: 100, numeroCreditoSifco: "01010214100000" },
		]);
		spyOn(gpsEventosService, "resolverVehiculoYCaso").mockResolvedValue({
			vehicleId: "veh-1",
			casoCobroId: "caso-1",
		});
		spyOn(db, "transaction").mockImplementation(async (cb: any) => {
			txCalled = true;
			return cb({
				delete: () => ({ where: async () => {} }),
				insert: () => ({ values: async () => {} }),
			});
		});
	});

	afterEach(() => {
		mock.restore();
	});

	it("preserva el snapshot previo si el historial de Wialon está incompleto (!completo)", async () => {
		const mockWialon = {
			getHistorialPosiciones: mock().mockResolvedValue({
				mensajes: [],
				completo: false,
				tramosTotal: 2,
				tramosCompletados: 1,
			}),
		};
		spyOn(wialonClientModule, "getWialonClient").mockReturnValue(
			mockWialon as any,
		);

		const res = await ejecutarCalculoUbicacionesClave();

		expect(res.unidadesConError).toBe(1);
		expect(res.unidadesProcesadas).toBe(0);
		expect(txCalled).toBe(false);
	});

	it("reemplaza el snapshot en DB cuando el historial de Wialon está completo", async () => {
		const mockWialon = {
			getHistorialPosiciones: mock().mockResolvedValue({
				mensajes: [],
				completo: true,
				tramosTotal: 2,
				tramosCompletados: 2,
			}),
		};
		spyOn(wialonClientModule, "getWialonClient").mockReturnValue(
			mockWialon as any,
		);

		const res = await ejecutarCalculoUbicacionesClave();

		expect(res.unidadesConError).toBe(0);
		expect(res.unidadesProcesadas).toBe(1);
		expect(txCalled).toBe(true);
	});
});
