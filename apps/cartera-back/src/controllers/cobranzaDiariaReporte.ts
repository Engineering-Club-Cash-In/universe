import { sql } from "drizzle-orm";
import Big from "big.js";
import { db } from "../database";
import type { InvSplitInput } from "../cofidi/splitInteresPci";
import {
	agruparPorAsesor, interesCubeResidual,
	type CobranzaAsesorRow, type CobranzaCreditoRow,
} from "./cobranzaDiaria";

type Exec = Pick<typeof db, "execute">;

export async function construirFilasCredito(
	p: { anio: number; mes: number; dia: number; asesorId?: number; limit?: number; offset?: number },
	exec: Exec,
): Promise<CobranzaCreditoRow[]> {
	const asesorFilter = p.asesorId ? sql`AND cr.asesor_id = ${p.asesorId}` : sql``;
	const pageFilter = p.limit != null ? sql`LIMIT ${p.limit} OFFSET ${p.offset ?? 0}` : sql``;

	const qA = await exec.execute(sql`
		SELECT cr.credito_id, cr.numero_credito_sifco, u.nombre AS cliente_nombre,
			cr.asesor_id, a.nombre AS asesor_nombre,
			COALESCE(prog.capital_restante,0) AS cap_rest, COALESCE(prog.interes_restante,0) AS int_rest,
			COALESCE(prog.iva_12_restante,0) AS iva_rest, COALESCE(prog.seguro_restante,0) AS seg_rest,
			COALESCE(prog.gps_restante,0) AS gps_rest, COALESCE(prog.membresias,0) AS mem_rest,
			COALESCE(pag.abono_capital,0) AS cap_cob, COALESCE(pag.abono_interes,0) AS int_cob,
			COALESCE(pag.abono_iva,0) AS iva_cob, COALESCE(pag.abono_seguro,0) AS seg_cob,
			COALESCE(pag.abono_gps,0) AS gps_cob, COALESCE(pag.membresias_pagada,0) AS mem_cob,
			COALESCE(pag.mora,0) AS mora_cob
		FROM cartera.cuotas_credito c
		JOIN cartera.creditos cr ON c.credito_id = cr.credito_id
		JOIN cartera.usuarios u ON cr.usuario_id = u.usuario_id
		LEFT JOIN cartera.asesores a ON cr.asesor_id = a.asesor_id
		LEFT JOIN LATERAL (
			SELECT pc.capital_restante::numeric AS capital_restante, pc.interes_restante::numeric AS interes_restante,
				pc.iva_12_restante::numeric AS iva_12_restante, pc.seguro_restante::numeric AS seguro_restante,
				pc.gps_restante::numeric AS gps_restante, pc.membresias::numeric AS membresias
			FROM cartera.pagos_credito pc
			WHERE pc.cuota_id = c.cuota_id AND pc."paymentFalse" = false
			ORDER BY pc.total_restante::numeric DESC NULLS LAST, pc.pago_id ASC LIMIT 1
		) prog ON true
		LEFT JOIN LATERAL (
			SELECT SUM(pc.abono_capital::numeric) AS abono_capital, SUM(pc.abono_interes::numeric) AS abono_interes,
				SUM(pc.abono_iva_12::numeric) AS abono_iva, SUM(pc.abono_seguro::numeric) AS abono_seguro,
				SUM(pc.abono_gps::numeric) AS abono_gps, SUM(pc.membresias_pago::numeric) AS membresias_pagada,
				SUM(pc.mora::numeric) AS mora
			FROM cartera.pagos_credito pc
			WHERE pc.cuota_id = c.cuota_id AND pc."paymentFalse" = false
		) pag ON true
		WHERE c.fecha_vencimiento::date = make_date(${p.anio}, ${p.mes}, ${p.dia})
			AND c.numero_cuota > 0
			AND cr."statusCredit" IN ('ACTIVO','MOROSO','EN_CONVENIO')
			${asesorFilter}
		ORDER BY cr.asesor_id, cr.numero_credito_sifco
		${pageFilter}
	`);
	const filas = qA.rows as any[];
	if (filas.length === 0) return [];

	const ids = filas.map((f) => Number(f.credito_id));
	const qB = await exec.execute(sql`
		SELECT ci.credito_id, ci.inversionista_id, i.nombre,
			ci.porcentaje_participacion_inversionista, ci.porcentaje_cash_in, ci.monto_aportado
		FROM cartera.creditos_inversionistas ci
		JOIN cartera.inversionistas i ON i.inversionista_id = ci.inversionista_id
		WHERE ci.credito_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
	`);
	const invPorCredito = new Map<number, InvSplitInput[]>();
	for (const r of qB.rows as any[]) {
		const arr = invPorCredito.get(Number(r.credito_id)) ?? [];
		arr.push({
			inversionista_id: Number(r.inversionista_id), nombre: r.nombre,
			porcentaje_participacion_inversionista: r.porcentaje_participacion_inversionista,
			porcentaje_cash_in: r.porcentaje_cash_in, monto_aportado: r.monto_aportado,
		});
		invPorCredito.set(Number(r.credito_id), arr);
	}

	const money = (b: Big) => b.round(2).toFixed(2);
	return filas.map((f) => {
		const invs = invPorCredito.get(Number(f.credito_id)) ?? [];
		const cubeEsp = interesCubeResidual(new Big(f.int_rest ?? 0), invs);
		const cubeCob = interesCubeResidual(new Big(f.int_cob ?? 0), invs);
		const restante = { capital: f.cap_rest, interes: f.int_rest, iva: f.iva_rest, seguro: f.seg_rest, gps: f.gps_rest, membresia: f.mem_rest };
		const cobrado = { capital: f.cap_cob, interes: f.int_cob, iva: f.iva_cob, seguro: f.seg_cob, gps: f.gps_cob, membresia: f.mem_cob };
		const sum = (o: Record<string, string>) =>
			Object.values(o).reduce((a, v) => a.plus(v ?? 0), new Big(0));
		return {
			credito_id: Number(f.credito_id), numero_credito_sifco: f.numero_credito_sifco,
			cliente_nombre: f.cliente_nombre, asesor_id: f.asesor_id == null ? null : Number(f.asesor_id),
			asesor_nombre: f.asesor_nombre ?? null,
			cobrado: mapMoney(cobrado, money), restante: mapMoney(restante, money),
			cube: { esperado: money(cubeEsp), cobrado: money(cubeCob) },
			mora_cobrada: money(new Big(f.mora_cob ?? 0)),
			total_cobrado: money(sum(cobrado)), total_esperado: money(sum(restante)),
		} satisfies CobranzaCreditoRow;
	});
}

