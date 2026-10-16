import { ORPCError } from "@orpc/server";
import { randomInt } from "node:crypto";
import { APIError } from "better-auth/api";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { companies } from "../db/schema/crm";
import { partnerMembers } from "../db/schema/partners";
import { vehicleVendors } from "../db/schema/vehicles";
import {
	errorDeMembresias,
	TIPO_VENDEDOR_AGENCIA,
	type MembresiaInput,
} from "./agency-sellers";
import { auth } from "./auth";
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
 * Toma los vendedores con FOR UPDATE (que nadie los mueva de agencia ni los
 * ligue a otra cuenta mientras se asignan) y exige que ninguno esté ligado a un
 * socio distinto de `userId`: un vendedor pertenece a una sola cuenta, y dos
 * cuentas con el mismo vendedor verían las mismas oportunidades. Devuelve las
 * filas bloqueadas para que el llamador valide tipo y agencia con ellas.
 * Reasignarle al mismo usuario su propio vendedor no es conflicto.
 */
export async function vendedoresLibres(
	tx: Tx,
	userId: string,
	sellerIds: string[],
) {
	if (sellerIds.length === 0) return [];
	const vendedores = await tx
		.select({
			id: vehicleVendors.id,
			vendorType: vehicleVendors.vendorType,
			companyId: vehicleVendors.companyId,
		})
		.from(vehicleVendors)
		.where(inArray(vehicleVendors.id, sellerIds))
		.for("update");

	const ligados = await tx
		.select({
			userId: partnerMembers.userId,
			sellerId: partnerMembers.sellerId,
		})
		.from(partnerMembers)
		.where(inArray(partnerMembers.sellerId, sellerIds));
	if (ligados.some((l) => l.userId !== userId)) {
		throw new ORPCError("CONFLICT", {
			message: "Ese vendedor ya está ligado a otra cuenta",
		});
	}
	return vendedores;
}

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
	const vendedores = await vendedoresLibres(tx, userId, sellerIds);

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

// Sin 0/O, 1/l/I ni o: la contraseña se lee y se dicta a mano.
const ALFABETO_CONTRASENA =
	"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const LARGO_CONTRASENA = 14;

/** Contraseña inicial aleatoria (CSPRNG). El primer login obliga a cambiarla. */
export function generarContrasenaTemporal(): string {
	let out = "";
	for (let i = 0; i < LARGO_CONTRASENA; i++) {
		out += ALFABETO_CONTRASENA[randomInt(ALFABETO_CONTRASENA.length)];
	}
	return out;
}

export const DOMINIO_INTERNO = "@clubcashin.com";

/**
 * Dos altas simultáneas con el mismo correo pasan ambas el chequeo de better-auth
 * y la segunda choca con el UNIQUE de `user.email` (23505). Drizzle envuelve el
 * error de Postgres, así que se busca el código también en la cadena de `cause`.
 */
function esViolacionDeCorreoUnico(error: unknown): boolean {
	let actual: unknown = error;
	for (let i = 0; i < 5 && actual && typeof actual === "object"; i++) {
		const { code, constraint, cause } = actual as {
			code?: unknown;
			constraint?: unknown;
			cause?: unknown;
		};
		if (
			code === "23505" &&
			typeof constraint === "string" &&
			/(^|_)user_email(_|$)/i.test(constraint)
		) {
			return true;
		}
		actual = cause;
	}
	return false;
}

function esCorreoRepetido(error: unknown): boolean {
	if (esViolacionDeCorreoUnico(error)) return true;
	if (!(error instanceof APIError)) return false;
	const detalle = error.body as { code?: string; message?: string } | undefined;
	return (
		detalle?.code === "USER_ALREADY_EXISTS" ||
		/already exists/i.test(detalle?.message ?? error.message ?? "")
	);
}

