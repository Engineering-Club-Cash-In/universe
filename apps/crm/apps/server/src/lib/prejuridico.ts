/**
 * «Listos para pasar a Prejurídico» (tarea S1, Dashboard del supervisor).
 *
 * B4 (Pre-Jurídico) es exactamente 4 cuotas vencidas y lo asigna el motor solo
 * (Figma «Derivado al tratamiento B4 (sistémico)»). Un crédito está «listo»
 * cuando está a punto de dar ese salto sin que nadie haya hecho nada:
 *
 *  · está en B3 (3 cuotas vencidas, bucket del motor);
 *  · su estado sigue en el funnel normal (ACTIVO o MOROSO): no está en
 *    convenio, recuperación, jurídico ni es incobrable;
 *  · su siguiente cuota (la 4.ª) vence en `DIAS_VENTANA_PREJURIDICO` días o menos;
 *  · no tiene una promesa de pago vigente (el cliente ya se comprometió).
 *
 * Decisión 2026-10-12, docs/features/cobros-02/23-plan-backend-supervision.md.
 */

export const DIAS_VENTANA_PREJURIDICO = 7;

export const ESTADOS_FUNNEL_PREJURIDICO = ["ACTIVO", "MOROSO"] as const;

export interface CuotaProximaParaPrejuridico {
	numero_credito_sifco: string;
	status_credit: string;
	bucket: number | null;
	cuotas_vencidas_reales: number;
	dias_para_vencer: number;
}

/** SIFCOs que están a punto de caer a B4, según las cuotas próximas de cartera. */
export function sifcosProximosAB4(
	cuotas: readonly CuotaProximaParaPrejuridico[],
	ventanaDias: number = DIAS_VENTANA_PREJURIDICO,
): Set<string> {
	const sifcos = new Set<string>();
	for (const c of cuotas) {
		if (c.bucket !== 3) continue;
		if (
			!(ESTADOS_FUNNEL_PREJURIDICO as readonly string[]).includes(
				c.status_credit,
			)
		)
			continue;
		// 3 vencidas hoy: la próxima impaga las lleva a 4.
		if (c.cuotas_vencidas_reales !== 3) continue;
		if (c.dias_para_vencer < 0 || c.dias_para_vencer > ventanaDias) continue;
		sifcos.add(c.numero_credito_sifco);
	}
	return sifcos;
}

/** Quita los que ya tienen una promesa vigente. */
export function listosPrejuridico(
	proximos: ReadonlySet<string>,
	conPromesaVigente: ReadonlySet<string>,
): string[] {
	return [...proximos].filter((s) => !conPromesaVigente.has(s));
}
