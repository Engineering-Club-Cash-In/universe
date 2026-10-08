import { useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useNexaDashboard } from "../hooks/useNexaDashboard";
import { getAdvisors, type Advisor } from "../services/services";
import { useAuth } from "@/Provider/authProvider";
import { NexaPagosModal } from "./NexaPagosModal";
import { NexaFiltros, type ChipFiltro } from "./NexaFiltros";
import { LeyendaCuotasNexa, NexaFranjaCanal } from "./NexaFranjaCanal";
import { NexaCuotaMesCelda } from "./NexaCuotaMes";
import { NexaCabecera } from "./NexaCabecera";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, AlertCircle, Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtQ } from "@/lib/moneda";
import { getApiErrorMessage } from "@/lib/apiError";
import { describirRango, fmtFechaNexa, type NexaDashboardCredito, type NexaDashboardParams } from "../services/nexaDashboard.services";
import { bancoTexto, resumenRechazosNexa } from "@/lib/cuotasNexa";
import { CLASES_TONO_NEXA, estadoNexa, motivoRechazoNexa } from "@/lib/estadoNexa";

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
  // Filtros ya aplicados (no lo que está escrito sin "Buscar"), cada uno con su forma de quitarlo.
  const chips: ChipFiltro[] = [];
  if (q) chips.push({ id: "q", texto: `Búsqueda: ${q}`, quitar: () => { setBusqueda(""); setQ(""); setPage(1); } });
  if (rango.desde || rango.hasta) {
    const texto = describirRango(rango).replace(/^ · p/, "P");
    chips.push({ id: "rango", texto, quitar: () => { setDesdeInput(""); setHastaInput(""); setRango({ desde: "", hasta: "" }); setPage(1); } });
  }
  if (cuotaMes) {
    const texto = `Cuota del mes: ${cuotaMes === "pagados" ? "pagada" : cuotaMes === "parciales" ? "parcial" : "sin pago"}`;
    chips.push({ id: "cuota", texto, quitar: () => { setCuotaMes(""); setPage(1); } });
  }
  if (medio) {
    chips.push({ id: "medio", texto: `Medio: ${medio === "nexa" ? "Nexa" : "Manual"}`, quitar: () => { setMedio(""); setPage(1); } });
  }
  if (puedeFiltrarAsesor && asesor) {
    const nombre = opcionesAsesor.find((a) => String(a.asesor_id) === asesor)?.nombre ?? asesor;
    chips.push({ id: "asesor", texto: `Asesor: ${nombre}`, quitar: () => { setAsesor(""); setPage(1); } });
  }
  const totalPages = data ? Math.max(1, Math.ceil(data.total / 20)) : 1;

  if (isLoading && !data) return <div className="flex items-center justify-center p-8 text-slate-700"><Loader2 className="animate-spin mr-2" /> Cargando…</div>;

  return (
    // Color explícito: el contenedor de la página hereda texto blanco.
    <div className="p-6 space-y-4 text-slate-900">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Pagos Nexa</h1>
        <p className="text-sm text-slate-700">Cómo vienen pagando la cuota los créditos con token de Nexa{describirRango(rango)}</p>
        {esAsesor && <p className="mt-1 text-sm font-medium text-blue-800">Mostrando tus créditos</p>}
      </div>

      {data?.totales?.desglose && (
        <NexaCabecera
          desglose={data.totales.desglose}
          filtro={{ cuotaMes, medio }}
          onFiltrar={(f) => { setCuotaMes(f.cuotaMes); setMedio(f.medio); setPage(1); }}
          periodo={describirRango(rango)}
        />
      )}

      <NexaFiltros
        busqueda={busqueda}
        onBusqueda={setBusqueda}
        desde={desdeInput}
        hasta={hastaInput}
        onDesde={setDesdeInput}
        onHasta={setHastaInput}
        pendiente={busqueda !== q || desdeInput !== rango.desde || hastaInput !== rango.hasta}
        onBuscar={handleBuscar}
        cuotaMes={cuotaMes}
        onCuotaMes={(nuevo) => {
          setCuotaMes(nuevo);
          // Sin pago no tiene medio.
          if (nuevo === "sinpago") setMedio("");
          setPage(1);
        }}
        medio={medio}
        onMedio={(v) => { setMedio(v); setPage(1); }}
        puedeFiltrarAsesor={puedeFiltrarAsesor}
        asesor={asesor}
        onAsesor={(v) => { setAsesor(v); setPage(1); }}
        opcionesAsesor={opcionesAsesor}
        chips={chips}
        onLimpiar={handleLimpiar}
      />

      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex gap-2 text-red-700"><AlertCircle className="h-5 w-5" /><span>{getApiErrorMessage(error, "No se pudieron cargar los créditos")}</span></div>}

      {!data?.creditos.length && !isLoading && !error ? (
        <div className="p-8 text-center text-gray-500">No hay créditos con Nexa para este filtro</div>
      ) : (
        <>
          <div className="py-1"><LeyendaCuotasNexa /></div>
          <Table className="rounded-lg border border-slate-200 bg-white">
            <TableHeader><TableRow className="bg-slate-50">
              {["Crédito", "Estado", "Token", "Últimas cuotas", "Cuota del mes", "Último pago", "Cómo pagó", "Pagos Nexa", ""].map((h) => (
                <TableHead key={h} className="text-xs font-semibold uppercase tracking-wider text-slate-600">{h}</TableHead>
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
                    {c.cuotaMes
                      ? <NexaCuotaMesCelda cuotaMes={c.cuotaMes} ultimasCuotas={c.ultimasCuotas} />
                      : <span className="text-xs text-slate-500">Sin cuotas</span>}
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
