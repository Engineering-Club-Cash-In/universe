import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { companies } from "../db/schema/crm";
import { auditRecord } from "../lib/audit";
import {
	actualizarEmpresa,
	actualizarEmpresaInput,
	crearEmpresa,
	crearEmpresaInput,
} from "../lib/companies";
import { agencyManagementProcedure } from "../lib/orpc";
import { ROLES } from "../lib/roles";
import {
	actualizarDatosSocio,
	agregarMembresia,
	buscarCuentaPorCorreo,
	cambiarEstadoMembresia,
	crearSocio,
	DOMINIO_INTERNO,
	generarContrasenaTemporal,
	listarSociosDeAgencias,
	promoverMembresiaAGerente,
	type RevalidarMembresias,
	recortarAlAlcance,
	type SocioDeAgencia,
} from "../lib/socios";

const companyIdInput = z.object({ companyId: z.string().uuid() });

/**
 * Dependencias con efectos (socios, empresas, bitácora). Viajan por parámetro
 * para que las pruebas las sustituyan sin `mock.module`, que en bun vale para
 * todo el proceso y rompería las pruebas de esos módulos.
 *
 * La bitácora NO recibe `actor`: la sesión del CRM ya da el actor correcto,
 * incluso bajo suplantación (`impersonatedBy`). `actor` es solo para requests
 * sin sesión del CRM.
 */
export type AgencyManagersDeps = {
	actualizarDatosSocio: typeof actualizarDatosSocio;
	actualizarEmpresa: typeof actualizarEmpresa;
	agregarMembresia: typeof agregarMembresia;
	auditRecord: typeof auditRecord;
	buscarCuentaPorCorreo: typeof buscarCuentaPorCorreo;
	cambiarEstadoMembresia: typeof cambiarEstadoMembresia;
	crearEmpresa: typeof crearEmpresa;
	crearSocio: typeof crearSocio;
	generarContrasenaTemporal: typeof generarContrasenaTemporal;
	listarSociosDeAgencias: typeof listarSociosDeAgencias;
	promoverMembresiaAGerente: typeof promoverMembresiaAGerente;
};

const depsReales: AgencyManagersDeps = {
	actualizarDatosSocio,
	actualizarEmpresa,
	agregarMembresia,
	auditRecord,
	buscarCuentaPorCorreo,
	cambiarEstadoMembresia,
	crearEmpresa,
	crearSocio,
	generarContrasenaTemporal,
	listarSociosDeAgencias,
	promoverMembresiaAGerente,
};

async function exigirAgencia(companyId: string) {
	const [agencia] = await db
		.select()
		.from(companies)
		.where(eq(companies.id, companyId))
		.limit(1);
	if (!agencia) {
		throw new ORPCError("NOT_FOUND", { message: "Agencia no encontrada" });
	}
	return agencia;
}

/**
 * Los socios de esa agencia que son GERENTES de ella (partner con membresía
 * `sellerId NULL`), ya recortados a esa agencia: el supervisor ve al gerente
 * aquí, no sus otras agencias.
 */
async function gerentesDe(
	deps: AgencyManagersDeps,
	companyId: string,
): Promise<SocioDeAgencia[]> {
	const socios = await deps.listarSociosDeAgencias([companyId]);
	return socios
		.filter((s) =>
			s.membresias.some((m) => m.companyId === companyId && m.sellerId === null),
		)
		.map((s) => recortarAlAlcance(s, [companyId]));
}

/**
 * Acotamiento: un supervisor solo opera sobre gerentes partner de ESA agencia.
 * Admin, internos, vendedores o gerentes de otra agencia responden igual que
 * un id inexistente.
 */
async function exigirGerente(
	deps: AgencyManagersDeps,
	companyId: string,
	userId: string,
) {
	const gerente = (await gerentesDe(deps, companyId)).find((g) => g.id === userId);
	if (!gerente) {
		throw new ORPCError("NOT_FOUND", { message: "Gerente no encontrado" });
	}
	return gerente;
}

