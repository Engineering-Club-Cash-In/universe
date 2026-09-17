import { useState, useRef, Fragment, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search, X, ChevronLeft, ChevronRight, FileDown, FileText, Loader2,
  ArrowUpDown, RotateCcw, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  descargarPagaloExcel, descargarPagaloPDF, getPagaloSupervision,
  type PagaloGrupo, type PagaloSupervisionParams,
} from "../services/pagaloSupervision.services";
import {
  alternarEstado, antiguedad, colorPuntoLink, ESTADOS_FILTRABLES, etiquetaEstadoLink,
  etiquetaFuente, etiquetaTipoLink, getEstadoGrupoInfo, normalizarNombreCliente,
  PROBLEMAS_LINK_FILTRABLES, siguienteOrden, type ColumnaOrdenable,
} from "./pagaloSupervision.helpers";

const fmtQ = (v: unknown) =>
  `Q ${Number(v ?? 0).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fechaGT = (valor: string) =>
  new Date(valor).toLocaleString("es-GT", { timeZone: "America/Guatemala" });

function EncabezadoOrdenable({
  label, columna, ordenPor, ordenDir, onOrdenar, className,
}: {
  label: string;
  columna: ColumnaOrdenable;
  ordenPor: ColumnaOrdenable;
  ordenDir: "asc" | "desc";
  onOrdenar: (columna: ColumnaOrdenable) => void;
  className?: string;
}) {
  const activo = ordenPor === columna;
  return (
    <TableHead className={`font-bold text-violet-800 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => onOrdenar(columna)}
        className="inline-flex items-center gap-1 hover:text-violet-600"
      >
        {label}
        <ArrowUpDown className={`w-3.5 h-3.5 ${activo ? "text-violet-600" : "text-violet-300"}`} />
        {activo && <span className="text-[10px]">{ordenDir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </TableHead>
  );
}

