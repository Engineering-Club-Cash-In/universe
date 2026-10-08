import { Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, Loader2, Smartphone } from "lucide-react";
import { useNexaPagosCredito } from "../hooks/useNexaDashboard";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fmtQ, sumaQ } from "@/lib/moneda";
import { getApiErrorMessage } from "@/lib/apiError";
import { CLASES_TONO_NEXA, estadoNexa, motivoRechazoNexa } from "@/lib/estadoNexa";
import { cuotasTexto, describirRango, fmtFechaNexa, type NexaDashboardCredito, type NexaPagoCredito, type RangoFechas } from "../services/nexaDashboard.services";
import { LeyendaCuotasNexa, NexaFranjaCanal } from "./NexaFranjaCanal";
import { bancoTexto } from "@/lib/cuotasNexa";

interface NexaPagosModalProps {
  credito: NexaDashboardCredito | null;
  rango: RangoFechas;
  onClose: () => void;
}

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const mesDe = (fecha: string | null) => (fecha ? `${MESES[Number(fecha.slice(5, 7)) - 1]} ${fecha.slice(0, 4)}` : "Sin fecha");
const esNexa = (p: NexaPagoCredito) => p.canal === "NEXA";

// Últimas cuotas del crédito (no depende del rango de fechas: es cómo están hoy).
function FranjaCuotas({ credito }: { credito: NexaDashboardCredito }) {
  return (
    <div>
      <NexaFranjaCanal cuotas={credito.ultimasCuotas} cuotaMes={credito.cuotaMes?.numero} />
      <div className="mt-1.5 flex justify-between text-[11px] text-slate-500">
        <span>Más antigua · número de cuota</span>
        <span>Más reciente</span>
      </div>
      <div className="mt-1"><LeyendaCuotasNexa /></div>
    </div>
  );
}

