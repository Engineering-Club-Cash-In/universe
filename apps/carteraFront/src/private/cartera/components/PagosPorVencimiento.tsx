import { useState, useRef, Fragment } from "react";
import { usePersistedState } from "../hooks/usePersistedState";
import { usePagosPorVencimiento } from "../hooks/usePagosPorVencimiento";
import { useAdminData } from "../hooks/advisor";
import type { PagoPorVencimientoItem, Advisor, AbonoDetalleItem, AcumuladoCuotaItem, AcumuladoTotales } from "../services/services";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, X, ChevronLeft, ChevronRight, Check, ChevronsUpDown, FileDown, Loader2, AlertCircle } from "lucide-react";
import { getPagosPorVencimiento, getAbonosPorVencimientoDetalle, getCreditoAcumulado } from "../services/services";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function formatQ(val: string | null | undefined): string {
  if (!val) return "Q 0.00";
  const n = Number(val);
  if (isNaN(n)) return "Q 0.00";
  return `Q ${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}


const currentDate = new Date();

export function PagosPorVencimiento() {
  const [mes, setMes] = usePersistedState<number>("cartera/pagosPorVencimiento/mes", currentDate.getMonth() + 1);
  const [anio, setAnio] = usePersistedState<number>("cartera/pagosPorVencimiento/anio", currentDate.getFullYear());
  const [page, setPage] = usePersistedState<number>("cartera/pagosPorVencimiento/page", 1);
  const [pageSize, setPageSize] = usePersistedState<number>("cartera/pagosPorVencimiento/pageSize", 20);
  const [tipoFecha, setTipoFecha] = usePersistedState<"vencimiento" | "creacion">("cartera/pagosPorVencimiento/tipoFecha", "vencimiento");
  const [sifcoInput, setSifcoInput] = usePersistedState<string>("cartera/pagosPorVencimiento/sifcoInput", "");
  const [sifcoFilter, setSifcoFilter] = usePersistedState<string>("cartera/pagosPorVencimiento/sifcoFilter", "");
  const [nombreInput, setNombreInput] = usePersistedState<string>("cartera/pagosPorVencimiento/nombreInput", "");
  const [nombreFilter, setNombreFilter] = usePersistedState<string>("cartera/pagosPorVencimiento/nombreFilter", "");
  const [selectedAdvisors, setSelectedAdvisors] = usePersistedState<string[]>("cartera/pagosPorVencimiento/selectedAdvisors", []);
  const [rangoMoraInput, setRangoMoraInput] = usePersistedState<string>("cartera/pagosPorVencimiento/rangoMoraInput", "");
  const [rangoMoraFilter, setRangoMoraFilter] = usePersistedState<string>("cartera/pagosPorVencimiento/rangoMoraFilter", "");
  const [advisorPopoverOpen, setAdvisorPopoverOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [abonosDetail, setAbonosDetail] = useState<AbonoDetalleItem[]>([]);
  const [acumuladoDetail, setAcumuladoDetail] = useState<AcumuladoCuotaItem[]>([]);
  const [acumuladoTotales, setAcumuladoTotales] = useState<AcumuladoTotales | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const pendingRequestRef = useRef<{ creditoId: number; mes: number; anio: number } | null>(null);

  const handleToggleRow = async (creditoId: number) => {
    if (expandedRow === creditoId) {
      setExpandedRow(null);
      setAbonosDetail([]);
      setAcumuladoDetail([]);
      setAcumuladoTotales(null);
      pendingRequestRef.current = null;
    } else {
      const token = { creditoId, mes, anio };
      setExpandedRow(creditoId);
      pendingRequestRef.current = token;
      setLoadingDetails(true);
      setAbonosDetail([]);
      setAcumuladoDetail([]);
      setAcumuladoTotales(null);
      try {
        const [acumuladoRes, abonosRes] = await Promise.all([
          getCreditoAcumulado({ credito_id: creditoId }),
          getAbonosPorVencimientoDetalle({ credito_id: creditoId, mes, anio }),
        ]);
        const current = pendingRequestRef.current;
        if (current?.creditoId === creditoId && current?.mes === mes && current?.anio === anio) {
          if (acumuladoRes.success) {
            setAcumuladoDetail(acumuladoRes.cuotas);
            setAcumuladoTotales(acumuladoRes.totales);
          }
          if (abonosRes.success) {
            setAbonosDetail(abonosRes.data);
          }
        }
      } catch (error) {
        console.error("Error al obtener detalle de crédito:", error);
      } finally {
        const current = pendingRequestRef.current;
        if (current?.creditoId === creditoId && current?.mes === mes && current?.anio === anio) {
          setLoadingDetails(false);
        }
      }
    }
  };

  const hasActiveFilters =
    sifcoFilter !== "" ||
    nombreFilter !== "" ||
    selectedAdvisors.length > 0 ||
    rangoMoraFilter !== "" ||
    tipoFecha !== "vencimiento";
  const { advisors } = useAdminData();

  const { data, isLoading, isError } = usePagosPorVencimiento({
    mes,
    anio,
    page,
    pageSize,
    numero_credito_sifco: sifcoFilter || undefined,
    nombre_usuario: nombreFilter || undefined,
    tipo_fecha: tipoFecha,
    asesor: selectedAdvisors.join(",") || undefined,
    rango_mora: rangoMoraFilter || undefined,
  });

  const handleSearch = () => {
    setSifcoFilter(sifcoInput.trim());
    setNombreFilter(nombreInput.trim());
    setRangoMoraFilter(rangoMoraInput);
    setPage(1);
  };

  const handleDownloadExcel = async () => {
    try {
      setIsExporting(true);
      const response = await getPagosPorVencimiento({
        mes,
        anio,
        numero_credito_sifco: sifcoFilter,
        nombre_usuario: nombreFilter,
        tipo_fecha: tipoFecha,
        asesor: selectedAdvisors.join(","),
        rango_mora: rangoMoraFilter,
        excel: true,
      });

      if (response.success && response.excelUrl) {
        window.open(response.excelUrl, "_blank");
      } else {
        setErrorMessage("No se pudo generar el archivo Excel. Por favor, intenta de nuevo o contacta a soporte.");
        setShowErrorModal(true);
      }
    } catch (error) {
      console.error("Error al descargar Excel:", error);
      setErrorMessage("Ocurrió un error inesperado al generar el archivo. Verifica tu conexión e intenta de nuevo.");
      setShowErrorModal(true);
    } finally {
      setIsExporting(false);
    }
  };

  const clearFilters = () => {
    setSifcoInput("");
    setSifcoFilter("");
    setNombreInput("");
    setNombreFilter("");
    setSelectedAdvisors([]);
    setRangoMoraInput("");
    setRangoMoraFilter("");
    setTipoFecha("vencimiento");
    setPage(1);
  };

  const items: PagoPorVencimientoItem[] = data?.data ?? [];
  const pagination = data?.pagination;
  const totales = data?.totales;
  const totalesAcumulado = data?.totalesAcumulado;

  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];

  return (
    <>
      <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-4 sm:px-6 lg:px-8 overflow-auto pt-8 pb-8">
    <div className="w-full max-w-[1400px]">
      <div className="flex flex-col items-center mb-6">
        <h1 className="text-3xl font-extrabold text-blue-700 text-center">
          {tipoFecha === "vencimiento" ? "Pagos por Vencimiento" : "Pagos por Creación de Crédito"}
        </h1>
        <p className="text-lg text-gray-600 leading-relaxed text-center mt-2">
          Detalle de pagos y cuotas por mes de vencimiento.
        </p>
      </div>

      {/* Filtros */}
      <div className="bg-white/80 backdrop-blur rounded-2xl shadow-lg border border-blue-100 p-5 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[170px]">
            <label className="text-sm font-semibold text-blue-800 mb-1 block">Filtrar por</label>
            <select
              className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800 bg-blue-50 focus:ring-blue-400"
              value={tipoFecha}
              onChange={(e) => { setTipoFecha(e.target.value as "vencimiento" | "creacion"); setPage(1); }}
            >
              <option value="vencimiento">Fecha Vencimiento</option>
              <option value="creacion">Fecha Creación</option>
            </select>
          </div>

          <div className="min-w-[140px]">
            <label className="text-sm font-semibold text-blue-800 mb-1 block">Mes</label>
            <select
              className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800 bg-blue-50 focus:ring-blue-400"
              value={mes}
              onChange={(e) => { setMes(Number(e.target.value)); setPage(1); }}
            >
              {meses.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>

          <div className="min-w-[100px]">
            <label className="text-sm font-semibold text-blue-800 mb-1 block">Año</label>
            <Input
              type="number"
              min={2020}
              value={anio}
              onChange={(e) => { setAnio(Number(e.target.value)); setPage(1); }}
              className="text-gray-900 border-blue-200 bg-blue-50 focus:ring-blue-400"
            />
          </div>

          <div className="flex-1 min-w-[180px]">
            <label className="text-sm font-semibold text-blue-800 mb-1 block">No. Crédito SIFCO</label>
            <Input
              placeholder="Buscar por SIFCO..."
              value={sifcoInput}
              onChange={(e) => setSifcoInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="text-gray-900 border-blue-200 bg-blue-50 focus:ring-blue-400"
            />
          </div>

          <div className="flex-1 min-w-[180px]">
            <label className="text-sm font-semibold text-blue-800 mb-1 block">Nombre Usuario</label>
            <Input
              placeholder="Buscar por nombre..."
              value={nombreInput}
              onChange={(e) => setNombreInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="text-gray-900 border-blue-200 bg-blue-50 focus:ring-blue-400"
            />
          </div>

          <div className="flex-1 min-w-[250px]">
            <label className="text-sm font-semibold text-blue-800 mb-1 block">Asesores</label>
            <Popover open={advisorPopoverOpen} onOpenChange={setAdvisorPopoverOpen}>
              <PopoverTrigger asChild>
                <div
                  role="button"
                  tabIndex={0}
                  className="w-full flex items-center justify-between border border-blue-200 rounded-lg px-3 py-2 bg-blue-50 text-blue-800 focus:ring-2 focus:ring-blue-400 text-sm h-10 overflow-hidden cursor-pointer"
                >
                  <span className="flex flex-wrap gap-1 flex-1 items-center overflow-hidden">
                    {selectedAdvisors.length === 0 ? (
                      <span className="text-gray-400">Todos los asesores</span>
                    ) : selectedAdvisors.length > 2 ? (
                      <Badge variant="secondary" className="text-xs font-semibold bg-blue-100 text-blue-700 border-blue-200">
                        {selectedAdvisors.length} asesores seleccionados
                      </Badge>
                    ) : (
                      selectedAdvisors.map((name) => (
                        <Badge key={name} variant="secondary" className="text-[10px] sm:text-xs flex items-center gap-1 max-w-[120px] truncate bg-blue-100 text-blue-700 border-blue-200">
                          <span className="truncate">{name}</span>
                          <span
                            role="button"
                            tabIndex={0}
                            className="cursor-pointer hover:text-red-500 transition-colors"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setSelectedAdvisors(selectedAdvisors.filter((v) => v !== name));
                              setPage(1);
                            }}
                          >
                            <X className="w-3 h-3" />
                          </span>
                        </Badge>
                      ))
                    )}
                  </span>
                  <ChevronsUpDown className="w-4 h-4 shrink-0 opacity-50 ml-2" />
                </div>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0 bg-white border border-blue-200 shadow-lg" align="start">
                <Command className="bg-white text-gray-900">
                  <CommandInput placeholder="Buscar asesor..." />
                  <CommandList className="max-h-[250px]">
                    <CommandEmpty>No se encontró asesor.</CommandEmpty>
                    <CommandGroup>
                      {advisors?.map((adv: Advisor) => {
                        const isSelected = selectedAdvisors.includes(adv.nombre);
                        return (
                          <CommandItem
                            key={adv.asesor_id}
                            value={adv.nombre}
                            onSelect={() => {
                              if (isSelected) {
                                setSelectedAdvisors(selectedAdvisors.filter((v) => v !== adv.nombre));
                              } else {
                                setSelectedAdvisors([...selectedAdvisors, adv.nombre]);
                              }
                              setPage(1);
                            }}
                            className="text-gray-800 hover:bg-blue-50 cursor-pointer"
                          >
                            <Check className={`w-4 h-4 mr-2 ${isSelected ? "opacity-100 text-blue-600" : "opacity-0"}`} />
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
            <label className="text-sm font-semibold text-blue-800 mb-1 block">Etapa de Mora</label>
            <select
              className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800 bg-blue-50 focus:ring-blue-400"
              value={rangoMoraInput}
              onChange={(e) => { 
                setRangoMoraInput(e.target.value); 
                setRangoMoraFilter(e.target.value);
                setPage(1); 
              }}
            >
              <option value="">Todos</option>
              <option value="0-30">Mora 30</option>
              <option value="31-60">Mora 60</option>
              <option value="61-90">Mora 90</option>
              <option value="+90">Mora 120+</option>
            </select>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleSearch}
            className="text-blue-700 border-blue-300 hover:bg-blue-50"
          >
            <Search className="w-4 h-4 mr-1" /> Buscar
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={handleDownloadExcel}
            disabled={isExporting}
            className="bg-green-600 hover:bg-green-700 text-white border-none"
          >
            {isExporting ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <FileDown className="w-4 h-4 mr-1" />
            )}
            {isExporting ? "Generando..." : "Exportar Excel"}
          </Button>

          {hasActiveFilters && (
            <Button
              variant="outline"
              size="sm"
              onClick={clearFilters}
              className="text-gray-600 border-gray-300 hover:bg-gray-100"
            >
              <X className="w-4 h-4 mr-1" /> Limpiar filtros
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
                {[sifcoFilter !== "", nombreFilter !== "", selectedAdvisors.length > 0, rangoMoraFilter !== "", tipoFecha !== "vencimiento"].filter(Boolean).length}
              </Badge>
            </Button>
          )}
        </div>
      </div>

      {/* Totales globales */}
      {totales && (
        <div className="bg-white/80 backdrop-blur rounded-2xl shadow-lg border border-blue-100 p-5 mb-6">
          <h2 className="text-sm font-bold text-blue-800 mb-3 uppercase tracking-wide">
            Totales del mes — {meses[mes - 1]} {anio}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-3">
              {[
                { label: "Abono Capital", value: totales.capital_restante },
                { label: "Interés", value: totales.interes_restante },
              { label: "IVA 12%", value: totales.iva_12_restante },
              { label: "Seguro", value: totales.seguro_restante },
              { label: "GPS", value: totales.gps_restante },
              { label: "Membresías", value: totales.membresias },
              { label: "Interés CUBE", value: totales.interes_cube },
              { label: "IVA CUBE", value: totales.iva_cube },
              { label: "Mora", value: totales.mora },
            ].map((t) => (
              <div key={t.label} className="text-center">
                <p className="text-xs text-gray-500 font-medium">{t.label}</p>
                <p className="text-sm font-bold text-blue-700">{formatQ(t.value)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Totales acumulados (morosos => deuda acumulada, al día => esperado) */}
      {totalesAcumulado && (
        <div className="bg-white/80 backdrop-blur rounded-2xl shadow-lg border border-red-100 p-5 mb-6">
          <h2 className="text-sm font-bold text-red-800 mb-1 uppercase tracking-wide">
            Totales acumulados — {meses[mes - 1]} {anio}
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            Para créditos en mora se suma su deuda acumulada; los créditos al día suman lo esperado del mes.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-3">
              {[
                { label: "Abono Capital", value: totalesAcumulado.capital_restante },
                { label: "Interés", value: totalesAcumulado.interes_restante },
              { label: "IVA 12%", value: totalesAcumulado.iva_12_restante },
              { label: "Seguro", value: totalesAcumulado.seguro_restante },
              { label: "GPS", value: totalesAcumulado.gps_restante },
              { label: "Membresías", value: totalesAcumulado.membresias },
              { label: "Interés CUBE", value: totalesAcumulado.interes_cube },
              { label: "IVA CUBE", value: totalesAcumulado.iva_cube },
              { label: "Mora", value: totalesAcumulado.mora },
            ].map((t) => (
              <div key={t.label} className="text-center">
                <p className="text-xs text-gray-500 font-medium">{t.label}</p>
                <p className="text-sm font-bold text-red-700">{formatQ(t.value)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Contenido */}
      {isLoading ? (
        <div className="text-center py-16 text-blue-400 font-semibold text-lg">Cargando...</div>
      ) : isError ? (
        <div className="text-center py-16 text-red-500 font-semibold">
          Error al cargar pagos por vencimiento
        </div>
      ) : !items.length ? (
        <div className="text-center py-16 text-gray-400 font-semibold text-lg">
          No hay pagos para este periodo
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl shadow-lg border border-blue-100 overflow-x-auto">
            <Table className="w-full border-collapse">
              <TableHeader>
                <TableRow className="bg-gradient-to-r from-blue-50 to-blue-100">
                  <TableHead className="sticky left-0 bg-[#f8fafc] z-20 font-bold text-blue-800 border-r border-b border-blue-200 min-w-[140px] w-[140px]">No. SIFCO</TableHead>
                  <TableHead className="sticky left-[140px] bg-[#f8fafc] z-20 font-bold text-blue-800 border-r border-b border-blue-300 min-w-[220px] w-[220px] shadow-[3px_0_5px_-2px_rgba(0,0,0,0.05)]">Cliente</TableHead>
                  <TableHead className="font-bold text-blue-800 border-r border-b border-blue-200">Asesor</TableHead>
                  <TableHead className="font-bold text-blue-800 text-center border-r border-b border-blue-200">Cuotas</TableHead>
                  <TableHead className="font-bold text-blue-800 text-center border-r border-b border-blue-200">Etapa de Mora</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right border-r border-b border-blue-200">Boletas Totales</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right border-r border-b border-blue-200">Abono Capital</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right border-r border-b border-blue-200">Interés</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right border-r border-b border-blue-200">IVA 12%</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right border-r border-b border-blue-200">Seguro</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right border-r border-b border-blue-200">GPS</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right border-r border-b border-blue-200">Membresías</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right border-r border-b border-blue-200">Int. CUBE</TableHead>
                   <TableHead className="font-bold text-blue-800 text-right border-r border-b border-blue-200">IVA CUBE</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right border-r border-b border-blue-200">Royalty</TableHead>
                  <TableHead className="font-bold text-red-800 text-right border-r border-b border-blue-200">Mora</TableHead>
                  <TableHead className="font-bold text-green-800 text-right border-b border-blue-200">Total Pagos Mes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <Fragment key={item.credito_id}>
                    <TableRow 
                      className={`hover:bg-[#f3f8ff] transition-colors group cursor-pointer ${
                        expandedRow === item.credito_id ? "bg-blue-50/40 hover:bg-[#f3f8ff]" : ""
                      }`}
                      onClick={() => handleToggleRow(item.credito_id)}
                    >
                      <TableCell className="sticky left-0 bg-white group-hover:bg-[#f3f8ff] transition-colors z-10 font-semibold text-blue-700 border-r border-b border-blue-200 min-w-[140px] w-[140px]">
                        {item.numero_credito_sifco}
                      </TableCell>
                      <TableCell className="sticky left-[140px] bg-white group-hover:bg-[#f3f8ff] transition-colors z-10 text-black border-r border-b border-blue-300 min-w-[220px] w-[220px] shadow-[3px_0_5px_-2px_rgba(0,0,0,0.05)]">
                        {item.nombre_usuario}
                      </TableCell>
                      <TableCell className="text-black text-xs border-r border-b border-blue-100">{item.asesor || "--"}</TableCell>
                      <TableCell className="text-black text-center border-r border-b border-blue-100">
                        {item.cuota_min === item.cuota_max 
                          ? item.cuota_min 
                          : `${item.cuota_min} - ${item.cuota_max}`}
                      </TableCell>
                      <TableCell className="text-center border-r border-b border-blue-100">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          item.dias_mora === 'Al día' 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {item.dias_mora}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium text-black border-r border-b border-blue-100">{formatQ(item.monto_aplicado)}</TableCell>
                      <TableCell className="text-right text-black border-r border-b border-blue-100">{formatQ(item.capital_restante)}</TableCell>
                      <TableCell className="text-right text-black border-r border-b border-blue-100">{formatQ(item.interes_restante)}</TableCell>
                      <TableCell className="text-right text-black border-r border-b border-blue-100">{formatQ(item.iva_12_restante)}</TableCell>
                      <TableCell className="text-right text-black border-r border-b border-blue-100">{formatQ(item.seguro_restante)}</TableCell>
                      <TableCell className="text-right text-black border-r border-b border-blue-100">{formatQ(item.gps_restante)}</TableCell>
                      <TableCell className="text-right text-black border-r border-b border-blue-100">{formatQ(item.membresias)}</TableCell>
                      <TableCell className="text-right text-black border-r border-b border-blue-100">{formatQ(item.interes_cube)}</TableCell>
                      <TableCell className="text-right text-black border-r border-b border-blue-100">{formatQ(item.iva_cube)}</TableCell>
                      <TableCell className="text-right text-black border-r border-b border-blue-100">
                        {item.cuota_min === 0 ? formatQ(item.royalti) : "--"}
                      </TableCell>
                      <TableCell className="text-right text-red-700 font-semibold bg-red-50/30 border-r border-b border-blue-100">
                        {formatQ(item.mora)}
                      </TableCell>
                      <TableCell className="text-right text-green-700 font-bold bg-green-50/30 border-b border-blue-100">
                        {formatQ(item.total_pagos_del_mes)}
                      </TableCell>
                    </TableRow>

                    {/* Fila colapsable de detalle de abonos */}
                    {expandedRow === item.credito_id && loadingDetails && (
                      <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                        <TableCell colSpan={17} className="p-4 border-b border-blue-200">
                          <div className="flex items-center justify-center py-6 text-xs text-blue-500 font-semibold gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Cargando detalle...
                          </div>
                        </TableCell>
                      </TableRow>
                    )}

                    {/* Sección deuda acumulada */}
                    {expandedRow === item.credito_id && !loadingDetails && acumuladoDetail.length > 0 && (
                      <>
                        {/* Header acumulado */}
                        <TableRow className="bg-red-50/80 hover:bg-red-50/80">
                          <TableCell
                            colSpan={17}
                            className="py-1.5 px-4 border-b border-red-200 text-xs font-bold text-red-700"
                          >
                            ⚠ Deuda Acumulada — {acumuladoDetail.length} cuota{acumuladoDetail.length !== 1 ? "s" : ""} vencida{acumuladoDetail.length !== 1 ? "s" : ""}
                          </TableCell>
                        </TableRow>

                        {/* Fila por cuota vencida */}
                        {acumuladoDetail.map((cuota) => (
                          <TableRow
                            key={`acum-${cuota.numero_cuota}`}
                            className="bg-red-50 hover:bg-red-100 border-b border-red-100 text-[11px] text-gray-700 transition-colors group"
                          >
                            {/* 1. SIFCO */}
                            <TableCell className="sticky left-0 bg-red-50 group-hover:bg-red-100 border-r border-b border-red-100 min-w-[140px] w-[140px] text-center font-semibold text-red-700">
                              #{cuota.numero_cuota}
                            </TableCell>
                            {/* 2. Cliente -> fecha vencimiento */}
                            <TableCell className="sticky left-[140px] bg-red-50 group-hover:bg-red-100 border-r border-b border-red-200 min-w-[220px] w-[220px] shadow-[3px_0_5px_-2px_rgba(0,0,0,0.05)] text-red-700 font-medium px-3">
                              Vencía {cuota.fecha_vencimiento}
                            </TableCell>
                            {/* 3. Asesor -> vacío */}
                            <TableCell className="border-r border-b border-red-100" />
                            {/* 4. Cuotas -> vacío */}
                            <TableCell className="border-r border-b border-red-100" />
                            {/* 5. Etapa de Mora -> vacío */}
                            <TableCell className="border-r border-b border-red-100" />
                            {/* 6. Boletas Totales -> total_restante */}
                            <TableCell className="text-right font-semibold text-red-800 border-r border-b border-red-100 bg-red-50/20">
                              {formatQ(cuota.total_restante)}
                            </TableCell>
                            {/* 7. Abono Capital */}
                            <TableCell className="text-right text-gray-700 border-r border-b border-red-100">
                              {formatQ(cuota.capital_restante)}
                            </TableCell>
                            {/* 8. Interés */}
                            <TableCell className="text-right text-gray-700 border-r border-b border-red-100">
                              {formatQ(cuota.interes_restante)}
                            </TableCell>
                            {/* 9. IVA 12% */}
                            <TableCell className="text-right text-gray-700 border-r border-b border-red-100">
                              {formatQ(cuota.iva_12_restante)}
                            </TableCell>
                            {/* 10. Seguro */}
                            <TableCell className="text-right text-gray-700 border-r border-b border-red-100">
                              {formatQ(cuota.seguro_restante)}
                            </TableCell>
                            {/* 11. GPS */}
                            <TableCell className="text-right text-gray-700 border-r border-b border-red-100">
                              {formatQ(cuota.gps_restante)}
                            </TableCell>
                            {/* 12. Membresías */}
                            <TableCell className="text-right text-gray-700 border-r border-b border-red-100">
                              {formatQ(cuota.membresias)}
                            </TableCell>
                            {/* 13. Int. CUBE */}
                            <TableCell className="text-right text-gray-700 border-r border-b border-red-100">
                              {formatQ(cuota.interes_cube)}
                            </TableCell>
                            {/* 14. IVA CUBE */}
                            <TableCell className="text-right text-gray-700 border-r border-b border-red-100">
                              {formatQ(cuota.iva_cube)}
                            </TableCell>
                            {/* 15. Royalty */}
                            <TableCell className="text-right text-gray-400 border-r border-b border-red-100">--</TableCell>
                            {/* 16. Mora -> vacío */}
                            <TableCell className="border-r border-b border-red-100" />
                            {/* 17. Total */}
                            <TableCell className="text-right text-red-700 font-bold bg-red-50/20 border-b border-red-100">
                              {formatQ(cuota.total_restante)}
                            </TableCell>
                          </TableRow>
                        ))}

                        {/* Fila totales acumulado */}
                        {acumuladoTotales && (
                          <TableRow className="bg-red-100 hover:bg-red-100">
                            {/* 1. SIFCO */}
                            <TableCell className="sticky left-0 bg-red-100 border-r border-b border-red-300 min-w-[140px] w-[140px] text-center font-bold text-red-800 text-[11px]">
                              TOTAL
                            </TableCell>
                            {/* 2. Cliente */}
                            <TableCell className="sticky left-[140px] bg-red-100 border-r border-b border-red-300 min-w-[220px] w-[220px] shadow-[3px_0_5px_-2px_rgba(0,0,0,0.05)] font-bold text-red-800 text-[11px] px-3">
                              Deuda acumulada total
                            </TableCell>
                            {/* 3-5 vacíos */}
                            <TableCell className="border-r border-b border-red-300" />
                            <TableCell className="border-r border-b border-red-300" />
                            <TableCell className="border-r border-b border-red-300" />
                            {/* 6. Boletas Totales -> total */}
                            <TableCell className="text-right font-bold text-red-800 border-r border-b border-red-300 bg-red-100/30 text-[11px]">
                              {formatQ(String(acumuladoTotales.total.toFixed(2)))}
                            </TableCell>
                            {/* 7. Capital */}
                            <TableCell className="text-right font-bold text-red-800 border-r border-b border-red-300 text-[11px]">
                              {formatQ(String(acumuladoTotales.capital.toFixed(2)))}
                            </TableCell>
                            {/* 8. Interés */}
                            <TableCell className="text-right font-bold text-red-800 border-r border-b border-red-300 text-[11px]">
                              {formatQ(String(acumuladoTotales.interes.toFixed(2)))}
                            </TableCell>
                            {/* 9. IVA */}
                            <TableCell className="text-right font-bold text-red-800 border-r border-b border-red-300 text-[11px]">
                              {formatQ(String(acumuladoTotales.iva.toFixed(2)))}
                            </TableCell>
                            {/* 10. Seguro */}
                            <TableCell className="text-right font-bold text-red-800 border-r border-b border-red-300 text-[11px]">
                              {formatQ(String(acumuladoTotales.seguro.toFixed(2)))}
                            </TableCell>
                            {/* 11. GPS */}
                            <TableCell className="text-right font-bold text-red-800 border-r border-b border-red-300 text-[11px]">
                              {formatQ(String(acumuladoTotales.gps.toFixed(2)))}
                            </TableCell>
                            {/* 12. Membresías */}
                            <TableCell className="text-right font-bold text-red-800 border-r border-b border-red-300 text-[11px]">
                              {formatQ(String(acumuladoTotales.membresias.toFixed(2)))}
                            </TableCell>
                            {/* 13. Int. CUBE */}
                            <TableCell className="text-right font-bold text-red-800 border-r border-b border-red-300 text-[11px]">
                              {formatQ(String(acumuladoTotales.interes_cube.toFixed(2)))}
                            </TableCell>
                            {/* 14. IVA CUBE */}
                            <TableCell className="text-right font-bold text-red-800 border-r border-b border-red-300 text-[11px]">
                              {formatQ(String(acumuladoTotales.iva_cube.toFixed(2)))}
                            </TableCell>
                            {/* 15. Royalty */}
                            <TableCell className="text-right text-gray-400 border-r border-b border-red-300 text-[11px]">--</TableCell>
                            {/* 16. Mora */}
                            <TableCell className="border-r border-b border-red-300" />
                            {/* 17. Total */}
                            <TableCell className="text-right font-bold text-red-800 bg-red-100/30 border-b border-red-300 text-[11px]">
                              {formatQ(String(acumuladoTotales.total.toFixed(2)))}
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    )}

                    {expandedRow === item.credito_id && !loadingDetails && abonosDetail.length === 0 && acumuladoDetail.length === 0 && (
                      <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                        <TableCell colSpan={17} className="p-4 border-b border-blue-200 text-center text-xs text-gray-500 italic">
                          No se encontraron abonos registrados y validados en este mes para este crédito.
                        </TableCell>
                      </TableRow>
                    )}

                    {expandedRow === item.credito_id && !loadingDetails && abonosDetail.length > 0 && (
                      <TableRow className="bg-blue-50/60 hover:bg-blue-50/60">
                        <TableCell
                          colSpan={17}
                          className="py-1.5 px-4 border-b border-blue-200 text-xs font-bold text-blue-700"
                        >
                          Abonos del mes
                        </TableCell>
                      </TableRow>
                    )}

                    {expandedRow === item.credito_id && !loadingDetails && abonosDetail.length > 0 && abonosDetail.map((abono) => (
                      <TableRow
                        key={abono.pago_id}
                        className="bg-slate-50/20 hover:bg-blue-50/30 border-b border-blue-100/50 text-[11px] text-gray-600 transition-colors group"
                      >
                        {/* 1. SIFCO -> vacío */}
                        <TableCell className="sticky left-0 bg-slate-50/90 group-hover:bg-[#f3f8ff] border-r border-b border-blue-100 min-w-[140px] w-[140px]" />
                        
                        {/* 2. Cliente -> vacío */}
                        <TableCell className="sticky left-[140px] bg-slate-50/90 group-hover:bg-[#f3f8ff] border-r border-b border-blue-200 min-w-[220px] w-[220px] shadow-[3px_0_5px_-2px_rgba(0,0,0,0.05)]" />
                        
                        {/* 3. Asesor -> vacío */}
                        <TableCell className="border-r border-b border-blue-100" />
                        
                        {/* 4. Cuotas -> vacío */}
                        <TableCell className="border-r border-b border-blue-100" />
                        
                        {/* 5. Etapa de Mora -> vacío */}
                        <TableCell className="border-r border-b border-blue-100" />
                        
                        {/* 6. Boletas Totales -> Monto Aplicado */}
                        <TableCell className="text-right font-semibold text-blue-900 border-r border-b border-blue-100 bg-blue-50/10">
                          {formatQ(abono.monto_aplicado)}
                        </TableCell>
                        
                        {/* 7. Abono Capital */}
                        <TableCell className="text-right text-gray-600 border-r border-b border-blue-100">
                          {formatQ(abono.abono_capital)}
                        </TableCell>
                        
                        {/* 8. Interés */}
                        <TableCell className="text-right text-gray-600 border-r border-b border-blue-100">
                          {formatQ(abono.abono_interes)}
                        </TableCell>
                        
                        {/* 9. IVA 12% */}
                        <TableCell className="text-right text-gray-600 border-r border-b border-blue-100">
                          {formatQ(abono.abono_iva_12)}
                        </TableCell>
                        
                        {/* 10. Seguro */}
                        <TableCell className="text-right text-gray-600 border-r border-b border-blue-100">
                          {formatQ(abono.abono_seguro)}
                        </TableCell>
                        
                        {/* 11. GPS */}
                        <TableCell className="text-right text-gray-600 border-r border-b border-blue-100">
                          {formatQ(abono.abono_gps)}
                        </TableCell>
                        
                        {/* 12. Membresías */}
                        <TableCell className="text-right text-gray-600 border-r border-b border-blue-100">
                          {formatQ(abono.membresias)}
                        </TableCell>
                        
                        {/* 13. Int. CUBE */}
                        <TableCell className="text-right text-gray-600 border-r border-b border-blue-100">
                          {formatQ(abono.interes_cube)}
                        </TableCell>
                        
                        {/* 14. IVA CUBE */}
                        <TableCell className="text-right text-gray-600 border-r border-b border-blue-100">
                          {formatQ(abono.iva_cube)}
                        </TableCell>
                        
                        {/* 15. Royalty */}
                        <TableCell className="text-right text-gray-400 border-r border-b border-blue-100">
                          --
                        </TableCell>
                        
                        {/* 16. Mora */}
                        <TableCell className="text-right text-red-600 bg-red-50/10 border-r border-b border-blue-100">
                          {formatQ(abono.mora)}
                        </TableCell>
                        
                        {/* 17. Total Pagos Mes (Monto Aplicado) */}
                        <TableCell className="text-right text-green-700 font-bold bg-green-50/10 border-b border-blue-100">
                          {formatQ(abono.monto_aplicado)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Paginación */}
          <div className="flex flex-wrap items-center justify-between mt-5 gap-3">
            <span className="text-sm text-gray-600">
              Página {pagination?.page ?? 1} de {pagination?.totalPages ?? 1} ({pagination?.total ?? 0} total)
            </span>
            <div className="flex items-center gap-2">
              <select
                className="border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800 bg-blue-50 focus:ring-blue-400"
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              >
                {[10, 20, 50].map((n) => (
                  <option key={n} value={n}>{n} por página</option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="border-blue-200 text-blue-700"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= (pagination?.totalPages ?? 1)}
                onClick={() => setPage((p) => p + 1)}
                className="border-blue-200 text-blue-700"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  </div>

  {/* Modal de Error */}
  <Dialog open={showErrorModal} onOpenChange={setShowErrorModal}>
    <DialogContent className="bg-white rounded-2xl border-red-100 shadow-2xl max-w-sm">
      <DialogHeader className="flex flex-col items-center gap-4 py-4">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center">
          <AlertCircle className="w-10 h-10 text-red-500" />
        </div>
        <div className="text-center space-y-2">
          <DialogTitle className="text-xl font-bold text-gray-900">¡Ups! Algo salió mal</DialogTitle>
          <DialogDescription className="text-gray-500 text-sm leading-relaxed">
            {errorMessage}
          </DialogDescription>
        </div>
      </DialogHeader>
      <DialogFooter className="sm:justify-center mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowErrorModal(false)}
              className="w-full sm:w-32 border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold rounded-xl"
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
