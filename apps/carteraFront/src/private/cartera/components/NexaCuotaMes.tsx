import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import {
  avisoCuotaMesNexa,
  fmtDiaNexa,
  hoyGuatemala,
  fraccionPagadaNexa,
  type CuotaFranjaNexa,
  type CuotaMesNexa,
  type TonoAvisoNexa,
} from "@/lib/cuotasNexa";

// La cuota del mes en palabras: qué estado tiene, cuánto se pagó y con qué. Bloque para el modal y
// celda para la tabla; los dos leen el mismo aviso de lib/cuotasNexa.

const TONO: Record<TonoAvisoNexa, { borde: string; texto: string; Icono: typeof Clock }> = {
  nexa: { borde: "border-l-purple-600", texto: "text-purple-800", Icono: CheckCircle2 },
  otro: { borde: "border-l-green-600", texto: "text-green-800", Icono: CheckCircle2 },
  vencida: { borde: "border-l-red-600", texto: "text-red-700", Icono: AlertCircle },
  pendiente: { borde: "border-l-amber-500", texto: "text-amber-800", Icono: Clock },
};

type Props = { cuotaMes: CuotaMesNexa; ultimasCuotas: CuotaFranjaNexa[]; hoy?: string };

const bancoDe = (cuotaMes: CuotaMesNexa, cuotas: CuotaFranjaNexa[]) =>
  cuotas.find((c) => c.numero === cuotaMes.numero)?.banco ?? null;

// Cuánto de la cuota del mes está cubierto, con los mismos topes que la franja: un parcial nunca parece completo.
const fraccion = (c: CuotaMesNexa) =>
  fraccionPagadaNexa({ pagada: c.estado === "pagada", aplicado: c.aplicado, monto: c.monto });

export function NexaCuotaMesBloque({ cuotaMes, ultimasCuotas, hoy = hoyGuatemala() }: Props) {
  const aviso = avisoCuotaMesNexa(cuotaMes, hoy, bancoDe(cuotaMes, ultimasCuotas));
  const tono = TONO[aviso.tono];
  // El relleno de lo pagado va en el color del medio; si no hay pago, la barra queda vacía.
  const relleno = cuotaMes.medio === "NEXA" ? "bg-purple-600" : "bg-green-600";
  const pct = Math.round(fraccion(cuotaMes) * 100);

  return (
    <section className={`rounded-lg border border-slate-200 border-l-4 ${tono.borde} bg-white px-4 py-3`} aria-label={`${aviso.etiqueta}: ${aviso.titulo}. ${aviso.detalle}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <p className="text-xs font-medium text-slate-600">{aviso.etiqueta}</p>
        <p className="text-xs tabular-nums text-slate-600">Cuota {cuotaMes.numero} · vence {fmtDiaNexa(cuotaMes.vencimiento)}</p>
      </div>
      <p className={`mt-1 flex items-center gap-2 text-lg font-semibold leading-tight ${tono.texto}`}>
        <tono.Icono className="h-5 w-5 shrink-0" aria-hidden /> {aviso.titulo}
      </p>
      <p className="mt-1 text-sm text-slate-700">{aviso.detalle}</p>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden>
        {pct > 0 && <div className={`h-full rounded-full ${relleno}`} style={{ width: `${pct}%` }} />}
      </div>
    </section>
  );
}

// Para la columna "Cuota del mes" de la tabla: titular, monto y número/vencimiento, en tres líneas.
export function NexaCuotaMesCelda({ cuotaMes, ultimasCuotas, hoy = hoyGuatemala() }: Props) {
  const aviso = avisoCuotaMesNexa(cuotaMes, hoy, bancoDe(cuotaMes, ultimasCuotas));
  const tono = TONO[aviso.tono];
  return (
    <div className="min-w-[10rem]">
      <div className={`flex items-center gap-1 whitespace-nowrap text-xs font-semibold ${tono.texto}`}>
        <tono.Icono className="h-3.5 w-3.5 shrink-0" aria-hidden /> {aviso.titulo}
      </div>
      <div className="mt-0.5 whitespace-nowrap text-[11px] text-slate-700">{aviso.corto}</div>
      <div className="mt-0.5 whitespace-nowrap text-[11px] tabular-nums text-slate-600">Cuota {cuotaMes.numero} · vence {fmtDiaNexa(cuotaMes.vencimiento)}</div>
    </div>
  );
}
