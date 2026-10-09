import { ORPCError } from "@orpc/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { companies } from "../db/schema/crm";
import { partnerMembers } from "../db/schema/partners";
import { vehicleVendors } from "../db/schema/vehicles";
import { errorDeMembresias, type MembresiaInput } from "../lib/agency-sellers";
import { auth } from "../lib/auth";
import { adminProcedure } from "../lib/orpc";
import { ROLES, USER_ROLE_VALUES } from "../lib/roles";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Sin `sellerId` el usuario es gerente de esa agencia; con él, solo ve las
// oportunidades de ese vendedor.
const membresiaSchema = z.object({
	companyId: z.string().uuid(),
	sellerId: z.string().uuid().nullable().optional(),
});

/**
 * Deja al usuario con exactamente estas agencias, usando la transacción del
 * llamador. Nunca abre una propia: updateUserRole ya tiene la fila de `user`
 * bloqueada con FOR UPDATE en su propia transacción, y una segunda conexión
 * intentando el mismo bloqueo se quedaría esperando a sí misma.
 */
async function reemplazarAgencias(
	tx: Tx,
	userId: string,
	membresias: MembresiaInput[],
) {
	const companyIds = [...new Set(membresias.map((m) => m.companyId))];
	const existentes = await tx
		.select({ id: companies.id })
		.from(companies)
		.where(inArray(companies.id, companyIds));

	if (existentes.length !== companyIds.length) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Alguna de las agencias seleccionadas ya no existe",
		});
	}

	const sellerIds = membresias
		.map((m) => m.sellerId)
		.filter((id): id is string => !!id);
	const vendedores =
		sellerIds.length > 0
			? await tx
					.select({
						id: vehicleVendors.id,
						vendorType: vehicleVendors.vendorType,
						companyId: vehicleVendors.companyId,
					})
					.from(vehicleVendors)
					.where(inArray(vehicleVendors.id, sellerIds))
					// Que no los muevan de agencia mientras se asignan
					.for("share")
			: [];

	const error = errorDeMembresias(membresias, vendedores);
	if (error) {
		throw new ORPCError("BAD_REQUEST", { message: error });
	}

	await tx.delete(partnerMembers).where(eq(partnerMembers.userId, userId));
	await tx.insert(partnerMembers).values(
		membresias.map((m) => ({
			userId,
			companyId: m.companyId,
			sellerId: m.sellerId ?? null,
		})),
	);
}

/**
 * Deja al usuario con exactamente estas agencias. Se usa al editar un socio ya
 * creado (setPartnerCompanies), para que asignar agencias nunca requiera SQL a
 * mano.
 */
async function asignarAgencias(userId: string, membresias: MembresiaInput[]) {
	// En una transacción: si el insert falla —por ejemplo si borran una agencia
	// justo después de validarla— el socio se quedaría sin ninguna membresía y
	// sin poder entrar, en vez de conservar la asignación que ya tenía.
	await db.transaction(async (tx) => {
		const [objetivo] = await tx
			.select({ role: user.role })
			.from(user)
			.where(eq(user.id, userId))
			.for("update")
			.limit(1);

		if (!objetivo) {
			throw new ORPCError("NOT_FOUND", { message: "Usuario no encontrado" });
		}
		if (objetivo.role !== ROLES.PARTNER) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Solo los usuarios de predio/agencia llevan agencias",
			});
		}

		await reemplazarAgencias(tx, userId, membresias);
	});
}