function mapMoney(o: Record<string, string>, money: (b: Big) => string) {
	return {
		capital: money(new Big(o.capital ?? 0)), interes: money(new Big(o.interes ?? 0)),
		iva: money(new Big(o.iva ?? 0)), seguro: money(new Big(o.seguro ?? 0)),
		gps: money(new Big(o.gps ?? 0)), membresia: money(new Big(o.membresia ?? 0)),
	};
}

export async function getCobranzaDiaria(p: {
	anio: number; mes: number; dia: number; asesorId?: number; executor?: Exec;
}): Promise<{ asesores: CobranzaAsesorRow[]; totalGeneral: CobranzaAsesorRow }> {
	const rows = await construirFilasCredito(p, p.executor ?? db);
	return agruparPorAsesor(rows);
}

export async function getCobranzaDiariaDetalle(p: {
	anio: number; mes: number; dia: number; asesorId: number;
	limit?: number; offset?: number; executor?: Exec;
}): Promise<{ creditos: CobranzaCreditoRow[]; total: number; hasMore: boolean }> {
	const exec = p.executor ?? db;
	const limit = p.limit ?? 10;
	const offset = p.offset ?? 0;
	const creditos = await construirFilasCredito({ ...p, limit, offset }, exec);
	const countRes = await exec.execute(sql`
		SELECT COUNT(*)::int AS total
		FROM cartera.cuotas_credito c
		JOIN cartera.creditos cr ON c.credito_id = cr.credito_id
		WHERE c.fecha_vencimiento::date = make_date(${p.anio}, ${p.mes}, ${p.dia})
			AND c.numero_cuota > 0
			AND cr."statusCredit" IN ('ACTIVO','MOROSO','EN_CONVENIO')
			AND cr.asesor_id = ${p.asesorId}
	`);
	const total = Number((countRes.rows[0] as any)?.total ?? 0);
	return { creditos, total, hasMore: offset + creditos.length < total };
}
