// Una barra por pago, del más viejo al más nuevo: teal si entró por Nexa, gris si fue manual.
// El último pago lleva un anillo. Se usa grande (modal, con número de cuota) y mini (tabla).
export type BarraCanal = { nexa: boolean; etiqueta?: string; titulo?: string };

export function NexaFranjaCanal({ barras, mini = false }: { barras: BarraCanal[]; mini?: boolean }) {
  const nexa = barras.filter((b) => b.nexa).length;
  const resumen = `${nexa} de ${barras.length} pagos por Nexa, del más antiguo al más reciente`;
  if (barras.length === 0) return <span className="text-xs text-slate-400">Sin pagos</span>;

  return (
    <div className={mini ? "inline-flex items-end gap-[2px] h-5" : "flex items-end gap-[3px]"} role="img" aria-label={resumen} title={mini ? resumen : undefined}>
      {barras.map((b, i) => {
        const ultimo = i === barras.length - 1;
        const barra = (
          <span
            title={mini ? undefined : b.titulo}
            className={`block rounded-sm ${mini ? "w-1.5" : "w-full"} ${
              b.nexa ? (mini ? "h-5 bg-teal-600" : "h-9 bg-teal-600") : (mini ? "h-2.5 bg-slate-300" : "h-5 bg-slate-300")
            } ${ultimo ? (mini ? "outline outline-1 outline-offset-1 outline-blue-700" : "ring-2 ring-offset-1 ring-blue-700") : ""}`}
          />
        );
        if (mini) return <span key={i}>{barra}</span>;
        return (
          <span key={i} className="flex flex-1 max-w-6 flex-col items-center gap-1">
            {barra}
            <span className={`font-mono text-[10px] leading-none tabular-nums ${b.nexa ? "text-teal-700" : "text-slate-500"}`}>{b.etiqueta ?? ""}</span>
          </span>
        );
      })}
    </div>
  );
}