export const adminRouter = {
	getStats: adminProcedure.handler(async ({ context: _ }) => {
		const totalUsers = await db.select().from(user);

		return {
			message: "This is admin-only data",
			adminStats: {
				totalUsers: totalUsers.length,
				totalSales: 150,
				revenue: "$50,000",
			},
		};
	}),

	// User CRUD operations
	getAllUsers: adminProcedure.handler(async ({ context: _ }) => {
		const users = await db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				role: user.role,
				banned: user.banned,
				emailVerified: user.emailVerified,
				createdAt: user.createdAt,
				updatedAt: user.updatedAt,
			})
			.from(user);

		const membresias = await db
			.select({
				userId: partnerMembers.userId,
				companyId: partnerMembers.companyId,
				agencia: companies.name,
				sellerId: partnerMembers.sellerId,
				vendedor: vehicleVendors.name,
			})
			.from(partnerMembers)
			.innerJoin(companies, eq(companies.id, partnerMembers.companyId))
			.leftJoin(vehicleVendors, eq(vehicleVendors.id, partnerMembers.sellerId));

		const agenciasPorUsuario = new Map<
			string,
			{
				id: string;
				nombre: string;
				sellerId: string | null;
				vendedor: string | null;
			}[]
		>();
		for (const m of membresias) {
			const lista = agenciasPorUsuario.get(m.userId) ?? [];
			lista.push({
				id: m.companyId,
				nombre: m.agencia.trim(),
				sellerId: m.sellerId ?? null,
				vendedor: m.vendedor?.trim() || null,
			});
			agenciasPorUsuario.set(m.userId, lista);
		}

		return users.map((u) => ({
			...u,
			agencias: (agenciasPorUsuario.get(u.id) ?? []).sort((a, b) =>
				a.nombre.localeCompare(b.nombre),
			),
		}));
	}),

	updateUserRole: adminProcedure
		.input(
			z.object({
				userId: z.string(),
				role: z.enum(USER_ROLE_VALUES),
				// Solo se usa (y se exige) cuando role === PARTNER, igual que en createUser.
				memberships: z.array(membresiaSchema).optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Prevent changing own role
			if (input.userId === context.session?.user?.id) {
				throw new ORPCError("FORBIDDEN", {
					message: "No puedes cambiar tu propio rol",
				});
			}

			// Los socios se crean con correo externo. Si pasan a un rol interno hay
			// que exigirles el mismo dominio que en el alta, o quedaría una identidad
			// externa con acceso al CRM.
			if (input.role !== ROLES.PARTNER) {
				const [objetivo] = await db
					.select({ email: user.email })
					.from(user)
					.where(eq(user.id, input.userId))
					.limit(1);

				if (objetivo && !objetivo.email.endsWith("@clubcashin.com")) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"Este correo es externo: solo puede tener el rol de predio/agencia",
					});
				}
			} else if (!input.memberships || input.memberships.length === 0) {
				// Mismo requisito que createUser: requirePartnerAccess (getCasos,
				// getCasoById) exige al menos una agencia, así que promover a alguien
				// a socio sin asignarle ninguna lo deja sin poder ver sus casos.
				throw new ORPCError("BAD_REQUEST", {
					message: "Selecciona al menos una agencia para el socio",
				});
			}

			// El rol y las membresías van juntos: si algo fallara después de cambiar
			// el rol, al devolverle el rol de socio recuperaría agencias viejas sin
			// que nadie las reasigne (o quedaría sin ninguna).
			const updatedUser = await db.transaction(async (tx) => {
				const actualizado = await tx
					.update(user)
					.set({
						role: input.role,
						updatedAt: new Date(),
					})
					.where(eq(user.id, input.userId))
					.returning();

				if (actualizado.length === 0) {
					throw new ORPCError("NOT_FOUND", {
						message: "Usuario no encontrado",
					});
				}

				if (input.role !== ROLES.PARTNER) {
					await tx
						.delete(partnerMembers)
						.where(eq(partnerMembers.userId, input.userId));
				} else if (input.memberships) {
					await reemplazarAgencias(tx, input.userId, input.memberships);
				}

				return actualizado;
			});

			return updatedUser[0];
		}),

	toggleUserSuspension: adminProcedure
		.input(
			z.object({
				userId: z.string(),
				banned: z.boolean(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Prevent suspending own account
			if (input.userId === context.session?.user?.id) {
				throw new ORPCError("FORBIDDEN", {
					message: "No puedes suspender tu propia cuenta",
				});
			}

			const updatedUser = await db
				.update(user)
				.set({
					banned: input.banned,
					updatedAt: new Date(),
				})
				.where(eq(user.id, input.userId))
				.returning();

			if (updatedUser.length === 0) {
				throw new ORPCError("NOT_FOUND", { message: "Usuario no encontrado" });
			}

			return updatedUser[0];
		}),

	deleteUser: adminProcedure
		.input(
			z.object({
				userId: z.string(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Prevent deleting own account
			if (input.userId === context.session?.user?.id) {
				throw new ORPCError("FORBIDDEN", {
					message: "No puedes eliminar tu propia cuenta",
				});
			}

			const deletedUser = await db
				.delete(user)
				.where(eq(user.id, input.userId))
				.returning();

			if (deletedUser.length === 0) {
				throw new ORPCError("NOT_FOUND", { message: "Usuario no encontrado" });
			}

			return { success: true, deletedUser: deletedUser[0] };
		}),

	createUser: adminProcedure
		.input(
			z.object({
				name: z.string().min(1, "Name is required"),
				email: z.string().email("Invalid email address"),
				password: z.string().min(8, "Password must be at least 8 characters"),
				role: z
					.enum(USER_ROLE_VALUES)
					.default("sales"),
				memberships: z.array(membresiaSchema).optional(),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			// Los socios (predios/agencias) son externos y usan su propio correo.
			if (
				input.role !== ROLES.PARTNER &&
				!input.email.endsWith("@clubcashin.com")
			) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Solo se permiten correos @clubcashin.com",
				});
			}

			const esSocio = input.role === ROLES.PARTNER;
			const agencias = input.memberships ?? [];

			if (esSocio && agencias.length === 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Selecciona al menos una agencia para el socio",
				});
			}
			if (!esSocio && agencias.length > 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Solo los usuarios de predio/agencia llevan agencias",
				});
			}

			// Use Better Auth's admin createUser API
			const result = await auth.api.createUser({
				body: {
					name: input.name,
					email: input.email,
					password: input.password,
					role: input.role,
				},
			});

			if (!result.user) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Error al crear usuario",
				});
			}

			if (esSocio) {
				try {
					await asignarAgencias(result.user.id, agencias);
				} catch (error) {
					// Un socio sin agencias no puede entrar a nada: mejor no dejarlo a medias.
					await db.delete(user).where(eq(user.id, result.user.id));
					throw error;
				}
			}

			return result.user;
		}),

	// Permite corregir las agencias de un socio ya creado sin tocar la BD a mano.
	setPartnerCompanies: adminProcedure
		.input(
			z.object({
				userId: z.string(),
				memberships: z
					.array(membresiaSchema)
					.min(1, "Selecciona al menos una agencia"),
			}),
		)
		.handler(async ({ input }) => {
			// La verificación de rol vive dentro de asignarAgencias, junto al
			// bloqueo de la fila, para que no se pueda colar un cambio de rol.
			await asignarAgencias(input.userId, input.memberships);
			return { success: true };
		}),
};