function EstadoPago({ pago }: { pago: NexaPagoCredito }) {
  const { etiqueta, tono } = esNexa(pago) && pago.eventoEstado
    ? estadoNexa(pago.eventoEstado)
    : pago.validado ? { etiqueta: "Validado", tono: "neutro" as const } : { etiqueta: "Pendiente de validar", tono: "espera" as const };
  return <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${CLASES_TONO_NEXA[tono]}`}>{etiqueta}</span>;
}

export function NexaPagosModal({ credito, rango, onClose }: NexaPagosModalProps) {
  const navigate = useNavigate();
  const { data, isLoading, error } = useNexaPagosCredito(credito?.creditoId ?? null, rango);
  const pagos = data?.pagos ?? [];
  const pagosNexa = pagos.filter(esNexa);
  const ultimo = pagos[0];

  return (
    <Dialog open={credito !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-white text-slate-900 sm:max-w-3xl max-h-[88vh] overflow-y-auto p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-200">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">Pagos del crédito{describirRango(rango)}</p>
          <DialogTitle className="font-mono text-xl tracking-tight text-slate-900">{credito?.numeroCreditoSifco}</DialogTitle>
          <DialogDescription className="text-slate-600">{credito?.cliente}</DialogDescription>
          {credito?.nexaToken && (
            <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-md bg-purple-50 px-2 py-1 font-mono text-xs text-purple-900">
              <Smartphone className="h-3.5 w-3.5" /> Token {credito.nexaToken}
            </span>
          )}
        </DialogHeader>

        <div className="px-6 py-5 space-y-6">
          {isLoading && <div className="flex items-center gap-2 py-10 justify-center text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando pagos…</div>}
          {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{getApiErrorMessage(error, "No se pudieron cargar los pagos")}</p>}
          {data && pagos.length === 0 && <p className="py-10 text-center text-slate-500">Este crédito no tiene pagos en el período elegido.</p>}

          {credito && credito.ultimasCuotas.length > 0 && <FranjaCuotas credito={credito} />}

          {pagos.length > 0 && (
            <section>
              <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
                <div><dt className="text-[11px] text-slate-500">Por Nexa</dt><dd className="font-semibold tabular-nums">{pagosNexa.length} de {pagos.length}</dd></div>
                <div><dt className="text-[11px] text-slate-500">Monto por Nexa</dt><dd className="font-semibold tabular-nums">{fmtQ(sumaQ(pagosNexa.map((p) => p.montoBoleta)))}</dd></div>
                <div><dt className="text-[11px] text-slate-500">Último pago</dt><dd className={`font-semibold ${ultimo && esNexa(ultimo) ? "text-purple-700" : "text-green-700"}`}>{ultimo && esNexa(ultimo) ? "Por Nexa" : "Manual"}</dd></div>
              </dl>
            </section>
          )}

          {(data?.eventosSinPago.length ?? 0) > 0 && (
            <section className="rounded-lg border border-red-200 bg-red-50/60 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-red-800"><AlertTriangle className="h-4 w-4" /> Pagos que Nexa envió y cartera no aplicó</h3>
              <ul className="mt-2 divide-y divide-red-100">
                {data!.eventosSinPago.map((e) => (
                  <li key={e.referencia} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
                    <span className="flex items-center gap-2 text-red-900">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${CLASES_TONO_NEXA[estadoNexa(e.estado).tono]}`}>{estadoNexa(e.estado).etiqueta}</span>
                      {motivoRechazoNexa(e.error)}
                    </span>
                    <span className="font-mono text-xs text-red-700/80 tabular-nums">{fmtFechaNexa(e.creado)} · {fmtQ(e.monto)} · ref. {e.referencia}</span>
                    {e.tieneFilasVivas && (
                      <span className="basis-full text-xs font-semibold text-red-800">
                        Nexa devolvió el dinero; anular estas filas, no validarlas.
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {pagos.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Pagos{pagos.length === 50 ? " (últimos 50)" : ""}</h3>
              <ol className="rounded-lg border border-slate-200">
                {pagos.map((p, i) => (
                  <Fragment key={`${p.fechaPago}-${p.montoBoleta}-${i}`}>
                    {(i === 0 || mesDe(p.fechaPago) !== mesDe(pagos[i - 1].fechaPago)) && (
                      <li className="bg-slate-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200 first:rounded-t-lg">{mesDe(p.fechaPago)}</li>
                    )}
                    <li className={`grid grid-cols-[auto_1fr_auto] sm:grid-cols-[auto_1fr_auto_6.5rem] items-center gap-x-4 gap-y-1 border-b border-slate-100 last:border-0 px-4 py-2 border-l-[3px] ${esNexa(p) ? "border-l-purple-600" : "border-l-green-600"}`}>
                      <span className="font-mono text-xs text-slate-500 tabular-nums">{fmtFechaNexa(p.fechaPago)}</span>
                      <span className="truncate text-xs">
                        <span className={esNexa(p) ? "font-medium text-purple-700" : "text-green-700"}>{esNexa(p) ? "Nexa" : `Manual · ${bancoTexto("MANUAL", p.banco)}`}</span>
                        {!esNexa(p) && p.registradoPor && <span className="text-slate-500"> · {p.registradoPor}</span>}
                        {p.cuotas.length > 0 && <span className="text-slate-400"> · {cuotasTexto(p.cuotas)}</span>}
                      </span>
                      <span className="order-last col-span-3 justify-self-end sm:order-none sm:col-span-1"><EstadoPago pago={p} /></span>
                      <span className="text-right font-mono text-sm font-semibold tabular-nums">{fmtQ(p.montoBoleta)}</span>
                    </li>
                  </Fragment>
                ))}
              </ol>
            </section>
          )}
        </div>

        <DialogFooter className="border-t border-slate-200 px-6 py-4">
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          <Button className="bg-blue-700 text-white hover:bg-blue-800" onClick={() => navigate(`/pagos/${credito?.numeroCreditoSifco}`)}>
            Ver todos los pagos del crédito <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