export type CrearSocioInput = {
	nombre: string;
	correo: string;
	contrasena: string;
	membresias: MembresiaInput[];
	/** Admin: true (como siempre). Tracker/CRM: false, para no ocupar el correo de un empleado. */
	permitirDominioInterno: boolean;
	/** Crea el vendedor de agencia y lo usa como sellerId de esa agencia. */
	vendedorNuevo?: { companyId: string; telefono?: string };
};

/**
 * Crea un socio y lo deja con sus agencias. No cabe en una sola transacción
 * (createUser usa su propia conexión y asignarAgencias toma al vendedor con
 * FOR UPDATE), así que ante cualquier error se compensa a mano: se borran el
 * usuario y el vendedor que esta llamada haya creado, y nada más.
 */
export async function crearSocio(
	input: CrearSocioInput,
): Promise<{ id: string; name: string; email: string }> {
	const correo = input.correo.trim().toLowerCase();

	if (!input.permitirDominioInterno && correo.endsWith(DOMINIO_INTERNO)) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Los correos @clubcashin.com no se pueden usar para un socio",
		});
	}
	if (input.membresias.length === 0 && !input.vendedorNuevo) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Selecciona al menos una agencia para el socio",
		});
	}

	let vendedorId: string | null = null;
	// Solo se borra en la compensación el vendedor que esta llamada creó.
	let vendedorCreado = false;
	let userId: string | null = null;
	try {
		if (input.vendedorNuevo) {
			const { companyId, telefono } = input.vendedorNuevo;
			// Un vendedor de esa agencia con el mismo correo se reutiliza solo si
			// ningún socio lo tiene ligado; si ya está ligado, error (§8.5).
			vendedorId = await db.transaction(async (tx) => {
				const [existente] = await tx
					.select({ id: vehicleVendors.id })
					.from(vehicleVendors)
					.where(
						and(
							eq(vehicleVendors.companyId, companyId),
							eq(vehicleVendors.vendorType, TIPO_VENDEDOR_AGENCIA),
							sql`lower(${vehicleVendors.email}) = ${correo}`,
						),
					)
					.limit(1)
					.for("update");
				if (!existente) return null;
				const ligados = await tx
					.select({ id: partnerMembers.id })
					.from(partnerMembers)
					.where(eq(partnerMembers.sellerId, existente.id))
					.limit(1);
				if (ligados.length > 0) {
					throw new ORPCError("CONFLICT", {
						message:
							"Ese vendedor ya está ligado a otro socio de la agencia",
					});
				}
				return existente.id;
			});

			if (!vendedorId) {
				const [vendedor] = await db
					.insert(vehicleVendors)
					.values({
						name: input.nombre,
						email: correo,
						phone: telefono ?? null,
						vendorType: TIPO_VENDEDOR_AGENCIA,
						companyId,
					})
					.returning({ id: vehicleVendors.id });
				vendedorId = vendedor?.id ?? null;
				if (!vendedorId) {
					throw new ORPCError("INTERNAL_SERVER_ERROR", {
						message: "No se pudo crear el vendedor de la agencia",
					});
				}
				vendedorCreado = true;
			}
		}

		let creado: Awaited<ReturnType<typeof auth.api.createUser>>;
		try {
			creado = await auth.api.createUser({
				body: {
					name: input.nombre,
					email: correo,
					password: input.contrasena,
					role: ROLES.PARTNER,
				},
			});
		} catch (error) {
			if (esCorreoRepetido(error)) {
				throw new ORPCError("CONFLICT", {
					message: "Ese correo ya tiene una cuenta",
				});
			}
			throw error;
		}
		if (!creado.user) {
			throw new ORPCError("BAD_REQUEST", { message: "Error al crear usuario" });
		}
		userId = creado.user.id;

		const membresias = vendedorId && input.vendedorNuevo
			? [
					...input.membresias,
					{ companyId: input.vendedorNuevo.companyId, sellerId: vendedorId },
				]
			: input.membresias;
		await asignarAgencias(userId, membresias);

		// Un vendedor reutilizado conserva sus datos viejos: se alinean con lo que
		// el alta acaba de enviar. Va después de asignarAgencias para que, si algo
		// falla antes, el vendedor quede intacto; si esto falla, la compensación
		// borra el usuario y el vendedor no se toca (no lo creó esta llamada).
		if (vendedorId && input.vendedorNuevo && !vendedorCreado) {
			const telefono = input.vendedorNuevo.telefono?.trim();
			await db
				.update(vehicleVendors)
				.set({
					name: input.nombre,
					...(telefono ? { phone: telefono } : {}),
				})
				.where(eq(vehicleVendors.id, vendedorId));
		}

		return { id: userId, name: creado.user.name, email: creado.user.email };
	} catch (error) {
		// Un socio sin agencias no puede entrar a nada, y un vendedor huérfano
		// ensucia el CRM: mejor no dejar nada a medias. El usuario va primero
		// porque partner_members.seller_id es RESTRICT.
		// Cada limpieza va aparte: si una falla, la otra se intenta igual y el
		// error que se propaga es siempre el original.
		if (userId) {
			try {
				await db.delete(user).where(eq(user.id, userId));
			} catch (limpieza) {
				console.error("crearSocio: no se pudo borrar el usuario", userId, limpieza);
			}
		}
		if (vendedorId && vendedorCreado) {
			try {
				await db.delete(vehicleVendors).where(eq(vehicleVendors.id, vendedorId));
			} catch (limpieza) {
				console.error("crearSocio: no se pudo borrar el vendedor", vendedorId, limpieza);
			}
		}
		throw error;
	}
}

