import { describe, expect, it, mock } from "bun:test";
import { call, ORPCError } from "@orpc/server";
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
mock.module("../db", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => [{ id: "user-test", role: "admin" }],
				}),
			}),
		}),
	},
}));

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
				// Restaurar el mock global (rol admin) para el resto de la suite
				mock.module("../db", () => ({
					db: {
						select: () => ({
							from: () => ({
								where: () => ({
									limit: async () => [{ id: "user-test", role: "admin" }],
								}),
							}),
						}),
					},
				}));
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
});
