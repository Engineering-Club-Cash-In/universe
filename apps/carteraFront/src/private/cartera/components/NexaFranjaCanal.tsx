import { useState } from "react";
import { Clock } from "lucide-react";
import {
  CLASES_TONO_CUOTA,
  conPagoPorValidar,
  conteoFranjaNexa,
  diasAlVencimiento,
  estadoCuotaTexto,
  fmtDiaNexa,
  fraccionPagadaNexa,
  hoyGuatemala,
  mesCortoNexa,
  rellenoCuotaNexa,
  resumenFranjaNexa,
  tituloCuotaNexa,
  type CuotaFranjaNexa,
} from "@/lib/cuotasNexa";

// Una barra por cuota, de la más vieja (izquierda) a la más nueva. La barra se llena con lo que se
// pagó, en el color del medio (morado Nexa, verde otro medio); lo gris es lo que falta. Una cuota
// que todavía no vence va punteada. La cuota del mes lleva la marca azul. Una cuota con un pago que
// falta validar lleva una marca ámbar arriba (punto en la mini, reloj en la grande).

type Props = { cuotas: CuotaFranjaNexa[]; cuotaMes?: number | null; mini?: boolean; hoy?: string };

function Barra({ c, hoy, mini }: { c: CuotaFranjaNexa; hoy: string; mini: boolean }) {
  const fraccion = fraccionPagadaNexa(c);
  const futura = !c.pagada && diasAlVencimiento(c.vencimiento, hoy) >= 0;
  const carril = futura ? "border border-dashed border-slate-400 bg-white" : "border border-slate-400 bg-slate-100";
  return (
    <span className={`relative block ${mini ? "w-2" : "w-full max-w-[1.75rem]"}`}>
      <span className={`relative block overflow-hidden ${mini ? "h-6 w-2 rounded-[2px]" : "h-12 w-full rounded"} ${carril}`}>
        {fraccion > 0 && (
          <span className={`absolute inset-x-0 bottom-0 ${rellenoCuotaNexa(c)}`} style={{ height: `${fraccion * 100}%` }} />
        )}
      </span>
      {conPagoPorValidar(c) && <MarcaPorValidar mini={mini} />}
    </span>
  );
}

