import { BORDE_PARCIAL, CLASES_TONO_CUOTA, esParcialNexa, tonoCuotaNexa, tituloCuotaNexa, type CuotaFranjaNexa } from "@/lib/cuotasNexa";

// Una barra por cuota, de la más vieja a la más nueva: morada si la pagó Nexa, verde si otro medio,
// gris (y más baja) si no está pagada; con pago parcial, gris con borde del color del medio. La
// cuota del mes lleva un anillo. Grande (modal, con número
// de cuota) o mini (tabla). Cada barra explica su cuota al pasar el mouse.
export function NexaFranjaCanal({ cuotas, cuotaMes, mini = false }: { cuotas: CuotaFranjaNexa[]; cuotaMes?: number | null; mini?: boolean }) {
  if (cuotas.length === 0) return <span className="text-xs text-slate-400">Sin cuotas</span>;
  const pagadas = cuotas.filter((c) => c.pagada).length;
  const nexa = cuotas.filter((c) => tonoCuotaNexa(c) === "nexa").length;
  const resumen = `Últimas ${cuotas.length} cuotas: ${pagadas} pagadas, ${nexa} por Nexa`;

  return (
    <div className={mini ? "inline-flex items-end gap-[2px] h-5" : "flex items-end gap-[3px]"} role="img" aria-label={resumen}>
      {cuotas.map((c) => {
        const tono = tonoCuotaNexa(c);
        const alto = tono === "pendiente" ? (mini ? "h-2.5" : "h-5") : (mini ? "h-5" : "h-9");
        const marcada = c.numero === cuotaMes;
        const borde = esParcialNexa(c) ? BORDE_PARCIAL[c.medio ?? "MANUAL"] : "";
        const barra = (
          <span
            title={tituloCuotaNexa(c)}
            className={`block rounded-sm ${mini ? "w-2" : "w-full"} ${alto} ${CLASES_TONO_CUOTA[tono]} ${borde} ${
              marcada ? (mini ? "outline outline-1 outline-offset-1 outline-slate-900" : "ring-2 ring-offset-1 ring-slate-900") : ""}`}
          />
        );
        if (mini) return <span key={c.numero}>{barra}</span>;
        return (
          <span key={c.numero} className="flex flex-1 max-w-6 flex-col items-center gap-1">
            {barra}
            <span className="font-mono text-[10px] leading-none tabular-nums text-slate-600">{c.numero}</span>
          </span>
        );
      })}
    </div>
  );
}

export function LeyendaCuotasNexa() {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
      <span className="flex items-center gap-1"><span className={`inline-block h-2.5 w-2.5 rounded-sm ${CLASES_TONO_CUOTA.nexa}`} />Pagada por Nexa</span>
      <span className="flex items-center gap-1"><span className={`inline-block h-2.5 w-2.5 rounded-sm ${CLASES_TONO_CUOTA.otro}`} />Pagada por otro medio</span>
      <span className="flex items-center gap-1"><span className={`inline-block h-2.5 w-2.5 rounded-sm ${CLASES_TONO_CUOTA.pendiente} ${BORDE_PARCIAL.NEXA}`} />Pago parcial (borde: medio)</span>
      <span className="flex items-center gap-1"><span className={`inline-block h-1.5 w-2.5 rounded-sm ${CLASES_TONO_CUOTA.pendiente}`} />No pagada</span>
      <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm outline outline-1 outline-offset-1 outline-slate-900" />Cuota del mes</span>
    </span>
  );
}
