import { ORPCError } from "@orpc/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { companies } from "../db/schema/crm";
import { partnerMembers } from "../db/schema/partners";
import { vehicleVendors } from "../db/schema/vehicles";
import { errorDeMembresias, type MembresiaInput } from "./agency-sellers";
import { ROLES } from "./roles";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// `sellerId: null` = gerente de esa agencia; con un vendedor, solo ve sus
// oportunidades. Es obligatorio: omitirlo no puede dar por descuido el acceso
// más amplio.
export const membresiaSchema = z.object({
	companyId: z.string().uuid(),
	sellerId: z.string().uuid().nullable(),
});

/**
 * Deja al usuario con exactamente estas agencias, usando la transacción del
 * llamador. Nunca abre una propia: updateUserRole ya tiene la fila de `user`
 * bloqueada con FOR UPDATE en su propia transacción, y una segunda conexión
 * intentando el mismo bloqueo se quedaría esperando a sí misma.
 */
export async function reemplazarAgencias(
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

	// Las agencias que se mantienen conservan su desactivación: si no, editar
	// agencias reactivaría sin querer a quien un gerente desactivó.
	const actuales = await tx
		.select({
			companyId: partnerMembers.companyId,
			desactivadoAt: partnerMembers.desactivadoAt,
			desactivadoPor: partnerMembers.desactivadoPor,
		})
		.from(partnerMembers)
		.where(eq(partnerMembers.userId, userId));
	const desactivacion = new Map(actuales.map((a) => [a.companyId, a]));

	await tx.delete(partnerMembers).where(eq(partnerMembers.userId, userId));
	await tx.insert(partnerMembers).values(
		membresias.map((m) => ({
			userId,
			companyId: m.companyId,
			sellerId: m.sellerId,
			desactivadoAt: desactivacion.get(m.companyId)?.desactivadoAt ?? null,
			desactivadoPor: desactivacion.get(m.companyId)?.desactivadoPor ?? null,
		})),
	);
}

/**
 * Deja al usuario con exactamente estas agencias. Se usa al editar un socio ya
 * creado (setPartnerCompanies), para que asignar agencias nunca requiera SQL a
 * mano.
 */
export async function asignarAgencias(userId: string, membresias: MembresiaInput[]) {
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
