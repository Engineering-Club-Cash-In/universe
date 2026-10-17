import { and, asc, desc, eq, gt, inArray, lte, max, sql } from "drizzle-orm";
import { db } from "../database";
import {
	bad_debts,
	credit_cancelations,
	creditos,
	creditos_caidos,
	usuarios,
} from "../database/db/schema";
import {
	decodificarCursorBuroInterno,
	codificarCursorBuroInterno,
	parsearTamanioPaginaBuroInterno,
} from "./buroInternoCursor";

export type CreditoBuroInterno = {
	creditos: {
		credito_id: number;
		usuario_id: number;
		numero_credito_sifco: string;
		statusCredit: (typeof creditos.$inferSelect)["statusCredit"];
	};
	usuarios: {
		usuario_id: number;
		nombre: string;
		nit: string | null;
		direccion: string | null;
	};
	cancelacion: {
		motivo: string;
		observaciones: string | null;
		cuotas_atrasadas: number;
	} | null;
	incobrable: {
		motivo: string;
		observaciones: string | null;
	} | null;
	caido: {
		motivo: string;
		observaciones: string | null;
	} | null;
};

export type PaginaCreditosBuroInterno = {
	data: CreditoBuroInterno[];
	hasMore: boolean;
	nextCursor: string | null;
	snapshotMaxCreditoId: number;
};

export async function obtenerCreditosParaBuroInterno(params: {
	cursor?: string;
	pageSize?: string | number;
}): Promise<PaginaCreditosBuroInterno> {
	const pageSize = parsearTamanioPaginaBuroInterno(params.pageSize);
	const cursor = decodificarCursorBuroInterno(params.cursor);
	const snapshotMaxCreditoId =
		cursor?.maxCreditoId ??
		Number(
			(
				await db
					.select({ maxCreditoId: max(creditos.credito_id) })
					.from(creditos)
			)[0]?.maxCreditoId ?? 0,
		);
	const afterCreditoId = cursor?.lastCreditoId ?? 0;

	const rows = await db
		.select({
			creditos: {
				credito_id: creditos.credito_id,
				usuario_id: creditos.usuario_id,
				numero_credito_sifco: creditos.numero_credito_sifco,
				statusCredit: creditos.statusCredit,
			},
			usuarios: {
				usuario_id: usuarios.usuario_id,
				nombre: usuarios.nombre,
				nit: usuarios.nit,
				direccion: usuarios.direccion,
			},
		})
		.from(creditos)
		.innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
		.where(
			and(
				gt(creditos.credito_id, afterCreditoId),
				lte(creditos.credito_id, snapshotMaxCreditoId),
			),
		)
		.orderBy(asc(creditos.credito_id))
		.limit(pageSize + 1);

	const hasMore = rows.length > pageSize;
	const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
	// Se consultan las evidencias históricas sin filtrar por el estado actual.
	// Un crédito reactivado o puesto en convenio puede conservar un antecedente
	// explícito de fraude, vehículo recuperado u otro riesgo relevante. Por la
	// misma razón no se filtra `credit_cancelations.activo`: ese indicador rige
	// la operación vigente de la cancelación, no elimina el antecedente.
	const creditosIds = pageRows.map((row) => row.creditos.credito_id);

	const [cancelaciones, incobrables, caidos] = await Promise.all([
		creditosIds.length > 0
			? db
					.select({
						credit_id: credit_cancelations.credit_id,
						motivo: credit_cancelations.motivo,
						observaciones: credit_cancelations.observaciones,
						cuotas_atrasadas: credit_cancelations.cuotas_atrasadas,
						id: credit_cancelations.id,
					})
					.from(credit_cancelations)
					.where(inArray(credit_cancelations.credit_id, creditosIds))
					.orderBy(
						sql`${credit_cancelations.fecha_cancelacion} DESC NULLS LAST`,
						desc(credit_cancelations.id),
					)
			: Promise.resolve([]),
		creditosIds.length > 0
			? db
					.select({
						credit_id: bad_debts.credit_id,
						motivo: bad_debts.motivo,
						observaciones: bad_debts.observaciones,
						id: bad_debts.id,
					})
					.from(bad_debts)
					.where(inArray(bad_debts.credit_id, creditosIds))
					.orderBy(
						sql`${bad_debts.fecha_registro} DESC NULLS LAST`,
						desc(bad_debts.id),
					)
			: Promise.resolve([]),
		creditosIds.length > 0
			? db
					.select({
						credit_id: creditos_caidos.credit_id,
						motivo: creditos_caidos.motivo,
						observaciones: creditos_caidos.observaciones,
						id: creditos_caidos.id,
					})
					.from(creditos_caidos)
					.where(inArray(creditos_caidos.credit_id, creditosIds))
					.orderBy(
						sql`${creditos_caidos.fecha_caida} DESC NULLS LAST`,
						desc(creditos_caidos.id),
					)
			: Promise.resolve([]),
	]);

	const cancelacionPorCredito = new Map<number, (typeof cancelaciones)[number]>();
	for (const row of cancelaciones) {
		if (!cancelacionPorCredito.has(row.credit_id)) {
			cancelacionPorCredito.set(row.credit_id, row);
		}
	}
	const incobrablePorCredito = new Map<number, (typeof incobrables)[number]>();
	for (const row of incobrables) {
		if (!incobrablePorCredito.has(row.credit_id)) {
			incobrablePorCredito.set(row.credit_id, row);
		}
	}
	const caidoPorCredito = new Map<number, (typeof caidos)[number]>();
	for (const row of caidos) {
		if (!caidoPorCredito.has(row.credit_id)) {
			caidoPorCredito.set(row.credit_id, row);
		}
	}

	const data: CreditoBuroInterno[] = pageRows.map((row) => ({
		creditos: row.creditos,
		usuarios: row.usuarios,
		cancelacion: cancelacionPorCredito.has(row.creditos.credito_id)
			? {
					motivo: cancelacionPorCredito.get(row.creditos.credito_id)!.motivo,
					observaciones:
						cancelacionPorCredito.get(row.creditos.credito_id)!.observaciones,
					cuotas_atrasadas:
						cancelacionPorCredito.get(row.creditos.credito_id)!.cuotas_atrasadas,
				}
			: null,
		incobrable: incobrablePorCredito.has(row.creditos.credito_id)
			? {
					motivo: incobrablePorCredito.get(row.creditos.credito_id)!.motivo,
					observaciones:
						incobrablePorCredito.get(row.creditos.credito_id)!.observaciones,
				}
			: null,
		caido: caidoPorCredito.has(row.creditos.credito_id)
			? {
					motivo: caidoPorCredito.get(row.creditos.credito_id)!.motivo,
					observaciones: caidoPorCredito.get(row.creditos.credito_id)!.observaciones,
				}
			: null,
	}));
	const lastCreditoId = pageRows.at(-1)?.creditos.credito_id;

	return {
		data,
		hasMore,
		nextCursor:
			hasMore && lastCreditoId !== undefined
				? codificarCursorBuroInterno({
						lastCreditoId,
						maxCreditoId: snapshotMaxCreditoId,
					})
				: null,
		snapshotMaxCreditoId,
	};
}
