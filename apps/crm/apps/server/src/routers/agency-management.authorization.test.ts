import { call } from "@orpc/server";
import { describe, expect, mock, test } from "bun:test";
import { ROLES } from "../lib/roles";

let currentRole: string = ROLES.ADMIN;

mock.module("../db", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => [{ id: "test-user", role: currentRole }],
				}),
			}),
		}),
	},
}));

const conSesion = { context: { session: { user: { id: "test-user" } } } } as never;
const sinSesion = { context: {} } as never;

const { agencyManagementProcedure } = await import("../lib/orpc");

const procedure = agencyManagementProcedure.handler(() => "allowed");

describe("agencyManagementProcedure", () => {
	for (const rol of [ROLES.ADMIN, ROLES.SALES_SUPERVISOR]) {
		test(`deja pasar a ${rol}`, async () => {
			currentRole = rol;
			await expect(call(procedure, undefined, conSesion)).resolves.toBe(
				"allowed",
			);
		});
	}

	for (const rol of Object.values(ROLES).filter(
		(r) => r !== ROLES.ADMIN && r !== ROLES.SALES_SUPERVISOR,
	)) {
		test(`rechaza a ${rol} con FORBIDDEN`, async () => {
			currentRole = rol;
			await expect(
				call(procedure, undefined, conSesion),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
		});
	}

	test("sin sesión responde UNAUTHORIZED", async () => {
		await expect(call(procedure, undefined, sinSesion)).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	test("expone userId y userRole al handler", async () => {
		currentRole = ROLES.SALES_SUPERVISOR;
		const p = agencyManagementProcedure.handler(({ context }) => ({
			id: context.userId,
			rol: context.userRole,
		}));
		await expect(call(p, undefined, conSesion)).resolves.toEqual({
			id: "test-user",
			rol: ROLES.SALES_SUPERVISOR,
		});
	});
});