/**
 * Suma una agencia al socio SIN tocar las que ya tiene (asignarAgencias las
 * reemplaza todas). Si ya tiene membresía en esa agencia no la pisa: quien
 * decide promoverla o reactivarla es el llamador.
 */
export async function agregarMembresia(userId: string, membresia: MembresiaInput) {
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

		const existentes = await tx
			.select({ id: companies.id })
			.from(companies)
			.where(eq(companies.id, membresia.companyId));
		if (existentes.length === 0) {
			throw new ORPCError("BAD_REQUEST", {
				message: "La agencia seleccionada ya no existe",
			});
		}

		if (membresia.sellerId) {
			const vendedores = await vendedoresLibres(tx, userId, [
				membresia.sellerId,
			]);
			const error = errorDeMembresias([membresia], vendedores);
			if (error) throw new ORPCError("BAD_REQUEST", { message: error });
		}

		const actuales = await tx
			.select({ companyId: partnerMembers.companyId })
			.from(partnerMembers)
			.where(eq(partnerMembers.userId, userId));
		if (actuales.some((a) => a.companyId === membresia.companyId)) {
			throw new ORPCError("CONFLICT", {
				message: "El usuario ya tiene una membresía en esa agencia",
			});
		}

		await tx.insert(partnerMembers).values({
			userId,
			companyId: membresia.companyId,
			sellerId: membresia.sellerId,
		});
	});
}

/** Cuenta (de cualquier rol) con ese correo, para decidir si ya existe. */
export async function buscarCuentaPorCorreo(
	correo: string,
): Promise<{ id: string; role: string | null } | null> {
	const [cuenta] = await db
		.select({ id: user.id, role: user.role })
		.from(user)
		.where(eq(sql`lower(${user.email})`, correo.trim().toLowerCase()))
		.limit(1);
	return cuenta ?? null;
}

/**
 * Deja al socio como gerente de esa agencia (sellerId NULL) y la reactiva, sin
 * tocar sus otras agencias. Solo opera sobre socios con membresía ahí.
 * Reactivar es un efecto de promover, aunque estuviera desactivado ahí: el
 * llamador debe haberlo avisado y obtenido confirmación antes.
 */
