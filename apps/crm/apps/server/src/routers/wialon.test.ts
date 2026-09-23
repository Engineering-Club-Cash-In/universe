import { afterEach, describe, expect, it, mock } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { casosCobros } from "../db/schema/cobros";
import type { Context } from "../lib/context";
import {
	setWialonClient,
	WialonClient,
} from "../services/wialon/wialon-client";
import { WialonClientError } from "../services/wialon/wialon-types";
import { mapWialonErrorToOrpc, wialonRouter } from "./wialon";

// Rol "admin" satisface también canAccessCobros/canAssignCobros/canAccessAdmin,
// así que un único mock de db sirve para todas las variantes de procedimiento
// (cobrosProcedure, cobrosSupervisorProcedure, adminProcedure) usadas en este archivo.
// Los tests de CB-118 (getGpsVehiculo) necesitan que el mismo mock devuelva a
// veces el usuario y a veces la fila del vehículo, y que a veces falle como
// falla Postgres cuando la migración 0057 no está aplicada. Estas dos variables
// dejan que cada test decida sin montar un mock por caso.
let filaVehiculoMock: Record<string, unknown> | null = null;
let errorSelectVehiculo: Error | null = null;
let insertsGpsAuditoria: Record<string, unknown>[] = [];
let bitacoraFilasMock: Record<string, unknown>[] = [];
// UPDATEs sobre vehicles (vínculo manual o deducido por placa) y cuántas filas
// "afecta" el mock: 0 simula un vehicleId inexistente.
let updatesVehiculo: Record<string, unknown>[] = [];
let filasAfectadasUpdate = 1;
// Gate de la ficha (resolverCasoParaGps): si el asesor tiene acceso al caso y
// qué vehículo/SIFCO devuelve el join caso ⨝ oportunidad ⨝ contrato.
let accesoCasoMock = true;
// Si la unidad deducida por placa ya está guardada en otro vehículo.
let unidadAsignadaAOtroMock = false;
// Cuántas veces se tomó el lock por unidad (pg_advisory_xact_lock vía execute).
let locksUnidad = 0;
// Simula que el INSERT de la bitácora falla (ej. tabla sin migrar).
let errorInsertAuditoria: Error | null = null;
// Simula que un UPDATE sobre vehicles falla (liberar un vínculo vencido).
let errorUpdateVehiculo: Error | null = null;
let casoGpsMock: Record<string, unknown> | null = {
	casoSifco: "01010214100000",
	vehiculoOportunidad: "11111111-1111-1111-1111-111111111111",
	vehiculoContrato: null,
};
// Filas vehicles ⨝ opportunities que lee creditosPorUnidad (catálogo admin).
let catalogoCreditosMock: Record<string, unknown>[] = [];
// Filas caso ⨝ contrato ⨝ vehículo (segunda fuente de creditosPorUnidad).
let catalogoCreditosContratoMock: Record<string, unknown>[] = [];
let bitacoraTotalMock = 0;

function mockDbAdmin() {
	const mockDb = {
		// vincularUnidadWialon desvincula y vincula en una transacción: el mock
		// corre el callback con el mismo objeto (sin rollback real).
		transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(mockDb),
		execute: async () => {
			locksUnidad++;
			return [];
		},
		select: (campos?: Record<string, unknown>) => {
			// El select del middleware de auth no pasa proyección; los de
			// leerVehiculoParaGps sí, y son los únicos que piden licensePlate.
			// getGpsBitacora es el único que pide userNombre (join con user).
			const esVehiculo = Boolean(campos && "licensePlate" in campos);
			const pideVinculo = Boolean(campos && "wialonUnitId" in campos);
			const esBitacora = Boolean(campos && "userNombre" in campos);
			const esConteoBitacora = Boolean(
				campos && "total" in campos && Object.keys(campos).length === 1,
			);

			// assertAccesoCasoCobro: select({ id }) a casos_cobros.
			if (campos && Object.keys(campos).length === 1 && "id" in campos) {
				return {
					from: () => ({
						where: () => ({
							limit: async () => (accesoCasoMock ? [{ id: "caso" }] : []),
						}),
					}),
				};
			}

			// getGpsVehiculo: ¿la unidad deducida ya está en otro vehículo?
			if (campos && "vehiculoConUnidad" in campos) {
				return {
					from: () => ({
						where: () => ({
							limit: async () => {
								// Sin la 0057 esta consulta también revienta: el handler
								// no debe llegar a correrla en ese caso.
								if (errorSelectVehiculo) throw errorSelectVehiculo;
								return unidadAsignadaAOtroMock
									? [{ vehiculoConUnidad: "otro" }]
									: [];
							},
						}),
					}),
				};
			}

			// resolverCasoParaGps: caso ⨝ oportunidad ⨝ contrato.
			if (campos && "casoSifco" in campos) {
				const encadenable = {
					leftJoin: () => encadenable,
					where: () => encadenable,
					limit: async () => (casoGpsMock ? [casoGpsMock] : []),
				};
				return { from: () => encadenable };
			}

			// creditosPorUnidad es el único select que pide numeroSifco: from →
			// innerJoin → where, que resuelve con las filas del mock.
			if (campos && "numeroSifco" in campos) {
				return {
					from: (tabla: unknown) => {
						const filas =
							tabla === casosCobros
								? catalogoCreditosContratoMock
								: catalogoCreditosMock;
						const encadenable = {
							innerJoin: () => encadenable,
							where: async () => filas,
						};
						return encadenable;
					},
				};
			}

			if (esBitacora) {
				// Cadena completa que usa getGpsBitacora: from → leftJoin → where →
				// orderBy → limit → offset. Cada eslabón devuelve el mismo objeto
				// encadenable hasta el final, que resuelve async con las filas mock.
				const encadenable = {
					leftJoin: () => encadenable,
					where: () => encadenable,
					orderBy: () => encadenable,
					limit: () => encadenable,
					offset: async () => bitacoraFilasMock,
				};
				return { from: () => encadenable };
			}

			if (esConteoBitacora) {
				return {
					from: () => ({
						where: async () => [{ total: bitacoraTotalMock }],
					}),
				};
			}

			return {
				from: () => ({
					where: () => ({
						limit: async () => {
							if (!esVehiculo) return [{ id: "user-test", role: "admin" }];
							// Simula "column wialon_unit_id does not exist": solo revienta
							// el SELECT que nombra las columnas nuevas.
							if (pideVinculo && errorSelectVehiculo) {
								throw errorSelectVehiculo;
							}
							if (!filaVehiculoMock) return [];
							const { wialonUnitId, wialonUnitName, ...resto } =
								filaVehiculoMock;
							return [
								pideVinculo
									? filaVehiculoMock
									: { ...resto, licensePlate: filaVehiculoMock.licensePlate },
							];
						},
					}),
				}),
			};
		},
		update: () => ({
			set: (data: Record<string, unknown>) => ({
				// Se puede await-ear directo (fijarVinculoPorPlaca) o encadenar
				// .returning() (vincularUnidadWialon), igual que drizzle.
				where: () => {
					if (errorUpdateVehiculo) {
						return Object.assign(Promise.reject(errorUpdateVehiculo), {
							returning: async () => {
								throw errorUpdateVehiculo;
							},
						});
					}
					updatesVehiculo.push(data);
					const filas = Array.from({ length: filasAfectadasUpdate }, () => ({
						id: "11111111-1111-1111-1111-111111111111",
					}));
					return Object.assign(Promise.resolve(undefined), {
						returning: async () => filas,
					});
				},
			}),
		}),
		// getGpsVehiculo audita cada consulta en gps_consulta_logs (CB-118).
		// Se captura en insertsGpsAuditoria para poder aserir motivo/usuario.
		insert: () => ({
			values: async (data: Record<string, unknown>) => {
				if (errorInsertAuditoria) throw errorInsertAuditoria;
				insertsGpsAuditoria.push(data);
			},
		}),
	};
	return mockDb;
}

mock.module("../db", () => ({ db: mockDbAdmin() }));

