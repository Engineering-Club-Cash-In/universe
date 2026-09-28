/**
 * COBROS-02 · Quién trabaja un crédito lo dice CARTERA, no el CRM.
 *
 * Regla de la casa (2026-09-28): la asignación asesor ↔ crédito vive en
 * cartera (`creditos.asesor_id`). Es la que cuenta en lo contable (pagos y
 * efectividad por asesor, reportes) y la que mueve el motor de buckets. El CRM
 * solo GESTIONA lo que cartera ya asignó: `casos_cobros` es el contenedor de
 * las gestiones (contactos, promesas, teléfonos, referencias…), no dice de
 * quién es el crédito.
 *
 * Antes lo decía la columna `casos_cobros.responsable_cobros`, que venía de
 * antes de la integración con cartera y se llenaba por su cuenta (un reparto
 * propio del job de sync, o quien abría la ficha). No coincidía con cartera en
 * la mitad de los casos activos de producción, y el asesor que el motor dejaba
 * con un crédito recibía "caso no encontrado" al abrir su ficha. Se eliminó
 * (migración 0066) y todo lo que decidía con ella pasó por acá.
 *
 * Un usuario trabaja un crédito si:
 *  · es admin o supervisor de cobros (ven toda la cartera), o
 *  · su asesor de cartera es el dueño del crédito (puente por correo:
 *    `asesores.email_cash_in` == `user.email`, el mismo de la agenda), o
 *  · hoy cubre al dueño por vacaciones o permiso (CC2-23): la cobertura no
 *    mueve la cartera, pero el suplente trabaja esas cuentas ese día.
 */

import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { casosCobros } from "../db/schema/cobros";
import {
	buscarAsesorCarteraPorEmail,
	obtenerCoberturasVigentes,
	resolverAsesoresAgenda,
} from "../services/agenda-cobros-source";
import { carteraBackClient } from "../services/cartera-back-client";
import { isCarteraBackEnabled } from "../services/cartera-back-integration";
import { construirMapaAsesorUsuario } from "../services/cobros-notif-helpers";
import type { PoolPorAsesorRow } from "../types/cartera-back";
import { toDateStrGT } from "./guatemala-month-window";
import { PERMISSIONS } from "./roles";

/** Lo que cartera acepta por llamada en `getAsesorPorSifco`. */
const MAX_SIFCOS_POR_CONSULTA = 1000;

type UsuarioCobros = {
	id: string;
	email: string;
	role: string;
	banned: boolean | null;
};

/**
 * Asesores de cartera cuyos créditos trabaja el usuario: el suyo más los de
 * los titulares que cubre hoy. Pura: el caller trae el pool, las coberturas
 * vigentes y los usuarios.
 *
 * El titular ausente conserva el acceso a lo suyo (la cartera sigue siendo
 * suya); lo que la cobertura le saca es la agenda del día, no la ficha.
 */
export function asesoresQueTrabaja(params: {
	userId: string;
	emailUsuario: string | null | undefined;
	pool: readonly PoolPorAsesorRow[];
	coberturas: readonly { titularId: string; suplenteId: string }[];
	usuarios: readonly UsuarioCobros[];
}): Set<number> {
	const asesores = new Set<number>();
	const propio = buscarAsesorCarteraPorEmail(params.pool, params.emailUsuario);
	if (propio) asesores.add(propio.asesor_id);

	const titulares = params.coberturas
		.filter((c) => c.suplenteId === params.userId)
		.map((c) => c.titularId);
	if (titulares.length === 0) return asesores;

	const asesorPorUserId = new Map(
		resolverAsesoresAgenda(params.usuarios, params.pool).map((a) => [
			a.userId,
			a.asesorCarteraId,
		]),
	);
	for (const titularId of titulares) {
		const asesorId = asesorPorUserId.get(titularId);
		if (asesorId !== undefined) asesores.add(asesorId);
	}
	return asesores;
}

