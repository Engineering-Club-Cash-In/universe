import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { companies } from "../db/schema/crm";
import { partnerProcedure } from "../lib/orpc";

// Sin campos: el perfil siempre es el de quien llama. `.strict()` rechaza
// cualquier `userId` que alguien intente mandar para pedir el de otro.
const inputVacio = z.object({}).strict();

export const trackerUsuariosRouter = {
	getMiPerfil: partnerProcedure.input(inputVacio).handler(async ({ context }) => {
		// Solo `context.userId`/`membresias`/`user`: salen de la sesión del socio y
		// de sus membresías activas, nunca del input.
		const filas = await db
			.select({ id: companies.id, name: companies.name })
			.from(companies)
			.where(inArray(companies.id, context.companyIds))
			.orderBy(companies.name);

		const rolPorAgencia = new Map(
			context.membresias.map((m) => [
				m.companyId,
				m.sellerId === null ? ("gerente" as const) : ("usuario" as const),
			]),
		);

		return {
			nombre: context.user.name,
			correo: context.user.email,
			agencias: filas
				.filter((a) => rolPorAgencia.has(a.id))
				.map((a) => ({
					id: a.id,
					nombre: a.name,
					rol: rolPorAgencia.get(a.id) as "gerente" | "usuario",
				})),
		};
	}),
};
