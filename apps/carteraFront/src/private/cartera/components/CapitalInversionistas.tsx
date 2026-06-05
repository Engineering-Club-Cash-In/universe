import { useState } from "react";
import { usePersistedState } from "../hooks/usePersistedState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Download, Loader2, Search, X } from "lucide-react";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getCapitalInversionistas,
  type CapitalInversionistaItem,
} from "../services/services";
import { useCapitalInversionistas } from "../hooks/useCapitalInversionistas";

function formatQ(val: string | number | null | undefined): string {
  const n = Number(val ?? 0);
  if (isNaN(n)) return "Q 0.00";
  return `Q ${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatFecha(val: string | null | undefined): string {
  if (!val) return "-";
  const [year, month, day] = val.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function formatModalidad(val: string | null | undefined): string {
  if (!val) return "-";
  return val.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function DatePickerField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(value + "T00:00:00") : undefined;

  return (
    <div className="min-w-[180px]">
      <label className="text-sm font-semibold text-blue-800 mb-1 block">{label}</label>
      <div className="flex items-center border border-blue-200 rounded-lg bg-blue-50 focus-within:ring-1 focus-within:ring-blue-400 overflow-hidden">
        <input
          type="text"
          placeholder="YYYY-MM-DD"
          value={value}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            let formatted = digits;
            if (digits.length > 4) formatted = digits.slice(0, 4) + "-" + digits.slice(4);
            if (digits.length > 6) formatted = digits.slice(0, 4) + "-" + digits.slice(4, 6) + "-" + digits.slice(6, 8);
            onChange(formatted);
          }}
          maxLength={10}
          className="flex-1 px-3 py-2 text-sm text-blue-800 bg-transparent focus:outline-none"
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="px-2 py-2 text-blue-600 hover:text-blue-800 hover:bg-blue-100 transition-colors"
            >
              <CalendarIcon className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 bg-white shadow-lg border border-slate-200 text-black" align="start">
            <Calendar
              mode="single"
              selected={selected}
              onSelect={(date) => {
                if (date) onChange(toDateString(date));
                setOpen(false);
              }}
              className="[--cell-size:--spacing(5)] w-60"
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

export function CapitalInversionistas() {
  const [fechaDesde, setFechaDesde] = usePersistedState<string>("cartera/capitalInversionistas/fechaDesde", "");
  const [fechaHasta, setFechaHasta] = usePersistedState<string>("cartera/capitalInversionistas/fechaHasta", "");
  const [queryEnabled, setQueryEnabled] = usePersistedState<boolean>("cartera/capitalInversionistas/queryEnabled", false);
  const [appliedDesde, setAppliedDesde] = usePersistedState<string>("cartera/capitalInversionistas/appliedDesde", "");
  const [appliedHasta, setAppliedHasta] = usePersistedState<string>("cartera/capitalInversionistas/appliedHasta", "");
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const hasActiveFilters = fechaDesde !== "" || fechaHasta !== "" || appliedDesde !== "" || appliedHasta !== "";

  const clearFilters = () => {
    setFechaDesde("");
    setFechaHasta("");
    setAppliedDesde("");
    setAppliedHasta("");
    setQueryEnabled(false);
  };

  const { data, isLoading, isError } = useCapitalInversionistas(
    { fecha_desde: appliedDesde || undefined, fecha_hasta: appliedHasta || undefined },
    queryEnabled
  );

  const rows: CapitalInversionistaItem[] = queryEnabled ? (data?.data ?? []) : [];

  const totalCapital = rows.reduce((acc, r) => acc + Number(r.capital ?? 0), 0);

  const handleGenerar = () => {
    setAppliedDesde(fechaDesde);
    setAppliedHasta(fechaHasta);
    setQueryEnabled(true);
  };

  const handleExcel = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      const res = await getCapitalInversionistas({
        fecha_desde: appliedDesde || undefined,
        fecha_hasta: appliedHasta || undefined,
        excel: true,
      });
      if (res.success && res.excelUrl) {
        window.open(res.excelUrl, "_blank");
      } else {
        setExportError("No se pudo generar el archivo Excel.");
      }
    } catch {
      setExportError("Error al exportar el Excel.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6">

        {/* Encabezado */}
        <div className="text-center space-y-1">
          <h1 className="text-xl sm:text-3xl font-bold text-blue-900">Capital Inversionistas</h1>
          <p className="text-slate-500 text-xs sm:text-sm">
            Resumen de capital aportado, tasa y modalidad por inversionista
          </p>
        </div>

        {/* Filtros */}
        <div className="bg-white/80 backdrop-blur rounded-2xl shadow-lg border border-blue-100 p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 sm:gap-4">
            <div className="w-full sm:min-w-[180px] sm:w-auto">
              <DatePickerField label="Fecha Desde" value={fechaDesde} onChange={setFechaDesde} />
            </div>
            <div className="w-full sm:min-w-[180px] sm:w-auto">
              <DatePickerField label="Fecha Hasta" value={fechaHasta} onChange={setFechaHasta} />
            </div>
            <div className="flex gap-2 sm:gap-3 sm:items-end">
              <Button
                onClick={handleGenerar}
                disabled={isLoading}
                className="flex-1 sm:flex-none bg-blue-700 hover:bg-blue-800 text-white"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                Generar Reporte
              </Button>
              <Button
                variant="outline"
                onClick={handleExcel}
                disabled={isExporting || rows.length === 0}
                className="flex-1 sm:flex-none border-green-600 text-green-700 hover:bg-green-50"
              >
                {isExporting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Exportar Excel
              </Button>
              {hasActiveFilters && (
                <Button
                  variant="outline"
                  onClick={clearFilters}
                  className="flex-1 sm:flex-none text-gray-600 border-gray-300 hover:bg-gray-100"
                >
                  <X className="h-4 w-4 mr-2" />
                  Limpiar filtros
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
                    {[fechaDesde !== "" || appliedDesde !== "", fechaHasta !== "" || appliedHasta !== ""].filter(Boolean).length}
                  </Badge>
                </Button>
              )}
            </div>
          </div>
          {exportError && (
            <p className="mt-3 text-sm text-red-600">{exportError}</p>
          )}
        </div>

        {/* Resultado */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200">
          {isLoading ? (
            <div className="flex items-center justify-center h-48 text-slate-500">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Cargando datos...
            </div>
          ) : isError ? (
            <div className="flex items-center justify-center h-48 text-red-500">
              Error al cargar el reporte. Intente de nuevo.
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-slate-400">
              Sin resultados para los filtros seleccionados.
            </div>
          ) : (
            <>
              {/* Vista móvil — tarjetas */}
              <div className="block md:hidden divide-y divide-slate-100">
                {rows.map((row, idx) => (
                  <div key={row.inversionista_id} className={`p-4 space-y-2 ${idx % 2 === 0 ? "bg-slate-50" : "bg-white"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-slate-800 text-sm leading-tight">{row.inversionista}</span>
                      <span className="text-xs text-slate-400 shrink-0">#{idx + 1}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div>
                        <span className="text-slate-400 uppercase tracking-wide">Capital</span>
                        <p className="font-mono font-semibold text-slate-700">{formatQ(row.capital)}</p>
                      </div>
                      <div>
                        <span className="text-slate-400 uppercase tracking-wide">Tasa</span>
                        <p className="text-slate-700">{row.tasa_inversionista}%</p>
                      </div>
                      <div>
                        <span className="text-slate-400 uppercase tracking-wide">Modalidad</span>
                        <p className="text-slate-600">{formatModalidad(row.modalidad)}</p>
                      </div>
                      <div>
                        <span className="text-slate-400 uppercase tracking-wide">Fecha Inicio</span>
                        <p className="text-slate-600">{formatFecha(row.fecha_inicio_participacion)}</p>
                      </div>
                      {row.comentario && (
                        <div className="col-span-2">
                          <span className="text-slate-400 uppercase tracking-wide">Comentario</span>
                          <p className="text-slate-500 italic">{row.comentario}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div className="flex justify-between items-center px-4 py-3 bg-blue-50 border-t border-slate-200">
                  <span className="text-sm font-semibold text-blue-900">Total Capital</span>
                  <span className="text-sm font-bold text-blue-900 font-mono">{formatQ(totalCapital)}</span>
                </div>
              </div>

              {/* Vista desktop — tabla con header fijo */}
              <div className="hidden md:block w-full overflow-x-auto">
                <table className="w-full caption-bottom text-sm table-fixed">
                  <colgroup>
                    <col className="w-[5%]" />
                    <col className="w-[22%]" />
                    <col className="w-[15%]" />
                    <col className="w-[10%]" />
                    <col className="w-[15%]" />
                    <col className="w-[18%]" />
                    <col className="w-[15%]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow className="bg-blue-900 hover:bg-blue-900">
                      <TableHead className="text-white font-semibold text-center">#</TableHead>
                      <TableHead className="text-white font-semibold">Inversionista</TableHead>
                      <TableHead className="text-white font-semibold text-right">Capital</TableHead>
                      <TableHead className="text-white font-semibold text-right">Tasa (%)</TableHead>
                      <TableHead className="text-white font-semibold">Modalidad</TableHead>
                      <TableHead className="text-white font-semibold">Fecha Inicio Participación</TableHead>
                      <TableHead className="text-white font-semibold">Comentario</TableHead>
                    </TableRow>
                  </TableHeader>
                </table>
                <div className="max-h-[500px] overflow-y-auto">
                  <table className="w-full caption-bottom text-sm table-fixed">
                    <colgroup>
                      <col className="w-[5%]" />
                      <col className="w-[22%]" />
                      <col className="w-[15%]" />
                      <col className="w-[10%]" />
                      <col className="w-[15%]" />
                      <col className="w-[18%]" />
                      <col className="w-[15%]" />
                    </colgroup>
                    <TableBody>
                      {rows.map((row, idx) => (
                        <TableRow
                          key={row.inversionista_id}
                          className={idx % 2 === 0 ? "bg-slate-50 hover:bg-slate-100" : "bg-white hover:bg-slate-50"}
                        >
                          <TableCell className="text-center text-slate-500">{idx + 1}</TableCell>
                          <TableCell className="font-medium text-slate-800 truncate">{row.inversionista}</TableCell>
                          <TableCell className="text-right font-mono text-slate-700">{formatQ(row.capital)}</TableCell>
                          <TableCell className="text-right text-slate-700">{row.tasa_inversionista}%</TableCell>
                          <TableCell className="text-slate-600 truncate">{formatModalidad(row.modalidad)}</TableCell>
                          <TableCell className="text-slate-600">{formatFecha(row.fecha_inicio_participacion)}</TableCell>
                          <TableCell className="text-slate-500 italic whitespace-normal break-words">{row.comentario || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </table>
                </div>
                <div className="flex justify-end border-t border-slate-200 px-4 py-3 bg-blue-50">
                  <span className="text-sm font-semibold text-blue-900 mr-4">Total Capital:</span>
                  <span className="text-sm font-bold text-blue-900 font-mono">{formatQ(totalCapital)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