// Ámbar 600: contraste 3:1 contra el blanco, como pide un gráfico (amber-500 no llega).
function MarcaPorValidar({ mini }: { mini: boolean }) {
  return mini
    ? <span aria-hidden className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-amber-600 ring-1 ring-white" />
    : (
      <span aria-hidden className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-600 text-white ring-2 ring-white">
        <Clock className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
}

export function NexaFranjaCanal({ cuotas, cuotaMes, mini = false, hoy = hoyGuatemala() }: Props) {
  const [elegida, setElegida] = useState<number | null>(null);
  if (cuotas.length === 0) return <span className="text-xs text-slate-500">Sin cuotas</span>;

  const marcada = cuotas.find((c) => c.numero === cuotaMes);
  const resumen = `${resumenFranjaNexa(cuotas)}${marcada ? `. Cuota del mes ${marcada.numero}: ${estadoCuotaTexto(marcada, hoy)}` : ""}`;

  if (mini) {
    return (
      <span className="inline-flex items-start gap-[3px]" role="img" aria-label={resumen}>
        {cuotas.map((c) => (
          <span key={c.numero} title={tituloCuotaNexa(c)} className="flex flex-col items-center gap-[3px]">
            <Barra c={c} hoy={hoy} mini />
            <span className={`block h-[3px] w-2 rounded-full ${c.numero === cuotaMes ? "bg-blue-700" : "bg-transparent"}`} />
          </span>
        ))}
      </span>
    );
  }

  const detalle = elegida === null ? null : cuotas[elegida];
  const ultima = cuotas.length - 1;
  // Si el crédito no tiene cuota este mes, el back marca la última que venció.
  const rotulo = marcada && marcada.vencimiento.slice(0, 7) === hoy.slice(0, 7) ? "Este mes" : "Última";

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold text-slate-900">Últimas {cuotas.length} cuotas</h3>
        <p className="text-xs text-slate-600">{conteoFranjaNexa(cuotas)}</p>
      </div>

      <div
        className="mt-6 grid gap-x-[3px] sm:gap-x-1"
        style={{ gridTemplateColumns: `repeat(${cuotas.length}, minmax(0, 3rem))` }}
        role="group"
        aria-label={resumen}
      >
        {cuotas.map((c, k) => {
          const esMes = c.numero === cuotaMes;
          const activa = k === elegida;
          return (
            <button
              key={c.numero}
              type="button"
              title={tituloCuotaNexa(c)}
              aria-label={`Cuota ${c.numero}, vence ${fmtDiaNexa(c.vencimiento)}: ${estadoCuotaTexto(c, hoy)}${esMes ? " (cuota del mes)" : ""}`}
              aria-pressed={activa}
              onMouseEnter={() => setElegida(k)}
              onFocus={() => setElegida(k)}
              onClick={() => setElegida(k)}
              className={`relative flex flex-col items-center gap-1 rounded-md px-0.5 pb-1 pt-1.5 outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                esMes ? "bg-blue-50 ring-1 ring-inset ring-blue-300" : activa ? "bg-slate-100" : "hover:bg-slate-50"}`}
            >
              {esMes && (
                <span
                  className={`pointer-events-none absolute -top-5 flex w-max items-center whitespace-nowrap text-[11px] font-semibold text-blue-800 ${
                    k === ultima ? "right-0" : k === 0 ? "left-0" : "left-1/2 -translate-x-1/2"}`}
                >
                  {rotulo} ▾
                </span>
              )}
              <Barra c={c} hoy={hoy} mini={false} />
              <span className={`text-[11px] leading-none ${esMes ? "font-semibold text-blue-900" : "font-medium text-slate-700"}`}>{mesCortoNexa(c.vencimiento)}</span>
              <span className="font-mono text-[10px] leading-none tabular-nums text-slate-600">{c.numero}</span>
            </button>
          );
        })}
      </div>

      <p className="mt-2 flex min-h-[2.375rem] flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800" aria-live="polite">
        {detalle ? (
          <>
            <span className="font-medium tabular-nums text-slate-900">Cuota {detalle.numero} · vence {fmtDiaNexa(detalle.vencimiento)}</span>
            <span className="text-slate-700">{estadoCuotaTexto(detalle, hoy)}</span>
          </>
        ) : <span className="text-slate-600">Pasá el mouse o tocá una cuota para ver su fecha, estado y medio.</span>}
      </p>
      <div className="mt-2"><LeyendaCuotasNexa conCuotaMes={false} /></div>
    </div>
  );
}

function Muestra({ relleno, futura = false }: { relleno?: string; futura?: boolean }) {
  return (
    <span className={`relative inline-block h-3.5 w-2 overflow-hidden rounded-[2px] border border-slate-400 ${futura ? "border-dashed bg-white" : "bg-slate-100"}`}>
      {relleno && <span className={`absolute inset-0 ${relleno}`} />}
    </span>
  );
}

// Leyenda corta: el color dice el medio; cuánto se llena la barra, cuánto se pagó. En la tabla
// la cuota del mes va subrayada; en el modal lleva su rótulo y no hace falta explicarla.
export function LeyendaCuotasNexa({ conCuotaMes = true }: { conCuotaMes?: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-700">
      <span className="flex items-center gap-1.5"><Muestra relleno={CLASES_TONO_CUOTA.nexa} />Nexa</span>
      <span className="flex items-center gap-1.5"><Muestra relleno={CLASES_TONO_CUOTA.otro} />Otro medio</span>
      <span className="flex items-center gap-1.5">
        <span className="relative inline-block h-3.5 w-2 overflow-hidden rounded-[2px] border border-slate-400 bg-slate-100">
          <span className={`absolute inset-x-0 bottom-0 h-1/2 ${CLASES_TONO_CUOTA.nexa}`} />
        </span>
        Parcial: se llena según lo pagado
      </span>
      <span className="flex items-center gap-1.5"><Muestra />Sin pagar</span>
      <span className="flex items-center gap-1.5"><Muestra futura />Aún no vence</span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-600 text-white">
          <Clock className="h-2.5 w-2.5" strokeWidth={3} />
        </span>
        Por validar
      </span>
      {conCuotaMes && <span className="flex items-center gap-1.5"><span className="inline-block h-[3px] w-2.5 rounded-full bg-blue-700" />Cuota del mes</span>}
    </span>
  );
}