export async function promoverMembresiaAGerente(
	userId: string,
	companyId: string,
): Promise<void> {
	await db.transaction(async (tx) => {
		await exigirSocio(tx, userId);
		const filas = await tx
			.update(partnerMembers)
			.set({ sellerId: null, desactivadoAt: null, desactivadoPor: null })
			.where(
				and(
					eq(partnerMembers.userId, userId),
					eq(partnerMembers.companyId, companyId),
				),
			)
			.returning({ id: partnerMembers.id });
		if (filas.length === 0) {
			throw new ORPCError("NOT_FOUND", { message: "Usuario no encontrado" });
		}
	});
}

async function exigirSocio(tx: Tx, userId: string) {
	const [objetivo] = await tx
		.select({ role: user.role })
		.from(user)
		.where(eq(user.id, userId))
		// Mismo candado que asignarAgencias/updateUserRole: sin él, un reemplazo de
		// agencias en curso pisaría la desactivación o el nombre que se escribe aquí.
		.for("update")
		.limit(1);
	// Un interno (o un id inventado) responde igual que uno inexistente.
	if (!objetivo || objetivo.role !== ROLES.PARTNER) {
		throw new ORPCError("NOT_FOUND", { message: "Usuario no encontrado" });
	}
}

/**
 * Membresías del objetivo tal como las ve `revalidar`: lo que el llamador
 * necesita para volver a exigir, ya con el candado de `user` tomado, lo que
 * comprobó antes de abrir la transacción.
 */
export type MembresiaRevalidable = {
	companyId: string;
	sellerId: string | null;
	activa: boolean;
};

/**
 * Se ejecuta DENTRO de la transacción, después del FOR UPDATE sobre `user`, con
 * las membresías releídas del objetivo. Si lanza, la transacción aborta sin
 * escribir: cierra la carrera entre el chequeo del llamador y la escritura
 * (p. ej. que lo pasen de gerente a vendedor justo entre ambas).
 */
export type RevalidarMembresias = (membresias: MembresiaRevalidable[]) => void;

function comoRevalidables(
	filas: { companyId: string; sellerId: string | null; desactivadoAt: Date | null }[],
): MembresiaRevalidable[] {
	return filas.map((m) => ({
		companyId: m.companyId,
		sellerId: m.sellerId,
		activa: m.desactivadoAt === null,
	}));
}

/**
 * Activa o desactiva al socio SOLO en esa agencia; sus otras agencias no se
 * tocan. Solo opera sobre socios (`partner`) con membresía en la agencia.
 * Desactivar a quien ya está inactivo no hace nada: conserva quién y cuándo lo
 * desactivó la primera vez. Devuelve true solo si la fila cambió de estado.
 */
export async function cambiarEstadoMembresia(
	userId: string,
	companyId: string,
	activa: boolean,
	actorId: string,
	revalidar?: RevalidarMembresias,
): Promise<boolean> {
	return db.transaction(async (tx) => {
		await exigirSocio(tx, userId);
		const membresias = await tx
			.select({
				companyId: partnerMembers.companyId,
				sellerId: partnerMembers.sellerId,
				desactivadoAt: partnerMembers.desactivadoAt,
			})
			.from(partnerMembers)
			.where(eq(partnerMembers.userId, userId));
		if (!membresias.some((m) => m.companyId === companyId)) {
			throw new ORPCError("NOT_FOUND", { message: "Usuario no encontrado" });
		}
		revalidar?.(comoRevalidables(membresias));

		const cambiadas = await tx
			.update(partnerMembers)
			.set(
				activa
					? { desactivadoAt: null, desactivadoPor: null }
					: { desactivadoAt: new Date(), desactivadoPor: actorId },
			)
			.where(
				and(
					eq(partnerMembers.userId, userId),
					eq(partnerMembers.companyId, companyId),
					// Simétrico: solo cambia lo que de verdad cambia de estado. Una
					// fila que ya estaba en ese estado no se toca (no se pisa quién ni
					// cuándo desactivó) y no cuenta como cambio.
					activa
						? isNotNull(partnerMembers.desactivadoAt)
						: isNull(partnerMembers.desactivadoAt),
				),
			)
			.returning({ id: partnerMembers.id });
		return cambiadas.length > 0;
	});
}

