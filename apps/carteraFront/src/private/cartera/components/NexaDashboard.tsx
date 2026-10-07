import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useNexaDashboard } from "../hooks/useNexaDashboard";
import { NexaPagosModal } from "./NexaPagosModal";
import { NexaFranjaCanal } from "./NexaFranjaCanal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, X, ChevronLeft, ChevronRight, AlertCircle, Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtQ } from "@/lib/moneda";
import { getApiErrorMessage } from "@/lib/apiError";
import { describirRango, fmtFechaNexa } from "../services/nexaDashboard.services";


export function NexaDashboard() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [busqueda, setBusqueda] = useState(searchParams.get("q") ?? "");
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [page, setPage] = useState(1);
  const [desdeInput, setDesdeInput] = useState("");
  const [hastaInput, setHastaInput] = useState("");
  const [rango, setRango] = useState({ desde: "", hasta: "" });
  const [creditoModal, setCreditoModal] = useState<{ creditoId: number; numeroCreditoSifco: string; cliente: string; nexaToken: string | null } | null>(null);
  const { data, isLoading, error } = useNexaDashboard({ q, page, pageSize: 20, ...rango });

  const handleBuscar = () => { setQ(busqueda); setRango({ desde: desdeInput, hasta: hastaInput }); setPage(1); };
  const handleLimpiar = () => {
    setBusqueda(""); setQ(""); setDesdeInput(""); setHastaInput(""); setRango({ desde: "", hasta: "" }); setPage(1);
  };
  const totalPages = data ? Math.max(1, Math.ceil(data.total / 20)) : 1;

  if (isLoading && !data) return <div className="flex items-center justify-center p-8"><Loader2 className="animate-spin mr-2" /> Cargando…</div>;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Pagos Nexa</h1>
        <p className="text-sm text-gray-600">Créditos con token de Nexa y si su último pago entró por Nexa{describirRango(rango)}</p>
      </div>

      {data?.totales && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Créditos con token", value: `${data.totales.conToken} de ${data.totales.creditos}` },
            { label: "Último pago por Nexa", value: `${data.totales.ultimoPagoNexa} créditos`, teal: true },
            { label: "Pagos por Nexa", value: `${data.totales.pagosNexa} · ${fmtQ(data.totales.montoNexa)}` },
            { label: "Rechazados por Nexa", value: data.totales.rechazosNexa, red: data.totales.rechazosNexa > 0 },
          ].map((stat) => (
            <div key={stat.label} className="p-4 rounded-lg bg-white border border-slate-200 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{stat.label}</div>
              <div className={`mt-1 text-xl font-semibold tabular-nums ${stat.red ? "text-red-600" : stat.teal ? "text-teal-700" : "text-slate-900"}`}>{stat.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <Input className="flex-1 min-w-[220px]" placeholder="Número de crédito o cliente" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleBuscar()} aria-label="Buscar por número de crédito o cliente" />
        <label htmlFor="nexa-desde" className="text-sm text-gray-600">Pagos desde</label>
        <Input id="nexa-desde" type="date" className="w-40" value={desdeInput} max={hastaInput || undefined} onChange={(e) => setDesdeInput(e.target.value)} />
        <label htmlFor="nexa-hasta" className="text-sm text-gray-600">hasta</label>
        <Input id="nexa-hasta" type="date" className="w-40" value={hastaInput} min={desdeInput || undefined} onChange={(e) => setHastaInput(e.target.value)} />
        <Button onClick={handleBuscar} variant="default" size="sm" aria-label="Buscar"><Search className="h-4 w-4" /></Button>
        <Button onClick={handleLimpiar} variant="outline" size="sm" aria-label="Limpiar filtros"><X className="h-4 w-4" /></Button>
      </div>

      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex gap-2 text-red-700"><AlertCircle className="h-5 w-5" /><span>{getApiErrorMessage(error, "No se pudieron cargar los créditos")}</span></div>}

      {!data?.creditos.length && !isLoading && !error ? (
        <div className="p-8 text-center text-gray-500">No hay créditos con Nexa para este filtro</div>
      ) : (
        <>
          <Table className="rounded-lg border border-slate-200 bg-white">
            <TableHeader><TableRow className="bg-slate-50">
              {["Crédito", "Estado", "Token", "Últimos pagos", "Último pago", "Pagos Nexa", ""].map((h) => (
                <TableHead key={h} className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{h}</TableHead>
              ))}
            </TableRow></TableHeader>
            <TableBody>
              {data?.creditos.map((c) => (
                <TableRow key={c.creditoId} className={`border-l-[3px] hover:bg-slate-50 ${c.ultimoPagoNexa ? "border-l-teal-600" : "border-l-transparent"}`}>
                  <TableCell>
                    <div className="font-mono text-sm text-slate-900">{c.numeroCreditoSifco}</div>
                    <div className="text-xs text-slate-500">{c.cliente}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className="text-[11px] text-slate-600">{c.estado}</Badge></TableCell>
                  <TableCell>
                    {c.nexaToken
                      ? <span className="rounded bg-teal-50 px-1.5 py-0.5 font-mono text-xs text-teal-800">{c.nexaToken}</span>
                      : <span className="text-xs text-slate-400">Sin token</span>}
                  </TableCell>
                  <TableCell>
                    <NexaFranjaCanal mini barras={[...c.ultimosCanales].map((canal) => ({ nexa: canal === "N" }))} />
                    {c.ultimoPagoFecha && (
                      <div className={`mt-1 text-[11px] font-medium ${c.ultimoPagoNexa ? "text-teal-700" : "text-slate-500"}`}>
                        Último: {c.ultimoPagoNexa ? "Nexa" : "manual"}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {c.ultimoPagoFecha ? (
                      <><div className="font-mono text-xs text-slate-600 tabular-nums">{fmtFechaNexa(c.ultimoPagoFecha)}</div>{c.ultimoPagoMonto && <div className="font-mono text-sm font-semibold tabular-nums">{fmtQ(c.ultimoPagoMonto)}</div>}</>
                    ) : <span className="text-xs text-slate-400">Sin pagos</span>}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {c.pagosNexa}
                    {c.rechazosNexa > 0 && <div className="text-[11px] font-medium text-red-600">{c.rechazosNexa} {c.rechazosNexa === 1 ? "rechazado" : "rechazados"}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" onClick={() => setCreditoModal({ creditoId: c.creditoId, numeroCreditoSifco: c.numeroCreditoSifco, cliente: c.cliente, nexaToken: c.nexaToken })} className="text-xs bg-blue-700 text-white hover:bg-blue-800">Ver pagos</Button>
                      <Button variant="outline" size="sm" onClick={() => navigate(`/pagos/${c.numeroCreditoSifco}`)} className="text-xs">Ir a pagos</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Página {page} de {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="sm" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} aria-label="Página siguiente"><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </>
      )}
      <NexaPagosModal credito={creditoModal} rango={rango} onClose={() => setCreditoModal(null)} />
    </div>
  );
}