/**
 * `exigirGerente` lee antes de abrir la transacción de escritura; entre una y
 * otra pueden pasarlo de gerente a vendedor. Esto se ejecuta ya dentro de la
 * transacción, con el candado de `user` tomado y las membresías releídas, y
 * vuelve a exigir {companyId, sellerId: null}: si ya no es gerente de esa
 * agencia, aborta sin escribir. Sigue valiendo que esté inactivo.
 */
const sigueSiendoGerente =
	(companyId: string): RevalidarMembresias =>
	(membresias) => {
		if (!membresias.some((m) => m.companyId === companyId && m.sellerId === null)) {
			throw new ORPCError("NOT_FOUND", { message: "Gerente no encontrado" });
		}
	};

const filaGerente = (g: SocioDeAgencia, companyId: string) => ({
	id: g.id,
	nombre: g.nombre,
	correo: g.correo,
	cuentaSuspendida: g.cuentaSuspendida,
	creadoEn: g.creadoEn,
	activa: g.membresias.find((m) => m.companyId === companyId)?.activa ?? false,
});

export const crearAgencyManagersRouter = (deps: AgencyManagersDeps) => ({
	getAgencias: agencyManagementProcedure.handler(async () => {
		return await db.select().from(companies).orderBy(companies.name);
	}),

	getAgencia: agencyManagementProcedure
		.input(companyIdInput)
		.handler(({ input }) => exigirAgencia(input.companyId)),

	// `partner_member` es la entidad auditada más cercana: la bitácora no tiene
	// una para empresas/agencias y agregarla exige migración del enum.
	crearAgencia: agencyManagementProcedure
		.meta({ audit: { entity: "partner_member", action: "create_agencia" } })
		.input(crearEmpresaInput)
		.handler(async ({ input, context }) => {
			const creada = await deps.crearEmpresa(db, input, context);
			deps.auditRecord({
				entity: "partner_member",
				id: creada.id,
				action: "create_agencia",
				data: input,
			});
			return creada;
		}),

	editarAgencia: agencyManagementProcedure
		.meta({ audit: { entity: "partner_member", action: "update_agencia" } })
		.input(actualizarEmpresaInput)
		.handler(async ({ input, context }) => {
			const editada = await deps.actualizarEmpresa(db, input, context);
			deps.auditRecord({
				entity: "partner_member",
				id: editada.id,
				action: "update_agencia",
				data: input,
			});
			return editada;
		}),

	getGerentesDeAgencia: agencyManagementProcedure
		.input(companyIdInput)
		.handler(async ({ input }) =>
			(await gerentesDe(deps, input.companyId)).map((g) =>
				filaGerente(g, input.companyId),
			),
		),

	getGerenteDeAgencia: agencyManagementProcedure
		.input(companyIdInput.extend({ userId: z.string().min(1) }))
		.handler(async ({ input }) =>
			filaGerente(
				await exigirGerente(deps, input.companyId, input.userId),
				input.companyId,
			),
		),

	crearGerenteDeAgencia: agencyManagementProcedure
		.meta({ audit: { entity: "partner_member", action: "create_gerente" } })
		.input(
			companyIdInput.extend({
				nombre: z.string().trim().min(1, "El nombre es obligatorio"),
				correo: z.string().trim().toLowerCase().email("Correo inválido"),
				// Promover a un vendedor existente (o reactivar a un gerente
				// inactivo) amplía su alcance a toda la agencia: exige confirmar.
				confirmarPromocion: z.boolean().optional(),
			}),
		)
		.handler(async ({ input }) => {
			await exigirAgencia(input.companyId);

			// También con una cuenta que ya existe (p. ej. un socio creado por el
			// admin con correo interno): un gerente de agencia nunca ocupa el
			// correo de un empleado. El input ya viene en minúsculas.
			if (input.correo.endsWith(DOMINIO_INTERNO)) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Los correos @clubcashin.com no se pueden usar para un socio",
				});
			}

			const cuenta = await deps.buscarCuentaPorCorreo(input.correo);
			if (!cuenta) {
				const contrasenaTemporal = deps.generarContrasenaTemporal();
				const creado = await deps.crearSocio({
					nombre: input.nombre,
					correo: input.correo,
					contrasena: contrasenaTemporal,
					membresias: [{ companyId: input.companyId, sellerId: null }],
					// Un gerente de agencia nunca ocupa el correo de un empleado
					permitirDominioInterno: false,
				});
				deps.auditRecord({
					entity: "partner_member",
					id: creado.id,
					action: "create_gerente",
					data: { companyId: input.companyId },
				});
				return { userId: creado.id, contrasenaTemporal };
			}

			// Un usuario interno jamás se vuelve gerente de agencia
			if (cuenta.role !== ROLES.PARTNER) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Ese correo pertenece a un usuario interno",
				});
			}

			const socios = await deps.listarSociosDeAgencias([input.companyId]);
			const actual = socios
				.find((s) => s.id === cuenta.id)
				?.membresias.find((m) => m.companyId === input.companyId);

			if (!actual) {
				await deps.agregarMembresia(cuenta.id, {
					companyId: input.companyId,
					sellerId: null,
				});
			} else if (actual.sellerId === null && actual.activa) {
				throw new ORPCError("CONFLICT", {
					message: "Ese usuario ya es gerente de la agencia",
				});
			} else {
				// Sin confirmación no se escribe nada: un correo mal tipeado que
				// coincide con un vendedor no debe ampliarle el alcance en silencio.
				if (!input.confirmarPromocion) {
					throw new ORPCError("CONFLICT", {
						message:
							actual.sellerId === null
								? "Ese usuario fue gerente de la agencia y está inactivo. Confirma para reactivarlo."
								: actual.activa
									? "Ese usuario es vendedor de la agencia. Confirma para pasarlo a gerente: verá todas las oportunidades de la agencia."
									: // Promover reactiva: quien lo desactivó no lo habría querido de vuelta
										"Ese usuario es vendedor de la agencia. Está desactivado en esta agencia; confirmar lo reactiva como gerente, con acceso a todas las oportunidades de la agencia.",
						data: {
							requiereConfirmacion: true,
							eraVendedor: actual.sellerId !== null,
							activa: actual.activa,
						},
					});
				}
				await deps.promoverMembresiaAGerente(cuenta.id, input.companyId);
			}
			deps.auditRecord({
				entity: "partner_member",
				id: cuenta.id,
				action: "add_gerente",
				data: { companyId: input.companyId },
			});
			return { userId: cuenta.id, yaExistia: true as const };
		}),

	editarGerenteDeAgencia: agencyManagementProcedure
		.meta({ audit: { entity: "partner_member", action: "update_gerente" } })
		.input(
			companyIdInput.extend({
				userId: z.string().min(1),
				nombre: z.string().trim().min(1).optional(),
				// Activa/desactiva la membresía de ESTA agencia, no la cuenta
				activa: z.boolean().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			await exigirGerente(deps, input.companyId, input.userId);

			// Cada escritura se anota apenas ocurre: si la segunda falla, la
			// primera ya quedó en la bitácora.
			if (input.nombre !== undefined) {
				await deps.actualizarDatosSocio(
					input.userId,
					{ nombre: input.nombre },
					input.companyId,
					sigueSiendoGerente(input.companyId),
				);
				deps.auditRecord({
					entity: "partner_member",
					id: input.userId,
					action: "update_gerente",
					data: { companyId: input.companyId, nombre: input.nombre },
				});
			}
			if (input.activa !== undefined) {
				const cambio = await deps.cambiarEstadoMembresia(
					input.userId,
					input.companyId,
					input.activa,
					context.userId,
					sigueSiendoGerente(input.companyId),
				);
				// Solo se anota si la fila cambió de estado: pedir lo que ya estaba
				// no deja una entrada falsa en la bitácora.
				if (cambio) {
					deps.auditRecord({
						entity: "partner_member",
						id: input.userId,
						action: "update_gerente",
						data: { companyId: input.companyId, activa: input.activa },
					});
				}
			}
			return { success: true as const };
		}),
});

export const agencyManagersRouter = crearAgencyManagersRouter(depsReales);
