/**
 * F3 (#1864) · Bitácora de cambios de los datos del cliente hechos desde
 * cobros (tabla `cambios_datos_cliente_cobros`, migración 0078).
 *
 * Quien edita (teléfonos, correo, direcciones) lee los valores de antes, hace
 * el UPDATE y llama a `registrarCambiosCaso` DENTRO de la misma transacción:
 * si la bitácora no se puede escribir, el cambio tampoco se guarda.
 *
 * Plan: docs/features/cobros-02/21-plan-backend-ficha-360.md
 */

import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { cambiosDatosClienteCobros } from "../db/schema/cobros";
import type { CambioFicha } from "../routers/ficha-cobros";

type Transaccion = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const CAMPOS_CAMBIO = {
	telefono_principal: { etiqueta: "Teléfono principal", categoria: "contacto" },
	telefono_alternativo: {
		etiqueta: "Teléfono alternativo",
		categoria: "contacto",
	},
	correo: { etiqueta: "Correo", categoria: "contacto" },
	direccion_residencia: {
		etiqueta: "Dirección de residencia",
		categoria: "direcciones",
	},
	empresa_trabajo: { etiqueta: "Empresa", categoria: "direcciones" },
	direccion_trabajo: {
		etiqueta: "Dirección de trabajo",
		categoria: "direcciones",
	},
} as const satisfies Record<
	string,
	{
		etiqueta: string;
		categoria: "contacto" | "direcciones" | "datos_personales";
	}
>;

export type CampoCambio = keyof typeof CAMPOS_CAMBIO;
export type ValoresCampos = Partial<Record<CampoCambio, string | null>>;

export const ORIGENES_CAMBIO = [
	"ficha_360",
	"workspace",
	"carga_masiva",
	"sistema",
] as const;
export type OrigenCambio = (typeof ORIGENES_CAMBIO)[number];

/** Input opcional de las mutaciones que editan datos del cliente. */
export const origenCambioSchema = z
	.enum(["ficha_360", "workspace"])
	.default("ficha_360");

const ETIQUETA_CATEGORIA: Record<string, string> = {
	contacto: "Contacto",
	direcciones: "Direcciones",
	datos_personales: "Datos personales",
};

const ETIQUETA_ORIGEN: Record<string, string> = {
	ficha_360: "Ficha 360",
	workspace: "Workspace",
	carga_masiva: "Carga masiva",
	sistema: "Sistema",
};

const ETIQUETA_ROL: Record<string, string> = {
	cobros: "asesor",
	cobros_supervisor: "supervisor",
	admin: "administrador",
};

/** "" y espacios cuentan como vacío: los formularios guardan "" en vez de NULL. */
function normal(v: string | null | undefined): string | null {
	const t = v?.trim();
	return t ? t : null;
}

export interface DiferenciaCampo {
	campo: CampoCambio;
	antes: string | null;
	despues: string | null;
}

/**
 * Los campos de `despues` que cambiaron respecto de `antes`. Un campo que no
 * viene en `despues` no se tocó y no se registra.
 */
export function diferenciasDatos(
	antes: ValoresCampos,
	despues: ValoresCampos,
): DiferenciaCampo[] {
	const cambios: DiferenciaCampo[] = [];
	for (const campo of Object.keys(despues) as CampoCambio[]) {
		const a = normal(antes[campo]);
		const d = normal(despues[campo]);
		if (a !== d) cambios.push({ campo, antes: a, despues: d });
	}
	return cambios;
}

export async function registrarCambiosCaso(
	tx: Transaccion,
	params: {
		casoCobroId: string;
		antes: ValoresCampos;
		despues: ValoresCampos;
		origen: OrigenCambio;
		userId: string | null;
	},
): Promise<number> {
	const cambios = diferenciasDatos(params.antes, params.despues);
	if (cambios.length === 0) return 0;
	await tx.insert(cambiosDatosClienteCobros).values(
		cambios.map((c) => ({
			casoCobroId: params.casoCobroId,
			campo: c.campo,
			categoria: CAMPOS_CAMBIO[c.campo].categoria,
			valorAnterior: c.antes,
			valorNuevo: c.despues,
			origen: params.origen,
			realizadoPor: params.userId,
		})),
	);
	return cambios.length;
}

/** Fila de la bitácora → lo que pinta la ficha. */
export function cambioFicha(fila: {
	id: string;
	campo: string;
	categoria: string;
	valorAnterior: string | null;
	valorNuevo: string | null;
	origen: string;
	createdAt: Date;
	autorNombre: string | null;
	autorRol: string | null;
}): CambioFicha {
	const campo =
		fila.campo in CAMPOS_CAMBIO
			? CAMPOS_CAMBIO[fila.campo as CampoCambio].etiqueta
			: fila.campo;
	const rol = fila.autorRol ? ETIQUETA_ROL[fila.autorRol] : undefined;
	return {
		id: fila.id,
		campo,
		categoria: ETIQUETA_CATEGORIA[fila.categoria] ?? fila.categoria,
		antes: fila.valorAnterior,
		despues: fila.valorNuevo ?? "Sin dato",
		autor: fila.autorNombre
			? rol
				? `${fila.autorNombre} (${rol})`
				: fila.autorNombre
			: "Sistema",
		fecha: fila.createdAt.toISOString(),
		origen: ETIQUETA_ORIGEN[fila.origen] ?? fila.origen,
	};
}

const LIMITE_HISTORIAL = 200;

/** Lo más reciente primero, hasta 200 cambios. */
export async function cargarHistorialCambios(
	casoCobroId: string,
): Promise<CambioFicha[]> {
	const filas = await db
		.select({
			id: cambiosDatosClienteCobros.id,
			campo: cambiosDatosClienteCobros.campo,
			categoria: cambiosDatosClienteCobros.categoria,
			valorAnterior: cambiosDatosClienteCobros.valorAnterior,
			valorNuevo: cambiosDatosClienteCobros.valorNuevo,
			origen: cambiosDatosClienteCobros.origen,
			createdAt: cambiosDatosClienteCobros.createdAt,
			autorNombre: user.name,
			autorRol: user.role,
		})
		.from(cambiosDatosClienteCobros)
		.leftJoin(user, eq(user.id, cambiosDatosClienteCobros.realizadoPor))
		.where(eq(cambiosDatosClienteCobros.casoCobroId, casoCobroId))
		.orderBy(desc(cambiosDatosClienteCobros.createdAt))
		.limit(LIMITE_HISTORIAL);
	return filas.map(cambioFicha);
}
