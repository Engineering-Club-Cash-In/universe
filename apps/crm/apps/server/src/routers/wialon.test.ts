import { describe, expect, it, mock } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import type { Context } from "../lib/context";
import {
	setWialonClient,
	WialonClient,
} from "../services/wialon/wialon-client";
import { WialonClientError } from "../services/wialon/wialon-types";
import { mapWialonErrorToOrpc, wialonRouter } from "./wialon";

mock.module("../db", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => [{ id: "user-test", role: "cobros_supervisor" }],
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

		it("mapea fallos upstream (códigos 5, 9, 10, 11) a BAD_GATEWAY", () => {
			for (const code of [5, 9, 10, 11]) {
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
	});
});