/**
 * EL asesor dueño de cada crédito en cartera (`creditos.asesor_id`), SIN
 * cache: una decisión de acceso tomada sobre una foto vieja se equivoca en las
 * dos direcciones (el dueño anterior sigue entrando y el nuevo queda afuera).
 * Es una consulta liviana —solo el asesor, no el crédito entero— y en lote.
 */
export async function duenosEnCarteraPorSifco(
	sifcos: readonly string[],
): Promise<Map<string, { asesorId: number; nombre: string }>> {
	const unicos = [...new Set(sifcos.filter(Boolean))];
	const duenos = new Map<string, { asesorId: number; nombre: string }>();
	for (let i = 0; i < unicos.length; i += MAX_SIFCOS_POR_CONSULTA) {
		const lote = unicos.slice(i, i + MAX_SIFCOS_POR_CONSULTA);
		const respuesta = await carteraBackClient.getAsesorPorSifco({
			sifcos: lote,
		});
		for (const fila of respuesta.data ?? []) {
			duenos.set(fila.numero_credito_sifco, {
				asesorId: fila.asesor_id,
				nombre: fila.nombre,
			});
		}
	}
	return duenos;
}

/**
 * Los asesores de cartera del usuario de la sesión, con las coberturas de hoy.
 *
 * El pool (qué asesor tiene qué correo) sí puede venir del cache del cliente:
 * es un catálogo que cambia cuando se da de alta a alguien, no cuando el motor
 * reasigna un crédito. Lo que no se cachea es el dueño del crédito.
 */
export async function asesoresDelUsuario(userId: string): Promise<Set<number>> {
	const [sesion] = await db
		.select({ email: user.email })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	if (!sesion) return new Set();

	const [pool, coberturas] = await Promise.all([
		carteraBackClient.getPoolPorAsesor(),
		obtenerCoberturasVigentes(userId, toDateStrGT(new Date())),
	]);
	const cubre = coberturas.some((c) => c.suplenteId === userId);
	const usuarios = cubre
		? await db
				.select({
					id: user.id,
					email: user.email,
					role: user.role,
					banned: user.banned,
				})
				.from(user)
		: [];
	return asesoresQueTrabaja({
		userId,
		emailUsuario: sesion.email,
		pool,
		coberturas,
		usuarios,
	});
}

const SIN_ACCESO = "Caso de cobro no encontrado o sin acceso.";

function carteraNoDisponible(causa?: unknown): ORPCError<string, unknown> {
	if (causa) {
		console.error("[acceso-caso-cobro] No se pudo consultar cartera:", causa);
	}
	return new ORPCError("SERVICE_UNAVAILABLE", {
		message:
			"No se pudo confirmar en cartera quién lleva este crédito. Intentá de nuevo en un momento.",
	});
}

/**
 * De estos SIFCOs, los que el usuario trabaja según cartera. Devuelve `null`
 * cuando ve toda la cartera (admin / supervisor): el caller no filtra.
 *
 * Falla cerrado: si cartera no responde se lanza, en vez de devolver una lista
 * vacía que se leería como "no tenés créditos".
 */
export async function sifcosQueTrabaja(params: {
	userId: string;
	userRole: string | null | undefined;
	sifcos: readonly string[];
	/** Si el caller ya consultó los dueños (p. ej. para mostrar nombres). */
	duenos?: Map<string, { asesorId: number }>;
}): Promise<Set<string> | null> {
	if (PERMISSIONS.canViewAllCasosCobros(params.userRole ?? "")) return null;
	if (params.sifcos.length === 0) return new Set();
	if (!isCarteraBackEnabled()) throw carteraNoDisponible();
	let duenos: Map<string, { asesorId: number }>;
	let mios: Set<number>;
	try {
		[duenos, mios] = await Promise.all([
			params.duenos ?? duenosEnCarteraPorSifco(params.sifcos),
			asesoresDelUsuario(params.userId),
		]);
	} catch (error) {
		throw carteraNoDisponible(error);
	}
	return new Set(
		params.sifcos.filter((sifco) => {
			const dueno = duenos.get(sifco);
			return dueno !== undefined && mios.has(dueno.asesorId);
		}),
	);
}

