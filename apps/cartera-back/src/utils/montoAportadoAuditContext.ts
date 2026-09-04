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