describe("wialonRouter", () => {
	it("expone todos los procedimientos requeridos", () => {
		expect(typeof wialonRouter.getWialonUnits).toBe("object");
		expect(typeof wialonRouter.getWialonUnitsStatus).toBe("object");
		expect(typeof wialonRouter.getWialonUnitDetail).toBe("object");
		expect(typeof wialonRouter.createWialonTrackingLink).toBe("object");
		expect(typeof wialonRouter.deleteWialonTrackingLink).toBe("object");
		expect(typeof wialonRouter.getWialonConnectionStatus).toBe("object");
		expect(typeof wialonRouter.getWialonDiagnostics).toBe("object");
		expect(typeof wialonRouter.testWialonConnection).toBe("object");
		expect(typeof wialonRouter.getWialonUnitsCatalog).toBe("object");
	});

	describe("mapWialonErrorToOrpc", () => {
		it("mapea WIALON_AUTH_REQUIRED a INTERNAL_SERVER_ERROR", () => {
			const err = new WialonClientError("No token", "WIALON_AUTH_REQUIRED");
			expect(() => mapWialonErrorToOrpc(err)).toThrow(ORPCError);
			try {
				mapWialonErrorToOrpc(err);
			} catch (e) {
				expect((e as ORPCError<string, unknown>).code).toBe(
					"INTERNAL_SERVER_ERROR",
				);
			}
		});

		it("mapea WIALON_INVALID_SESSION a BAD_GATEWAY", () => {
			const err = new WialonClientError(
				"Sesión vencida",
				"WIALON_INVALID_SESSION",
			);
			expect(() => mapWialonErrorToOrpc(err)).toThrow(ORPCError);
			try {
				mapWialonErrorToOrpc(err);
			} catch (e) {
				expect((e as ORPCError<string, unknown>).code).toBe("BAD_GATEWAY");
			}
		});

		it("mapea WIALON_TIMEOUT a GATEWAY_TIMEOUT", () => {
			const err = new WialonClientError("Timeout 15s", "WIALON_TIMEOUT");
			expect(() => mapWialonErrorToOrpc(err)).toThrow(ORPCError);
			try {
				mapWialonErrorToOrpc(err);
			} catch (e) {
				expect((e as ORPCError<string, unknown>).code).toBe("GATEWAY_TIMEOUT");
			}
		});

		it("mapea WIALON_NETWORK_ERROR e INVALID_RESPONSE a BAD_GATEWAY", () => {
			const netErr = new WialonClientError(
				"Network drop",
				"WIALON_NETWORK_ERROR",
			);
			expect(() => mapWialonErrorToOrpc(netErr)).toThrow(ORPCError);
			try {
				mapWialonErrorToOrpc(netErr);
			} catch (e) {
				expect((e as ORPCError<string, unknown>).code).toBe("BAD_GATEWAY");
			}

			const respErr = new WialonClientError(
				"Malformed JSON",
				"WIALON_INVALID_RESPONSE",
			);
			expect(() => mapWialonErrorToOrpc(respErr)).toThrow(ORPCError);
			try {
				mapWialonErrorToOrpc(respErr);
			} catch (e) {
				expect((e as ORPCError<string, unknown>).code).toBe("BAD_GATEWAY");
			}
		});

		it("mapea fallos upstream (códigos 5, 8, 9, 10, 11, 14) a BAD_GATEWAY", () => {
			for (const code of [5, 8, 9, 10, 11, 14]) {
				const err = new WialonClientError(
					`Fallo servidor ${code}`,
					"WIALON_API_ERROR",
					code,
				);
				expect(() => mapWialonErrorToOrpc(err)).toThrow(ORPCError);
				try {
					mapWialonErrorToOrpc(err);
				} catch (e) {
					expect((e as ORPCError<string, unknown>).code).toBe("BAD_GATEWAY");
				}
			}
		});

		it("mapea error 7 de permisos a FORBIDDEN", () => {
			const err = new WialonClientError(
				"Acceso denegado",
				"WIALON_API_ERROR",
				7,
			);
			expect(() => mapWialonErrorToOrpc(err)).toThrow(ORPCError);
			try {
				mapWialonErrorToOrpc(err);
			} catch (e) {
				expect((e as ORPCError<string, unknown>).code).toBe("FORBIDDEN");
			}
		});

		it("mapea errores comunes de API a BAD_REQUEST", () => {
			const err = new WialonClientError(
				"Parámetro inválido",
				"WIALON_API_ERROR",
				4,
			);
			expect(() => mapWialonErrorToOrpc(err)).toThrow(ORPCError);
			try {
				mapWialonErrorToOrpc(err);
			} catch (e) {
				expect((e as ORPCError<string, unknown>).code).toBe("BAD_REQUEST");
			}
		});

		it("mapea errores no controlados a INTERNAL_SERVER_ERROR", () => {
			const err = new Error("Error desconocido");
			expect(() => mapWialonErrorToOrpc(err)).toThrow(ORPCError);
			try {
				mapWialonErrorToOrpc(err);
			} catch (e) {
				expect((e as ORPCError<string, unknown>).code).toBe(
					"INTERNAL_SERVER_ERROR",
				);
			}
		});
	});

	describe("ejecución de handlers y auditoría", () => {
		it("createWialonTrackingLink ejecuta el handler y emite log estructurado de auditoría", async () => {
			const infoCalls: unknown[][] = [];
			const origInfo = console.info;
			console.info = (...args: unknown[]) => {
				infoCalls.push(args);
			};

			const mockFetch = async (_: unknown, init?: RequestInit) => {
				const bodyStr = String(init?.body || "");
				if (bodyStr.includes("token%2Flogin")) {
					return new Response(JSON.stringify({ eid: "sid-mock" }), {
						status: 200,
					});
				}
				return new Response(
					JSON.stringify({
						h: "HASH_AUDIT_TEST",
						app: "locator",
						dur: 3600,
						items: [101],
					}),
					{ status: 200 },
				);
			};

			const testClient = new WialonClient({ token: "tok-test" }, mockFetch);
			setWialonClient(testClient);

			try {
				const mockContext = {
					headers: new Headers(),
					session: {
						user: { id: "user-test-1", email: "supervisor@example.com" },
					},
					user: {
						id: "user-test-1",
						email: "supervisor@example.com",
						role: "cobros_supervisor",
					},
					userId: "user-test-1",
					userRole: "cobros_supervisor",
				};

				const res = await call(
					wialonRouter.createWialonTrackingLink,
					{
						unitId: 101,
						durationSeconds: 3600,
						note: "Auditoría de prueba",
					},
					{ context: mockContext as unknown as Context },
				);

				expect(res?.hash).toBe("HASH_AUDIT_TEST");
				expect(res?.unitId).toBe(101);

				// Verificar log de auditoría
				const auditEntry = infoCalls.find(
					(c) => c[0] === "WIALON_LOCATOR_LINK_CREATED",
				);
				expect(auditEntry).toBeDefined();
				const payload = auditEntry?.[1] as Record<string, unknown>;
				expect(payload.userId).toBe("user-test-1");
				expect(payload.userEmail).toBe("supervisor@example.com");
				expect(payload.hashPrefix).toBe("HASH_AUD...");
				expect(payload.unitId).toBe(101);
			} finally {
				console.info = origInfo;
				setWialonClient(null);
			}
		});

		it("deleteWialonTrackingLink ejecuta el handler y emite log estructurado de auditoría", async () => {
			const infoCalls: unknown[][] = [];
			const origInfo = console.info;
			console.info = (...args: unknown[]) => {
				infoCalls.push(args);
			};

			const mockFetch = async (_: unknown, init?: RequestInit) => {
				const bodyStr = String(init?.body || "");
				if (bodyStr.includes("token%2Flogin")) {
					return new Response(JSON.stringify({ eid: "sid-mock" }), {
						status: 200,
					});
				}
				return new Response(JSON.stringify({}), { status: 200 });
			};

			const testClient = new WialonClient({ token: "tok-test" }, mockFetch);
			setWialonClient(testClient);

			try {
				const mockContext = {
					headers: new Headers(),
					session: {
						user: { id: "user-test-2", email: "admin@example.com" },
					},
					user: {
						id: "user-test-2",
						email: "admin@example.com",
						role: "admin",
					},
					userId: "user-test-2",
					userRole: "admin",
				};

				const res = await call(
					wialonRouter.deleteWialonTrackingLink,
					{ hash: "HASH_A_ELIMINAR_123" },
					{ context: mockContext as unknown as Context },
				);

				expect(res?.success).toBe(true);

				// Verificar log de auditoría
				const auditEntry = infoCalls.find(
					(c) => c[0] === "WIALON_LOCATOR_LINK_DELETED",
				);
				expect(auditEntry).toBeDefined();
				const payload = auditEntry?.[1] as Record<string, unknown>;
				expect(payload.userId).toBe("user-test-2");
				expect(payload.userEmail).toBe("admin@example.com");
				expect(payload.hashPrefix).toBe("HASH_A_E...");
			} finally {
				console.info = origInfo;
				setWialonClient(null);
			}
		});

		it("getWialonConnectionStatus consulta la salud de la conexión y retorna el estado", async () => {
			const mockFetch = async (_: unknown, init?: RequestInit) => {
				const bodyStr = String(init?.body || "");
				if (bodyStr.includes("token%2Flogin")) {
					return new Response(
						JSON.stringify({
							eid: "sid-status-test",
							user: { id: 77, nm: "Admin IT" },
						}),
						{ status: 200 },
					);
				}
				if (bodyStr.includes("core%2Fsearch_items")) {
					return new Response(
						JSON.stringify({ totalItemsCount: 1, items: [] }),
						{ status: 200 },
					);
				}
				return new Response(JSON.stringify({}), { status: 200 });
			};

			const testClient = new WialonClient({ token: "tok-test" }, mockFetch);
			setWialonClient(testClient);

			try {
				const mockContext = {
					headers: new Headers(),
					session: {
						user: { id: "user-test-3", email: "agent@example.com" },
					},
					user: {
						id: "user-test-3",
						email: "agent@example.com",
						role: "cobros_ejecutivo",
					},
					userId: "user-test-3",
					userRole: "cobros_ejecutivo",
				};

				const res = await call(
					wialonRouter.getWialonConnectionStatus,
					undefined,
					{ context: mockContext as unknown as Context },
				);

				expect(res.connected).toBe(true);
				expect(res.user?.nm).toBe("Admin IT");
			} finally {
				setWialonClient(null);
			}
		});

		it("getWialonConnectionStatus arroja BAD_GATEWAY si core/search_items responde con JSON malformado", async () => {
			const mockFetch = async (_: unknown, init?: RequestInit) => {
				const bodyStr = String(init?.body || "");
				if (bodyStr.includes("token%2Flogin")) {
					return new Response(
						JSON.stringify({
							eid: "sid-valid-test",
							user: { id: 1, nm: "Admin IT" },
						}),
						{ status: 200 },
					);
				}
				if (bodyStr.includes("core%2Fsearch_items")) {
					// Respuesta malformada durante degradación upstream (omite items)
					return new Response(JSON.stringify({}), { status: 200 });
				}
				return new Response(JSON.stringify({}), { status: 200 });
			};

			const testClient = new WialonClient({ token: "tok-test" }, mockFetch);
			setWialonClient(testClient);

			try {
				const mockContext = {
					headers: new Headers(),
					session: {
						user: { id: "user-test-3", email: "agent@example.com" },
					},
					user: {
						id: "user-test-3",
						email: "agent@example.com",
						role: "cobros_ejecutivo",
					},
					userId: "user-test-3",
					userRole: "cobros_ejecutivo",
				};

				await expect(
					call(wialonRouter.getWialonConnectionStatus, undefined, {
						context: mockContext as unknown as Context,
					}),
				).rejects.toThrow(ORPCError);
			} finally {
				setWialonClient(null);
			}
		});
	});
	describe("getWialonDiagnostics", () => {
		const adminContext = {
			headers: new Headers(),
			session: { user: { id: "user-admin-1", email: "admin@example.com" } },
			user: { id: "user-admin-1", email: "admin@example.com", role: "admin" },
			userId: "user-admin-1",
			userRole: "admin",
		};

		it("retorna connected: true con latencia, ambiente y conteo de unidades cuando Wialon responde", async () => {
			const mockFetch = async (_: unknown, init?: RequestInit) => {
				const bodyStr = String(init?.body || "");
				if (bodyStr.includes("token%2Flogin")) {
					return new Response(
						JSON.stringify({
							eid: "sid-diag-test",
							user: { id: 55, nm: "Admin Diag" },
						}),
						{ status: 200 },
					);
				}
				if (bodyStr.includes("core%2Fsearch_items")) {
					return new Response(
						JSON.stringify({ totalItemsCount: 70, items: [] }),
						{ status: 200 },
					);
				}
				return new Response(JSON.stringify({}), { status: 200 });
			};

			const testClient = new WialonClient(
				{
					token: "tok-diag",
					baseUrl: "https://hst-api.wialon.com/wialon/ajax.html",
				},
				mockFetch,
			);
			setWialonClient(testClient);

			try {
				const res = await call(wialonRouter.getWialonDiagnostics, undefined, {
					context: adminContext as unknown as Context,
				});

				expect(res.connected).toBe(true);
				expect(res.environment).toBe("hosting-wialon");
				expect(res.unitCount).toBe(70);
				expect(res.user?.nm).toBe("Admin Diag");
				expect(res.error).toBeNull();
				expect(typeof res.latencyMs).toBe("number");
				expect(res.tokenConfigured).toBe(true);
				// Nunca debe exponer el token ni el sid crudo de sesión
				expect(Object.keys(res)).not.toContain("token");
				expect(Object.keys(res)).not.toContain("sid");
			} finally {
				setWialonClient(null);
			}
		});

		it("degrada a connected: false con error incluido en vez de lanzar, ante fallo upstream", async () => {
			const mockFetch = async () =>
				new Response(
					JSON.stringify({ error: 8, reason: "Invalid credentials" }),
					{ status: 200 },
				);

			const testClient = new WialonClient({ token: "tok-bad" }, mockFetch);
			setWialonClient(testClient);

			try {
				const res = await call(wialonRouter.getWialonDiagnostics, undefined, {
					context: adminContext as unknown as Context,
				});

				expect(res.connected).toBe(false);
				expect(res.error).not.toBeNull();
				expect(res.error?.code).toBe("WIALON_API_ERROR");
				expect(res.latencyMs).toBeNull();
				expect(res.unitCount).toBeNull();
				// La config pública se sigue reportando aunque falle la conexión
				expect(res.tokenConfigured).toBe(true);
			} finally {
				setWialonClient(null);
			}
		});

		it("rechaza usuarios sin rol admin con FORBIDDEN", async () => {
			mock.module("../db", () => ({
				db: {
					select: () => ({
						from: () => ({
							where: () => ({
								limit: async () => [
									{ id: "user-cobros", role: "cobros_supervisor" },
								],
							}),
						}),
					}),
				},
			}));

			const nonAdminContext = {
				headers: new Headers(),
				session: {
					user: { id: "user-cobros", email: "supervisor@example.com" },
				},
				user: {
					id: "user-cobros",
					email: "supervisor@example.com",
					role: "cobros_supervisor",
				},
				userId: "user-cobros",
				userRole: "cobros_supervisor",
			};

			try {
				await expect(
					call(wialonRouter.getWialonDiagnostics, undefined, {
						context: nonAdminContext as unknown as Context,
					}),
				).rejects.toThrow(ORPCError);
			} finally {
				// Restaurar el mock global (rol admin) para el resto de la suite.
				// Reusa mockDbAdmin para no perder `update` ni el select de vehículos
				// que necesitan los tests de CB-118 más abajo.
				mock.module("../db", () => ({ db: mockDbAdmin() }));
			}
		});
	});

	describe("testWialonConnection", () => {
		it("fuerza re-login vía checkHealth(true) y emite log de auditoría WIALON_CONNECTION_TESTED", async () => {
			const infoCalls: unknown[][] = [];
			const origInfo = console.info;
			console.info = (...args: unknown[]) => {
				infoCalls.push(args);
			};

			const mockFetch = async (_: unknown, init?: RequestInit) => {
				const bodyStr = String(init?.body || "");
				if (bodyStr.includes("token%2Flogin")) {
					return new Response(JSON.stringify({ eid: "sid-test-conn" }), {
						status: 200,
					});
				}
				return new Response(
					JSON.stringify({ totalItemsCount: 12, items: [] }),
					{ status: 200 },
				);
			};

			const testClient = new WialonClient({ token: "tok-test" }, mockFetch);
			setWialonClient(testClient);

			try {
				const mockContext = {
					headers: new Headers(),
					session: {
						user: { id: "user-admin-2", email: "admin2@example.com" },
					},
					user: {
						id: "user-admin-2",
						email: "admin2@example.com",
						role: "admin",
					},
					userId: "user-admin-2",
					userRole: "admin",
				};

				const res = await call(wialonRouter.testWialonConnection, undefined, {
					context: mockContext as unknown as Context,
				});

				expect(res.connected).toBe(true);
				expect(res.unitCount).toBe(12);

				const auditEntry = infoCalls.find(
					(c) => c[0] === "WIALON_CONNECTION_TESTED",
				);
				expect(auditEntry).toBeDefined();
				// adminProcedure (requireAdmin) no inyecta userId propio: el contexto.user
				// proviene del lookup de db (mockeado con id "user-test" en este archivo).
				const payload = auditEntry?.[1] as Record<string, unknown>;
				expect(payload.userId).toBe("user-test");
				expect(payload.userEmail).toBe("admin2@example.com");
				expect(payload.connected).toBe(true);
			} finally {
				console.info = origInfo;
				setWialonClient(null);
			}
		});

		it("propaga BAD_GATEWAY ante fallo upstream (a diferencia de getWialonDiagnostics)", async () => {
			const mockFetch = async () =>
				new Response(
					JSON.stringify({ error: 8, reason: "Invalid credentials" }),
					{ status: 200 },
				);

			const testClient = new WialonClient({ token: "tok-bad" }, mockFetch);
			setWialonClient(testClient);

			try {
				const mockContext = {
					headers: new Headers(),
					session: {
						user: { id: "user-admin-3", email: "admin3@example.com" },
					},
					user: {
						id: "user-admin-3",
						email: "admin3@example.com",
						role: "admin",
					},
					userId: "user-admin-3",
					userRole: "admin",
				};

				await expect(
					call(wialonRouter.testWialonConnection, undefined, {
						context: mockContext as unknown as Context,
					}),
				).rejects.toThrow(ORPCError);
			} finally {
				setWialonClient(null);
			}
		});

		it("audita el intento fallido con connected:false antes de propagar el error", async () => {
			const infoCalls: unknown[][] = [];
			const origInfo = console.info;
			console.info = (...args: unknown[]) => {
				infoCalls.push(args);
			};

			const mockFetch = async () =>
				new Response(
					JSON.stringify({ error: 8, reason: "Invalid credentials" }),
					{ status: 200 },
				);

			const testClient = new WialonClient({ token: "tok-bad" }, mockFetch);
			setWialonClient(testClient);

			try {
				const mockContext = {
					headers: new Headers(),
					session: {
						user: { id: "user-admin-4", email: "admin4@example.com" },
					},
					user: {
						id: "user-admin-4",
						email: "admin4@example.com",
						role: "admin",
					},
					userId: "user-admin-4",
					userRole: "admin",
				};

				await expect(
					call(wialonRouter.testWialonConnection, undefined, {
						context: mockContext as unknown as Context,
					}),
				).rejects.toThrow(ORPCError);

				const auditEntry = infoCalls.find(
					(c) => c[0] === "WIALON_CONNECTION_TESTED",
				);
				expect(auditEntry).toBeDefined();
				const payload = auditEntry?.[1] as Record<string, unknown>;
				// adminProcedure (requireAdmin) no inyecta userId propio: el
				// contexto.user proviene del lookup de db (mockeado en este archivo).
				expect(payload.userId).toBe("user-test");
				expect(payload.userEmail).toBe("admin4@example.com");
				expect(payload.connected).toBe(false);
				expect(payload.error).toBe("WIALON_API_ERROR");
			} finally {
				console.info = origInfo;
				setWialonClient(null);
			}
		});
	});

	describe("getWialonUnitsCatalog", () => {
		it("retorna el catálogo de unidades con rol admin", async () => {
			const mockFetch = async (_: unknown, init?: RequestInit) => {
				const bodyStr = String(init?.body || "");
				if (bodyStr.includes("token%2Flogin")) {
					return new Response(JSON.stringify({ eid: "sid-catalog" }), {
						status: 200,
					});
				}
				return new Response(
					JSON.stringify({
						totalItemsCount: 2,
						indexFrom: 0,
						indexTo: 2,
						items: [
							{ id: 1, nm: "Unidad 1" },
							{ id: 2, nm: "Unidad 2" },
						],
					}),
					{ status: 200 },
				);
			};

			const testClient = new WialonClient({ token: "tok-catalog" }, mockFetch);
			setWialonClient(testClient);

			try {
				const mockContext = {
					headers: new Headers(),
					session: {
						user: { id: "user-admin-4", email: "admin4@example.com" },
					},
					user: {
						id: "user-admin-4",
						email: "admin4@example.com",
						role: "admin",
					},
					userId: "user-admin-4",
					userRole: "admin",
				};

				const res = await call(wialonRouter.getWialonUnitsCatalog, undefined, {
					context: mockContext as unknown as Context,
				});

				expect(res.total).toBe(2);
				expect(res.items).toHaveLength(2);
			} finally {
				setWialonClient(null);
			}
		});

		it("fuerza flags:1 (básico) hacia Wialon, ignorando cualquier flags del input", async () => {
			const searchCalls: Record<string, unknown>[] = [];
			const mockFetch = async (_: unknown, init?: RequestInit) => {
				const bodyStr = String(init?.body || "");
				if (bodyStr.includes("token%2Flogin")) {
					return new Response(JSON.stringify({ eid: "sid-flags-test" }), {
						status: 200,
					});
				}
				const params = new URLSearchParams(bodyStr);
				const parsedParams = JSON.parse(params.get("params") || "{}");
				searchCalls.push(parsedParams);
				return new Response(
					JSON.stringify({
						totalItemsCount: 0,
						indexFrom: 0,
						indexTo: 0,
						items: [],
					}),
					{ status: 200 },
				);
			};

			const testClient = new WialonClient({ token: "tok-flags" }, mockFetch);
			setWialonClient(testClient);

			try {
				const mockContext = {
					headers: new Headers(),
					session: {
						user: { id: "user-admin-5", email: "admin5@example.com" },
					},
					user: {
						id: "user-admin-5",
						email: "admin5@example.com",
						role: "admin",
					},
					userId: "user-admin-5",
					userRole: "admin",
				};

				await call(wialonRouter.getWialonUnitsCatalog, undefined, {
					context: mockContext as unknown as Context,
				});

				expect(searchCalls).toHaveLength(1);
				expect(searchCalls[0]?.flags).toBe(1);
			} finally {
				setWialonClient(null);
			}
		});
	});

	describe("getWialonUnitsCatalog — créditos por unidad (CB-118)", () => {
		afterEach(() => {
			catalogoCreditosMock = [];
			catalogoCreditosContratoMock = [];
			setWialonClient(null);
		});

		it("muestra el SIFCO vinculado o deducido por placa de cada unidad", async () => {
			setWialonClient(
				new WialonClient({ token: "tok" }, async (_: unknown, init) => {
					const bodyStr = String(init?.body || "");
					if (bodyStr.includes("token%2Flogin")) {
						return new Response(JSON.stringify({ eid: "sid-cat" }), {
							status: 200,
						});
					}
					return new Response(
						JSON.stringify({
							totalItemsCount: 3,
							indexFrom: 0,
							indexTo: 2,
							items: [
								{ id: 1, nm: "P-720GVH SIN APAGADO" },
								{ id: 2, nm: "C-629BNC" },
								{ id: 3, nm: "A-04" },
							],
						}),
						{ status: 200 },
					);
				}),
			);
			catalogoCreditosMock = [
				// Vínculo guardado: manda sobre cualquier deducción.
				{
					wialonUnitId: 2,
					licensePlate: "C-629BNC",
					numeroSifco: "01010214100002",
				},
				// Sin vínculo, placa con "P0-": se deduce por núcleo.
				{
					wialonUnitId: null,
					licensePlate: "P0-720GVH",
					numeroSifco: "01010214100001",
				},
				// Mismo núcleo pero YA vinculado a otra unidad: no se deduce aquí.
				{
					wialonUnitId: 99,
					licensePlate: "P-720GVH",
					numeroSifco: "01010214199999",
				},
			];

			const res = await call(wialonRouter.getWialonUnitsCatalog, undefined, {
				context: {
					headers: new Headers(),
					session: { user: { id: "admin-c", email: "a@example.com" } },
					user: { id: "admin-c", email: "a@example.com", role: "admin" },
					userId: "admin-c",
					userRole: "admin",
				} as unknown as Context,
			});

			const porId = new Map(res.items.map((u) => [u.id, u.creditos]));
			expect(porId.get(1)).toEqual([
				{ numeroSifco: "01010214100001", origen: "placa" },
			]);
			expect(porId.get(2)).toEqual([
				{ numeroSifco: "01010214100002", origen: "vinculado" },
			]);
			expect(porId.get(3)).toEqual([]);
		});

		it("no deduce el SIFCO cuando dos unidades comparten la placa (ambiguo, igual que la ficha)", async () => {
			setWialonClient(
				new WialonClient({ token: "tok" }, async (_: unknown, init) => {
					const bodyStr = String(init?.body || "");
					if (bodyStr.includes("token%2Flogin")) {
						return new Response(JSON.stringify({ eid: "sid-cat" }), {
							status: 200,
						});
					}
					return new Response(
						JSON.stringify({
							totalItemsCount: 2,
							indexFrom: 0,
							indexTo: 1,
							items: [
								{ id: 1, nm: "P-720GVH SIN APAGADO" },
								{ id: 2, nm: "C-720GVH - CON APAGADO" },
							],
						}),
						{ status: 200 },
					);
				}),
			);
			catalogoCreditosMock = [
				{
					wialonUnitId: null,
					licensePlate: "P-720GVH",
					numeroSifco: "01010214100001",
				},
			];
			const res = await call(wialonRouter.getWialonUnitsCatalog, undefined, {
				context: {
					headers: new Headers(),
					session: { user: { id: "admin-c", email: "a@example.com" } },
					user: { id: "admin-c", email: "a@example.com", role: "admin" },
					userId: "admin-c",
					userRole: "admin",
				} as unknown as Context,
			});
			expect(res.items.map((u) => u.creditos)).toEqual([[], []]);
		});

		it("con filtro, detecta la ambigüedad contra el catálogo completo", async () => {
			// El filtro devuelve una sola unidad, pero el catálogo completo tiene
			// otra con el mismo núcleo: no se deduce.
			setWialonClient(
				new WialonClient({ token: "tok" }, async (_: unknown, init) => {
					const bodyStr = String(init?.body || "");
					if (bodyStr.includes("token%2Flogin")) {
						return new Response(JSON.stringify({ eid: "sid-cat" }), {
							status: 200,
						});
					}
					const params = JSON.parse(
						new URLSearchParams(bodyStr).get("params") || "{}",
					);
					const filtrado = params.spec?.propValueMask !== "*";
					const items = filtrado
						? [{ id: 1, nm: "P-720GVH SIN APAGADO" }]
						: [
								{ id: 1, nm: "P-720GVH SIN APAGADO" },
								{ id: 2, nm: "C-720GVH - CON APAGADO" },
							];
					return new Response(
						JSON.stringify({
							totalItemsCount: items.length,
							indexFrom: 0,
							indexTo: items.length - 1,
							items,
						}),
						{ status: 200 },
					);
				}),
			);
			catalogoCreditosMock = [
				{
					wialonUnitId: null,
					licensePlate: "P-720GVH",
					numeroSifco: "01010214100001",
				},
			];
			const res = await call(
				wialonRouter.getWialonUnitsCatalog,
				{ filterName: "SIN APAGADO" },
				{
					context: {
						headers: new Headers(),
						session: { user: { id: "admin-c", email: "a@example.com" } },
						user: { id: "admin-c", email: "a@example.com", role: "admin" },
						userId: "admin-c",
						userRole: "admin",
					} as unknown as Context,
				},
			);
			expect(res.items[0]?.creditos).toEqual([]);
		});

		it("toma también el crédito cuyo vehículo viene del contrato del caso", async () => {
			setWialonClient(
				new WialonClient({ token: "tok" }, async (_: unknown, init) => {
					const bodyStr = String(init?.body || "");
					if (bodyStr.includes("token%2Flogin")) {
						return new Response(JSON.stringify({ eid: "sid-cat" }), {
							status: 200,
						});
					}
					return new Response(
						JSON.stringify({
							totalItemsCount: 1,
							indexFrom: 0,
							indexTo: 0,
							items: [{ id: 1, nm: "P-720GVH SIN APAGADO" }],
						}),
						{ status: 200 },
					);
				}),
			);
			catalogoCreditosContratoMock = [
				{
					wialonUnitId: null,
					licensePlate: "P-720GVH",
					numeroSifco: "01010214100003",
				},
			];

			const res = await call(wialonRouter.getWialonUnitsCatalog, undefined, {
				context: {
					headers: new Headers(),
					session: { user: { id: "admin-c", email: "a@example.com" } },
					user: { id: "admin-c", email: "a@example.com", role: "admin" },
					userId: "admin-c",
					userRole: "admin",
				} as unknown as Context,
			});

			expect(res.items[0]?.creditos).toEqual([
				{ numeroSifco: "01010214100003", origen: "placa" },
			]);
		});

		it("con filtro, no invalida un vínculo automático cuya unidad no está en el resultado", async () => {
			// El filtro trae solo la unidad 6 (mismo núcleo). La 5, vinculada al
			// vehículo, no está en la lista: eso no la vuelve inválida, y el
			// crédito no debe pasar a la unidad 6 "por placa".
			setWialonClient(
				new WialonClient({ token: "tok" }, async (_: unknown, init) => {
					const bodyStr = String(init?.body || "");
					if (bodyStr.includes("token%2Flogin")) {
						return new Response(JSON.stringify({ eid: "sid-cat" }), {
							status: 200,
						});
					}
					return new Response(
						JSON.stringify({
							totalItemsCount: 1,
							indexFrom: 0,
							indexTo: 0,
							items: [{ id: 6, nm: "C-629BNC repuesto" }],
						}),
						{ status: 200 },
					);
				}),
			);
			catalogoCreditosMock = [
				{
					wialonUnitId: 5,
					wialonVinculadoPor: "auto:placa",
					licensePlate: "C-629BNC",
					numeroSifco: "01010214100009",
				},
			];
			const res = await call(
				wialonRouter.getWialonUnitsCatalog,
				{ filterName: "repuesto" },
				{
					context: {
						headers: new Headers(),
						session: { user: { id: "admin-c", email: "a@example.com" } },
						user: { id: "admin-c", email: "a@example.com", role: "admin" },
						userId: "admin-c",
						userRole: "admin",
					} as unknown as Context,
				},
			);
			expect(res.items[0]?.creditos).toEqual([]);
		});

		it("no cuenta como vinculado un vínculo automático que ya no coincide con la placa", async () => {
			setWialonClient(
				new WialonClient({ token: "tok" }, async (_: unknown, init) => {
					const bodyStr = String(init?.body || "");
					if (bodyStr.includes("token%2Flogin")) {
						return new Response(JSON.stringify({ eid: "sid-cat" }), {
							status: 200,
						});
					}
					return new Response(
						JSON.stringify({
							totalItemsCount: 1,
							indexFrom: 0,
							indexTo: 0,
							items: [{ id: 5, nm: "C-629BNC" }],
						}),
						{ status: 200 },
					);
				}),
			);
			catalogoCreditosMock = [
				{
					wialonUnitId: 5,
					wialonVinculadoPor: "auto:placa",
					licensePlate: "P-999ZZZ",
					numeroSifco: "01010214100009",
				},
			];
			const res = await call(wialonRouter.getWialonUnitsCatalog, undefined, {
				context: {
					headers: new Headers(),
					session: { user: { id: "admin-c", email: "a@example.com" } },
					user: { id: "admin-c", email: "a@example.com", role: "admin" },
					userId: "admin-c",
					userRole: "admin",
				} as unknown as Context,
			});
			expect(res.items[0]?.creditos).toEqual([]);
		});
	});

	describe("getGpsVehiculo (CB-118)", () => {
		const cobrosContext = {
			headers: new Headers(),
			session: { user: { id: "user-cob-1", email: "asesor@example.com" } },
			user: { id: "user-cob-1", email: "asesor@example.com", role: "admin" },
			userId: "user-cob-1",
			userRole: "admin",
		};

		const loginOk = (bodyStr: string) =>
			bodyStr.includes("token%2Flogin")
				? new Response(
						JSON.stringify({ eid: "sid-gps", user: { id: 1, nm: "GPS" } }),
						{ status: 200 },
					)
				: null;

		function clienteWialon(handler: (bodyStr: string) => Response) {
			return new WialonClient(
				{ token: "tok-gps" },
				async (_: unknown, init?: RequestInit) => {
					const bodyStr = String(init?.body || "");
					return loginOk(bodyStr) ?? handler(bodyStr);
				},
			);
		}

		afterEach(() => {
			filaVehiculoMock = null;
			errorSelectVehiculo = null;
			insertsGpsAuditoria = [];
			updatesVehiculo = [];
			setWialonClient(null);
		});

		it("devuelve telemetría y última señal cuando el vínculo ya está fijado", async () => {
			filaVehiculoMock = {
				licensePlate: "C-629BNC",
				wialonUnitId: 28554757,
				wialonUnitName: "Bidgar Yatz - C-629BNC",
			};
			setWialonClient(
				clienteWialon((bodyStr) => {
					if (bodyStr.includes("unit%2Fcalc_last")) {
						return new Response(
							JSON.stringify([
								{ i: 28554757, pos: { y: 14.6, x: -90.5, s: 12 } },
							]),
							{ status: 200 },
						);
					}
					if (bodyStr.includes("core%2Fsearch_item&")) {
						return new Response(
							JSON.stringify({
								item: { id: 28554757, nm: "u", lmsg: { t: 1773704628 } },
								flags: 1025,
							}),
							{ status: 200 },
						);
					}
					return new Response(JSON.stringify({}), { status: 200 });
				}),
			);

			const res = await call(
				wialonRouter.getGpsVehiculo,
				{
					casoCobroId: "33333333-3333-3333-3333-333333333333",
					vehicleId: "11111111-1111-1111-1111-111111111111",
					motivo: "Verificar ubicación para gestión de cobro",
				},
				{ context: cobrosContext as unknown as Context },
			);

			expect(res.estado).toBe("vinculado");
			if (res.estado !== "vinculado") throw new Error("estado inesperado");
			expect(res.unitId).toBe(28554757);
			expect(res.vinculoOrigen).toBe("persistido");
			expect(res.auditada).toBe(true);
			expect(res.placa).toBe("C-629BNC");
			expect(res.telemetria.latitude).toBe(14.6);
			expect(res.telemetria.ultimaSenalAt?.getTime()).toBe(1773704628 * 1000);
			// Sin pos.t no hay fecha de posición: la UI no puede decir "reciente".
			expect(res.telemetria.ultimaPosicionAt).toBeNull();

			// CB-118: "cada consulta queda auditada con usuario, motivo y cuenta".
			expect(insertsGpsAuditoria).toHaveLength(1);
			// El SIFCO de la bitácora sale del caso, no de lo que mande el cliente.
			expect(insertsGpsAuditoria[0]).toMatchObject({
				numeroCreditoSifco: "01010214100000",
				vehicleId: "11111111-1111-1111-1111-111111111111",
				motivo: "Verificar ubicación para gestión de cobro",
				unitId: "28554757",
				userId: "user-cob-1",
			});
		});

		it("audita la consulta aunque no encuentre unidad (motivo importa igual)", async () => {
			filaVehiculoMock = {
				licensePlate: null,
				wialonUnitId: null,
				wialonUnitName: null,
			};
			setWialonClient(clienteWialon(() => new Response("{}", { status: 200 })));

			const res = await call(
				wialonRouter.getGpsVehiculo,
				{
					casoCobroId: "33333333-3333-3333-3333-333333333333",
					vehicleId: "11111111-1111-1111-1111-111111111111",
					motivo: "Cliente en mora crítica, ubicar para recuperación",
				},
				{ context: cobrosContext as unknown as Context },
			);

			expect(res.estado).toBe("sin_vinculo");
			expect(insertsGpsAuditoria).toHaveLength(1);
			expect(insertsGpsAuditoria[0]).toMatchObject({
				motivo: "Cliente en mora crítica, ubicar para recuperación",
				unitId: null,
			});
		});

		it("rechaza un motivo demasiado corto sin llegar a consultar Wialon", async () => {
			await expect(
				call(
					wialonRouter.getGpsVehiculo,
					{
						casoCobroId: "33333333-3333-3333-3333-333333333333",
						vehicleId: "11111111-1111-1111-1111-111111111111",
						motivo: "ok",
					},
					{ context: cobrosContext as unknown as Context },
				),
			).rejects.toThrow();
			// Ni siquiera llegó a intentar auditar: la validación de zod corta antes.
			expect(insertsGpsAuditoria).toHaveLength(0);
		});

		it("rechaza un caso al que el asesor no tiene acceso, sin consultar ni auditar", async () => {
			accesoCasoMock = false;
			filaVehiculoMock = {
				licensePlate: "C-629BNC",
				wialonUnitId: 28554757,
				wialonUnitName: "u",
			};
			try {
				await expect(
					call(
						wialonRouter.getGpsVehiculo,
						{
							casoCobroId: "33333333-3333-3333-3333-333333333333",
							vehicleId: "11111111-1111-1111-1111-111111111111",
							motivo: "Verificar ubicación para gestión de cobro",
						},
						{ context: cobrosContext as unknown as Context },
					),
				).rejects.toMatchObject({ code: "NOT_FOUND" });
				expect(insertsGpsAuditoria).toHaveLength(0);
			} finally {
				accesoCasoMock = true;
			}
		});

		it("rechaza un vehículo que no es el del caso (caso propio + vehículo ajeno)", async () => {
			// Sin esta validación el gate de acceso se saltaba pasando el UUID de
			// un caso asignado junto con el vehículo de otro cliente.
			casoGpsMock = {
				casoSifco: "01010214100000",
				vehiculoOportunidad: null,
				vehiculoContrato: "99999999-9999-9999-9999-999999999999",
			};
			filaVehiculoMock = {
				licensePlate: "C-629BNC",
				wialonUnitId: 28554757,
				wialonUnitName: "u",
			};
			try {
				await expect(
					call(
						wialonRouter.getGpsVehiculo,
						{
							casoCobroId: "33333333-3333-3333-3333-333333333333",
							vehicleId: "11111111-1111-1111-1111-111111111111",
							motivo: "Verificar ubicación para gestión de cobro",
						},
						{ context: cobrosContext as unknown as Context },
					),
				).rejects.toMatchObject({ code: "NOT_FOUND" });
				expect(insertsGpsAuditoria).toHaveLength(0);
			} finally {
				casoGpsMock = {
					casoSifco: "01010214100000",
					vehiculoOportunidad: "11111111-1111-1111-1111-111111111111",
					vehiculoContrato: null,
				};
			}
		});

		it("no acepta el vehículo del contrato si no es el de la oportunidad (misma fuente que la ficha)", async () => {
			casoGpsMock = {
				casoSifco: "01010214100000",
				vehiculoOportunidad: null,
			};
			try {
				await expect(
					call(
						wialonRouter.getGpsVehiculo,
						{
							casoCobroId: "33333333-3333-3333-3333-333333333333",
							vehicleId: "11111111-1111-1111-1111-111111111111",
							motivo: "Verificar ubicación para gestión de cobro",
						},
						{ context: cobrosContext as unknown as Context },
					),
				).rejects.toMatchObject({ code: "NOT_FOUND" });
				expect(insertsGpsAuditoria).toHaveLength(0);
			} finally {
				casoGpsMock = {
					casoSifco: "01010214100000",
					vehiculoOportunidad: "11111111-1111-1111-1111-111111111111",
					vehiculoContrato: null,
				};
			}
		});

		it("resuelve por placa cuando no hay vínculo fijado", async () => {
			filaVehiculoMock = {
				licensePlate: "C-629BNC",
				wialonUnitId: null,
				wialonUnitName: null,
			};
			setWialonClient(
				clienteWialon((bodyStr) => {
					if (bodyStr.includes("core%2Fsearch_items")) {
						return new Response(
							JSON.stringify({
								totalItemsCount: 1,
								indexFrom: 0,
								indexTo: 0,
								items: [{ id: 999, nm: "Bidgar Yatz - C-629BNC" }],
							}),
							{ status: 200 },
						);
					}
					if (bodyStr.includes("unit%2Fcalc_last")) {
						return new Response(JSON.stringify([{ i: 999 }]), { status: 200 });
					}
					return new Response(
						JSON.stringify({ item: { id: 999, nm: "u" }, flags: 1025 }),
						{ status: 200 },
					);
				}),
			);

			const res = await call(
				wialonRouter.getGpsVehiculo,
				{
					casoCobroId: "33333333-3333-3333-3333-333333333333",
					vehicleId: "11111111-1111-1111-1111-111111111111",
					motivo: "Verificar ubicación para gestión de cobro",
				},
				{ context: cobrosContext as unknown as Context },
			);

			expect(res.estado).toBe("vinculado");
			if (res.estado !== "vinculado") throw new Error("estado inesperado");
			expect(res.unitId).toBe(999);
			expect(res.vinculoOrigen).toBe("placa");
			// Queda fijado para que la próxima consulta no recorra el catálogo,
			// marcado como deducción del sistema y no como decisión de un supervisor.
			expect(updatesVehiculo).toHaveLength(1);
			expect(updatesVehiculo[0]).toMatchObject({
				wialonUnitId: 999,
				wialonUnitName: "Bidgar Yatz - C-629BNC",
				wialonVinculadoPor: "auto:placa",
			});
		});

		it("no re-deduce una unidad que un supervisor reasignó a otro vehículo", async () => {
			// Tras reasignar el GPS al vehículo B, el A queda sin vínculo pero el
			// nombre de la unidad sigue con su placa: deducir de nuevo desharía la
			// reasignación y el crédito de A mostraría el carro B.
			unidadAsignadaAOtroMock = true;
			filaVehiculoMock = {
				licensePlate: "C-629BNC",
				wialonUnitId: null,
				wialonUnitName: null,
			};
			setWialonClient(
				clienteWialon(
					() =>
						new Response(
							JSON.stringify({
								totalItemsCount: 1,
								indexFrom: 0,
								indexTo: 0,
								items: [{ id: 999, nm: "Bidgar Yatz - C-629BNC" }],
							}),
							{ status: 200 },
						),
				),
			);
			try {
				const res = await call(
					wialonRouter.getGpsVehiculo,
					{
						casoCobroId: "33333333-3333-3333-3333-333333333333",
						vehicleId: "11111111-1111-1111-1111-111111111111",
						motivo: "Verificar ubicación para gestión de cobro",
					},
					{ context: cobrosContext as unknown as Context },
				);
				expect(res.estado).toBe("sin_vinculo");
				if (res.estado !== "sin_vinculo") throw new Error("estado inesperado");
				expect(res.motivo).toBe("asignada_a_otro");
				expect(res.candidatos).toEqual([
					{ id: 999, nm: "Bidgar Yatz - C-629BNC" },
				]);
				expect(updatesVehiculo).toHaveLength(0);
				expect(insertsGpsAuditoria).toHaveLength(1);
			} finally {
				unidadAsignadaAOtroMock = false;
			}
		});

		it("si un supervisor vinculó a mano durante la consulta, muestra SU unidad y no la deducida", async () => {
			filaVehiculoMock = {
				licensePlate: "C-629BNC",
				wialonUnitId: null,
				wialonUnitName: null,
				wialonVinculadoPor: null,
			};
			setWialonClient(
				clienteWialon((bodyStr) => {
					if (bodyStr.includes("core%2Fsearch_items")) {
						// El supervisor fija la unidad 555 mientras se recorre el
						// catálogo: el UPDATE condicional ya no encuentra la fila.
						filasAfectadasUpdate = 0;
						filaVehiculoMock = {
							licensePlate: "C-629BNC",
							wialonUnitId: 555,
							wialonUnitName: "Unidad elegida por supervisor",
							wialonVinculadoPor: "sup@example.com",
						};
						return new Response(
							JSON.stringify({
								totalItemsCount: 1,
								indexFrom: 0,
								indexTo: 0,
								items: [{ id: 999, nm: "Bidgar Yatz - C-629BNC" }],
							}),
							{ status: 200 },
						);
					}
					if (bodyStr.includes("unit%2Fcalc_last")) {
						return new Response(JSON.stringify([{ i: 555 }]), { status: 200 });
					}
					return new Response(
						JSON.stringify({ item: { id: 555, nm: "u" }, flags: 1025 }),
						{ status: 200 },
					);
				}),
			);
			try {
				const res = await call(
					wialonRouter.getGpsVehiculo,
					{
						casoCobroId: "33333333-3333-3333-3333-333333333333",
						vehicleId: "11111111-1111-1111-1111-111111111111",
						motivo: "Verificar ubicación para gestión de cobro",
					},
					{ context: cobrosContext as unknown as Context },
				);
				expect(res.estado).toBe("vinculado");
				if (res.estado !== "vinculado") throw new Error("estado inesperado");
				expect(res.unitId).toBe(555);
				expect(res.vinculoOrigen).toBe("persistido");
				expect(insertsGpsAuditoria).toHaveLength(1);
				expect(insertsGpsAuditoria[0]).toMatchObject({ unitId: "555" });
			} finally {
				filasAfectadasUpdate = 1;
			}
		});

		it("el guardado automático toma el lock de la unidad", async () => {
			locksUnidad = 0;
			filaVehiculoMock = {
				licensePlate: "C-629BNC",
				wialonUnitId: null,
				wialonUnitName: null,
			};
			setWialonClient(
				clienteWialon((bodyStr) =>
					bodyStr.includes("core%2Fsearch_items")
						? new Response(
								JSON.stringify({
									totalItemsCount: 1,
									indexFrom: 0,
									indexTo: 0,
									items: [{ id: 999, nm: "Bidgar Yatz - C-629BNC" }],
								}),
								{ status: 200 },
							)
						: bodyStr.includes("unit%2Fcalc_last")
							? new Response(JSON.stringify([{ i: 999 }]), { status: 200 })
							: new Response(
									JSON.stringify({ item: { id: 999, nm: "u" }, flags: 1025 }),
									{ status: 200 },
								),
				),
			);
			await call(
				wialonRouter.getGpsVehiculo,
				{
					casoCobroId: "33333333-3333-3333-3333-333333333333",
					vehicleId: "11111111-1111-1111-1111-111111111111",
					motivo: "Verificar ubicación para gestión de cobro",
				},
				{ context: cobrosContext as unknown as Context },
			);
			expect(locksUnidad).toBe(1);
		});

		it("informa auditada:false también en respuestas sin ubicación", async () => {
			// Sin esto la tarjeta decía "Consulta registrada" aunque la bitácora
			// no tuviera la fila (ej. vehículo sin placa + insert fallido).
			errorInsertAuditoria = new Error("db caída");
			filaVehiculoMock = {
				licensePlate: null,
				wialonUnitId: null,
				wialonUnitName: null,
			};
			setWialonClient(clienteWialon(() => new Response("{}", { status: 200 })));
			try {
				const res = await call(
					wialonRouter.getGpsVehiculo,
					{
						casoCobroId: "33333333-3333-3333-3333-333333333333",
						vehicleId: "11111111-1111-1111-1111-111111111111",
						motivo: "Verificar ubicación para gestión de cobro",
					},
					{ context: cobrosContext as unknown as Context },
				);
				expect(res.estado).toBe("sin_vinculo");
				expect(res.auditada).toBe(false);
			} finally {
				errorInsertAuditoria = null;
			}
		});

		it("si la auditoría falla no muestra la ubicación (fail closed)", async () => {
			errorInsertAuditoria = new Error(
				'relation "gps_consulta_logs" does not exist',
			);
			filaVehiculoMock = {
				licensePlate: "C-629BNC",
				wialonUnitId: 28554757,
				wialonUnitName: "Bidgar Yatz - C-629BNC",
			};
			const svcs: string[] = [];
			setWialonClient(
				clienteWialon((bodyStr) => {
					svcs.push(new URLSearchParams(bodyStr).get("svc") ?? "");
					return new Response("[]", { status: 200 });
				}),
			);
			try {
				const res = await call(
					wialonRouter.getGpsVehiculo,
					{
						casoCobroId: "33333333-3333-3333-3333-333333333333",
						vehicleId: "11111111-1111-1111-1111-111111111111",
						motivo: "Verificar ubicación para gestión de cobro",
					},
					{ context: cobrosContext as unknown as Context },
				);
				expect(res.estado).toBe("no_disponible");
				if (res.estado !== "no_disponible")
					throw new Error("estado inesperado");
				expect(res.error.code).toBe("AUDITORIA_NO_DISPONIBLE");
				// Ni siquiera se pidió la telemetría a Wialon.
				expect(svcs).not.toContain("unit/calc_last");
			} finally {
				errorInsertAuditoria = null;
			}
		});

		it("libera un vínculo automático si la placa ya no coincide y vuelve a deducir", async () => {
			// La placa se corrigió después de vincular (updateVehicle no toca el
			// vínculo): seguir usando la unidad vieja mostraría otro carro.
			filaVehiculoMock = {
				licensePlate: "P-999ZZZ",
				wialonUnitId: 28554757,
				wialonUnitName: "Bidgar Yatz - C-629BNC",
				wialonVinculadoPor: "auto:placa",
			};
			setWialonClient(
				clienteWialon((bodyStr) =>
					bodyStr.includes("core%2Fsearch_item&")
						? new Response(
								JSON.stringify({
									item: { id: 28554757, nm: "Bidgar Yatz - C-629BNC" },
									flags: 1,
								}),
								{ status: 200 },
							)
						: new Response(
								JSON.stringify({
									totalItemsCount: 0,
									indexFrom: 0,
									indexTo: 0,
									items: [],
								}),
								{ status: 200 },
							),
				),
			);
			const res = await call(
				wialonRouter.getGpsVehiculo,
				{
					casoCobroId: "33333333-3333-3333-3333-333333333333",
					vehicleId: "11111111-1111-1111-1111-111111111111",
					motivo: "Verificar ubicación para gestión de cobro",
				},
				{ context: cobrosContext as unknown as Context },
			);
			expect(res.estado).toBe("sin_vinculo");
			if (res.estado !== "sin_vinculo") throw new Error("estado inesperado");
			expect(res.motivo).toBe("sin_coincidencia");
			expect(updatesVehiculo[0]).toMatchObject({
				wialonUnitId: null,
				wialonVinculadoPor: null,
			});
		});

		it("libera un vínculo automático si la unidad se renombró en Wialon a otra placa", async () => {
			// El GPS se pasó a otro carro y lo renombraron en Wialon: el nombre
			// guardado al vincular todavía coincide, el actual ya no.
			filaVehiculoMock = {
				licensePlate: "C-629BNC",
				wialonUnitId: 28554757,
				wialonUnitName: "Bidgar Yatz - C-629BNC",
				wialonVinculadoPor: "auto:placa",
			};
			const svcs: string[] = [];
			setWialonClient(
				clienteWialon((bodyStr) => {
					svcs.push(new URLSearchParams(bodyStr).get("svc") ?? "");
					if (bodyStr.includes("core%2Fsearch_item&")) {
						return new Response(
							JSON.stringify({
								item: { id: 28554757, nm: "Otro Cliente - P-111AAA" },
								flags: 1,
							}),
							{ status: 200 },
						);
					}
					return new Response(
						JSON.stringify({
							totalItemsCount: 0,
							indexFrom: 0,
							indexTo: 0,
							items: [],
						}),
						{ status: 200 },
					);
				}),
			);
			const res = await call(
				wialonRouter.getGpsVehiculo,
				{
					casoCobroId: "33333333-3333-3333-3333-333333333333",
					vehicleId: "11111111-1111-1111-1111-111111111111",
					motivo: "Verificar ubicación para gestión de cobro",
				},
				{ context: cobrosContext as unknown as Context },
			);
			expect(res.estado).toBe("sin_vinculo");
			expect(updatesVehiculo[0]).toMatchObject({ wialonUnitId: null });
			// No se pidió la telemetría de la unidad vieja.
			expect(svcs).not.toContain("unit/calc_last");
		});

		it("si no puede liberar un vínculo vencido, no devuelve ubicación (fail closed)", async () => {
			errorUpdateVehiculo = new Error("db caída");
			filaVehiculoMock = {
				licensePlate: "P-999ZZZ",
				wialonUnitId: 28554757,
				wialonUnitName: "Bidgar Yatz - C-629BNC",
				wialonVinculadoPor: "auto:placa",
			};
			const svcs: string[] = [];
			setWialonClient(
				clienteWialon((bodyStr) => {
					svcs.push(new URLSearchParams(bodyStr).get("svc") ?? "");
					return new Response(
						JSON.stringify({
							item: { id: 28554757, nm: "Bidgar Yatz - C-629BNC" },
							flags: 1,
						}),
						{ status: 200 },
					);
				}),
			);
			try {
				const res = await call(
					wialonRouter.getGpsVehiculo,
					{
						casoCobroId: "33333333-3333-3333-3333-333333333333",
						vehicleId: "11111111-1111-1111-1111-111111111111",
						motivo: "Verificar ubicación para gestión de cobro",
					},
					{ context: cobrosContext as unknown as Context },
				);
				expect(res.estado).toBe("no_disponible");
				if (res.estado !== "no_disponible")
					throw new Error("estado inesperado");
				expect(res.error.code).toBe("VINCULO_NO_ACTUALIZADO");
				expect(svcs).not.toContain("unit/calc_last");
			} finally {
				errorUpdateVehiculo = null;
			}
		});

		it("una unidad borrada o invisible en Wialon (error 7) libera el vínculo automático", async () => {
			filaVehiculoMock = {
				licensePlate: "C-629BNC",
				wialonUnitId: 28554757,
				wialonUnitName: "Bidgar Yatz - C-629BNC",
				wialonVinculadoPor: "auto:placa",
			};
			setWialonClient(
				clienteWialon((bodyStr) =>
					bodyStr.includes("core%2Fsearch_item&")
						? new Response(JSON.stringify({ error: 7 }), { status: 200 })
						: new Response(
								JSON.stringify({
									totalItemsCount: 0,
									indexFrom: 0,
									indexTo: 0,
									items: [],
								}),
								{ status: 200 },
							),
				),
			);
			const res = await call(
				wialonRouter.getGpsVehiculo,
				{
					casoCobroId: "33333333-3333-3333-3333-333333333333",
					vehicleId: "11111111-1111-1111-1111-111111111111",
					motivo: "Verificar ubicación para gestión de cobro",
				},
				{ context: cobrosContext as unknown as Context },
			);
			// Queda sin vínculo (con selector para el supervisor), no trabado en
			// no_disponible con la unidad que ya no existe.
			expect(res.estado).toBe("sin_vinculo");
			expect(updatesVehiculo[0]).toMatchObject({ wialonUnitId: null });
		});

		it("un error transitorio de Wialon no libera el vínculo automático", async () => {
			filaVehiculoMock = {
				licensePlate: "C-629BNC",
				wialonUnitId: 28554757,
				wialonUnitName: "Bidgar Yatz - C-629BNC",
				wialonVinculadoPor: "auto:placa",
			};
			setWialonClient(
				new WialonClient({ token: "tok" }, async () => {
					throw new WialonClientError("Upstream caído", "WIALON_NETWORK_ERROR");
				}),
			);
			const res = await call(
				wialonRouter.getGpsVehiculo,
				{
					casoCobroId: "33333333-3333-3333-3333-333333333333",
					vehicleId: "11111111-1111-1111-1111-111111111111",
					motivo: "Verificar ubicación para gestión de cobro",
				},
				{ context: cobrosContext as unknown as Context },
			);
			expect(res.estado).toBe("no_disponible");
			expect(updatesVehiculo).toHaveLength(0);
		});

		it("no revalida contra la placa un vínculo que fijó un supervisor", async () => {
			filaVehiculoMock = {
				licensePlate: "P-999ZZZ",
				wialonUnitId: 28554757,
				wialonUnitName: "Bidgar Yatz - C-629BNC",
				wialonVinculadoPor: "sup@example.com",
			};
			setWialonClient(
				clienteWialon((bodyStr) =>
					bodyStr.includes("unit%2Fcalc_last")
						? new Response(JSON.stringify([{ i: 28554757 }]), { status: 200 })
						: new Response(
								JSON.stringify({
									item: { id: 28554757, nm: "u" },
									flags: 1025,
								}),
								{ status: 200 },
							),
				),
			);
			const res = await call(
				wialonRouter.getGpsVehiculo,
				{
					casoCobroId: "33333333-3333-3333-3333-333333333333",
					vehicleId: "11111111-1111-1111-1111-111111111111",
					motivo: "Verificar ubicación para gestión de cobro",
				},
				{ context: cobrosContext as unknown as Context },
			);
			expect(res.estado).toBe("vinculado");
			if (res.estado !== "vinculado") throw new Error("estado inesperado");
			expect(res.unitId).toBe(28554757);
			expect(res.vinculoOrigen).toBe("persistido");
			expect(updatesVehiculo).toHaveLength(0);
		});

		it("un vínculo guardado por deducción de placa se sigue mostrando como deducción", async () => {
			filaVehiculoMock = {
				licensePlate: "C-629BNC",
				wialonUnitId: 999,
				wialonUnitName: "Bidgar Yatz - C-629BNC",
				wialonVinculadoPor: "auto:placa",
			};
			setWialonClient(
				clienteWialon((bodyStr) =>
					bodyStr.includes("unit%2Fcalc_last")
						? new Response(JSON.stringify([{ i: 999 }]), { status: 200 })
						: new Response(
								JSON.stringify({
									item: { id: 999, nm: "Bidgar Yatz - C-629BNC" },
									flags: 1025,
								}),
								{ status: 200 },
							),
				),
			);

			const res = await call(
				wialonRouter.getGpsVehiculo,
				{
					casoCobroId: "33333333-3333-3333-3333-333333333333",
					vehicleId: "11111111-1111-1111-1111-111111111111",
					motivo: "Verificar ubicación para gestión de cobro",
				},
				{ context: cobrosContext as unknown as Context },
			);

			expect(res.estado).toBe("vinculado");
			if (res.estado !== "vinculado") throw new Error("estado inesperado");
			// Sin esto el supervisor perdería el atajo "¿No es esta la unidad?".
			expect(res.vinculoOrigen).toBe("placa");
			// Ya estaba fijado: no se vuelve a escribir.
			expect(updatesVehiculo).toHaveLength(0);
		});

		it("no adivina cuando varias unidades comparten la placa: devuelve candidatos", async () => {
			filaVehiculoMock = {
				licensePlate: "C-629BNC",
				wialonUnitId: null,
				wialonUnitName: null,
			};
			setWialonClient(
				clienteWialon(
					() =>
						new Response(
							JSON.stringify({
								totalItemsCount: 2,
								indexFrom: 0,
								indexTo: 1,
								items: [
									{ id: 1, nm: "Juan - C-629BNC" },
									{ id: 2, nm: "C-629BNC repuesto" },
								],
							}),
							{ status: 200 },
						),
				),
			);

			const res = await call(
				wialonRouter.getGpsVehiculo,
				{
					casoCobroId: "33333333-3333-3333-3333-333333333333",
					vehicleId: "11111111-1111-1111-1111-111111111111",
					motivo: "Verificar ubicación para gestión de cobro",
				},
				{ context: cobrosContext as unknown as Context },
			);

			expect(res.estado).toBe("sin_vinculo");
			if (res.estado !== "sin_vinculo") throw new Error("estado inesperado");
			expect(res.motivo).toBe("ambiguo");
			expect(res.candidatos).toHaveLength(2);
		});

		it("reporta sin_placa cuando el vehículo no tiene placa registrada", async () => {
			filaVehiculoMock = {
				licensePlate: null,
				wialonUnitId: null,
				wialonUnitName: null,
			};
			setWialonClient(clienteWialon(() => new Response("{}", { status: 200 })));

			const res = await call(
				wialonRouter.getGpsVehiculo,
				{
					casoCobroId: "33333333-3333-3333-3333-333333333333",
					vehicleId: "11111111-1111-1111-1111-111111111111",
					motivo: "Verificar ubicación para gestión de cobro",
				},
				{ context: cobrosContext as unknown as Context },
			);

			expect(res.estado).toBe("sin_vinculo");
			if (res.estado !== "sin_vinculo") throw new Error("estado inesperado");
			expect(res.motivo).toBe("sin_placa");
		});

		it("degrada a no_disponible con Wialon caído en vez de lanzar", async () => {
			// El tab Vehículo de la ficha no puede romperse porque el proveedor
			// esté caído: el resto de los datos del vehículo siguen sirviendo.
			filaVehiculoMock = {
				licensePlate: "C-629BNC",
				wialonUnitId: 28554757,
				wialonUnitName: "u",
			};
			setWialonClient(
				new WialonClient({ token: "tok" }, async () => {
					throw new WialonClientError("Upstream caído", "WIALON_NETWORK_ERROR");
				}),
			);

			const res = await call(
				wialonRouter.getGpsVehiculo,
				{
					casoCobroId: "33333333-3333-3333-3333-333333333333",
					vehicleId: "11111111-1111-1111-1111-111111111111",
					motivo: "Verificar ubicación para gestión de cobro",
				},
				{ context: cobrosContext as unknown as Context },
			);

			expect(res.estado).toBe("no_disponible");
		});

		it("registra una sola fila de auditoría si la telemetría falla tras resolver la unidad", async () => {
			// La resolución ya quedó auditada con la unidad; el catch no debe
			// sumar una segunda fila (con unitId null) por la misma consulta.
			filaVehiculoMock = {
				licensePlate: "C-629BNC",
				wialonUnitId: 28554757,
				wialonUnitName: "Bidgar Yatz - C-629BNC",
			};
			setWialonClient(
				clienteWialon(() => {
					throw new WialonClientError("Upstream caído", "WIALON_NETWORK_ERROR");
				}),
			);

			const res = await call(
				wialonRouter.getGpsVehiculo,
				{
					casoCobroId: "33333333-3333-3333-3333-333333333333",
					vehicleId: "11111111-1111-1111-1111-111111111111",
					motivo: "Verificar ubicación para gestión de cobro",
				},
				{ context: cobrosContext as unknown as Context },
			);

			expect(res.estado).toBe("no_disponible");
			expect(insertsGpsAuditoria).toHaveLength(1);
			expect(insertsGpsAuditoria[0]).toMatchObject({ unitId: "28554757" });
		});

		it("busca por los dígitos de la placa para encontrarla aunque el CRM la guarde con espacios", async () => {
			// Wialon filtra por subcadena literal: "*P - 278KJQ*" no trae
			// "P-278KJQ SIN APAGADO". El prefiltro va por dígitos y el match
			// normalizado descarta las unidades que solo comparten números.
			filaVehiculoMock = {
				licensePlate: "P - 278KJQ",
				wialonUnitId: null,
				wialonUnitName: null,
			};
			const filtros: string[] = [];
			setWialonClient(
				clienteWialon((bodyStr) => {
					if (bodyStr.includes("core%2Fsearch_items")) {
						const params = JSON.parse(
							new URLSearchParams(bodyStr).get("params") || "{}",
						);
						// getUnitsStatus también usa search_items (metadatos de
						// sensores por id); solo interesa la búsqueda por nombre.
						if (params.spec?.propName === "sys_name") {
							filtros.push(params.spec.propValueMask);
						}
						return new Response(
							JSON.stringify({
								totalItemsCount: 2,
								indexFrom: 0,
								indexTo: 1,
								items: [
									{ id: 501, nm: "P-278KJQ SIN APAGADO" },
									{ id: 502, nm: "C-278ABC" },
								],
							}),
							{ status: 200 },
						);
					}
					if (bodyStr.includes("unit%2Fcalc_last")) {
						return new Response(JSON.stringify([{ i: 501 }]), { status: 200 });
					}
					return new Response(
						JSON.stringify({ item: { id: 501, nm: "u" }, flags: 1025 }),
						{ status: 200 },
					);
				}),
			);

			const res = await call(
				wialonRouter.getGpsVehiculo,
				{
					casoCobroId: "33333333-3333-3333-3333-333333333333",
					vehicleId: "11111111-1111-1111-1111-111111111111",
					motivo: "Verificar ubicación para gestión de cobro",
				},
				{ context: cobrosContext as unknown as Context },
			);

			expect(filtros).toEqual(["*278*"]);
			expect(res.estado).toBe("vinculado");
			if (res.estado !== "vinculado") throw new Error("estado inesperado");
			expect(res.unitId).toBe(501);
		});

		it('una placa de relleno ("NUEVO") es sin_placa y no recorre el catálogo', async () => {
			filaVehiculoMock = {
				licensePlate: "NUEVO",
				wialonUnitId: null,
				wialonUnitName: null,
			};
			const svcs: string[] = [];
			setWialonClient(
				clienteWialon((bodyStr) => {
					svcs.push(new URLSearchParams(bodyStr).get("svc") ?? "");
					return new Response("{}", { status: 200 });
				}),
			);

			const res = await call(
				wialonRouter.getGpsVehiculo,
				{
					casoCobroId: "33333333-3333-3333-3333-333333333333",
					vehicleId: "11111111-1111-1111-1111-111111111111",
					motivo: "Verificar ubicación para gestión de cobro",
				},
				{ context: cobrosContext as unknown as Context },
			);

			expect(res.estado).toBe("sin_vinculo");
			if (res.estado !== "sin_vinculo") throw new Error("estado inesperado");
			expect(res.motivo).toBe("sin_placa");
			expect(svcs).not.toContain("core/search_items");
			// La consulta igual queda auditada: el motivo importa aunque no haya unidad.
			expect(insertsGpsAuditoria).toHaveLength(1);
		});

		it("en caso ambiguo solo ofrece como candidatos las unidades que coinciden con la placa", async () => {
			// El prefiltro por dígitos trae unidades de otras placas; no deben
			// aparecer como opción para el supervisor.
			filaVehiculoMock = {
				licensePlate: "C-629BNC",
				wialonUnitId: null,
				wialonUnitName: null,
			};
			setWialonClient(
				clienteWialon(
					() =>
						new Response(
							JSON.stringify({
								totalItemsCount: 3,
								indexFrom: 0,
								indexTo: 2,
								items: [
									{ id: 1, nm: "Juan - C-629BNC" },
									{ id: 2, nm: "C-629BNC repuesto" },
									{ id: 3, nm: "P-629XYZ" },
								],
							}),
							{ status: 200 },
						),
				),
			);

			const res = await call(
				wialonRouter.getGpsVehiculo,
				{
					casoCobroId: "33333333-3333-3333-3333-333333333333",
					vehicleId: "11111111-1111-1111-1111-111111111111",
					motivo: "Verificar ubicación para gestión de cobro",
				},
				{ context: cobrosContext as unknown as Context },
			);

			expect(res.estado).toBe("sin_vinculo");
			if (res.estado !== "sin_vinculo") throw new Error("estado inesperado");
			expect(res.motivo).toBe("ambiguo");
			expect(res.candidatos.map((c) => c.id)).toEqual([1, 2]);
		});

		it("sigue resolviendo por placa si las columnas de la migración 0057 no existen", async () => {
			// Deuda temporal: la 0057 está commiteada pero puede no estar aplicada.
			filaVehiculoMock = {
				licensePlate: "C-629BNC",
				wialonUnitId: 28554757,
				wialonUnitName: "u",
			};
			errorSelectVehiculo = new Error('column "wialon_unit_id" does not exist');
			setWialonClient(
				clienteWialon((bodyStr) => {
					if (bodyStr.includes("core%2Fsearch_items")) {
						return new Response(
							JSON.stringify({
								totalItemsCount: 1,
								indexFrom: 0,
								indexTo: 0,
								items: [{ id: 999, nm: "Bidgar Yatz - C-629BNC" }],
							}),
							{ status: 200 },
						);
					}
					if (bodyStr.includes("unit%2Fcalc_last")) {
						return new Response(JSON.stringify([{ i: 999 }]), { status: 200 });
					}
					return new Response(
						JSON.stringify({ item: { id: 999, nm: "u" }, flags: 1025 }),
						{ status: 200 },
					);
				}),
			);

			const res = await call(
				wialonRouter.getGpsVehiculo,
				{
					casoCobroId: "33333333-3333-3333-3333-333333333333",
					vehicleId: "11111111-1111-1111-1111-111111111111",
					motivo: "Verificar ubicación para gestión de cobro",
				},
				{ context: cobrosContext as unknown as Context },
			);

			// No lanza: cae al fallback y deduce por placa.
			expect(res.estado).toBe("vinculado");
			if (res.estado !== "vinculado") throw new Error("estado inesperado");
			expect(res.vinculoOrigen).toBe("placa");
		});
	});

	describe("vincularUnidadWialon (CB-118)", () => {
		it("guarda el vínculo y deja registro de auditoría con el usuario", async () => {
			const logs: unknown[][] = [];
			const originalInfo = console.info;
			console.info = (...args: unknown[]) => {
				logs.push(args);
			};

			try {
				const res = await call(
					wialonRouter.vincularUnidadWialon,
					{
						vehicleId: "11111111-1111-1111-1111-111111111111",
						unitId: 28554757,
						unitName: "Bidgar Yatz - C-629BNC",
					},
					{
						context: {
							headers: new Headers(),
							session: {
								user: { id: "user-sup", email: "sup@example.com" },
							},
							user: {
								id: "user-sup",
								email: "sup@example.com",
								role: "admin",
							},
							userId: "user-sup",
							userRole: "admin",
						} as unknown as Context,
					},
				);

				expect(res.success).toBe(true);
				expect(res.unitId).toBe(28554757);

				const auditoria = logs.find((l) => l[0] === "WIALON_UNIDAD_VINCULADA");
				expect(auditoria).toBeDefined();
				expect((auditoria?.[1] as Record<string, unknown>).userEmail).toBe(
					"sup@example.com",
				);
			} finally {
				console.info = originalInfo;
			}
		});
	});

	describe("vincularUnidadWialon — vehículo inexistente (CB-118)", () => {
		afterEach(() => {
			filasAfectadasUpdate = 1;
			updatesVehiculo = [];
		});

		it("responde NOT_FOUND en vez de success cuando el vehicleId no existe", async () => {
			filasAfectadasUpdate = 0;

			await expect(
				call(
					wialonRouter.vincularUnidadWialon,
					{
						vehicleId: "22222222-2222-2222-2222-222222222222",
						unitId: 28554757,
						unitName: "Bidgar Yatz - C-629BNC",
					},
					{
						context: {
							headers: new Headers(),
							session: {
								user: { id: "user-sup", email: "sup@example.com" },
							},
							user: {
								id: "user-sup",
								email: "sup@example.com",
								role: "admin",
							},
							userId: "user-sup",
							userRole: "admin",
						} as unknown as Context,
					},
				),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
		});

		it("al reasignar una unidad se la quita al vehículo que la tenía", async () => {
			// Si no, el crédito anterior seguiría mostrando la ubicación del
			// carro al que se pasó el GPS.
			const logs: unknown[][] = [];
			const originalInfo = console.info;
			console.info = (...args: unknown[]) => {
				logs.push(args);
			};
			try {
				await call(
					wialonRouter.vincularUnidadWialon,
					{
						vehicleId: "22222222-2222-2222-2222-222222222222",
						unitId: 28554757,
						unitName: "Bidgar Yatz - C-629BNC",
					},
					{
						context: {
							headers: new Headers(),
							session: {
								user: { id: "user-sup", email: "sup@example.com" },
							},
							user: {
								id: "user-sup",
								email: "sup@example.com",
								role: "admin",
							},
							userId: "user-sup",
							userRole: "admin",
						} as unknown as Context,
					},
				);
			} finally {
				console.info = originalInfo;
			}

			// Primero se libera la unidad en los demás vehículos, después se fija.
			expect(updatesVehiculo).toHaveLength(2);
			expect(updatesVehiculo[0]).toMatchObject({
				wialonUnitId: null,
				wialonVinculadoPor: null,
			});
			expect(updatesVehiculo[1]).toMatchObject({ wialonUnitId: 28554757 });
			// Serializado contra otra asignación simultánea de la misma unidad.
			expect(locksUnidad).toBeGreaterThan(0);
			const auditoria = logs.find((l) => l[0] === "WIALON_UNIDAD_VINCULADA");
			expect(
				(auditoria?.[1] as Record<string, unknown>).vehiculosDesvinculados,
			).toBeDefined();
		});
	});

	describe("getGpsBitacora (CB-118)", () => {
		const adminContext = {
			headers: new Headers(),
			session: { user: { id: "admin-1", email: "admin@example.com" } },
			user: { id: "admin-1", email: "admin@example.com", role: "admin" },
			userId: "admin-1",
			userRole: "admin",
		};

		afterEach(() => {
			bitacoraFilasMock = [];
			bitacoraTotalMock = 0;
		});

		it("lista la bitácora con paginación y datos del usuario que consultó", async () => {
			bitacoraFilasMock = [
				{
					id: "log-1",
					vehicleId: "11111111-1111-1111-1111-111111111111",
					numeroCreditoSifco: "01010214106660",
					motivo: "Cliente en mora crítica, ubicar para recuperación",
					unitId: "999",
					unitName: "P-278KJQ",
					userId: "user-cob-1",
					userNombre: "Wilson Gómez",
					userEmail: "wilson@example.com",
					createdAt: new Date("2026-09-23T10:00:00Z"),
				},
			];
			bitacoraTotalMock = 1;

			const res = await call(
				wialonRouter.getGpsBitacora,
				{ page: 1, perPage: 25 },
				{ context: adminContext as unknown as Context },
			);

			expect(res.total).toBe(1);
			expect(res.items).toHaveLength(1);
			expect(res.items[0]).toMatchObject({
				numeroCreditoSifco: "01010214106660",
				userNombre: "Wilson Gómez",
			});
		});

		it("devuelve página vacía sin explotar cuando no hay registros", async () => {
			bitacoraFilasMock = [];
			bitacoraTotalMock = 0;

			const res = await call(
				wialonRouter.getGpsBitacora,
				{ page: 1, perPage: 25 },
				{ context: adminContext as unknown as Context },
			);

			expect(res.total).toBe(0);
			expect(res.items).toHaveLength(0);
		});
	});
});
