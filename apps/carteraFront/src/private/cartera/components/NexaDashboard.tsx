import { useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useNexaDashboard } from "../hooks/useNexaDashboard";
import { getAdvisors, type Advisor } from "../services/services";
import { useAuth } from "@/Provider/authProvider";
import { NexaPagosModal } from "./NexaPagosModal";
import { LeyendaCuotasNexa, NexaFranjaCanal } from "./NexaFranjaCanal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, X, ChevronLeft, ChevronRight, AlertCircle, Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtQ } from "@/lib/moneda";
import { getApiErrorMessage } from "@/lib/apiError";
import { describirRango, fmtFechaNexa, type NexaDashboardCredito, type NexaDashboardParams } from "../services/nexaDashboard.services";
import { ESTADO_CUOTA_MES, bancoTexto, fmtDiaNexa, pagoCuotaMesTexto, resumenRechazosNexa } from "@/lib/cuotasNexa";
import { CLASES_TONO_NEXA, estadoNexa, motivoRechazoNexa } from "@/lib/estadoNexa";

// Radix Select no admite value "": "todos" = sin filtro.
const sinTodos = <T extends string>(v: string) => (v === "todos" ? "" : v) as T;

function RechazosFila({ c }: { c: NexaDashboardCredito }) {
  if (c.rechazosNexa === 0) return null;
  return (
    <details className="mt-1 text-[11px]">
      <summary className="cursor-pointer font-medium text-red-700">{resumenRechazosNexa(c.rechazosDetalle, c.rechazosNexa)}</summary>
      <ul className="mt-1 space-y-1">
        {c.rechazosDetalle.map((r, i) => {
          const { etiqueta, tono } = estadoNexa(r.estado);
          return (
            <li key={i} className="rounded border border-slate-200 bg-white p-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`rounded-full border px-1.5 py-px text-[10px] font-medium ${CLASES_TONO_NEXA[tono]}`}>{etiqueta}</span>
                <span className="font-mono tabular-nums text-slate-600">{fmtFechaNexa(r.fecha)} · {fmtQ(r.monto)}</span>
              </div>
              <div className="mt-0.5 text-slate-800">{motivoRechazoNexa(r.codigo)}</div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}


export function NexaDashboard() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [busqueda, setBusqueda] = useState(searchParams.get("q") ?? "");
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [page, setPage] = useState(1);
  const [desdeInput, setDesdeInput] = useState("");
  const [hastaInput, setHastaInput] = useState("");
  const [rango, setRango] = useState({ desde: "", hasta: "" });
  const [medio, setMedio] = useState<NexaDashboardParams["medio"]>("");
  const [cuotaMes, setCuotaMes] = useState<NexaDashboardParams["cuotaMes"]>("");
  const [creditoModal, setCreditoModal] = useState<NexaDashboardCredito | null>(null);
  // El alcance lo decide el back: esto solo muestra u oculta el filtro. Un ASESOR no lo ve y,
  // aunque mande ?asesor=, el back le aplica el suyo.
  const { user } = useAuth();
  const esAsesor = user?.role === "ASESOR";
  const puedeFiltrarAsesor = user?.role === "ADMIN" || user?.role === "CONTA";
  const [asesor, setAsesor] = useState("");
  const { data: advisors } = useQuery<Advisor[]>({
    queryKey: ["advisors"],
    queryFn: getAdvisors,
    enabled: puedeFiltrarAsesor,
    staleTime: 5 * 60 * 1000,
  });
  // GET /advisor une con platform_users: un asesor con dos usuarios viene repetido.
  const opcionesAsesor = useMemo(() => {
    const porId = new Map<number, Advisor>();
    for (const a of Array.isArray(advisors) ? advisors : []) if (!porId.has(a.asesor_id)) porId.set(a.asesor_id, a);
    return [...porId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [advisors]);
  const { data, isLoading, error } = useNexaDashboard({
    q, page, pageSize: 20, medio, cuotaMes, asesor: puedeFiltrarAsesor ? asesor : "", ...rango,
  });

  const handleBuscar = () => { setQ(busqueda); setRango({ desde: desdeInput, hasta: hastaInput }); setPage(1); };
  const handleLimpiar = () => {
    setBusqueda(""); setQ(""); setDesdeInput(""); setHastaInput(""); setRango({ desde: "", hasta: "" });
    setMedio(""); setCuotaMes(""); setAsesor(""); setPage(1);
  };
  const totalPages = data ? Math.max(1, Math.ceil(data.total / 20)) : 1;

  if (isLoading && !data) return <div className="flex items-center justify-center p-8 text-slate-700"><Loader2 className="animate-spin mr-2" /> Cargando…</div>;

  return (
    // Color explícito: el contenedor de la página hereda texto blanco.
    <div className="p-6 space-y-4 text-slate-900">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Pagos Nexa</h1>
        <p className="text-sm text-slate-700">Créditos con token de Nexa y si su último pago entró por Nexa{describirRango(rango)}</p>
        {esAsesor && <p className="mt-1 text-sm font-medium text-blue-800">Mostrando tus créditos</p>}
      </div>

      {data?.totales && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Créditos con token", value: `${data.totales.conToken} de ${data.totales.creditos}` },
            { label: "Último pago por Nexa", value: `${data.totales.ultimoPagoNexa} créditos`, nexa: true },
            { label: "Pagos por Nexa", value: `${data.totales.pagosNexa} · ${fmtQ(data.totales.montoNexa)}` },
            { label: "Rechazados por Nexa", value: data.totales.rechazosNexa, red: data.totales.rechazosNexa > 0 },
          ].map((stat) => (
            <div key={stat.label} className="p-4 rounded-lg bg-white border border-slate-200 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{stat.label}</div>
              <div className={`mt-1 text-xl font-semibold tabular-nums ${stat.red ? "text-red-600" : stat.nexa ? "text-purple-700" : "text-slate-900"}`}>{stat.value}</div>
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
        <Select value={cuotaMes || "todos"} onValueChange={(v) => {
          const nuevo = sinTodos<NexaDashboardParams["cuotaMes"]>(v);
          setCuotaMes(nuevo);
          // El medio solo aplica a cuotas pagadas.
          if (nuevo !== "pagados") setMedio("");
          setPage(1);
        }}>
          <SelectTrigger className="w-auto gap-2 text-slate-900" aria-label="Cuota del mes"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-white text-slate-900 border-slate-200">
            <SelectItem value="todos" className="text-slate-900 focus:bg-blue-50 focus:text-slate-900">Cuota del mes: todos</SelectItem>
            <SelectItem value="pagados" className="text-slate-900 focus:bg-blue-50 focus:text-slate-900">Cuota del mes: pagados</SelectItem>
            <SelectItem value="pendientes" className="text-slate-900 focus:bg-blue-50 focus:text-slate-900">Cuota del mes: pendientes</SelectItem>
          </SelectContent>
        </Select>
        {cuotaMes === "pagados" && (
          <Select value={medio || "todos"} onValueChange={(v) => { setMedio(sinTodos<NexaDashboardParams["medio"]>(v)); setPage(1); }}>
            <SelectTrigger className="w-auto gap-2 text-slate-900" aria-label="Medio con que se pagó la cuota del mes"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-white text-slate-900 border-slate-200">
              <SelectItem value="todos" className="text-slate-900 focus:bg-blue-50 focus:text-slate-900">Pagada por: Nexa o manual</SelectItem>
              <SelectItem value="nexa" className="text-slate-900 focus:bg-blue-50 focus:text-slate-900">Pagada por: Nexa</SelectItem>
              <SelectItem value="manual" className="text-slate-900 focus:bg-blue-50 focus:text-slate-900">Pagada por: manual</SelectItem>
            </SelectContent>
          </Select>
        )}
        {puedeFiltrarAsesor && (
          <Select value={asesor || "todos"} onValueChange={(v) => { setAsesor(sinTodos<string>(v)); setPage(1); }}>
            <SelectTrigger className="w-auto gap-2 text-slate-900" aria-label="Asesor"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-white text-slate-900 border-slate-200">
              <SelectItem value="todos" className="text-slate-900 focus:bg-blue-50 focus:text-slate-900">Asesor: todos</SelectItem>
              {opcionesAsesor.map((a) => (
                <SelectItem key={a.asesor_id} value={String(a.asesor_id)} className="text-slate-900 focus:bg-blue-50 focus:text-slate-900">Asesor: {a.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button onClick={handleBuscar} variant="default" size="sm" aria-label="Buscar"><Search className="h-4 w-4" /></Button>
        <Button onClick={handleLimpiar} variant="outline" size="sm" aria-label="Limpiar filtros"><X className="h-4 w-4" /></Button>
      </div>

      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex gap-2 text-red-700"><AlertCircle className="h-5 w-5" /><span>{getApiErrorMessage(error, "No se pudieron cargar los créditos")}</span></div>}

      {!data?.creditos.length && !isLoading && !error ? (
        <div className="p-8 text-center text-gray-500">No hay créditos con Nexa para este filtro</div>
      ) : (
        <>
          <LeyendaCuotasNexa />
          <Table className="rounded-lg border border-slate-200 bg-white">
            <TableHeader><TableRow className="bg-slate-50">
              {["Crédito", "Estado", "Token", "Últimas cuotas", "Cuota del mes", "Último pago", "Cómo pagó", "Pagos Nexa", ""].map((h) => (
                <TableHead key={h} className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{h}</TableHead>
              ))}
            </TableRow></TableHeader>
            <TableBody>
              {data?.creditos.map((c) => (
                <TableRow key={c.creditoId} className={`border-l-[3px] hover:bg-slate-50 ${c.ultimoPagoNexa ? "border-l-purple-600" : "border-l-transparent"}`}>
                  <TableCell>
                    <div className="font-mono text-sm text-slate-900">{c.numeroCreditoSifco}</div>
                    <div className="text-xs text-slate-500">{c.cliente}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className="text-[11px] text-slate-600">{c.estado}</Badge></TableCell>
                  <TableCell>
                    {c.nexaToken
                      ? <span className="rounded bg-purple-50 px-1.5 py-0.5 font-mono text-xs text-purple-900">{c.nexaToken}</span>
                      : <span className="text-xs text-slate-400">Sin token</span>}
                  </TableCell>
                  <TableCell>
                    <NexaFranjaCanal mini cuotas={c.ultimasCuotas} cuotaMes={c.cuotaMes?.numero} />
                  </TableCell>
                  <TableCell>
                    {c.cuotaMes ? (
                      <>
                        <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${ESTADO_CUOTA_MES[c.cuotaMes.estado].clases}`}>{ESTADO_CUOTA_MES[c.cuotaMes.estado].etiqueta}</span>
                        <div className={`mt-1 whitespace-nowrap text-[11px] font-medium ${c.cuotaMes.pago === "parcial" ? "text-amber-700" : c.cuotaMes.pago === "completa" ? (c.cuotaMes.medio === "NEXA" ? "text-purple-700" : "text-green-700") : "text-slate-600"}`}>{pagoCuotaMesTexto(c.cuotaMes)}</div>
                        <div className="mt-1 font-mono text-[11px] text-slate-600 tabular-nums">Cuota {c.cuotaMes.numero} · vence {fmtDiaNexa(c.cuotaMes.vencimiento)}</div>
                      </>
                    ) : <span className="text-xs text-slate-400">Sin cuotas</span>}
                  </TableCell>
                  <TableCell>
                    {c.ultimoPagoFecha ? (
                      <><div className="font-mono text-xs text-slate-600 tabular-nums">{fmtFechaNexa(c.ultimoPagoFecha)}</div>{c.ultimoPagoMonto && <div className="font-mono text-sm font-semibold tabular-nums text-slate-900">{fmtQ(c.ultimoPagoMonto)}</div>}</>
                    ) : <span className="text-xs text-slate-400">Sin pagos</span>}
                  </TableCell>
                  <TableCell>
                    {c.ultimoPagoFecha ? (
                      <>
                        <div className={`text-sm font-medium ${c.ultimoPagoNexa ? "text-purple-700" : "text-green-700"}`}>{c.ultimoPagoNexa ? "Nexa" : "Manual"}</div>
                        <div className="text-[11px] text-slate-600">{bancoTexto(c.ultimoPagoNexa ? "NEXA" : "MANUAL", c.ultimoPagoBanco)}</div>
                      </>
                    ) : <span className="text-xs text-slate-400">--</span>}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums min-w-[9rem] text-slate-900">
                    {c.pagosNexa}
                    <RechazosFila c={c} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" onClick={() => setCreditoModal(c)} className="text-xs bg-blue-700 text-white hover:bg-blue-800">Ver pagos</Button>
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