/**
 * El nombre es único por cuenta: se escribe en `user` y en todos sus
 * vendedores para que el CRM no se desfase. El teléfono va solo en el vendedor
 * de `companyId`.
 */
export async function actualizarDatosSocio(
	userId: string,
	datos: { nombre?: string; telefono?: string },
	companyId: string,
	revalidar?: RevalidarMembresias,
): Promise<void> {
	await db.transaction(async (tx) => {
		await exigirSocio(tx, userId);
		const membresias = await tx
			.select({
				companyId: partnerMembers.companyId,
				sellerId: partnerMembers.sellerId,
				desactivadoAt: partnerMembers.desactivadoAt,
			})
			.from(partnerMembers)
			.where(eq(partnerMembers.userId, userId));
		revalidar?.(comoRevalidables(membresias));
		const enAgencia = membresias.find((m) => m.companyId === companyId);
		if (!enAgencia) {
			throw new ORPCError("NOT_FOUND", { message: "Usuario no encontrado" });
		}

		const nombre = datos.nombre?.trim();
		if (nombre) {
			await tx
				.update(user)
				.set({ name: nombre, updatedAt: new Date() })
				.where(eq(user.id, userId));
			const vendedores = membresias
				.map((m) => m.sellerId)
				.filter((id): id is string => !!id);
			if (vendedores.length > 0) {
				await tx
					.update(vehicleVendors)
					.set({ name: nombre })
					.where(inArray(vehicleVendors.id, vendedores));
			}
		}

		if (datos.telefono !== undefined) {
			if (!enAgencia.sellerId) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Este usuario no tiene teléfono que editar en esa agencia",
				});
			}
			await tx
				.update(vehicleVendors)
				.set({ phone: datos.telefono.trim() || null })
				.where(eq(vehicleVendors.id, enAgencia.sellerId));
		}
	});
}

export type SocioDeAgencia = {
	id: string;
	nombre: string;
	correo: string;
	cuentaSuspendida: boolean;
	creadoEn: Date;
	membresias: {
		companyId: string;
		companyNombre: string;
		sellerId: string | null;
		telefono: string | null;
		activa: boolean;
	}[];
};

/**
 * Socios con membresía en alguna de estas agencias, con TODAS sus membresías
 * (las necesita permisosDelGerente). Todo lo que salga al tracker debe pasar
 * por recortarAlAlcance.
 */
export async function listarSociosDeAgencias(
	companyIds: string[],
): Promise<SocioDeAgencia[]> {
	if (companyIds.length === 0) return [];

	const ids = await db
		.select({ userId: partnerMembers.userId })
		.from(partnerMembers)
		.innerJoin(user, eq(user.id, partnerMembers.userId))
		.where(
			and(
				inArray(partnerMembers.companyId, companyIds),
				eq(user.role, ROLES.PARTNER),
			),
		);
	if (ids.length === 0) return [];
	const userIds = [...new Set(ids.map((i) => i.userId))];

	const filas = await db
		.select({
			userId: user.id,
			nombre: user.name,
			correo: user.email,
			banned: user.banned,
			creadoEn: user.createdAt,
			companyId: partnerMembers.companyId,
			companyNombre: companies.name,
			sellerId: partnerMembers.sellerId,
			telefono: vehicleVendors.phone,
			desactivadoAt: partnerMembers.desactivadoAt,
		})
		.from(partnerMembers)
		.innerJoin(user, eq(user.id, partnerMembers.userId))
		.innerJoin(companies, eq(companies.id, partnerMembers.companyId))
		.leftJoin(vehicleVendors, eq(vehicleVendors.id, partnerMembers.sellerId))
		.where(
			and(
				inArray(partnerMembers.userId, userIds),
				eq(user.role, ROLES.PARTNER),
			),
		)
		.orderBy(asc(user.name), asc(companies.name));

	// Entre una consulta y otra el socio pudo quedar sin membresías en estas
	// agencias (o dejar de ser socio): solo salen los que aún tienen al menos una.
	const alcance = new Set(companyIds);
	const enAlcance = new Set(
		filas.filter((f) => alcance.has(f.companyId)).map((f) => f.userId),
	);

	const porUsuario = new Map<string, SocioDeAgencia>();
	for (const f of filas) {
		if (!enAlcance.has(f.userId)) continue;
		let socio = porUsuario.get(f.userId);
		if (!socio) {
			socio = {
				id: f.userId,
				nombre: f.nombre,
				correo: f.correo,
				cuentaSuspendida: f.banned === true,
				creadoEn: f.creadoEn,
				membresias: [],
			};
			porUsuario.set(f.userId, socio);
		}
		socio.membresias.push({
			companyId: f.companyId,
			companyNombre: f.companyNombre,
			sellerId: f.sellerId,
			telefono: f.telefono ?? null,
			activa: f.desactivadoAt === null,
		});
	}
	return [...porUsuario.values()];
}

