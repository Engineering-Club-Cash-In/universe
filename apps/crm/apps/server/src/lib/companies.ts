import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { db as Db } from "../db";
import { companies } from "../db/schema/crm";
import { PERMISSIONS } from "./roles";

export const crearEmpresaInput = z.object({
	name: z.string().min(1, "Company name is required"),
	razonSocial: z.string().trim().optional(),
	industry: z.string().optional(),
	size: z.string().optional(),
	website: z.string().optional(),
	address: z.string().optional(),
	phone: z.string().optional(),
	email: z.string().email().optional(),
	notes: z.string().optional(),
});

export const actualizarEmpresaInput = crearEmpresaInput.partial().extend({
	id: z.string().uuid(),
});

export type Actor = { userId: string; userRole: string };

/** Alta de empresa/agencia. Mismo comportamiento que tenía `createCompany`. */
export async function crearEmpresa(
	database: typeof Db,
	input: z.infer<typeof crearEmpresaInput>,
	actor: Actor,
) {
	// crmProcedure deja pasar a jurídico, que no da de alta empresas
	if (!PERMISSIONS.canCreateCompanies(actor.userRole)) {
		throw new ORPCError("FORBIDDEN", {
			message: "No tienes permiso para crear empresas",
		});
	}
	const [nueva] = await database
		.insert(companies)
		.values({ ...input, createdBy: actor.userId, updatedAt: new Date() })
		.returning();
	return nueva;
}

/**
 * Edición de empresa/agencia. Admin y supervisor de ventas editan cualquiera;
 * el resto solo las que creó.
 */
export async function actualizarEmpresa(
	database: typeof Db,
	input: z.infer<typeof actualizarEmpresaInput>,
	actor: Actor,
) {
	const { id, ...datos } = input;
	const where = PERMISSIONS.canManageAllCompanies(actor.userRole)
		? eq(companies.id, id)
		: and(eq(companies.id, id), eq(companies.createdBy, actor.userId));

	const filas = await database
		.update(companies)
		.set({ ...datos, updatedAt: new Date() })
		.where(where)
		.returning();

	if (filas.length === 0) {
		throw new ORPCError("NOT_FOUND", {
			message: "Empresa no encontrada o no tienes permiso para actualizarla",
		});
	}
	return filas[0];
}
