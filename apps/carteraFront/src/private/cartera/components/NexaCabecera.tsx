import type { CSSProperties } from "react";
import { AlertCircle, Clock } from "lucide-react";
import { fmtQ } from "@/lib/moneda";
import { hoyGuatemala, mesLargoNexa, segmentosCuotaMesNexa, type SegmentoCuotaMesNexa } from "@/lib/cuotasNexa";
import type { NexaDashboardParams, NexaDesglose } from "../services/nexaDashboard.services";

// Cabecera del dashboard Nexa: la cuota del mes contada sobre todos los créditos de la vista (sin el
// filtro de cuota ni de medio, para que no colapse al filtrar). Cada grupo es un botón que aplica su
// filtro; el activo queda marcado. Colores explícitos: el tema deja blanco el texto heredado.

type Filtro = { cuotaMes: NexaDashboardParams["cuotaMes"]; medio: NexaDashboardParams["medio"] };

// Parcial: rayado en el color de su medio (la franja también llena el parcial con el color del medio).
const RAYADO = (fuerte: string, suave: string): CSSProperties => ({
  backgroundImage: `repeating-linear-gradient(135deg, ${fuerte} 0 3px, ${suave} 3px 6px)`,
});
const PURPURA = "#9333ea"; // purple-600
const VERDE = "#16a34a"; // green-600

const estiloParcial = (d: NexaDesglose): CSSProperties =>
  d.parcialNexa >= d.parcialManual ? RAYADO(PURPURA, "#e9d5ff") : RAYADO(VERDE, "#bbf7d0");

const RELLENO: Record<SegmentoCuotaMesNexa["id"], string> = {
  nexa: "bg-purple-600",
  manual: "bg-green-600",
  parcial: "",
  sinpago: "bg-slate-300",
};

