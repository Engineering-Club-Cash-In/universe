const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const corta = (ymd: string) => `${ymd.slice(8, 10)}-${MESES[Number(ymd.slice(5, 7)) - 1]}`;

/** "Boleta del 30-sep registrada el 03-oct, cuota 12, aceptada por <email>" (queda en moras_condonaciones.motivo). */
export function motivoCondonacionBoletaTardia(p: {
  fechaBoleta: string; fechaRegistro: string; numerosCuota: number[]; email: string;
}): string {
  const cuotas = [...p.numerosCuota].sort((a, b) => a - b);
  const etiqueta = cuotas.length === 1 ? `cuota ${cuotas[0]}` : `cuotas ${cuotas.join(", ")}`;
  return `Boleta del ${corta(p.fechaBoleta)} registrada el ${corta(p.fechaRegistro)}, ${etiqueta}, aceptada por ${p.email}`;
}
