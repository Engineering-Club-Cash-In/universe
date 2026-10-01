import Big from "big.js";
import type { AnotacionMoraPagada } from "./anotarMoraPagada";
import { moraPendientePorCuota, repartirPagoDeMora, type CuotaParaPendiente } from "./moraPendiente";

/**
 * Convierte un monto abonado a mora —cobrado en un pago o condonado— en las
 * filas del ledger, cuota por cuota.
 *
 * Es UNA sola regla para los dos orígenes: lo pendiente de cada cuota
 * (devengado − ya abonado), repartido de la cuota más vieja a la más nueva.
 * Lo que excede lo pendiente no tiene cuota donde anotarse y se descarta: una
 * cuota nunca queda con más abonado del que puede generar.
 */
export function anotacionesDeMoraAbonada(
  params: {
    credito_id: number;
    monto: Big | string | number;
    capital: Big | string | number;
    cuotas: CuotaParaPendiente[];
    usuario_id?: number | null;
    motivo?: string | null;
  } & ({ tipo: "PAGO"; pago_id: number } | { tipo: "CONDONACION"; pago_id?: null }),
): AnotacionMoraPagada[] {
  const { porCuota } = moraPendientePorCuota({ capital: params.capital, cuotas: params.cuotas });
  const { reparto } = repartirPagoDeMora({ monto: new Big(params.monto || 0), porCuota });
  return reparto.map((r): AnotacionMoraPagada => {
    const comun = {
      credito_id: params.credito_id,
      cuota_id: r.cuota_id,
      monto: r.monto,
      usuario_id: params.usuario_id ?? null,
      motivo: params.motivo ?? null,
    };
    return params.tipo === "PAGO"
      ? { ...comun, tipo: "PAGO", pago_id: params.pago_id }
      : { ...comun, tipo: "CONDONACION", pago_id: null };
  });
}
