import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { companies } from "../db/schema/crm";
import { ORPCError } from "@orpc/server";
import { partnerManagerProcedure, partnerProcedure } from "../lib/orpc";
import {
	listarSociosDeAgencias,
	permisosDelGerente,
	recortarAlAlcance,
	type SocioDeAgencia,
} from "../lib/socios";

// Sin campos: el perfil siempre es el de quien llama. `.strict()` rechaza
// cualquier `userId` que alguien intente mandar para pedir el de otro.
const inputVacio = z.object({}).strict();

// Fila ya recortada a las agencias del gerente: el vendedor interno (`sellerId`)
// no sale, solo el rol que importa a la pantalla.
function aFila(recortado: SocioDeAgencia, gerenteId: string) {
	return {
		id: recortado.id,
		nombre: recortado.nombre,
		correo: recortado.correo,
		cuentaSuspendida: recortado.cuentaSuspendida,
		creadoEn: recortado.creadoEn,
		esYo: recortado.id === gerenteId,
		membresias: recortado.membresias.map((m) => ({
			companyId: m.companyId,
			companyNombre: m.companyNombre,
			rol: m.sellerId === null ? ("gerente" as const) : ("usuario" as const),
			telefono: m.telefono,
			activa: m.activa,
		})),
	};
}

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

	getUsuariosDeMiAgencia: partnerManagerProcedure.handler(async ({ context }) => {
		const socios = await listarSociosDeAgencias(context.agenciasGerente);
		return socios
			.map((s) => recortarAlAlcance(s, context.agenciasGerente))
			.map((s) => aFila(s, context.userId));
	}),

	getUsuarioDeMiAgencia: partnerManagerProcedure
		.input(z.object({ userId: z.string().min(1) }))
		.handler(async ({ context, input }) => {
			const socios = await listarSociosDeAgencias(context.agenciasGerente);
			const objetivo = socios.find((s) => s.id === input.userId);
			// Ajeno e inexistente responden igual: no se revela que existe.
			if (!objetivo) {
				throw new ORPCError("NOT_FOUND", { message: "Usuario no encontrado" });
			}
			// Los permisos se calculan con TODAS sus membresías (la regla del nombre
			// las necesita), pero lo que sale se recorta antes de responder.
			const permisos = permisosDelGerente(
				context.userId,
				context.agenciasGerente,
				objetivo,
			);
			return {
				...aFila(
					recortarAlAlcance(objetivo, context.agenciasGerente),
					context.userId,
				),
				permisos,
			};
		}),
};