function DetalleLinks({ grupo }: { grupo: PagaloGrupo }) {
  if (!grupo.links.length) {
    return <p className="text-xs text-gray-500 italic text-center py-2">Este grupo no tiene links generados.</p>;
  }
  return (
    <div>
      <p className="text-xs font-bold text-violet-700 mb-2">Links de pago del grupo</p>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-violet-800 border-b border-violet-100">
            <th className="py-1 px-2">Tipo</th><th className="py-1 px-2">Estado</th>
            <th className="py-1 px-2 text-center">Gen.</th><th className="py-1 px-2 text-right">Monto</th>
            <th className="py-1 px-2">Creado</th><th className="py-1 px-2">Motivo de cierre</th>
            <th className="py-1 px-2">Error</th>
          </tr>
        </thead>
        <tbody>
          {grupo.links.map((link) => (
            <tr key={link.id} className="border-b border-gray-50">
              <td className="py-1 px-2 whitespace-nowrap">{etiquetaTipoLink(link.linkType)}</td>
              <td className="py-1 px-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${colorPuntoLink(link.status)}`} />
                  {etiquetaEstadoLink(link.status)}
                </span>
              </td>
              <td className="py-1 px-2 text-center">{link.generation}</td>
              <td className="py-1 px-2 text-right">
                {link.transactionAmount ? fmtQ(link.transactionAmount) : "--"}
              </td>
              <td className="py-1 px-2 whitespace-nowrap text-gray-600">{fechaGT(link.createdAt)}</td>
              <td className="py-1 px-2 text-gray-600">{link.motivoCierre ?? "--"}</td>
              <td className="py-1 px-2 text-red-600">{link.errorMessage ?? link.lastPollError ?? "--"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PagaloSupervision() {
  const [estados, setEstados] = useState<string[]>([]);
  const [problemasLink, setProblemasLink] = useState<string[]>([]);
  const [soloHuerfanos, setSoloHuerfanos] = useState(false);
  const [antiguedadMin, setAntiguedadMin] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [sifcoInput, setSifcoInput] = useState("");
  const [sifco, setSifco] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [ordenPor, setOrdenPor] = useState<ColumnaOrdenable>("createdAt");
  const [ordenDir, setOrdenDir] = useState<"asc" | "desc">("desc");
  const [exportando, setExportando] = useState<"excel" | "pdf" | null>(null);
  const [avisoExport, setAvisoExport] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);

  const filtros: Omit<PagaloSupervisionParams, "limit" | "offset"> = {
    estados: estados.length ? estados.join(",") : undefined,
    problemasLink: problemasLink.length ? problemasLink.join(",") : undefined,
    soloHuerfanos: soloHuerfanos || undefined,
    antiguedadMinDias: antiguedadMin ? Number(antiguedadMin) : undefined,
    numeroSifco: sifco || undefined,
    fechaDesde: fechaDesde || undefined,
    fechaHasta: fechaHasta || undefined,
    sortBy: ordenPor,
    sortDir: ordenDir,
    // Sin chips de estado activos se muestra todo; el predicado "problemático"
    // queda reservado para cuando el usuario ya acotó por estado.
    soloProblematicos: estados.length > 0,
  };

  const query = useQuery({
    queryKey: ["pagalo-supervision", filtros, page, pageSize],
    queryFn: () =>
      getPagaloSupervision({ ...filtros, limit: pageSize, offset: (page - 1) * pageSize }),
    refetchOnWindowFocus: false,
  });

  const grupos = query.data?.grupos ?? [];
  const total = query.data?.total ?? 0;
  const conteoPorEstado = query.data?.conteoPorEstado ?? {};
  const totalPaginas = Math.max(1, Math.ceil(total / pageSize));

  // Cambiar de filtro puede reducir el total y dejar la página actual fuera de
  // rango: el offset cae vacío y se ve como "no hay grupos" aunque sí los haya.
  useEffect(() => {
    if (page > totalPaginas) setPage(totalPaginas);
  }, [page, totalPaginas]);

  const alternarOrden = (columna: ColumnaOrdenable) => {
    const siguiente = siguienteOrden({ columna: ordenPor, direccion: ordenDir }, columna);
    setOrdenPor(siguiente.columna);
    setOrdenDir(siguiente.direccion);
    setPage(1);
  };

  const toggleEstado = (estado: string) => {
    setEstados((prev) => alternarEstado(prev, estado));
    setPage(1);
  };

  const toggleProblemaLink = (valor: string) => {
    setProblemasLink((prev) => alternarEstado(prev, valor));
    setPage(1);
  };

  const aplicar = () => { setSifco(sifcoInput.trim()); setPage(1); };

  const limpiar = () => {
    setEstados([]); setProblemasLink([]); setSoloHuerfanos(false); setAntiguedadMin("");
    setFechaDesde(""); setFechaHasta(""); setSifcoInput(""); setSifco(""); setPage(1);
  };

  const toggleRow = (grupoId: string) => {
    const siguiente = expanded === grupoId ? null : grupoId;
    setExpanded(siguiente);
    pendingRef.current = siguiente;
  };

  const exportar = async (formato: "excel" | "pdf") => {
    if (exportando) return;
    setExportando(formato);
    setAvisoExport(null);
    try {
      const descarga =
        formato === "excel" ? await descargarPagaloExcel(filtros) : await descargarPagaloPDF(filtros);
      const url = URL.createObjectURL(descarga.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `supervision-pagalo${descarga.truncado ? "-parcial" : ""}-${new Date().toISOString().slice(0, 10)}.${formato === "excel" ? "xlsx" : "pdf"}`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);

      if (descarga.truncado) {
        // Sin decir "límite alcanzado": el backend marca truncado tanto cuando
        // el filtro excede el tope como cuando la paginación pierde filas
        // porque el dataset cambió mientras se exportaba.
        setAvisoExport(
          `Reporte parcial: se exportaron ${descarga.cantidad.toLocaleString("es-GT")} de ${descarga.total.toLocaleString("es-GT")} grupos. Acotá el rango de fechas y volvé a intentar para obtenerlo completo.`
        );
      }
    } catch {
      setAvisoExport("No se pudo generar el archivo. Intentá de nuevo.");
    } finally {
      setExportando(null);
    }
  };

  const filtrosActivos =
    estados.length + problemasLink.length + (soloHuerfanos ? 1 : 0) +
    (antiguedadMin ? 1 : 0) + (fechaDesde ? 1 : 0) + (fechaHasta ? 1 : 0) + (sifco ? 1 : 0);

  return (
    <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 overflow-auto bg-gradient-to-br from-violet-50 to-white px-4 sm:px-6 lg:px-8 pt-8 pb-8">
      <div className="w-full max-w-[1500px] mx-auto">
        <div className="flex flex-col items-center mb-6">
          <h1 className="text-3xl font-extrabold text-violet-700 text-center">Supervisión Págalo</h1>
          <p className="text-gray-600 mt-2 text-center">
            Grupos de pago con links vencidos, fallidos o duplicados. Sin estados seleccionados se
            muestran todos; al elegir uno o más, solo esos. Expande un grupo para ver sus links.
          </p>
        </div>

        {/* Filtros */}
        <div className="bg-white/80 backdrop-blur rounded-2xl shadow-lg border border-violet-100 p-5 mb-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[150px]">
              <label className="text-sm font-semibold text-violet-800 mb-1 block">Desde</label>
              <Input type="date" value={fechaDesde} max={fechaHasta || undefined}
                onChange={(e) => { setFechaDesde(e.target.value); setPage(1); }}
                className="text-gray-900 border-violet-200 bg-violet-50 [color-scheme:light]" />
            </div>
            <div className="min-w-[150px]">
              <label className="text-sm font-semibold text-violet-800 mb-1 block">Hasta</label>
              <Input type="date" value={fechaHasta} min={fechaDesde || undefined}
                onChange={(e) => { setFechaHasta(e.target.value); setPage(1); }}
                className="text-gray-900 border-violet-200 bg-violet-50 [color-scheme:light]" />
            </div>
            <div className="flex-1 min-w-[150px]">
              <label className="text-sm font-semibold text-violet-800 mb-1 block">No. SIFCO</label>
              <Input placeholder="Buscar SIFCO..." value={sifcoInput}
                onChange={(e) => setSifcoInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && aplicar()}
                className="text-gray-900 border-violet-200 bg-violet-50" />
            </div>
            <div className="min-w-[150px]">
              <label className="text-sm font-semibold text-violet-800 mb-1 block">Antigüedad mínima</label>
              <Input type="number" min={1} placeholder="Días" value={antiguedadMin}
                onChange={(e) => { setAntiguedadMin(e.target.value); setPage(1); }}
                className="text-gray-900 border-violet-200 bg-violet-50" />
            </div>

            <Button variant="outline" size="sm" onClick={aplicar}
              className="text-violet-700 border-violet-300 hover:bg-violet-50">
              <Search className="w-4 h-4 mr-1" /> Buscar
            </Button>
            <Button variant="default" size="sm" onClick={() => exportar("excel")}
              disabled={!!exportando || total === 0}
              className="bg-green-600 hover:bg-green-700 text-white border-none">
              {exportando === "excel" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileDown className="w-4 h-4 mr-1" />}
              {exportando === "excel" ? "Generando..." : "Excel"}
            </Button>
            <Button variant="default" size="sm" onClick={() => exportar("pdf")}
              disabled={!!exportando || total === 0}
              className="bg-violet-600 hover:bg-violet-700 text-white border-none">
              {exportando === "pdf" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileText className="w-4 h-4 mr-1" />}
              {exportando === "pdf" ? "Generando..." : "PDF"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => query.refetch()}
              disabled={query.isFetching} className="text-violet-700 border-violet-300 hover:bg-violet-50">
              <RotateCcw className={`w-4 h-4 mr-1 ${query.isFetching ? "animate-spin" : ""}`} /> Actualizar
            </Button>
            {filtrosActivos > 0 && (
              <Button variant="outline" size="sm" onClick={limpiar}
                className="text-gray-600 border-gray-300 hover:bg-gray-100">
                <X className="w-4 h-4 mr-1" /> Limpiar
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">{filtrosActivos}</Badge>
              </Button>
            )}
          </div>

          {/* Chips de estado */}
          <div className="flex flex-wrap items-center gap-2 mt-4">
            {ESTADOS_FILTRABLES.map((estado) => {
              const activo = estados.includes(estado);
              const info = getEstadoGrupoInfo(estado);
              return (
                <button key={estado} type="button" onClick={() => toggleEstado(estado)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    activo ? `${info.className} ring-2 ring-violet-500` : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}>
                  {info.label} ({conteoPorEstado[estado] ?? 0})
                </button>
              );
            })}
          </div>

          {/* Filtros de link */}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className="text-xs font-semibold text-violet-800">Problemas de link:</span>
            {PROBLEMAS_LINK_FILTRABLES.map(({ valor, label }) => {
              const activo = problemasLink.includes(valor);
              return (
                <button key={valor} type="button" onClick={() => toggleProblemaLink(valor)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    activo ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}>
                  {label}
                </button>
              );
            })}
            <label className="flex items-center gap-1.5 text-xs font-semibold text-violet-800 ml-2 cursor-pointer">
              <input type="checkbox" checked={soloHuerfanos}
                onChange={(e) => { setSoloHuerfanos(e.target.checked); setPage(1); }}
                className="accent-violet-600" />
              Solo huérfanos
            </label>
          </div>

          {avisoExport && (
            <div className="flex items-start gap-2 mt-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{avisoExport}</span>
            </div>
          )}
        </div>

        {/* Tabla */}
        {query.isLoading ? (
          <div className="text-center py-16 text-violet-400 font-semibold">Cargando...</div>
        ) : query.isError ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <p className="text-red-500 font-semibold">No se pudo cargar la supervisión Págalo</p>
            <Button variant="outline" size="sm" onClick={() => query.refetch()}
              className="text-violet-700 border-violet-300">Reintentar</Button>
          </div>
        ) : !grupos.length ? (
          <div className="text-center py-16 text-gray-400 font-semibold">
            No hay grupos Págalo para los filtros seleccionados
          </div>
        ) : (
          <>
            <div className="bg-white rounded-2xl shadow-lg border border-violet-100 overflow-x-auto">
              <Table className="w-full">
                <TableHeader>
                  <TableRow className="bg-gradient-to-r from-violet-50 to-violet-100">
                    <TableHead className="font-bold text-violet-800">No. SIFCO / Cliente</TableHead>
                    <TableHead className="font-bold text-violet-800">Asesor</TableHead>
                    <TableHead className="font-bold text-violet-800 text-center">Estado</TableHead>
                    <EncabezadoOrdenable label="Total" columna="totalAmount" ordenPor={ordenPor}
                      ordenDir={ordenDir} onOrdenar={alternarOrden} className="text-right" />
                    <TableHead className="font-bold text-violet-800 text-center">Origen</TableHead>
                    <TableHead className="font-bold text-violet-800 text-center">Links</TableHead>
                    <EncabezadoOrdenable label="Antigüedad" columna="createdAt" ordenPor={ordenPor}
                      ordenDir={ordenDir} onOrdenar={alternarOrden} className="text-center" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grupos.map((grupo) => {
                    const estadoInfo = getEstadoGrupoInfo(grupo.status);
                    const edad = antiguedad(grupo.createdAt);
                    return (
                      <Fragment key={grupo.id}>
                        <TableRow className="hover:bg-violet-50/40 cursor-pointer" onClick={() => toggleRow(grupo.id)}>
                          <TableCell>
                            <div className="font-semibold text-violet-700">{grupo.numeroCreditoSifco}</div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              {normalizarNombreCliente(grupo.clienteNombre) ?? "--"}
                            </div>
                          </TableCell>
                          <TableCell className="text-black text-xs">
                            {grupo.asesoresNombres.join(", ") || "--"}
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${estadoInfo.className}`}>
                              {estadoInfo.label}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-bold text-violet-700">
                            {fmtQ(grupo.totalAmount)}
                          </TableCell>
                          <TableCell className="text-center text-xs text-gray-600">
                            {etiquetaFuente(grupo.origen)}
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="inline-flex items-center gap-1">
                              {grupo.links.length === 0 ? (
                                <span className="text-xs text-gray-400">--</span>
                              ) : (
                                grupo.links.map((link) => (
                                  <span key={link.id} title={`${etiquetaTipoLink(link.linkType)} · ${etiquetaEstadoLink(link.status)}`}
                                    className={`w-2.5 h-2.5 rounded-full ${colorPuntoLink(link.status)}`} />
                                ))
                              )}
                            </span>
                          </TableCell>
                          <TableCell className={`text-center text-xs ${edad.alerta ? "text-red-600 font-semibold" : "text-gray-500"}`}>
                            {edad.etiqueta}
                          </TableCell>
                        </TableRow>
                        {expanded === grupo.id && (
                          <TableRow className="bg-slate-50/60">
                            <TableCell colSpan={7} className="p-4">
                              <DetalleLinks grupo={grupo} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between mt-5 gap-3">
              <span className="text-sm text-gray-600">
                Página {page} de {totalPaginas} ({total} grupos)
              </span>
              <div className="flex items-center gap-2">
                <select className="border border-violet-200 rounded-lg px-3 py-2 text-sm text-violet-800 bg-violet-50"
                  value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                  {[25, 50, 100].map((n) => <option key={n} value={n}>{n} por página</option>)}
                </select>
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                  className="border-violet-200 text-violet-700"><ChevronLeft className="w-4 h-4" /></Button>
                <Button variant="outline" size="sm" disabled={page >= totalPaginas} onClick={() => setPage((p) => p + 1)}
                  className="border-violet-200 text-violet-700"><ChevronRight className="w-4 h-4" /></Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default PagaloSupervision;
