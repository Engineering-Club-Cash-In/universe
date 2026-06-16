/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo, useCallback } from "react";
import { usePersistedState } from "../hooks/usePersistedState";
import { getApiErrorMessage } from "@/lib/apiError";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  getResumenGlobalLiquidaciones,
  descargarResumenLiquidacionesExcel,
  formatMensajeFallido,
  type LiquidacionResumen,
  type CalcularPagosEspejoResponse,
} from "../services/services";
import { useCalcularPagosEspejo } from "../hooks/getInvestor";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  FileSpreadsheet,
  Search,
  Loader2,
  Landmark,
  RefreshCw,
  Eye,
  Calculator,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const PER_PAGE = 25;

const MESES = [
  { value: 1, label: "Enero" },
  { value: 2, label: "Febrero" },
  { value: 3, label: "Marzo" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Mayo" },
  { value: 6, label: "Junio" },
  { value: 7, label: "Julio" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Septiembre" },
  { value: 10, label: "Octubre" },
  { value: 11, label: "Noviembre" },
  { value: 12, label: "Diciembre" },
];

function formatCurrency(value: number | string | null | undefined, symbol: string): string {
  const num = Number(value ?? 0);
  return `${symbol}${num.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getMesLabel(mes: number): string {
  return MESES.find((m) => m.value === mes)?.label ?? "";
}

function getMesAnioActualGT(): { mes: number; anio: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guatemala",
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date());
  return {
    mes: Number(parts.find((p) => p.type === "month")?.value),
    anio: Number(parts.find((p) => p.type === "year")?.value),
  };
}

type EstadoFiltro = "all" | "liquidated" | "pending" | "uploaded" | "sin_movimiento";

const STATUS_META: Record<
  "activo" | "inactivo" | "pendiente_devolucion",
  { label: string; badgeClass: string }
> = {
  activo: {
    label: "Activo",
    badgeClass: "border-green-300 text-green-700 bg-green-50",
  },
  inactivo: {
    label: "Inactivo",
    badgeClass: "border-gray-300 text-gray-600 bg-gray-100",
  },
  pendiente_devolucion: {
    label: "Pendiente devolución",
    badgeClass: "border-rose-300 text-rose-700 bg-rose-50",
  },
};

const ESTADO_META: Record<
  Exclude<EstadoFiltro, "all">,
  { label: string; chipLabel: string; badgeClass: string; chipActiveClass: string }
> = {
  liquidated: {
    label: "Liquidado",
    chipLabel: "Liquidados",
    badgeClass: "border-emerald-300 text-emerald-700 bg-emerald-50",
    chipActiveClass: "bg-emerald-600 text-white border-emerald-600",
  },
  pending: {
    label: "Con pagos generados",
    chipLabel: "Con pagos generados",
    badgeClass: "border-amber-300 text-amber-700 bg-amber-50",
    chipActiveClass: "bg-amber-500 text-white border-amber-500",
  },
  uploaded: {
    label: "Boleta subida",
    chipLabel: "Boleta subida",
    badgeClass: "border-sky-300 text-sky-700 bg-sky-50",
    chipActiveClass: "bg-sky-600 text-white border-sky-600",
  },
  sin_movimiento: {
    label: "Pendiente de liquidar",
    chipLabel: "Pendiente de liquidar",
    badgeClass: "border-slate-300 text-slate-600 bg-slate-100",
    chipActiveClass: "bg-slate-700 text-white border-slate-700",
  },
};

interface LiquidacionCardProps {
  item: LiquidacionResumen;
  onGenerarPagos: (id: number) => void;
  onVerPagos: (id: number) => void;
  generandoId: number | null;
  navegandoId: number | null;
}

function LiquidacionCard({ item, onGenerarPagos, onVerPagos, generandoId, navegandoId }: LiquidacionCardProps) {
  const s = item.currencySymbol;
  const boleta = item.boleta_liquidacion;
  const estadoMeta = ESTADO_META[item.estado_liquidacion_resumen];
  const reinvCap = Number(item.total_reinversion_capital ?? 0);
  const reinvInt = Number(item.total_reinversion_interes ?? 0);
  const estado = item.estado_liquidacion_resumen;

  const puedeGenerarPagos = estado === "sin_movimiento";
  const puedeVerPagos = estado !== "sin_movimiento";
  const generandoEste = generandoId === item.inversionista_id;
  const navegandoEste = navegandoId === item.inversionista_id;

  const cuentaTexto = item.banco
    ? `${item.banco} — ${item.tipo_cuenta ?? ""} ${item.numero_cuenta ?? ""}`.trim()
    : "Sin cuenta bancaria";

  return (
    <div className="h-full bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow p-5 pb-4 flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h3
          className="text-base font-bold text-gray-900 break-words leading-tight"
          title={item.nombre}
        >
          {item.nombre}
        </h3>

        <div className="flex items-start justify-between gap-2">
          {item.banco ? (
            <span
              className="text-xs text-gray-500 flex items-center gap-1 truncate cursor-help min-w-0"
              title={cuentaTexto}
            >
              <Landmark className="w-3 h-3 shrink-0" />
              <span className="truncate">{cuentaTexto}</span>
            </span>
          ) : (
            <span className="text-xs text-gray-400 italic flex items-center gap-1">
              <Landmark className="w-3 h-3 shrink-0" />
              Sin cuenta bancaria
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {estadoMeta && (
            <Badge variant="outline" className={`text-[11px] ${estadoMeta.badgeClass}`}>
              {estadoMeta.label}
            </Badge>
          )}
          {item.status && STATUS_META[item.status] && (
            <Badge variant="outline" className={`text-[11px] ${STATUS_META[item.status].badgeClass}`}>
              {STATUS_META[item.status].label}
            </Badge>
          )}
          {item.emite_factura && (
            <Badge variant="outline" className="text-[11px] border-blue-300 text-blue-700 bg-blue-50">
              Factura
            </Badge>
          )}
          {item.reinversion !== "sin_reinversion" && (
            <Badge variant="outline" className="text-[11px] border-purple-300 text-purple-700 bg-purple-50">
              Reinversión
            </Badge>
          )}
        </div>
      </div>

      {/* Montos Grid: 4 cols x 2 rows */}
      <div className="grid grid-cols-4 gap-1.5">
        <div className="bg-blue-50 rounded-lg px-2 py-1.5 min-w-0">
          <p className="text-[10px] text-blue-600 font-medium uppercase tracking-wide truncate">Capital</p>
          <p className="text-[12px] font-bold text-blue-900 truncate">{formatCurrency(item.total_abono_capital, s)}</p>
        </div>
        <div className="bg-indigo-50 rounded-lg px-2 py-1.5 min-w-0">
          <p className="text-[10px] text-indigo-600 font-medium uppercase tracking-wide truncate">Interés</p>
          <p className="text-[12px] font-bold text-indigo-900 truncate">{formatCurrency(item.total_abono_interes, s)}</p>
        </div>
        <div className="bg-purple-50 rounded-lg px-2 py-1.5 min-w-0">
          <p className="text-[10px] text-purple-600 font-medium uppercase tracking-wide truncate">IVA</p>
          <p className="text-[12px] font-bold text-purple-900 truncate">{formatCurrency(item.total_abono_iva, s)}</p>
        </div>
        <div className="bg-orange-50 rounded-lg px-2 py-1.5 min-w-0">
          <p className="text-[10px] text-orange-600 font-medium uppercase tracking-wide truncate">ISR</p>
          <p className="text-[12px] font-bold text-orange-900 truncate">{formatCurrency(item.total_isr, s)}</p>
        </div>
        <div className="bg-cyan-50 rounded-lg px-2 py-1.5 min-w-0" title="Reinversión Capital">
          <p className="text-[10px] text-cyan-700 font-medium uppercase tracking-wide truncate">Reinv. Cap.</p>
          <p className="text-[12px] font-bold text-cyan-900 truncate">{formatCurrency(reinvCap, s)}</p>
        </div>
        <div className="bg-violet-50 rounded-lg px-2 py-1.5 min-w-0" title="Reinversión Interés">
          <p className="text-[10px] text-violet-700 font-medium uppercase tracking-wide truncate">Reinv. Int.</p>
          <p className="text-[12px] font-bold text-violet-900 truncate">{formatCurrency(reinvInt, s)}</p>
        </div>
        <div className="bg-teal-50 rounded-lg px-2 py-1.5 min-w-0">
          <p className="text-[10px] text-teal-600 font-medium uppercase tracking-wide truncate">Reinversión</p>
          <p className="text-[12px] font-bold text-teal-900 truncate">{formatCurrency(item.total_reinversion, s)}</p>
        </div>
        <div className="bg-slate-100 rounded-lg px-2 py-1.5 border border-slate-300 min-w-0">
          <p className="text-[10px] text-slate-600 font-medium uppercase tracking-wide truncate">Total c/Reinv.</p>
          <p className="text-[12px] font-extrabold text-slate-900 truncate">{formatCurrency(item.total_a_recibir_con_reinversion, s)}</p>
        </div>
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100 mt-auto">
        {puedeGenerarPagos && (
          <button
            type="button"
            onClick={() => onGenerarPagos(item.inversionista_id)}
            disabled={generandoEste}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-60 px-3.5 py-2 rounded-lg shadow-sm transition-colors"
          >
            {generandoEste ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Generando...
              </>
            ) : (
              <>
                <Calculator className="w-3.5 h-3.5" />
                Generar Pagos
              </>
            )}
          </button>
        )}
        {puedeVerPagos && (
          <button
            type="button"
            onClick={() => onVerPagos(item.inversionista_id)}
            disabled={navegandoEste}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 px-3.5 py-2 rounded-lg shadow-sm transition-colors"
          >
            {navegandoEste ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Abriendo...
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5" />
                Ver Detalle
              </>
            )}
          </button>
        )}
        {boleta?.boleta_url && (
          <a
            href={boleta.boleta_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 border border-gray-300 px-3.5 py-2 rounded-lg shadow-sm transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Boleta
          </a>
        )}
        {item.reporte_liquidacion_url && (
          <a
            href={item.reporte_liquidacion_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 border border-gray-300 px-3.5 py-2 rounded-lg shadow-sm transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Reporte
          </a>
        )}
      </div>
    </div>
  );
}

// Persiste el resultado del modal fuera del componente para sobrevivir remounts
let _pendingModal: {
  nombre: string;
  inversionistaId: number;
  response?: CalcularPagosEspejoResponse;
  errorMsg?: string;
} | null = null;

export function HistorialLiquidaciones() {
  const ahoraGT = useMemo(() => getMesAnioActualGT(), []);
  const [mes, setMes] = usePersistedState<number>("cartera/historialLiquidaciones/mes", ahoraGT.mes);
  const [anio, setAnio] = usePersistedState<number>("cartera/historialLiquidaciones/anio", ahoraGT.anio);

  const [search, setSearch] = usePersistedState<string>("cartera/historialLiquidaciones/search", "");
  const [page, setPage] = usePersistedState<number>("cartera/historialLiquidaciones/page", 1);
  const [estadoFiltro, setEstadoFiltro] = usePersistedState<EstadoFiltro>("cartera/historialLiquidaciones/estadoFiltro", "all");
  const [descargandoExcel, setDescargandoExcel] = useState(false);

  const hasActiveFilters = search !== "" || estadoFiltro !== "all";

  const clearFilters = useCallback(() => {
    setSearch("");
    setEstadoFiltro("all");
    setPage(1);
  }, []);
  const [generandoId, setGenerandoId] = useState<number | null>(null);
  const [navegandoId, setNavegandoId] = useState<number | null>(null);
  const [resultadoModal, _setResultadoModal] = useState<{
    nombre: string;
    inversionistaId: number;
    response?: CalcularPagosEspejoResponse;
    errorMsg?: string;
  } | null>(() => _pendingModal);

  const setResultadoModal = useCallback((val: typeof _pendingModal) => {
    _pendingModal = val;
    _setResultadoModal(val);
  }, []);
  const navigate = useNavigate();
  const { mutate: calcularPagosEspejo } = useCalcularPagosEspejo();

  const { data, isLoading, isError, refetch } = useQuery<LiquidacionResumen[]>({
    queryKey: ["historial-liquidaciones", mes, anio],
    queryFn: () =>
      getResumenGlobalLiquidaciones({
        mes,
        anio,
        estado: "all",
        incluirSinMovimiento: true,
      }),
    staleTime: 1000 * 60 * 2,
    refetchOnWindowFocus: false,
  });

  // Conteos por estado para los chips
  const counts = useMemo(() => {
    const base = { all: 0, liquidated: 0, pending: 0, uploaded: 0, sin_movimiento: 0 };
    if (!data) return base;
    base.all = data.length;
    for (const item of data) {
      const e = item.estado_liquidacion_resumen;
      if (e in base) (base as any)[e]++;
    }
    return base;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let result = data;
    if (estadoFiltro !== "all") {
      result = result.filter((item) => item.estado_liquidacion_resumen === estadoFiltro);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((item) => item.nombre.toLowerCase().includes(q));
    }
    return result;
  }, [data, search, estadoFiltro]);

  const handleDescargarExcel = useCallback(async () => {
    setDescargandoExcel(true);
    try {
      const res = await descargarResumenLiquidacionesExcel({
        mes,
        anio,
        estado: "all",
        incluirSinMovimiento: true,
      });
      if (res?.url) {
        window.open(res.url, "_blank", "noopener,noreferrer");
        toast.success("Excel generado correctamente");
      } else {
        toast.error("No se pudo generar el Excel");
      }
    } catch (err: any) {
      toast.error(getApiErrorMessage(err, "Error al generar el Excel"));
    } finally {
      setDescargandoExcel(false);
    }
  }, [mes, anio]);

  const handleChipClick = useCallback((estado: EstadoFiltro) => {
    setEstadoFiltro(estado);
    setPage(1);
  }, []);

  const handleGenerarPagos = useCallback(
    (inversionistaId: number) => {
      const inv = data?.find((d) => d.inversionista_id === inversionistaId);
      const nombre = inv?.nombre ?? `Inversionista #${inversionistaId}`;
      setGenerandoId(inversionistaId);
      const fecha_calculo = new Date(anio, mes - 1, 1).toISOString().slice(0, 10);
      calcularPagosEspejo({ inversionistaId, fecha_calculo }, {
        onSuccess: (res: any) => {
          setResultadoModal({
            nombre,
            inversionistaId,
            response: res as CalcularPagosEspejoResponse,
          });
          const nFallidos = (res?.fallidos ?? []).length;
          if (nFallidos > 0) {
            toast.warning(
              `${nFallidos} crédito${nFallidos !== 1 ? "s" : ""} no se procesaron`,
              { description: "Ver detalle en el modal." }
            );
          }
        },
        onError: (err: any) => {
          setResultadoModal({
            nombre,
            inversionistaId,
            errorMsg: err?.message ?? "Error al generar los pagos",
          });
        },
        onSettled: () => setGenerandoId(null),
      });
    },
    [calcularPagosEspejo, data, anio, mes],
  );

  const handleVerPagos = useCallback(
    (inversionistaId: number) => {
      setNavegandoId(inversionistaId);
      // Pequeño delay para que el spinner sea visible antes del cambio de ruta
      setTimeout(() => {
        navigate(`/inversionistas?id=${inversionistaId}`);
      }, 250);
    },
    [navigate],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const paginated = useMemo(
    () => filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [filtered, page],
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
      setPage(1);
    },
    [],
  );

  const goToPrevMonth = useCallback(() => {
    setPage(1);
    if (mes === 1) {
      setMes(12);
      setAnio((a) => a - 1);
    } else {
      setMes((m) => m - 1);
    }
  }, [mes]);

  const goToNextMonth = useCallback(() => {
    setPage(1);
    if (mes === 12) {
      setMes(1);
      setAnio((a) => a + 1);
    } else {
      setMes((m) => m + 1);
    }
  }, [mes]);

  return (
    <div className="fixed inset-x-0 top-16 xl:top-28 bottom-0 flex flex-col bg-gradient-to-br from-blue-50 to-white overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 sm:px-8 pt-8 pb-4 max-w-7xl mx-auto w-full">
        <h1 className="text-3xl font-extrabold text-blue-700 text-center mb-5">
          Liquidaciones Inversionistas
        </h1>

        {/* Filtros: buscar izquierda | mes/año derecha */}
        <div className="flex flex-wrap items-end justify-between gap-4 w-full">
          {/* Izquierda: Buscar */}
          <div className="min-w-[220px] max-w-xs flex-1">
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Buscar inversionista</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Nombre..."
                value={search}
                onChange={handleSearchChange}
                className="pl-9 h-10 text-gray-900"
              />
            </div>
          </div>

          {/* Derecha: Mes/Año con flechas */}
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={goToPrevMonth}
              title="Mes anterior"
              className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Mes</label>
              <select
                value={mes}
                onChange={(e) => { setMes(Number(e.target.value)); setPage(1); }}
                className="border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900 text-sm h-10 min-w-[140px]"
              >
                {MESES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Año</label>
              <select
                value={anio}
                onChange={(e) => { setAnio(Number(e.target.value)); setPage(1); }}
                className="border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900 text-sm h-10 w-24"
              >
                {Array.from({ length: 6 }, (_, i) => {
                  const y = new Date().getFullYear() - i;
                  return <option key={y} value={y}>{y}</option>;
                })}
              </select>
            </div>

            <button
              type="button"
              onClick={goToNextMonth}
              title="Mes siguiente"
              className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => refetch()}
              disabled={isLoading}
              title="Refrescar"
              className="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={handleDescargarExcel}
              disabled={descargandoExcel}
              title="Descargar Excel"
              className="h-10 inline-flex items-center gap-2 rounded-lg border border-emerald-600 bg-emerald-600 text-white px-3 hover:bg-emerald-700 disabled:opacity-60 transition-colors text-sm font-semibold shrink-0"
            >
              {descargandoExcel ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">Descargar Excel</span>
            </button>
          </div>
        </div>

        {/* Chips de estado */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {(
            [
              { key: "all" as EstadoFiltro, label: "Todos", count: counts.all },
              { key: "liquidated" as EstadoFiltro, label: ESTADO_META.liquidated.chipLabel, count: counts.liquidated },
              { key: "pending" as EstadoFiltro, label: ESTADO_META.pending.chipLabel, count: counts.pending },
              { key: "sin_movimiento" as EstadoFiltro, label: ESTADO_META.sin_movimiento.chipLabel, count: counts.sin_movimiento },
            ]
          ).map((chip) => {
            const active = estadoFiltro === chip.key;
            const meta = chip.key !== "all" ? ESTADO_META[chip.key] : null;
            const activeClass =
              chip.key === "all"
                ? "bg-blue-600 text-white border-blue-600"
                : meta?.chipActiveClass ?? "bg-gray-700 text-white border-gray-700";
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => handleChipClick(chip.key)}
                className={`text-xs font-medium rounded-full px-3 py-1.5 border transition-colors ${
                  active
                    ? activeClass
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                }`}
              >
                {chip.label}
                <span className={`ml-1.5 ${active ? "opacity-90" : "opacity-70"}`}>
                  ({chip.count})
                </span>
              </button>
            );
          })}
        </div>

        {/* Info bar */}
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">
              {filtered.length} resultado{filtered.length !== 1 ? "s" : ""}
              {search && ` para "${search}"`}
              {" — "}
              <span className="font-medium text-gray-700">{getMesLabel(mes)} {anio}</span>
            </span>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={clearFilters} className="h-7 text-xs text-gray-600 border-gray-300 hover:bg-gray-100 gap-1">
                <X className="w-3 h-3" /> Limpiar filtros
                <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-xs">
                  {[search !== "", estadoFiltro !== "all"].filter(Boolean).length}
                </Badge>
              </Button>
            )}
          </div>
          <span className="text-sm text-gray-500">
            Página {page} de {totalPages}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 pb-20 max-w-7xl mx-auto w-full">
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            <span className="ml-3 text-gray-500">Cargando liquidaciones...</span>
          </div>
        )}

        {isError && (
          <div className="text-center py-20">
            <p className="text-red-600 font-medium">Error al cargar las liquidaciones.</p>
            <Button variant="outline" onClick={() => refetch()} className="mt-3">
              Reintentar
            </Button>
          </div>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <div className="text-center py-20">
            <p className="text-gray-500">No se encontraron liquidaciones para este período.</p>
          </div>
        )}

        {!isLoading && !isError && paginated.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 w-full items-stretch auto-rows-fr">
            {paginated.map((item) => (
              <LiquidacionCard
                key={item.inversionista_id}
                item={item}
                onGenerarPagos={handleGenerarPagos}
                onVerPagos={handleVerPagos}
                generandoId={generandoId}
                navegandoId={navegandoId}

              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination - fixed bottom */}
      {totalPages > 1 && (
        <div className="border-t border-gray-200 bg-white px-6 py-3 flex items-center justify-center gap-1.5 fixed bottom-0 inset-x-0 z-10 shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let pageNum: number;
            if (totalPages <= 5) {
              pageNum = i + 1;
            } else if (page <= 3) {
              pageNum = i + 1;
            } else if (page >= totalPages - 2) {
              pageNum = totalPages - 4 + i;
            } else {
              pageNum = page - 2 + i;
            }
            return (
              <button
                key={pageNum}
                type="button"
                onClick={() => setPage(pageNum)}
                className={`h-8 w-9 inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors ${
                  pageNum === page
                    ? "bg-blue-600 text-white border border-blue-600"
                    : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                }`}
              >
                {pageNum}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      <ResultadoGeneracionModal
        resultado={resultadoModal}
        onClose={() => { _pendingModal = null; setResultadoModal(null); refetch(); }}
        onVerDetalle={(id) => {
          setResultadoModal(null);
          navigate(`/inversionistas?id=${id}`);
        }}
      />
    </div>
  );
}

interface ResultadoGeneracionModalProps {
  resultado: {
    nombre: string;
    inversionistaId: number;
    response?: CalcularPagosEspejoResponse;
    errorMsg?: string;
  } | null;
  onClose: () => void;
  onVerDetalle: (inversionistaId: number) => void;
}

function ResultadoGeneracionModal({ resultado, onClose, onVerDetalle }: ResultadoGeneracionModalProps) {
  if (!resultado) return null;

  const { nombre, inversionistaId, response, errorMsg } = resultado;
  const success = !!response?.success && !errorMsg;
  const totalCreditos = response?.totalCreditosProcesados ?? 0;
  const totalPagos = (response?.data ?? []).reduce(
    (acc, d) => acc + (Number(d.pagosRegistrados) || 0),
    0,
  );
  const huboPagos = success && totalPagos > 0;
  const sinPagos = success && totalPagos === 0;
  const fallo = !success;
  const fallidos = response?.fallidos ?? [];

  let HeroIcon: React.ElementType;
  let titulo: string;
  let descripcion: string;
  let iconBgClass: string;
  let iconColorClass: string;

  if (fallo) {
    HeroIcon = XCircle;
    titulo = "No se pudieron generar los pagos";
    descripcion = errorMsg ?? response?.message ?? "Ocurrió un error al procesar la solicitud.";
    iconBgClass = "bg-rose-100";
    iconColorClass = "text-rose-600";
  } else if (sinPagos) {
    HeroIcon = AlertTriangle;
    titulo = "No se generaron pagos";
    descripcion =
      totalCreditos === 0
        ? "Este inversionista no tiene créditos elegibles para generar pagos en este momento."
        : "Se procesaron créditos pero ninguno tenía cuotas pendientes para generar pagos.";
    iconBgClass = "bg-amber-100";
    iconColorClass = "text-amber-600";
  } else {
    HeroIcon = CheckCircle2;
    titulo = "Pagos generados correctamente";
    descripcion = `Se procesaron ${totalCreditos} crédito${totalCreditos !== 1 ? "s" : ""} y se registraron ${totalPagos} pago${totalPagos !== 1 ? "s" : ""}.`;
    iconBgClass = "bg-emerald-100";
    iconColorClass = "text-emerald-600";
  }

  return (
    <Dialog open={!!resultado} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-xl bg-white p-0 overflow-hidden gap-0 max-h-[90vh] flex flex-col">
        {/* Hero header */}
        <div className="flex flex-col items-center text-center px-6 pt-8 pb-5 bg-gradient-to-b from-gray-50 to-white border-b border-gray-100">
          <div className={`flex items-center justify-center w-16 h-16 rounded-full ${iconBgClass} mb-4 shadow-sm`}>
            <HeroIcon className={`w-8 h-8 ${iconColorClass}`} />
          </div>
          <DialogTitle className="text-xl font-bold text-gray-900 mb-1">
            {titulo}
          </DialogTitle>
          <DialogDescription className="text-sm text-gray-500">
            <span className="font-semibold text-gray-700">{nombre}</span>
          </DialogDescription>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <p className="text-sm text-gray-700 text-center leading-relaxed">
            {descripcion}
          </p>

          {huboPagos && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2.5 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Créditos</p>
                <p className="text-2xl font-bold text-emerald-900">{totalCreditos}</p>
              </div>
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2.5 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Pagos</p>
                <p className="text-2xl font-bold text-emerald-900">{totalPagos}</p>
              </div>
            </div>
          )}

          {fallidos.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-200 bg-amber-100">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                  {fallidos.length} crédito{fallidos.length !== 1 ? "s" : ""} sin procesar
                </span>
              </div>
              <div className="max-h-40 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-amber-50 text-[11px] uppercase text-amber-700 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Crédito SIFCO</th>
                      <th className="px-3 py-2 text-left font-semibold">Razón</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100 bg-white">
                    {fallidos.map((row) => (
                      <tr key={row.creditoId} className="hover:bg-amber-50">
                        <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{row.numeroCreditoSifco}</td>
                        <td className="px-3 py-2 text-gray-600 text-xs">{formatMensajeFallido(row.mensaje)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {huboPagos && response?.data && response.data.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[11px] uppercase text-gray-600 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Crédito SIFCO</th>
                    <th className="px-3 py-2 text-center font-semibold">Cuota</th>
                    <th className="px-3 py-2 text-right font-semibold">Pagos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {response.data.map((row) => (
                    <tr key={row.creditoId} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-800">{row.numeroCreditoSifco}</td>
                      <td className="px-3 py-2 text-center text-gray-600">#{row.cuotaProcesada}</td>
                      <td className="px-3 py-2 text-right">
                        <Badge
                          variant="outline"
                          className={
                            row.pagosRegistrados > 0
                              ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                              : "border-gray-300 text-gray-600 bg-gray-50"
                          }
                        >
                          {row.pagosRegistrados}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 bg-gray-50 border-t border-gray-100 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-w-24 inline-flex items-center justify-center px-4 py-2 rounded-md border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Cerrar
          </button>
          {huboPagos && (
            <button
              type="button"
              onClick={() => onVerDetalle(inversionistaId)}
              className="min-w-32 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-sm font-semibold text-white transition-colors"
            >
              <Eye className="w-4 h-4" />
              Ver Detalle
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