export type PermisosDelGerente = {
	porAgencia: Record<
		string,
		{ puedeActivar: boolean; puedeEditarTelefono: boolean; motivo?: string }
	>;
	puedeEditarNombre: boolean;
	motivoNombre?: string;
};

/**
 * Regla §2.3, pura. Por agencia del gerente donde el objetivo tiene membresía:
 * activar y editar teléfono solo si es vendedor ahí y no es el mismo gerente.
 * El nombre es único por cuenta: solo si TODAS sus membresías son de vendedor
 * y caen dentro de las agencias del gerente. Los motivos son genéricos: nunca
 * nombran otra agencia.
 */
export function permisosDelGerente(
	gerenteId: string,
	agenciasGerente: string[],
	objetivo: SocioDeAgencia,
): PermisosDelGerente {
	const esElMismo = objetivo.id === gerenteId;
	const porAgencia: PermisosDelGerente["porAgencia"] = {};

	for (const m of objetivo.membresias) {
		if (!agenciasGerente.includes(m.companyId)) continue;
		if (esElMismo) {
			porAgencia[m.companyId] = {
				puedeActivar: false,
				puedeEditarTelefono: false,
				motivo: "No puedes modificar tu propia cuenta",
			};
		} else if (m.sellerId === null) {
			porAgencia[m.companyId] = {
				puedeActivar: false,
				puedeEditarTelefono: false,
				motivo: "Es gerente de esta agencia; lo administra Club Cash In",
			};
		} else {
			porAgencia[m.companyId] = { puedeActivar: true, puedeEditarTelefono: true };
		}
	}

	let puedeEditarNombre = true;
	let motivoNombre: string | undefined;
	if (esElMismo) {
		puedeEditarNombre = false;
		motivoNombre = "No puedes modificar tu propia cuenta";
	} else if (
		objetivo.membresias.some((m) => !agenciasGerente.includes(m.companyId))
	) {
		// Primero lo ajeno: el motivo no puede delatar qué rol tiene en otra agencia.
		puedeEditarNombre = false;
		motivoNombre =
			"El nombre lo administra Club Cash In porque también trabaja con otra agencia";
	} else if (objetivo.membresias.some((m) => m.sellerId === null)) {
		puedeEditarNombre = false;
		motivoNombre = "Es gerente; lo administra Club Cash In";
	}

	return { porAgencia, puedeEditarNombre, motivoNombre };
}

/** §2.4: quita las membresías de agencias que no son del gerente. */
export function recortarAlAlcance(
	socio: SocioDeAgencia,
	agenciasGerente: string[],
): SocioDeAgencia {
	return {
		...socio,
		membresias: socio.membresias.filter((m) =>
			agenciasGerente.includes(m.companyId),
		),
	};
}
