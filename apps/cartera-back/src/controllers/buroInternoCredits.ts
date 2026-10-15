import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../database";
import {
	bad_debts,
	credit_cancelations,
	creditos,
	creditos_caidos,
	usuarios,
} from "../database/db/schema";

type EvidenciaCancelacion = {
	motivo: string;
	observaciones: string | null;
	cuotas_atrasadas: number;
};

type EvidenciaHistorica = {
	motivo: string;
	observaciones: string | null;
};

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
	cancelaciones: EvidenciaCancelacion[];
	incobrables: EvidenciaHistorica[];
	caidos: EvidenciaHistorica[];
};

function agregarPorCredito<T extends { credit_id: number }>(
	mapa: Map<number, T[]>,
	fila: T,
): void {
	const actuales = mapa.get(fila.credit_id) ?? [];
	actuales.push(fila);
	mapa.set(fila.credit_id, actuales);
}

/** Devuelve todo el insumo del buró bajo una sola instantánea de Postgres. */
export async function obtenerCreditosParaBuroInterno(): Promise<{
	data: CreditoBuroInterno[];
}> {
	return db.transaction(
		async (tx) => {
			const rows = await tx
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
				.orderBy(asc(creditos.credito_id));

			const cancelaciones = await tx
				.select({
					credit_id: credit_cancelations.credit_id,
					motivo: credit_cancelations.motivo,
					observaciones: credit_cancelations.observaciones,
					cuotas_atrasadas: credit_cancelations.cuotas_atrasadas,
					id: credit_cancelations.id,
				})
				.from(credit_cancelations)
				.orderBy(
					asc(credit_cancelations.credit_id),
					sql`${credit_cancelations.fecha_cancelacion} DESC NULLS LAST`,
					desc(credit_cancelations.id),
				);
			const incobrables = await tx
				.select({
					credit_id: bad_debts.credit_id,
					motivo: bad_debts.motivo,
					observaciones: bad_debts.observaciones,
					id: bad_debts.id,
				})
				.from(bad_debts)
				.orderBy(asc(bad_debts.credit_id), desc(bad_debts.id));
			const caidos = await tx
				.select({
					credit_id: creditos_caidos.credit_id,
					motivo: creditos_caidos.motivo,
					observaciones: creditos_caidos.observaciones,
					id: creditos_caidos.id,
				})
				.from(creditos_caidos)
				.orderBy(
					asc(creditos_caidos.credit_id),
					sql`${creditos_caidos.fecha_caida} DESC NULLS LAST`,
					desc(creditos_caidos.id),
				);

			const cancelacionesPorCredito = new Map<number, typeof cancelaciones>();
			for (const fila of cancelaciones) {
				agregarPorCredito(cancelacionesPorCredito, fila);
			}
			const incobrablesPorCredito = new Map<number, typeof incobrables>();
			for (const fila of incobrables) {
				agregarPorCredito(incobrablesPorCredito, fila);
			}
			const caidosPorCredito = new Map<number, typeof caidos>();
			for (const fila of caidos) agregarPorCredito(caidosPorCredito, fila);

			return {
				data: rows.map((row) => {
					const creditoId = row.creditos.credito_id;
					return {
						creditos: row.creditos,
						usuarios: row.usuarios,
						cancelaciones: (cancelacionesPorCredito.get(creditoId) ?? []).map(
							({ motivo, observaciones, cuotas_atrasadas }) => ({
								motivo,
								observaciones,
								cuotas_atrasadas,
							}),
						),
						incobrables: (incobrablesPorCredito.get(creditoId) ?? []).map(
							({ motivo, observaciones }) => ({ motivo, observaciones }),
						),
						caidos: (caidosPorCredito.get(creditoId) ?? []).map(
							({ motivo, observaciones }) => ({ motivo, observaciones }),
						),
					};
				}),
			};
		},
		{ isolationLevel: "repeatable read", accessMode: "read only" },
	);
}
