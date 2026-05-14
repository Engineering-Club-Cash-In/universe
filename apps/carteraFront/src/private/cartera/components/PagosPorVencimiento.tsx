import { useState } from "react";
import { usePersistedState } from "../hooks/usePersistedState";
import { usePagosPorVencimiento } from "../hooks/usePagosPorVencimiento";
import { useAdminData } from "../hooks/advisor";
import type { PagoPorVencimientoItem, Advisor } from "../services/services";
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
import { getPagosPorVencimiento } from "../services/services";
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
    setPage(1);
  };

  const items: PagoPorVencimientoItem[] = data?.data ?? [];
  const pagination = data?.pagination;
  const totales = data?.totales;

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
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {[
              { label: "Capital", value: totales.capital_restante },
              { label: "Interés", value: totales.interes_restante },
              { label: "IVA 12%", value: totales.iva_12_restante },
              { label: "Seguro", value: totales.seguro_restante },
              { label: "GPS", value: totales.gps_restante },
              { label: "Membresías", value: totales.membresias },
              { label: "Interés CUBE", value: totales.interes_cube },
              { label: "IVA CUBE", value: totales.iva_cube },
            ].map((t) => (
              <div key={t.label} className="text-center">
                <p className="text-xs text-gray-500 font-medium">{t.label}</p>
                <p className="text-sm font-bold text-blue-700">{formatQ(t.value)}</p>
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
            <Table className="w-full">
              <TableHeader>
                <TableRow className="bg-gradient-to-r from-blue-50 to-blue-100">
                  <TableHead className="font-bold text-blue-800">No. SIFCO</TableHead>
                  <TableHead className="font-bold text-blue-800">Cliente</TableHead>
                  <TableHead className="font-bold text-blue-800">Asesor</TableHead>
                  <TableHead className="font-bold text-blue-800 text-center">Cuotas</TableHead>
                  <TableHead className="font-bold text-blue-800 text-center">Etapa de Mora</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right">Boletas Totales</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right">Capital</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right">Interés</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right">IVA 12%</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right">Seguro</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right">GPS</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right">Membresías</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right">Int. CUBE</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right">IVA CUBE</TableHead>
                  <TableHead className="font-bold text-blue-800 text-right">Royalty</TableHead>
                  <TableHead className="font-bold text-green-800 text-right">Total Pagos Mes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.credito_id} className="hover:bg-blue-50/50 transition">
                    <TableCell className="font-semibold text-blue-700">
                      {item.numero_credito_sifco}
                    </TableCell>
                    <TableCell className="text-black">{item.nombre_usuario}</TableCell>
                    <TableCell className="text-black text-xs">{item.asesor || "--"}</TableCell>
                    <TableCell className="text-black text-center">
                      {item.cuota_min === item.cuota_max 
                        ? item.cuota_min 
                        : `${item.cuota_min} - ${item.cuota_max}`}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        item.dias_mora === 'Al día' 
                          ? 'bg-green-100 text-green-700' 
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {item.dias_mora}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium text-black">{formatQ(item.monto_boleta)}</TableCell>
                    <TableCell className="text-right text-black">{formatQ(item.capital_restante)}</TableCell>
                    <TableCell className="text-right text-black">{formatQ(item.interes_restante)}</TableCell>
                    <TableCell className="text-right text-black">{formatQ(item.iva_12_restante)}</TableCell>
                    <TableCell className="text-right text-black">{formatQ(item.seguro_restante)}</TableCell>
                    <TableCell className="text-right text-black">{formatQ(item.gps_restante)}</TableCell>
                    <TableCell className="text-right text-black">{formatQ(item.membresias)}</TableCell>
                    <TableCell className="text-right text-black">{formatQ(item.interes_cube)}</TableCell>
                    <TableCell className="text-right text-black">{formatQ(item.iva_cube)}</TableCell>
                    <TableCell className="text-right text-black">
                      {item.cuota_min === 0 ? formatQ(item.royalti) : "--"}
                    </TableCell>
                    <TableCell className="text-right text-green-700 font-bold bg-green-50/50">
                      {formatQ(item.total_pagos_del_mes)}
                    </TableCell>
                  </TableRow>
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
