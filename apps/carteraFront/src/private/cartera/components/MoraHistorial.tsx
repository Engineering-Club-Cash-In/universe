import { useState, useRef, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Search, X, ChevronLeft, ChevronRight, Check, ChevronsUpDown, FileDown, Loader2, Calendar, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useAdminData } from "../hooks/advisor";
import type { Advisor } from "../services/services";
import {
  getMoraHistorialSnapshot, getMoraTimeline, getMoraHistorialCredito, descargarMoraExcel,
  type MoraEvento,
} from "../services/moraHistorial.services";

const fechaGT = () => new Date(new Date().toLocaleString("en-US", { timeZone: "America/Guatemala" }));
const isoDe = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hoyISO = () => isoDe(fechaGT());
const menosDias = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() - n); return isoDe(d); };
const fmtQ = (v: any) => `Q ${Number(v ?? 0).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const etapaBadge = (etapa: string) => {
  const map: Record<string, string> = {
    "Mora 30": "bg-yellow-100 text-yellow-800",
    "Mora 60": "bg-orange-100 text-orange-800",
    "Mora 90": "bg-red-100 text-red-700",
    "Mora 120+": "bg-red-200 text-red-900",
  };
  return map[etapa] ?? "bg-gray-100 text-gray-700";
};

export function MoraHistorial() {
  const { advisors } = useAdminData();
  const [fecha, setFecha] = useState(hoyISO());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [asesores, setAsesores] = useState<string[]>([]);
  const [etapa, setEtapa] = useState("");
  const [sifcoInput, setSifcoInput] = useState("");
  const [nombreInput, setNombreInput] = useState("");
  const [sifco, setSifco] = useState("");
  const [nombre, setNombre] = useState("");
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [expanded, setExpanded] = useState<number | null>(null);
  const [eventos, setEventos] = useState<MoraEvento[]>([]);
  const [loadingEv, setLoadingEv] = useState(false);
  const pendingRef = useRef<number | null>(null); // token anti-race del drill-down

  const asesorCsv = asesores.join(",") || undefined;

  const snapQuery = useQuery({
    queryKey: ["mora-historial", fecha, asesorCsv, etapa, sifco, nombre, page, pageSize],
    queryFn: () => getMoraHistorialSnapshot({
      fecha, asesor: asesorCsv, etapa: etapa || undefined,
      numero_credito_sifco: sifco || undefined, nombre_usuario: nombre || undefined, page, pageSize,
    }),
    refetchOnWindowFocus: false,
  });

  const timelineQuery = useQuery({
    queryKey: ["mora-timeline", fecha, asesorCsv],
    queryFn: () => getMoraTimeline(menosDias(fecha, 45), fecha, asesorCsv),
    refetchOnWindowFocus: false,
  });

  const rows = snapQuery.data?.data ?? [];
  const totales = snapQuery.data?.totales;
  const pagination = snapQuery.data?.pagination;
  const timeline = (timelineQuery.data?.data ?? []).map((d) => ({
    fecha: String(d.fecha).slice(5, 10),
    mora: Number(d.mora_total),
  }));

  const aplicar = () => { setSifco(sifcoInput.trim()); setNombre(nombreInput.trim()); setPage(1); };
  const limpiar = () => { setAsesores([]); setEtapa(""); setSifcoInput(""); setNombreInput(""); setSifco(""); setNombre(""); setPage(1); };

  const toggleRow = async (creditoId: number) => {
    if (expanded === creditoId) { setExpanded(null); setEventos([]); pendingRef.current = null; return; }
    setExpanded(creditoId); setEventos([]); setLoadingEv(true);
    pendingRef.current = creditoId;
    try {
      const r = await getMoraHistorialCredito(creditoId);
      if (pendingRef.current !== creditoId) return; // otra fila se expandió mientras tanto
      if (r.success) setEventos(r.data);
    } finally {
      if (pendingRef.current === creditoId) setLoadingEv(false);
    }
  };

  const descargar = async () => {
    setExporting(true);
    try {
      const blob = await descargarMoraExcel({ fecha, asesor: asesorCsv, etapa: etapa || undefined, numero_credito_sifco: sifco || undefined, nombre_usuario: nombre || undefined });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `mora-${fecha}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  };

  const filtros = asesores.length + (etapa ? 1 : 0) + (sifco ? 1 : 0) + (nombre ? 1 : 0);

  return (
    <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 overflow-auto bg-gradient-to-br from-blue-50 to-white px-4 sm:px-6 lg:px-8 pt-8 pb-8">
      <div className="w-full max-w-[1400px] mx-auto">
        <div className="flex flex-col items-center mb-6">
          <h1 className="text-3xl font-extrabold text-red-700 text-center">Mora Histórica</h1>
          <p className="text-gray-600 mt-2 text-center">Mora reconstruida a cualquier fecha de corte (desde el historial). Expande un crédito para ver sus eventos.</p>
        </div>

        {/* Filtros */}
        <div className="bg-white/80 backdrop-blur rounded-2xl shadow-lg border border-red-100 p-5 mb-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[150px]">
              <label className="text-sm font-semibold text-red-800 mb-1 block">Mora al día</label>
              <Input type="date" value={fecha} onChange={(e) => { setFecha(e.target.value); setPage(1); }} className="text-gray-900 border-red-200 bg-red-50 [color-scheme:light]" />
            </div>

            <div className="flex-1 min-w-[230px]">
              <label className="text-sm font-semibold text-red-800 mb-1 block">Asesores</label>
              <Popover open={advisorOpen} onOpenChange={setAdvisorOpen}>
                <PopoverTrigger asChild>
                  <div role="button" tabIndex={0} className="w-full flex items-center justify-between border border-red-200 rounded-lg px-3 py-2 bg-red-50 text-red-800 text-sm h-10 overflow-hidden cursor-pointer">
                    <span className="flex flex-wrap gap-1 flex-1 items-center overflow-hidden">
                      {asesores.length === 0 ? <span className="text-gray-400">Todos</span>
                        : asesores.length > 2 ? <Badge variant="secondary" className="text-xs bg-red-100 text-red-700">{asesores.length} asesores</Badge>
                        : asesores.map((n) => <Badge key={n} variant="secondary" className="text-xs bg-red-100 text-red-700">{n}</Badge>)}
                    </span>
                    <ChevronsUpDown className="w-4 h-4 shrink-0 opacity-50 ml-2" />
                  </div>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0 bg-white border border-red-200 shadow-lg" align="start">
                  <Command className="bg-white text-gray-900">
                    <CommandInput placeholder="Buscar asesor..." />
                    <CommandList className="max-h-[250px]">
                      <CommandEmpty>Sin resultados.</CommandEmpty>
                      <CommandGroup>
                        {advisors?.map((adv: Advisor) => {
                          const sel = asesores.includes(adv.nombre);
                          return (
                            <CommandItem key={adv.asesor_id} value={adv.nombre}
                              onSelect={() => { setAsesores(sel ? asesores.filter((v) => v !== adv.nombre) : [...asesores, adv.nombre]); setPage(1); }}
                              className="text-gray-800 hover:bg-red-50 cursor-pointer">
                              <Check className={`w-4 h-4 mr-2 ${sel ? "opacity-100 text-red-600" : "opacity-0"}`} />
                              {adv.nombre}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="min-w-[150px]">
              <label className="text-sm font-semibold text-red-800 mb-1 block">Etapa de Mora</label>
              <select className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm text-red-800 bg-red-50" value={etapa} onChange={(e) => { setEtapa(e.target.value); setPage(1); }}>
                <option value="">Todas</option>
                <option value="0-30">Mora 30</option>
                <option value="31-60">Mora 60</option>
                <option value="61-90">Mora 90</option>
                <option value="+90">Mora 120+</option>
              </select>
            </div>

            <div className="flex-1 min-w-[150px]">
              <label className="text-sm font-semibold text-red-800 mb-1 block">No. SIFCO</label>
              <Input placeholder="Buscar SIFCO..." value={sifcoInput} onChange={(e) => setSifcoInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && aplicar()} className="text-gray-900 border-red-200 bg-red-50" />
            </div>
            <div className="flex-1 min-w-[150px]">
              <label className="text-sm font-semibold text-red-800 mb-1 block">Cliente</label>
              <Input placeholder="Buscar nombre..." value={nombreInput} onChange={(e) => setNombreInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && aplicar()} className="text-gray-900 border-red-200 bg-red-50" />
            </div>

            <Button variant="outline" size="sm" onClick={aplicar} className="text-red-700 border-red-300 hover:bg-red-50">
              <Search className="w-4 h-4 mr-1" /> Buscar
            </Button>
            <Button variant="default" size="sm" onClick={descargar} disabled={exporting || !rows.length} className="bg-green-600 hover:bg-green-700 text-white border-none">
              {exporting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileDown className="w-4 h-4 mr-1" />}
              {exporting ? "Generando..." : "Excel"}
            </Button>
            {filtros > 0 && (
              <Button variant="outline" size="sm" onClick={limpiar} className="text-gray-600 border-gray-300 hover:bg-gray-100">
                <X className="w-4 h-4 mr-1" /> Limpiar <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">{filtros}</Badge>
              </Button>
            )}
          </div>
        </div>

        {/* Totales por etapa */}
        {totales && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            <div className="bg-white rounded-xl shadow border border-red-200 p-4 text-center">
              <p className="text-xs text-gray-500 font-medium flex items-center justify-center gap-1"><Calendar className="h-3 w-3" /> Mora total al {fecha}</p>
              <p className="text-lg font-bold text-red-700">{fmtQ(totales.mora_total)}</p>
            </div>
            <div className="bg-white rounded-xl shadow border border-blue-100 p-4 text-center">
              <p className="text-xs text-gray-500 font-medium">Créditos</p>
              <p className="text-lg font-bold text-blue-700">{totales.creditos}</p>
            </div>
            {[["Mora 30", totales.mora_30], ["Mora 60", totales.mora_60], ["Mora 90", totales.mora_90], ["Mora 120+", totales.mora_120]].map(([l, v]) => (
              <div key={l} className="bg-white rounded-xl shadow border border-gray-100 p-4 text-center">
                <p className="text-xs text-gray-500 font-medium">{l}</p>
                <p className="text-sm font-bold text-gray-800">{fmtQ(v)}</p>
              </div>
            ))}
          </div>
        )}

        {/* Timeline */}
        <div className="bg-white rounded-2xl shadow-lg border border-red-100 p-5 mb-6">
          <h2 className="text-sm font-bold text-red-800 mb-3 uppercase tracking-wide flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Evolución de la mora (últimos 45 días)</h2>
          {timelineQuery.isFetching ? (
            <div className="h-64 flex items-center justify-center text-red-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={timeline} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#fee2e2" />
                <XAxis dataKey="fecha" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: any) => fmtQ(v)} />
                <Line type="monotone" dataKey="mora" stroke="#dc2626" strokeWidth={2} dot={{ r: 2 }} name="Mora total" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Tabla */}
        {snapQuery.isLoading ? (
          <div className="text-center py-16 text-red-400 font-semibold">Cargando...</div>
        ) : snapQuery.isError ? (
          <div className="text-center py-16 text-red-500 font-semibold">Error al cargar la mora</div>
        ) : !rows.length ? (
          <div className="text-center py-16 text-gray-400 font-semibold">No hay mora para los filtros seleccionados</div>
        ) : (
          <>
            <div className="bg-white rounded-2xl shadow-lg border border-red-100 overflow-x-auto">
              <Table className="w-full">
                <TableHeader>
                  <TableRow className="bg-gradient-to-r from-red-50 to-red-100">
                    <TableHead className="font-bold text-red-800">No. SIFCO</TableHead>
                    <TableHead className="font-bold text-red-800">Cliente</TableHead>
                    <TableHead className="font-bold text-red-800">Asesor</TableHead>
                    <TableHead className="font-bold text-red-800 text-center">Status</TableHead>
                    <TableHead className="font-bold text-red-800 text-center">Cuotas</TableHead>
                    <TableHead className="font-bold text-red-800 text-center">Etapa</TableHead>
                    <TableHead className="font-bold text-red-800 text-right">Capital</TableHead>
                    <TableHead className="font-bold text-red-800 text-right">Mora</TableHead>
                    <TableHead className="font-bold text-red-800 text-center">Actualizado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <Fragment key={r.credito_id}>
                      <TableRow className="hover:bg-red-50/40 cursor-pointer" onClick={() => toggleRow(r.credito_id)}>
                        <TableCell className="font-semibold text-red-700">{r.numero_credito_sifco}</TableCell>
                        <TableCell className="text-black">{r.cliente}</TableCell>
                        <TableCell className="text-black text-xs">{r.asesor || "--"}</TableCell>
                        <TableCell className="text-center text-xs text-gray-600">{r.status}</TableCell>
                        <TableCell className="text-center text-black">{r.cuotas_atrasadas}</TableCell>
                        <TableCell className="text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${etapaBadge(r.etapa)}`}>{r.etapa}</span>
                        </TableCell>
                        <TableCell className="text-right text-gray-700">{fmtQ(r.capital)}</TableCell>
                        <TableCell className="text-right font-bold text-red-700">{fmtQ(r.mora)}</TableCell>
                        <TableCell className="text-center text-xs text-gray-500">{r.actualizado ? String(r.actualizado).slice(0, 10) : "--"}</TableCell>
                      </TableRow>
                      {expanded === r.credito_id && (
                        <TableRow className="bg-slate-50/60">
                          <TableCell colSpan={9} className="p-4">
                            {loadingEv ? (
                              <div className="flex items-center gap-2 text-xs text-red-500 py-3 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Cargando historial...</div>
                            ) : eventos.length === 0 ? (
                              <p className="text-xs text-gray-500 italic text-center py-2">Sin eventos de mora registrados.</p>
                            ) : (
                              <div>
                                <p className="text-xs font-bold text-red-700 mb-2">Historial de mora del crédito</p>
                                <table className="w-full text-[11px]">
                                  <thead>
                                    <tr className="text-left text-red-800 border-b border-red-100">
                                      <th className="py-1 px-2">Fecha</th><th className="py-1 px-2">Evento</th><th className="py-1 px-2">Origen</th>
                                      <th className="py-1 px-2 text-right">Antes</th><th className="py-1 px-2 text-right">Después</th>
                                      <th className="py-1 px-2 text-center">Cuotas</th><th className="py-1 px-2">Usuario</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {eventos.map((ev) => (
                                      <tr key={ev.historial_id} className="border-b border-gray-50">
                                        <td className="py-1 px-2 whitespace-nowrap">{String(ev.fecha).slice(0, 10)}</td>
                                        <td className="py-1 px-2">{ev.tipo_evento}</td>
                                        <td className="py-1 px-2 text-gray-500">{ev.origen}</td>
                                        <td className="py-1 px-2 text-right">{fmtQ(ev.monto_anterior)}</td>
                                        <td className="py-1 px-2 text-right font-semibold">{fmtQ(ev.monto_nuevo)}</td>
                                        <td className="py-1 px-2 text-center">{ev.cuotas_atrasadas_nuevas}</td>
                                        <td className="py-1 px-2 text-gray-600">{ev.usuario || "sistema"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between mt-5 gap-3">
              <span className="text-sm text-gray-600">Página {pagination?.page ?? 1} de {pagination?.totalPages ?? 1} ({pagination?.total ?? 0} créditos)</span>
              <div className="flex items-center gap-2">
                <select className="border border-red-200 rounded-lg px-3 py-2 text-sm text-red-800 bg-red-50" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                  {[20, 50, 100].map((n) => <option key={n} value={n}>{n} por página</option>)}
                </select>
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="border-red-200 text-red-700"><ChevronLeft className="w-4 h-4" /></Button>
                <Button variant="outline" size="sm" disabled={page >= (pagination?.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)} className="border-red-200 text-red-700"><ChevronRight className="w-4 h-4" /></Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default MoraHistorial;
