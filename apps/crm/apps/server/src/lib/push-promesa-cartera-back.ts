/**
 * CB-030 — push por evento hacia el espejo de promesas de pago vigentes en
 * cartera-back (contactos_cobros vive solo en esta DB del CRM; el job
 * nocturno de mora/bucket de cartera-back, ajeno a esta DB, necesita su
 * propia copia local para congelar cuotas cubiertas por una promesa vigente
 * — ver `promesas_pago_espejo` en el schema de cartera-back y
 * `syncPromesasPago` en su router).
 *
 * Módulo neutral (no vive en routers/cobros.ts ni en services/
 * check-promesas-pago.ts) para que ambos lo importen sin ciclo: el router
 * llama esto al crear/evaluar una promesa, y el job nocturno de
 * check-promesas-pago.ts hace lo mismo al marcar una promesa cumplida.
 *
 * Best-effort a propósito: una falla de red aquí NUNCA debe tumbar la
 * operación de negocio que lo disparó. El job de reconciliación diario
 * (services/sync-promesas-cartera-back.ts) es la red de seguridad que
 * corrige cualquier push perdido antes de que corra procesarMoras.
 */

import { carteraBackClient } from "../services/cartera-back-client";
import { toDateStrGT } from "./guatemala-month-window";
import { resolverNumeroSifco } from "./resolver-numero-sifco";

export async function pushPromesaActivaHaciaCarteraBack(promesa: {
	id: string;
	casoCobroId?: string;
	numeroCreditoSifco?: string | null;
	cuotaInicio: number | null;
	cuotaFin: number | null;
	incluyeMora: boolean;
	fechaProximoContacto: Date | null;
	activa: boolean;
}): Promise<void> {
	try {
		if (!promesa.fechaProximoContacto) return; // sin fecha no hay ventana que congelar
		const numeroSifco =
			promesa.numeroCreditoSifco ??
			(promesa.casoCobroId
				? await resolverNumeroSifco(promesa.casoCobroId)
				: null);
		if (!numeroSifco) return;
		const result = await carteraBackClient.syncPromesasPago([
			{
				contacto_cobros_id: promesa.id,
				numero_credito_sifco: numeroSifco,
				cuota_inicio: promesa.cuotaInicio,
				cuota_fin: promesa.cuotaFin,
				incluye_mora: promesa.incluyeMora,
				// toDateStrGT, NO toISOString().slice(0,10): fechaProximoContacto es
				// un timestamp con hora real, no medianoche UTC. Una promesa
				// registrada de noche en GT (18:00-23:59) cae en el día SIGUIENTE
				// en UTC — .toISOString() la mandaría un día adelante, extendiendo
				// la ventana de freeze un día de más.
				fecha_promesa: toDateStrGT(promesa.fechaProximoContacto),
				activa: promesa.activa,
			},
		]);
		// success:true no significa "se guardó" — con un solo elemento en el
		// batch, fallaTotal/noEncontradas indican que cartera-back no pudo
		// resolver el SIFCO a un crédito. No es crítico (la reconciliación
		// diaria lo reintentará), pero debe quedar visible en logs, no tragado.
		if (result.fallaTotal || (result.noEncontradas?.length ?? 0) > 0) {
			console.error(
				`[pushPromesaActivaHaciaCarteraBack] cartera-back no resolvió el sifco ${numeroSifco} (contacto_cobros_id=${promesa.id}) — la reconciliación diaria reintentará`,
			);
		}
	} catch (error) {
		console.error(
			"[pushPromesaActivaHaciaCarteraBack] Error (no crítico, la reconciliación diaria corrige):",
			error,
		);
	}
}