function Muestra({ s, d }: { s: SegmentoCuotaMesNexa; d: NexaDesglose }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-3 w-3 shrink-0 rounded-sm ${RELLENO[s.id]} ${s.id === "sinpago" ? "border border-slate-400" : ""}`}
      style={s.id === "parcial" ? estiloParcial(d) : undefined}
    />
  );
}

const detalleSegmento = (s: SegmentoCuotaMesNexa, d: NexaDesglose) => {
  if (s.id === "parcial" && s.conteo > 0) return `${d.parcialNexa} Nexa · ${d.parcialManual} otro medio`;
  if (s.id === "sinpago" && d.vencidaSinPago > 0) return `${d.vencidaSinPago} ${d.vencidaSinPago === 1 ? "vencida" : "vencidas"}`;
  return null;
};

export function NexaCabecera({ desglose: d, filtro, onFiltrar, periodo, hoy = hoyGuatemala() }: {
  desglose: NexaDesglose;
  filtro: Filtro;
  onFiltrar: (f: Filtro) => void;
  /** " · pagos del 01/09/2026 al 30/09/2026" o "" (describirRango). */
  periodo: string;
  hoy?: string;
}) {
  const segmentos = segmentosCuotaMesNexa(d);
  const activo = (s: SegmentoCuotaMesNexa) => s.filtro.cuotaMes === filtro.cuotaMes && s.filtro.medio === filtro.medio;
  const alternar = (s: SegmentoCuotaMesNexa) => onFiltrar(activo(s) ? { cuotaMes: "", medio: "" } : s.filtro);
  const sinCuota = d.creditos - d.conCuotaMes;
  const pagadas = d.pagadaNexa + d.pagadaManual;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_15rem]">
      <section aria-labelledby="nexa-cuota-mes-titulo" className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="nexa-cuota-mes-titulo" className="text-sm font-medium text-slate-700">
            Cuota de {mesLargoNexa(hoy)}
          </h2>
          <p className="text-xs tabular-nums text-slate-600">
            {d.creditos} {d.creditos === 1 ? "crédito" : "créditos"} en la vista · {d.conToken} con token
            {sinCuota > 0 && ` · ${sinCuota} sin cuota este mes`}
          </p>
        </div>

        {d.conCuotaMes === 0 ? (
          <p className="mt-2 text-base text-slate-700">Ningún crédito de la vista tiene cuota del mes.</p>
        ) : (
          <>
            <p className="mt-1.5 text-slate-900">
              <span className="text-3xl font-semibold tabular-nums leading-none text-purple-800">{d.pagadaNexa}</span>
              <span className="ml-2 text-base">
                de {d.conCuotaMes} {d.conCuotaMes === 1 ? "pagó" : "pagaron"} la cuota por Nexa
              </span>
              <span className="mt-1 block text-sm text-slate-600 sm:ml-2 sm:mt-0 sm:inline">
                <span aria-hidden className="max-sm:hidden">· </span>{pagadas} {pagadas === 1 ? "pagada" : "pagadas"} en total
              </span>
            </p>

            {/* La barra repite lo que dicen los botones de abajo: para el lector de pantalla basta con ellos. */}
            <div aria-hidden className="mt-3 flex h-3.5 w-full gap-[2px] overflow-hidden rounded-full bg-slate-100">
              {segmentos.filter((s) => s.conteo > 0).map((s) => (
                <span
                  key={s.id}
                  onClick={() => alternar(s)}
                  className={`h-full cursor-pointer ${RELLENO[s.id]} ${activo(s) ? "outline outline-2 -outline-offset-2 outline-blue-700" : ""}`}
                  style={{ flexGrow: s.conteo, flexBasis: 0, minWidth: "6px", ...(s.id === "parcial" ? estiloParcial(d) : {}) }}
                />
              ))}
            </div>

            <div role="group" aria-label="Filtrar la tabla por la cuota del mes" className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              {segmentos.map((s) => {
                const on = activo(s);
                const detalle = detalleSegmento(s, d);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => alternar(s)}
                    title={on ? "Quitar este filtro" : "Ver solo estos créditos en la tabla"}
                    className={`flex min-w-0 flex-col items-start rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 ${
                      on ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                      <Muestra s={s} d={d} /> {s.etiqueta}
                    </span>
                    <span className="mt-1 flex items-baseline gap-1.5">
                      <span className="text-xl font-semibold tabular-nums leading-none text-slate-900">{s.conteo}</span>
                      <span className="text-xs tabular-nums text-slate-600">{s.pct}%</span>
                    </span>
                    <span className={`mt-0.5 min-h-4 text-[11px] leading-4 ${s.id === "sinpago" ? "font-medium text-red-700" : "text-slate-600"}`}>
                      {detalle}
                    </span>
                  </button>
                );
              })}
            </div>

            {d.porValidar > 0 && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-900">
                <Clock aria-hidden className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                {d.porValidar === 1
                  ? "1 cuota cuenta como pagada con un pago que contabilidad todavía no validó."
                  : `${d.porValidar} cuotas cuentan como pagadas con pagos que contabilidad todavía no validó.`}
              </p>
            )}
          </>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-700">Pagos por Nexa</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-purple-800">{d.pagosNexa}</p>
          <p className="text-sm tabular-nums text-slate-700">{fmtQ(d.montoNexa)}</p>
          <p className="mt-1 text-[11px] text-slate-600">{periodo ? "En las fechas elegidas" : "Todos los registrados"}</p>
        </div>
        <div className={`rounded-lg border bg-white p-4 shadow-sm ${d.rechazosNexa > 0 ? "border-red-200" : "border-slate-200"}`}>
          <p className="text-xs font-medium text-slate-700">Rechazados por Nexa</p>
          <p className={`mt-1 flex items-center gap-1.5 text-xl font-semibold tabular-nums ${d.rechazosNexa > 0 ? "text-red-700" : "text-slate-900"}`}>
            {d.rechazosNexa > 0 && <AlertCircle aria-hidden className="h-4 w-4" />}
            {d.rechazosNexa}
          </p>
          <p className="text-sm text-slate-700">{d.rechazosNexa === 0 ? "Sin rechazos" : "Revisalos en la tabla"}</p>
          <p className="mt-1 text-[11px] text-slate-600">{periodo ? "En las fechas elegidas" : "Todos los registrados"}</p>
        </div>
      </div>
    </div>
  );
}
