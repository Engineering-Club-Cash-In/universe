/**
 * CB-041 — changeNotificationStatus rechaza resolver/descartar a mano las
 * notificaciones del flujo de inmovilización (review de Codex, PR #1758):
 * esos avisos se cierran SOLO por su propio flujo de negocio
 * (decidirInmovilizacion, registrarResultadoLlamada /
 * registrarLlamadaReactivacion), nunca desde el botón "Resolver" genérico.
 *
 * Mock de `db` propio, mismo criterio que inmovilizacion-unidad.test.ts:
 * identifica ramas por TABLA.
 */
import { afterEach, describe, expect, it, mock } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { user } from "../db/schema/auth";
import { notifications } from "../db/schema/notifications";
import type { Context } from "../lib/context";

let cobrosTipoMock: string | null = "inmovilizacion_pendiente_aprobacion";
let assignedToRoleMock = "cobros_supervisor";
let assignedToMock = "user-test";
let notifStatusMock = "pending";
let updateLlamado = false;
let updateDevuelveFila = true;

function mockDb() {
	return {
		select: (campos?: Record<string, unknown>) => ({
			from: (tabla: unknown) => {
				if (tabla === user) {
					return {
						where: () => ({
							limit: async () => [{ role: "cobros_supervisor" }],
						}),
					};
				}
				if (tabla === notifications && campos && "cobrosTipo" in campos) {
					return {
						where: () => ({
							limit: async () => [
								{
									status: notifStatusMock,
									type: "action_required",
									cobrosTipo: cobrosTipoMock,
									assignedToRole: assignedToRoleMock,
									assignedTo: assignedToMock,
								},
							],
						}),
					};
				}
				throw new Error(`select from tabla no mockeada: ${String(tabla)}`);
			},
		}),
		update: (tabla: unknown) => {
			if (tabla === notifications) {
				return {
					set: () => ({
						where: () => ({
							returning: async () => {
								updateLlamado = true;
								return updateDevuelveFila
									? [
											{
												id: "11111111-1111-1111-1111-111111111111",
												status: "resolved",
											},
										]
									: [];
							},
						}),
					}),
				};
			}
			throw new Error(`update en tabla no mockeada: ${String(tabla)}`);
		},
	};
}

mock.module("../db", () => ({ db: mockDb() }));

const { notificationsRouter } = await import("./notifications");

function reset() {
	cobrosTipoMock = "inmovilizacion_pendiente_aprobacion";
	assignedToRoleMock = "cobros_supervisor";
	assignedToMock = "user-test";
	notifStatusMock = "pending";
	updateLlamado = false;
	updateDevuelveFila = true;
}

function ctx(): Context {
	return {
		session: { user: { id: "user-test", email: "u@example.com" } },
		userId: "user-test",
	} as unknown as Context;
}

