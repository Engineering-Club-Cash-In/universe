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
 * Incluye cambios de monto y bajas de participaciones existentes. Las altas
 * no entran: se registran en compras_credito_inversionista, no como ajuste.
 */
export function getChangedExistingInvestorIds(
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

  return [...new Set([...modificados, ...eliminados])];
}
