import Big from "big.js";

export type MontoAportadoAuditOrigin = "PADRE" | "ESPEJO";

type AuditSetting = {
  name: string;
  value: string;
};

export function buildMontoAportadoAuditSettings(
  origen: MontoAportadoAuditOrigin,
  motivo: string | undefined,
  inversionistasConMontoCambiado: number[],
): AuditSetting[] {
  const sufijo = origen === "PADRE" ? "padre" : "espejo";

  return [
    { name: `app.monto_aportado_rebuild_${sufijo}`, value: "true" },
    {
      name: `app.monto_aportado_ids_${sufijo}`,
      value: inversionistasConMontoCambiado.join(","),
    },
    { name: `app.monto_aportado_motivo_${sufijo}`, value: motivo ?? "" },
  ];
}

type InvestorMonto = {
  inversionista_id: number;
  monto_aportado: string | number | null;
};

/**
 * IDs cuyo INSERT/DELETE debe quedar en el historial de monto_aportado:
 * cambios de monto, bajas y altas.
 *
 * Las altas entran aunque `compras_credito_inversionista` ya registre la
 * operación: verificarCuadreLiquidaciones descubre los créditos movidos tras
 * una liquidación EXCLUSIVAMENTE por el historial ESPEJO (creditos_rel), y
 * `compras_por_credito_ajustada` hace inner join contra ese conjunto. Sin la
 * fila de auditoría, el crédito destino de una reinversión nunca se descubre
 * y el verificador resta la reinversión sin sumar el saldo que la recibió,
 * reportando un descuadre falso.
 *
 * Para decidir si se exige motivo usar `getAdjustedExistingInvestorIds`: un
 * alta es una compra o reinversión, no un ajuste que haya que justificar.
 */
export function getAuditableInvestorIds(
  originales: InvestorMonto[],
  enviados: InvestorMonto[] | undefined,
): number[] {
  if (!enviados) return [];

  const originalPorId = new Map(
    originales.map((inversionista) => [
      inversionista.inversionista_id,
      inversionista.monto_aportado,
    ]),
  );
  const idsEnviados = new Set(
    enviados.map((inversionista) => inversionista.inversionista_id),
  );
  const modificados = enviados.flatMap((inversionista) => {
    const montoOriginal = originalPorId.get(inversionista.inversionista_id);
    return montoOriginal !== undefined && montoOriginal !== null &&
      inversionista.monto_aportado !== null &&
      !new Big(inversionista.monto_aportado).eq(new Big(montoOriginal))
      ? [inversionista.inversionista_id]
      : [];
  });
  const eliminados = originales
    .filter((inversionista) => !idsEnviados.has(inversionista.inversionista_id))
    .map((inversionista) => inversionista.inversionista_id);
  const agregados = enviados
    .filter(
      (inversionista) =>
        originalPorId.get(inversionista.inversionista_id) === undefined,
    )
    .map((inversionista) => inversionista.inversionista_id);

  return [...new Set([...modificados, ...eliminados, ...agregados])];
}

/**
 * IDs que representan un ajuste sobre una participación que ya existía
 * (cambio de monto o baja) y por lo tanto exigen motivo. Las altas quedan
 * fuera: son compras o reinversiones, registradas en
 * compras_credito_inversionista con su monto y tipo de operación.
 */
export function getAdjustedExistingInvestorIds(
  originales: InvestorMonto[],
  enviados: InvestorMonto[] | undefined,
): number[] {
  if (!enviados) return [];

  const idsOriginales = new Set(
    originales.map((inversionista) => inversionista.inversionista_id),
  );
  return getAuditableInvestorIds(originales, enviados).filter((id) =>
    idsOriginales.has(id),
  );
}