/**
 * ¿El usuario trabaja este crédito según cartera? Sin mirar el rol: para
 * callers que ya resolvieron aparte si ve toda la cartera.
 */
export async function usuarioTrabajaSifco(
	userId: string,
	numeroSifco: string | null | undefined,
): Promise<boolean> {
	const sifco = numeroSifco?.trim();
	if (!sifco) return false;
	const permitidos = await sifcosQueTrabaja({
		userId,
		userRole: null,
		sifcos: [sifco],
	});
	return permitidos === null || permitidos.has(sifco);
}

/**
 * El gate de TODA la Ficha 360: ¿este usuario puede ver o actuar sobre este
 * caso? El caso tiene que existir; el permiso lo da cartera.
 *
 * Sin acceso y caso inexistente responden igual (NOT_FOUND): no se confirma la
 * existencia de un caso ajeno probando UUIDs.
 *
 * Las ESCRITURAS que ya revalidan el dueño con
 * `assertCreditoAsignadoEnCarteraPorSifco` (convenio, recuperación, deshacer
 * convenio) lo siguen haciendo: eso además manda el dueño esperado a cartera
 * para que lo revalide bajo sus locks.
 */
export async function assertAccesoCasoCobro(
	casoCobroId: string,
	userId: string,
	userRole: string,
): Promise<void> {
	const [caso] = await db
		.select({ numeroCreditoSifco: casosCobros.numeroCreditoSifco })
		.from(casosCobros)
		.where(eq(casosCobros.id, casoCobroId))
		.limit(1);
	if (!caso) throw new ORPCError("NOT_FOUND", { message: SIN_ACCESO });
	if (PERMISSIONS.canViewAllCasosCobros(userRole)) return;

	const sifco = caso.numeroCreditoSifco?.trim();
	// Sin crédito de cartera no hay dueño: solo lo ven admin y supervisor.
	if (!sifco) throw new ORPCError("NOT_FOUND", { message: SIN_ACCESO });

	const permitidos = await sifcosQueTrabaja({
		userId,
		userRole,
		sifcos: [sifco],
	});
	if (permitidos && !permitidos.has(sifco)) {
		throw new ORPCError("NOT_FOUND", { message: SIN_ACCESO });
	}
}

/**
 * Usuario del CRM dueño de cada crédito en cartera, para AVISOS. Sin
 * coberturas a propósito: el aviso es de quien lleva la cuenta. Best-effort:
 * si cartera no responde devuelve un mapa vacío y el caller decide (típicamente
 * avisar solo a supervisión).
 */
export async function usuariosDuenosPorSifco(
	sifcos: readonly string[],
): Promise<Map<string, string>> {
	const usuarios = new Map<string, string>();
	if (sifcos.length === 0 || !isCarteraBackEnabled()) return usuarios;
	try {
		const [duenos, usuarioPorAsesor] = await Promise.all([
			duenosEnCarteraPorSifco(sifcos),
			construirMapaAsesorUsuario({ useCircuitBreaker: false }),
		]);
		for (const [sifco, dueno] of duenos) {
			const userId = usuarioPorAsesor.get(dueno.asesorId);
			if (userId) usuarios.set(sifco, userId);
		}
	} catch (error) {
		console.error(
			"[acceso-caso-cobro] No se pudo resolver el dueño en cartera para avisos:",
			error,
		);
	}
	return usuarios;
}

/** Atajo de `usuariosDuenosPorSifco` para un solo crédito. */
export async function usuarioDuenoEnCartera(
	numeroSifco: string | null | undefined,
): Promise<string | null> {
	const sifco = numeroSifco?.trim();
	if (!sifco) return null;
	return (await usuariosDuenosPorSifco([sifco])).get(sifco) ?? null;
}