describe("CB-041 — changeNotificationStatus bloquea resolución manual del flujo de inmovilización", () => {
	afterEach(reset);

	it("inmovilizacion_pendiente_aprobacion: resolved rechaza con BAD_REQUEST", async () => {
		await expect(
			call(
				notificationsRouter.changeNotificationStatus,
				{
					notificationId: "11111111-1111-1111-1111-111111111111",
					status: "resolved",
				},
				{ context: ctx() },
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(updateLlamado).toBe(false);
	});

	it("inmovilizacion_pendiente_aprobacion: dismissed rechaza con BAD_REQUEST", async () => {
		await expect(
			call(
				notificationsRouter.changeNotificationStatus,
				{
					notificationId: "11111111-1111-1111-1111-111111111111",
					status: "dismissed",
				},
				{ context: ctx() },
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(updateLlamado).toBe(false);
	});

	it("inmovilizacion_llamar_cliente: resolved rechaza con BAD_REQUEST", async () => {
		cobrosTipoMock = "inmovilizacion_llamar_cliente";
		assignedToRoleMock = "cobros";
		await expect(
			call(
				notificationsRouter.changeNotificationStatus,
				{
					notificationId: "11111111-1111-1111-1111-111111111111",
					status: "resolved",
				},
				{ context: ctx() },
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(updateLlamado).toBe(false);
	});

	it("inmovilizacion_pendiente_aprobacion: 'read' SÍ se permite (no es resolución)", async () => {
		const res = await call(
			notificationsRouter.changeNotificationStatus,
			{
				notificationId: "11111111-1111-1111-1111-111111111111",
				status: "read",
			},
			{ context: ctx() },
		);
		expect(res.status).toBe("resolved"); // lo que devuelve el mock del UPDATE
		expect(updateLlamado).toBe(true);
	});

	it("inmovilizacion_resuelta (aviso informativo, no bloqueado): resolved SÍ se permite", async () => {
		cobrosTipoMock = "inmovilizacion_resuelta";
		assignedToRoleMock = "cobros";
		const res = await call(
			notificationsRouter.changeNotificationStatus,
			{
				notificationId: "11111111-1111-1111-1111-111111111111",
				status: "resolved",
			},
			{ context: ctx() },
		);
		expect(res.status).toBe("resolved");
		expect(updateLlamado).toBe(true);
	});

	it("otro cobrosTipo (no del flujo de inmovilización): resolved SÍ se permite", async () => {
		cobrosTipoMock = "promesa_incumplida";
		const res = await call(
			notificationsRouter.changeNotificationStatus,
			{
				notificationId: "11111111-1111-1111-1111-111111111111",
				status: "resolved",
			},
			{ context: ctx() },
		);
		expect(res.status).toBe("resolved");
		expect(updateLlamado).toBe(true);
	});

	it("cobrosTipo null (notificación de otro módulo, no de cobros): resolved SÍ se permite", async () => {
		cobrosTipoMock = null;
		const res = await call(
			notificationsRouter.changeNotificationStatus,
			{
				notificationId: "11111111-1111-1111-1111-111111111111",
				status: "resolved",
			},
			{ context: ctx() },
		);
		expect(res.status).toBe("resolved");
		expect(updateLlamado).toBe(true);
	});

	it("inmovilizacion_pendiente_aprobacion ya en 'resolved': reabrir a 'pending' rechaza con BAD_REQUEST (review de Codex)", async () => {
		notifStatusMock = "resolved";
		await expect(
			call(
				notificationsRouter.changeNotificationStatus,
				{
					notificationId: "11111111-1111-1111-1111-111111111111",
					status: "pending",
				},
				{ context: ctx() },
			),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message:
				"No se puede reabrir una notificación de inmovilización que ya fue resuelta.",
		});
		expect(updateLlamado).toBe(false);
	});

	it("inmovilizacion_llamar_cliente ya en 'resolved': reabrir a 'read' o 'in_progress' rechaza con BAD_REQUEST (review de Codex)", async () => {
		cobrosTipoMock = "inmovilizacion_llamar_cliente";
		assignedToRoleMock = "cobros";
		notifStatusMock = "resolved";
		await expect(
			call(
				notificationsRouter.changeNotificationStatus,
				{
					notificationId: "11111111-1111-1111-1111-111111111111",
					status: "read",
				},
				{ context: ctx() },
			),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message:
				"No se puede reabrir una notificación de inmovilización que ya fue resuelta.",
		});
		expect(updateLlamado).toBe(false);
	});

	it("inmovilizacion_llamar_cliente ya en 'dismissed': reabrir a 'in_progress' rechaza con BAD_REQUEST (review de Codex)", async () => {
		cobrosTipoMock = "inmovilizacion_llamar_cliente";
		assignedToRoleMock = "cobros";
		notifStatusMock = "dismissed";
		await expect(
			call(
				notificationsRouter.changeNotificationStatus,
				{
					notificationId: "11111111-1111-1111-1111-111111111111",
					status: "in_progress",
				},
				{ context: ctx() },
			),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message:
				"No se puede reabrir una notificación de inmovilización que ya fue resuelta.",
		});
		expect(updateLlamado).toBe(false);
	});

	it("carrera: si la notificación se resolvió concurrentemente antes del UPDATE, el UPDATE condicionado no afecta filas y rechaza con BAD_REQUEST (review de Codex)", async () => {
		// El SELECT inicial ve la notificación en 'pending' (pasa el guard temprano),
		// pero antes del UPDATE el flujo de negocio la resolvió → el UPDATE atómico condicionado a status abierto no devuelve filas.
		notifStatusMock = "pending";
		updateDevuelveFila = false;

		await expect(
			call(
				notificationsRouter.changeNotificationStatus,
				{
					notificationId: "11111111-1111-1111-1111-111111111111",
					status: "read",
				},
				{ context: ctx() },
			),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message:
				"No se puede reabrir una notificación de inmovilización que ya fue resuelta.",
		});
		expect(updateLlamado).toBe(true);
	});

	it("b3_llamada_supervisor (CB-035): resolved/dismissed a mano rechaza y reabrir una terminal usa el texto genérico", async () => {
		cobrosTipoMock = "b3_llamada_supervisor";
		notifStatusMock = "pending";
		for (const status of ["resolved", "dismissed"] as const) {
			await expect(
				call(
					notificationsRouter.changeNotificationStatus,
					{ notificationId: "11111111-1111-1111-1111-111111111111", status },
					{ context: ctx() },
				),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
		}
		notifStatusMock = "resolved";
		await expect(
			call(
				notificationsRouter.changeNotificationStatus,
				{
					notificationId: "11111111-1111-1111-1111-111111111111",
					status: "pending",
				},
				{ context: ctx() },
			),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message:
				"No se puede reabrir una notificación de un flujo de cobros que ya fue resuelta.",
		});
	});
});
