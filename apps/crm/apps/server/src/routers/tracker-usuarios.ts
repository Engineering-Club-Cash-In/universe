import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { companies } from "../db/schema/crm";
import { ORPCError } from "@orpc/server";
import { partnerManagerProcedure, partnerProcedure } from "../lib/orpc";
import { auditRecord } from "../lib/audit";
import { ROLES } from "../lib/roles";
import {
	actualizarDatosSocio,
	cambiarEstadoMembresia,
	crearSocio,
	generarContrasenaTemporal,
	listarSociosDeAgencias,
	permisosDelGerente,
	recortarAlAlcance,
	type MembresiaRevalidable,
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

type EdicionPedida = {
	agenciaId: string;
	nombre?: string;
	telefono?: string;
	activa?: boolean;
};

// Lanza FORBIDDEN con el motivo de la regla si algo de lo pedido no está
// permitido. Lo usan el chequeo previo y la revalidación dentro de la transacción.
function exigirPermiso(
	permisos: ReturnType<typeof permisosDelGerente>,
	input: EdicionPedida,
): void {
	const enAgencia = permisos.porAgencia[input.agenciaId];
	if (input.nombre !== undefined && !permisos.puedeEditarNombre) {
		throw new ORPCError("FORBIDDEN", { message: permisos.motivoNombre });
	}
	if (input.telefono !== undefined && !enAgencia?.puedeEditarTelefono) {
		throw new ORPCError("FORBIDDEN", { message: enAgencia?.motivo });
	}
	if (input.activa !== undefined && !enAgencia?.puedeActivar) {
		throw new ORPCError("FORBIDDEN", { message: enAgencia?.motivo });
	}
}

// Mismo socio, con las membresías releídas dentro de la transacción: permisosDelGerente
// solo mira companyId y sellerId (los demás campos no entran en la regla).
function comoSocio(
	objetivo: SocioDeAgencia,
	membresias: MembresiaRevalidable[],
): SocioDeAgencia {
	return {
		...objetivo,
		membresias: membresias.map((m) => ({
			companyId: m.companyId,
			companyNombre: "",
			sellerId: m.sellerId,
			telefono: null,
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

	crearUsuarioDeMiAgencia: partnerManagerProcedure
		.input(
			z.object({
				agenciaId: z.string().uuid(),
				nombre: z.string().trim().min(1).max(200),
				correo: z.string().trim().email().max(320),
				telefono: z.string().trim().max(30).optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			// Una agencia donde no es gerente responde igual que una inexistente.
			if (!context.agenciasGerente.includes(input.agenciaId)) {
				throw new ORPCError("NOT_FOUND", { message: "Agencia no encontrada" });
			}
			const contrasenaTemporal = generarContrasenaTemporal();
			const creado = await crearSocio({
				nombre: input.nombre,
				correo: input.correo,
				contrasena: contrasenaTemporal,
				membresias: [],
				// Un gerente no puede ocupar el correo de un empleado.
				permitirDominioInterno: false,
				vendedorNuevo: { companyId: input.agenciaId, telefono: input.telefono },
			});
			// Sin la contraseña en la bitácora.
			auditRecord({
				entity: "partner_member",
				id: creado.id,
				action: "create",
				data: { agenciaId: input.agenciaId, correo: creado.email },
				actor: { id: context.userId, role: ROLES.PARTNER },
			});
			return { userId: creado.id, contrasenaTemporal };
		}),

	editarUsuarioDeMiAgencia: partnerManagerProcedure
		.input(
			z
				.object({
					userId: z.string().min(1),
					agenciaId: z.string().uuid(),
					nombre: z.string().trim().min(1).max(200).optional(),
					telefono: z.string().trim().max(30).optional(),
					activa: z.boolean().optional(),
				})
				.refine(
					(i) =>
						i.nombre !== undefined ||
						i.telefono !== undefined ||
						i.activa !== undefined,
					{ message: "No hay nada que cambiar" },
				),
		)
		.handler(async ({ context, input }) => {
			// Datos (nombre, teléfono) y estado (activar o desactivar) son escrituras
			// distintas, cada una en su propia transacción: juntas no serían
			// atómicas. Una llamada hace una sola clase de cosa, y así "o se hace lo
			// pedido, o nada" es cierto.
			if (
				(input.nombre !== undefined || input.telefono !== undefined) &&
				input.activa !== undefined
			) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Edita los datos o cambia el estado del usuario, no las dos cosas a la vez",
				});
			}
			if (!context.agenciasGerente.includes(input.agenciaId)) {
				throw new ORPCError("NOT_FOUND", { message: "Agencia no encontrada" });
			}
			const socios = await listarSociosDeAgencias(context.agenciasGerente);
			const objetivo = socios.find((s) => s.id === input.userId);
			if (!objetivo?.membresias.some((m) => m.companyId === input.agenciaId)) {
				throw new ORPCError("NOT_FOUND", { message: "Usuario no encontrado" });
			}

			// Se valida todo antes de escribir.
			const exigir = (socio: SocioDeAgencia) =>
				exigirPermiso(
					permisosDelGerente(context.userId, context.agenciasGerente, socio),
					input,
				);
			exigir(objetivo);
			// La lectura de arriba va fuera de la transacción: un admin pudo hacer
			// gerente al objetivo o sumarle una agencia ajena entre el chequeo y la
			// escritura. Con el candado de `user` tomado y las membresías releídas,
			// se vuelve a exigir exactamente la misma regla.
			const revalidar = (membresias: MembresiaRevalidable[]) =>
				exigir(comoSocio(objetivo, membresias));

			const actor = { id: context.userId, role: ROLES.PARTNER };
			if (input.nombre !== undefined || input.telefono !== undefined) {
				await actualizarDatosSocio(
					input.userId,
					{ nombre: input.nombre, telefono: input.telefono },
					input.agenciaId,
					revalidar,
				);
				auditRecord({
					entity: "partner_member",
					id: input.userId,
					action: "update",
					data: {
						agenciaId: input.agenciaId,
						campos: [
							...(input.nombre !== undefined ? ["nombre"] : []),
							...(input.telefono !== undefined ? ["telefono"] : []),
						],
					},
					actor,
				});
			}
			if (input.activa !== undefined) {
				const cambio = await cambiarEstadoMembresia(
					input.userId,
					input.agenciaId,
					input.activa,
					context.userId,
					revalidar,
				);
				// Solo se anota si la fila cambió de estado; pedir el estado que ya
				// tenía responde igual de bien pero no deja una entrada falsa.
				if (cambio) {
					auditRecord({
						entity: "partner_member",
						id: input.userId,
						action: input.activa ? "reactivate" : "deactivate",
						data: { agenciaId: input.agenciaId },
						actor,
					});
				}
			}
			return { success: true };
		}),
};
