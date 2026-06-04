/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo, useCallback, useEffect } from "react";
import { usePersistedState } from "../hooks/usePersistedState";
import { useSesionesPendientes, useCompletarEspejo, useReemplazarInversionistaCredito, useCreditCandidates, useDevolverPendientesACube, useCompraCarteraAceptada, useExtenderCompraCartera } from "../hooks/useSesionesPendientes";
import type { CreditoEspejoPendiente, InversionistaSesionPendiente, OtroCreditoDisponible } from "../services/services";
import {
  Loader2,
  Search,
  AlertTriangle,
  ArrowRight,
  Check,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Undo2,
  User,
  Mail,
  CreditCard,
  X,
  Ban,
  AlertCircle,
  Clock,
  Plus,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";

type AccionTipo = "aceptar" | "confirmar" | "confirmar_reinversion" | "extender" | "cancelar";

const ACCION_CONFIG: Record<AccionTipo, {
  titulo: string; subtitulo: string;
  headerText: string; borderColor: string;
  btnClass: string; btnLabel: string;
}> = {
  aceptar: {
    titulo: "Aceptar compra de cartera",
    subtitulo: "Se aceptarán y notificarán los siguientes créditos:",
    headerText: "text-amber-600", borderColor: "#f59e0b",
    btnClass: "bg-amber-500 hover:bg-amber-600 text-white border-none",
    btnLabel: "Sí, aceptar",
  },
  confirmar: {
    titulo: "Confirmar compra de cartera",
    subtitulo: "Se marcarán como completados los siguientes créditos:",
    headerText: "text-amber-700", borderColor: "#d97706",
    btnClass: "bg-amber-600 hover:bg-amber-700 text-white border-none",
    btnLabel: "Sí, confirmar",
  },
  extender: {
    titulo: "Extender 24 horas",
    subtitulo: "Se extenderá el plazo de los siguientes créditos:",
    headerText: "text-blue-600", borderColor: "#2563eb",
    btnClass: "bg-blue-600 hover:bg-blue-700 text-white border-none",
    btnLabel: "Sí, extender",
  },
  confirmar_reinversion: {
    titulo: "Confirmar reinversión",
    subtitulo: "Se marcarán como completadas las siguientes reinversiones:",
    headerText: "text-blue-700", borderColor: "#2563eb",
    btnClass: "bg-blue-600 hover:bg-blue-700 text-white border-none",
    btnLabel: "Sí, confirmar",
  },
  cancelar: {
    titulo: "Cancelar compra de cartera",
    subtitulo: "Los siguientes créditos se devolverán a CUBE. Esta acción no se puede deshacer.",
    headerText: "text-red-600", borderColor: "#dc2626",
    btnClass: "bg-red-600 hover:bg-red-700 text-white border-none",
    btnLabel: "Sí, cancelar",
  },
};

function ModalConfirmAccion({
  open, onClose, onConfirm, tipo, creditos, isPending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  tipo: AccionTipo;
  creditos: CreditoEspejoPendiente[];
  isPending: boolean;
}) {
  const cfg = ACCION_CONFIG[tipo];
  const totalMonto = creditos.reduce((s, c) => s + Number(c.monto_aportado_nuevo ?? c.monto_aportado), 0);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="rounded-2xl shadow-2xl max-w-md bg-white px-6 py-5 gap-0"
        style={{ border: `2px solid ${cfg.borderColor}` }}
      >
        <DialogTitle className="sr-only">{cfg.titulo}</DialogTitle>
        <DialogDescription className="sr-only">{cfg.subtitulo}</DialogDescription>
        {/* Título */}
        <div className="flex items-center gap-2.5 mb-1">
          <AlertCircle className={`w-5 h-5 shrink-0 ${cfg.headerText}`} />
          <h2 className="text-base font-bold text-gray-900">{cfg.titulo}</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4 ml-7">{cfg.subtitulo}</p>

        {/* Lista */}
        <div className="space-y-1.5 max-h-52 overflow-y-auto mb-5">
          {creditos.map(c => (
            <div key={c.credito_id} className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-mono text-gray-400 truncate">{c.numero_credito_sifco}</p>
                <p className="text-xs font-semibold text-gray-800 truncate">{c.nombre_usuario}</p>
              </div>
              <span className="text-xs font-bold text-gray-600 shrink-0">{formatQ(c.monto_aportado_nuevo ?? c.monto_aportado)}</span>
            </div>
          ))}
        </div>

        {/* Acciones */}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-gray-400">
            {creditos.length} crédito{creditos.length !== 1 ? "s" : ""} · <span className="font-semibold text-gray-600">{formatQ(totalMonto)}</span>
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onClose} disabled={isPending} className="h-8 text-xs px-4 border-gray-300 text-gray-700 hover:bg-gray-100">
              No
            </Button>
            <Button size="sm" className={`h-8 text-xs px-4 gap-1.5 ${cfg.btnClass}`} onClick={onConfirm} disabled={isPending}>
              {isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              {cfg.btnLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatQ(v: number | string | null | undefined): string {
  const num = Number(v ?? 0);
  return `Q${num.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusLabel(status: string): string {
  return status === "pendiente_reinversion" ? "Reinversión"
    : status === "pendiente_compra_cartera" ? "Compra Cartera"
    : status === "pendiente_revision" ? "Pendiente Autorizacion"
    : status;
}

function statusColor(status: string): string {
  return status === "pendiente_reinversion" ? "border-purple-300 text-purple-700 bg-purple-50"
    : status === "pendiente_compra_cartera" ? "border-amber-300 text-amber-700 bg-amber-50"
    : status === "pendiente_revision" ? "border-green-300 text-green-700 bg-green-50"
    : "border-gray-300 text-gray-700 bg-gray-50";
}

// ============================================
// Tipos
// ============================================
interface CreditoDestino {
  id: number;
  label: string;
  capacidad: number; // max que puede absorber (monto_aportado_cash_in)
  tipo: "existente" | "pendiente";
}

// Distribuye monto respetando la capacidad de cada destino seleccionado
function distribuirMonto(
  montoTotal: number,
  destinos: CreditoDestino[],
  selectedIds: Set<number>
): Map<number, number> {
  const result = new Map<number, number>();
  let restante = montoTotal;
  const selected = destinos.filter((d) => selectedIds.has(d.id));
  for (const d of selected) {
    if (restante <= 0) break;
    const asignar = Math.min(d.capacidad, restante);
    result.set(d.id, Math.round(asignar * 100) / 100);
    restante -= asignar;
  }
  return result;
}

// ============================================
// Componente principal
// ============================================
const PAGE_SIZE = 10;

export function SesionesPendientes() {
  const [page, setPage] = usePersistedState<number>("cartera/sesionesPendientes/page", 1);
  const [search, setSearch] = usePersistedState<string>("cartera/sesionesPendientes/search", "");
  const [debouncedSearch, setDebouncedSearch] = usePersistedState<string>("cartera/sesionesPendientes/debouncedSearch", "");
  const [selectedStatuses, setSelectedStatuses] = usePersistedState<string[]>("cartera/sesionesPendientes/selectedStatuses", [
    "pendiente_reinversion",
    "pendiente_compra_cartera",
    "pendiente_revision"
  ]);

  const statusesParam = useMemo(() => {
    if (selectedStatuses.length === 3) return undefined;
    return selectedStatuses.join(",");
  }, [selectedStatuses]);

  const { data: response, isLoading, isError, error, refetch, isFetching } = useSesionesPendientes(
    page, 
    PAGE_SIZE, 
    debouncedSearch,
    statusesParam
  );

  const hasActiveFilters = search !== "" || selectedStatuses.length !== 3;

  // Debounce search to avoid firing on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 800);
    return () => clearTimeout(timer);
  }, [search, setDebouncedSearch]);

  const investors = useMemo(() => response?.data ?? [], [response]);
  
  // Lógica de selección de filtros
  const toggleStatus = (status: string | "all") => {
    setPage(1);
    if (status === "all") {
      setSelectedStatuses(["pendiente_reinversion", "pendiente_compra_cartera", "pendiente_revision"]);
      return;
    }
    
    setSelectedStatuses(prev => {
      // Si estaba en "Todos", al seleccionar uno individual, solo queda ese
      if (prev.length === 3) return [status];
      
      const isSelected = prev.includes(status);
      if (isSelected) {
        const next = prev.filter(s => s !== status);
        // Si no queda ninguno, volver a "Todos"
        return next.length === 0 ? ["pendiente_reinversion", "pendiente_compra_cartera", "pendiente_revision"] : next;
      } else {
        const next = [...prev, status];
        // Si seleccioné todos manualmente, es "Todos"
        return next.length === 3 ? ["pendiente_reinversion", "pendiente_compra_cartera", "pendiente_revision"] : next;
      }
    });
  };

  const isAllSelected = selectedStatuses.length === 3;

  const total = response?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const totalCreditos = useMemo(
    () => investors.reduce((a, inv) => a + inv.creditosPendientes.length, 0),
    [investors]
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
      setPage(1);
    },
    [setPage, setSearch],
  );

  const clearSearch = useCallback(() => {
    setSearch("");
    setDebouncedSearch("");
    setSelectedStatuses(["pendiente_reinversion", "pendiente_compra_cartera", "pendiente_revision"]);
    setPage(1);
  }, [setDebouncedSearch, setPage, setSearch, setSelectedStatuses]);

  if (isLoading) {
    return (
      <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex items-center justify-center">
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          <span>Cargando sesiones pendientes&hellip;</span>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-red-600">
          <AlertTriangle className="w-8 h-8" aria-hidden="true" />
          <p className="font-medium">Error al cargar las sesiones pendientes</p>
          <p className="text-sm text-gray-500">{(error as any)?.message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Reintentar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-4 sm:px-6 lg:px-8 overflow-auto pt-6 pb-20">
      <div className="w-full max-w-[1400px] space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Sesiones Pendientes</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Créditos pendientes de reinversión o compra de cartera
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
            Actualizar
          </Button>
        </div>

        {/* Search + Stats inline */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
            <Input
              placeholder="Buscar por nombre"
              value={search}
              onChange={handleSearchChange}
              className="pl-9 h-8 text-xs text-gray-900"
              aria-label="Buscar inversionistas"
            />
          </div>
          {hasActiveFilters && (
            <Button variant="outline" size="sm" onClick={clearSearch} className="h-8 text-xs text-gray-600 border-gray-300 hover:bg-gray-100 gap-1">
              <X className="w-3.5 h-3.5" /> Limpiar
              <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-xs">
                {[search !== "", selectedStatuses.length !== 3].filter(Boolean).length}
              </Badge>
            </Button>
          )}
          <Badge variant="outline" className="text-[11px] border-blue-200 text-blue-700 bg-blue-50 tabular-nums">
            {total} inversionistas
          </Badge>
          <Badge variant="outline" className="text-[11px] border-purple-200 text-purple-700 bg-purple-50 tabular-nums">
            {totalCreditos} créditos
          </Badge>
          <span className="text-xs text-gray-500">
            Página {page} de {totalPages}
          </span>
        </div>

        {/* Status Filters (Chips) */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          <button
            onClick={() => toggleStatus("all")}
            className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all border ${
              isAllSelected 
                ? "bg-gray-900 text-white border-gray-900 shadow-sm" 
                : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
            }`}
          >
            Todos
          </button>
          
          <button
            onClick={() => toggleStatus("pendiente_compra_cartera")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all border ${
              !isAllSelected && selectedStatuses.includes("pendiente_compra_cartera")
                ? "bg-amber-100 text-amber-800 border-amber-300 shadow-sm"
                : "bg-white text-gray-400 border-gray-100 hover:border-gray-200"
            }`}
          >
            <div className={`w-1.5 h-1.5 rounded-full ${(!isAllSelected && selectedStatuses.includes("pendiente_compra_cartera")) ? "bg-amber-500" : "bg-gray-300"}`} />
            Compra Cartera
          </button>

          <button
            onClick={() => toggleStatus("pendiente_reinversion")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all border ${
              !isAllSelected && selectedStatuses.includes("pendiente_reinversion")
                ? "bg-purple-100 text-purple-800 border-purple-300 shadow-sm"
                : "bg-white text-gray-400 border-gray-100 hover:border-gray-200"
            }`}
          >
            <div className={`w-1.5 h-1.5 rounded-full ${(!isAllSelected && selectedStatuses.includes("pendiente_reinversion")) ? "bg-purple-500" : "bg-gray-300"}`} />
            Reinversiones
          </button>

          <button
            onClick={() => toggleStatus("pendiente_revision")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all border ${
              !isAllSelected && selectedStatuses.includes("pendiente_revision")
                ? "bg-emerald-100 text-emerald-800 border-emerald-300 shadow-sm"
                : "bg-white text-gray-400 border-gray-100 hover:border-gray-200"
            }`}
          >
            <div className={`w-1.5 h-1.5 rounded-full ${(!isAllSelected && selectedStatuses.includes("pendiente_revision")) ? "bg-emerald-500" : "bg-gray-300"}`} />
            Por Autorizar
          </button>
        </div>

        {/* Cards */}
        {investors.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
            <CreditCard className="w-8 h-8 text-gray-300" aria-hidden="true" />
            <p className="text-xs">
              {search || !isAllSelected ? "Sin resultados para los filtros aplicados" : "No hay sesiones pendientes"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {investors.map((investor) => (
              <InvestorCard 
                key={investor.inversionista_id} 
                investor={investor} 
                recalculateSession={refetch}
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
    </div>
  );
}

// ============================================
// Subcomponente para cada fila de crédito
// ============================================
function CreditRow({
  credito,
  editingCreditId,
  isEditing,
  onStartEdit,
  onCancelEdit,
  distribucion,
  isBalanced,
  montoAportado,
  isLoadingCandidates,
  destinos,
  selectedDestinoIds,
  onToggleDestino,
  onSave,
  reemplazarIsPending,
  checked,
  onToggleSelection,
}: {
  credito: CreditoEspejoPendiente;
  editingCreditId: number | null;
  isEditing: boolean;
  onStartEdit: (id: number) => void;
  onCancelEdit: () => void;
  distribucion: Map<number, number>;
  isBalanced: boolean;
  montoAportado: number;
  isLoadingCandidates: boolean;
  destinos: any[];
  selectedDestinoIds: Set<number>;
  onToggleDestino: (id: number) => void;
  onSave: () => void;
  reemplazarIsPending: boolean;
  checked?: boolean;
  onToggleSelection?: (creditoId: number) => void;
}) {
  const isCreditEditing = editingCreditId === credito.id;
  const values = Array.from(distribucion.values() as IterableIterator<number>);
  const totalAsig = values.reduce((a, b) => a + b, 0);
  const restante = montoAportado - totalAsig;

  // Cálculo de desglose (si existe monto nuevo)
  const montoTotal = Number(credito.monto_aportado);
  const montoNuevo = credito.monto_aportado_nuevo ? Number(credito.monto_aportado_nuevo) : 0;
  const montoAnterior = montoTotal - montoNuevo;
  const tieneParticipacionPrevia = montoAnterior > 0.01 && montoNuevo > 0;

  return (
    <div
      className={`rounded-lg border transition-all ${
        isCreditEditing
          ? "border-amber-300 bg-amber-50/30"
          : isEditing
            ? "border-gray-100 bg-gray-50/50 opacity-50"
            : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        {onToggleSelection && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onToggleSelection(credito.credito_id); }}
            className="shrink-0 focus:outline-none opacity-60 hover:opacity-100 transition-opacity"
          >
            {checked
              ? <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${credito.status === "pendiente_reinversion" ? "border-blue-500 bg-blue-500" : "border-amber-500 bg-amber-500"}`}>
                  <Check className="w-2.5 h-2.5 text-white stroke-[3]" />
                </div>
              : <div className="w-3.5 h-3.5 rounded-sm border border-gray-300 bg-white" />
            }
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-gray-900">{credito.numero_credito_sifco}</span>
            <span className="text-[11px] text-gray-500">{credito.nombre_usuario}</span>
            <Badge variant="outline" className={`text-[9px] py-0 ${statusColor(credito.status)}`}>
              {statusLabel(credito.status)}
            </Badge>
            {credito.tipo_reinversion && (
              <Badge variant="outline" className="text-[9px] py-0 border-indigo-200 text-indigo-700 bg-indigo-50">
                {credito.tipo_reinversion.replaceAll("_", " ")}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1 text-[11px] text-gray-500">
            {credito.monto_aportado_nuevo != null ? (
              <span className="flex items-center gap-2 text-emerald-700">
                <span>Monto nuevo aportado: <b className="text-emerald-800">{formatQ(credito.monto_aportado_nuevo)}</b></span>
                <span className="text-emerald-200">|</span>
                <span title={tieneParticipacionPrevia ? "Incluye participación previa" : undefined}>
                  Total: <b className="text-emerald-800">{formatQ(montoTotal)}</b>
                </span>
              </span>
            ) : (
              <span><b className="text-gray-800">{formatQ(credito.monto_aportado)}</b> aportado</span>
            )}
            <span>Cuota: {formatQ(credito.cuota_inversionista)}</span>
            <span>{credito.porcentaje_participacion_inversionista}% part.</span>
            <span>Cash In: {credito.porcentaje_cash_in}%</span>
          </div>
          {credito.otrosInversionistas && credito.otrosInversionistas.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 mt-1 text-[10px] text-gray-400">
              {credito.otrosInversionistas.map((otro: any, idx: any) => (
                <span key={idx}>
                  {otro.nombre}: <b className="text-gray-600">{formatQ(otro.monto_aportado)}</b>
                </span>
              ))}
            </div>
          )}
        </div>

        {isCreditEditing ? (
          <button
            type="button"
            onClick={onCancelEdit}
            className="text-[11px] text-gray-500 hover:text-gray-700 flex items-center gap-1 px-1.5 py-1 rounded hover:bg-gray-100 shrink-0"
          >
            <Undo2 className="w-3 h-3" aria-hidden="true" />Cancelar
          </button>
        ) : !isEditing ? (
          <button
            type="button"
            onClick={() => onStartEdit(credito.id)}
            className="text-[11px] text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1 px-1.5 py-1 rounded hover:bg-red-50 shrink-0"
          >
            <X className="w-3 h-3" />Quitar
          </button>
        ) : null}
      </div>

      {isCreditEditing && (
        <div className="border-t border-amber-200 bg-amber-50/30 px-3 py-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-amber-800">
              <ArrowRight className="w-3 h-3 inline mr-1" aria-hidden="true" />
              Reasignar <b className="tabular-nums">{formatQ(montoAportado)}</b>
            </p>
            {restante > 0.01 && (
              <span className="text-[11px] text-amber-600 font-semibold tabular-nums">
                Pendiente: {formatQ(restante)}
              </span>
            )}
            {isBalanced && (
              <span className="text-[11px] text-green-600 font-semibold flex items-center gap-0.5">
                <Check className="w-3 h-3" aria-hidden="true" />Completo
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            {isLoadingCandidates ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" aria-hidden="true" />
                <p className="text-[11px] text-gray-500">Cargando créditos disponibles&hellip;</p>
              </div>
            ) : destinos.length === 0 ? (
              <p className="text-[11px] text-gray-500 italic">Sin créditos disponibles</p>
            ) : (
              destinos.map((d: any) => {
                const sel = selectedDestinoIds.has(d.id);
                const asignado = distribucion.get(d.id) ?? 0;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => onToggleDestino(d.id)}
                    className={`w-full flex items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-all text-xs focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      sel
                        ? "border-blue-400 bg-blue-50"
                        : "border-gray-200 bg-white hover:border-gray-300"
                    }`}
                  >
                    <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 ${
                      sel ? "bg-blue-600 border-blue-600" : "border-gray-300"
                    }`}>
                      {sel && <Check className="w-2 h-2 text-white" aria-hidden="true" />}
                    </div>
                    <span className="flex-1 min-w-0 truncate text-gray-700">{d.label}</span>
                    <Badge variant="outline" className={`text-[9px] py-0 shrink-0 ${
                      d.tipo === "existente" ? "border-green-200 text-green-700 bg-green-50" : "border-purple-200 text-purple-700 bg-purple-50"
                    }`}>
                      {d.tipo === "existente" ? "Existente" : "Pendiente"}
                    </Badge>
                    {sel && asignado > 0 && (
                      <span className="text-[11px] font-bold text-blue-700 tabular-nums shrink-0">
                        +{formatQ(asignado)}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {selectedDestinoIds.size > 0 && (
            <div className="flex justify-end pt-1">
              <Button
                size="sm"
                onClick={onSave}
                disabled={reemplazarIsPending || !isBalanced}
                className={`gap-1 text-[11px] h-7 text-white ${
                  isBalanced ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-400 cursor-not-allowed"
                }`}
              >
                {reemplazarIsPending
                  ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                  : <Check className="w-3 h-3" aria-hidden="true" />
                }
                Guardar Reasignación
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


function getCashInMonto(oc: OtroCreditoDisponible): number {
  const cube = oc.inversionistas.find((i) => i.es_cube);
  return cube?.monto_aportado ?? 0;
}

function formatTiempoRestante(ms: number | null | undefined): string {
  if (ms == null) return "Sin fecha de vencimiento";
  if (ms <= 0) return "Vencido";

  const totalHours = Math.ceil(ms / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days > 0 && hours > 0) return `Vence en ${days}d ${hours}h`;
  if (days > 0) return `Vence en ${days}d`;
  return `Vence en ${hours}h`;
}

// ============================================
// Construir destinos con capacidad
// ============================================
function buildDestinos(
  candidates: OtroCreditoDisponible[],
): CreditoDestino[] {
  const destinos: CreditoDestino[] = [];

  for (const oc of candidates) {
    const cashInMonto = getCashInMonto(oc);
    destinos.push({
      id: oc.credito_id,
      label: `${oc.numero_credito_sifco || `#${oc.credito_id}`} · ${oc.credito_completo?.usuario?.nombre ?? ""} · Aportado: ${formatQ(cashInMonto)}`,
      capacidad: cashInMonto || oc.capital_activo,
      tipo: "existente",
    });
  }

  return destinos;
}

// ============================================
// Card por inversionista (compacta)
// ============================================
function InvestorCard({
  investor,
  recalculateSession
}: {
  investor: InversionistaSesionPendiente;
  recalculateSession: () => any;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editingCreditId, setEditingCreditId] = useState<number | null>(null);
  const [selectedDestinoIds, setSelectedDestinoIds] = useState<Set<number>>(new Set());
  const [selectedCompraIds, setSelectedCompraIds] = useState<Set<number>>(() =>
    new Set(investor.creditosPendientes
      .filter(c => c.status === "pendiente_compra_cartera" || c.status === "pendiente_revision")
      .map(c => c.credito_id))
  );
  const [selectedReinversionIds, setSelectedReinversionIds] = useState<Set<number>>(() =>
    new Set(investor.creditosPendientes
      .filter(c => c.status === "pendiente_reinversion")
      .map(c => c.credito_id))
  );
  const [idsToCancel, setIdsToCancel] = useState<number[] | null>(null);
  const [cancelLabelOverride, setCancelLabelOverride] = useState<string>("");
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ tipo: AccionTipo; creditos: CreditoEspejoPendiente[]; handler: () => void } | null>(null);
  const reemplazar = useReemplazarInversionistaCredito();
  const completarEspejo = useCompletarEspejo();
  const devolverPendientes = useDevolverPendientesACube();
  const aceptarCompra = useCompraCarteraAceptada();
  const extenderCompra = useExtenderCompraCartera();

  const isEditing = editingCreditId !== null;
  const editingCredit = investor.creditosPendientes.find((c) => c.id === editingCreditId);

  const montoParaCandidatos = editingCredit ? Number(editingCredit.monto_aportado) : null;
  const { data: candidates, isLoading: isLoadingCandidates } = useCreditCandidates(montoParaCandidatos, investor.inversionista_id);

  const destinos = useMemo(() => {
    if (!editingCreditId || !candidates) return [];
    return buildDestinos(candidates);
  }, [editingCreditId, candidates]);

  const montoAportado = editingCredit ? Number(editingCredit.monto_aportado) : 0;

  const distribucion = useMemo(
    () => distribuirMonto(montoAportado, destinos, selectedDestinoIds),
    [montoAportado, destinos, selectedDestinoIds]
  );

  const totalAsignado = useMemo(() => {
    let t = 0;
    for (const m of distribucion.values()) t += m;
    return t;
  }, [distribucion]);

  const restante = montoAportado - totalAsignado;
  const isBalanced = Math.abs(restante) < 0.01;

  const handleStartEdit = useCallback((creditId: number) => {
    setEditingCreditId(creditId);
    setSelectedDestinoIds(new Set());
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingCreditId(null);
    setSelectedDestinoIds(new Set());
  }, []);

  const handleToggleDestino = useCallback((destinoId: number) => {
    setSelectedDestinoIds((prev) => {
      const next = new Set(prev);
      if (next.has(destinoId)) next.delete(destinoId);
      else next.add(destinoId);
      return next;
    });
  }, []);

  const handleSave = useCallback(() => {
    if (!editingCreditId || !isBalanced || !editingCredit) return;

    const tipoOp = editingCredit.status === "pendiente_reinversion"
      ? "reinversion" as const
      : "compra_cartera" as const;

    reemplazar.mutate(
      {
        inversionista_id: investor.inversionista_id,
        credito_espejo_removido_id: editingCredit.credito_id,
        tipo_operacion: tipoOp,
        porcentaje_cash_in: Number(editingCredit.porcentaje_cash_in),
        porcentaje_inversion: Number(editingCredit.porcentaje_participacion_inversionista),
        reasignaciones: Array.from(distribucion.entries()).map(([destId, monto]) => ({
          credito_destino_id: destId,
          monto,
        })),
      },
      {
        onSuccess: () => {
          toast.success("Reasignación guardada correctamente.");
          setEditingCreditId(null);
          setSelectedDestinoIds(new Set());
          recalculateSession();
        },
        onError: (err) => {
          toast.error(err?.message || "Error al guardar la reasignación");
        },
      }
    );
  }, [editingCreditId, isBalanced, editingCredit, distribucion, investor, reemplazar, recalculateSession]);

  const handleConfirmReinversion = useCallback(() => {
    const ids = Array.from(selectedReinversionIds);
    if (ids.length === 0) return;

    completarEspejo.mutate(
      {
        creditos: ids,
        inversionista_id: investor.inversionista_id,
      },
      {
        onSuccess: () => {
          toast.success("Reinversión confirmada correctamente.");
          setSelectedReinversionIds(new Set());
          recalculateSession();
        },
        onError: (err) => {
          toast.error(err?.message || "Error al confirmar la reinversión");
        },
      }
    );
  }, [completarEspejo, selectedReinversionIds, investor.inversionista_id, recalculateSession]);

  const selectedAceptarIds = useMemo(() =>
    investor.creditosPendientes
      .filter(c => selectedCompraIds.has(c.credito_id) && c.status === "pendiente_compra_cartera")
      .map(c => c.credito_id),
    [selectedCompraIds, investor.creditosPendientes]
  );

  const selectedConfirmarIds = useMemo(() =>
    investor.creditosPendientes
      .filter(c => selectedCompraIds.has(c.credito_id) && c.status === "pendiente_revision")
      .map(c => c.credito_id),
    [selectedCompraIds, investor.creditosPendientes]
  );

  const showAceptar = selectedAceptarIds.length > 0;
  const showConfirmar = selectedConfirmarIds.length > 0;

  const allCompraIds = useMemo(() =>
    investor.creditosPendientes
      .filter(c => c.status === "pendiente_compra_cartera" || c.status === "pendiente_revision")
      .map(c => c.credito_id),
    [investor.creditosPendientes]
  );
  const allCompraSelected = allCompraIds.length > 0 && allCompraIds.every(id => selectedCompraIds.has(id));
  const someCompraSelected = allCompraIds.some(id => selectedCompraIds.has(id));

  const handleToggleAllCompra = useCallback(() => {
    if (allCompraSelected) {
      setSelectedCompraIds(new Set());
    } else {
      setSelectedCompraIds(new Set(allCompraIds));
    }
  }, [allCompraSelected, allCompraIds]);

  const handleToggleCompraId = useCallback((creditoId: number) => {
    setSelectedCompraIds(prev => {
      const next = new Set(prev);
      if (next.has(creditoId)) next.delete(creditoId);
      else next.add(creditoId);
      return next;
    });
  }, []);

  const allCompraKey = allCompraIds.join(',');
  useEffect(() => {
    const valid = new Set(allCompraIds);
    setSelectedCompraIds(prev => {
      const pruned = new Set([...prev].filter(id => valid.has(id)));
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [allCompraKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const allReinversionIds = useMemo(() =>
    investor.creditosPendientes
      .filter(c => c.status === "pendiente_reinversion")
      .map(c => c.credito_id),
    [investor.creditosPendientes]
  );
  const allReinversionSelected = allReinversionIds.length > 0 && allReinversionIds.every(id => selectedReinversionIds.has(id));
  const someReinversionSelected = allReinversionIds.some(id => selectedReinversionIds.has(id));

  const handleToggleAllReinversion = useCallback(() => {
    if (allReinversionSelected) {
      setSelectedReinversionIds(new Set());
    } else {
      setSelectedReinversionIds(new Set(allReinversionIds));
    }
  }, [allReinversionSelected, allReinversionIds]);

  const handleToggleReinversionId = useCallback((creditoId: number) => {
    setSelectedReinversionIds(prev => {
      const next = new Set(prev);
      if (next.has(creditoId)) next.delete(creditoId);
      else next.add(creditoId);
      return next;
    });
  }, []);

  const allReinversionKey = allReinversionIds.join(',');
  useEffect(() => {
    const valid = new Set(allReinversionIds);
    setSelectedReinversionIds(prev => {
      const pruned = new Set([...prev].filter(id => valid.has(id)));
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [allReinversionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConfirmCompraCartera = useCallback(() => {
    if (selectedConfirmarIds.length === 0) return;

    completarEspejo.mutate(
      {
        creditos: selectedConfirmarIds,
        inversionista_id: investor.inversionista_id,
      },
      {
        onSuccess: () => {
          toast.success("Compra de cartera confirmada correctamente.");
          setSelectedCompraIds(new Set());
          recalculateSession();
        },
        onError: (err) => {
          toast.error(err?.message || "Error al confirmar la compra de cartera");
        },
      }
    );
  }, [completarEspejo, selectedConfirmarIds, investor.inversionista_id, recalculateSession]);

  const tieneCompraCartera = investor.creditosPendientes.some(
    (c) => c.status === "pendiente_compra_cartera" || c.status === "pendiente_revision"
  );
  const tieneReinversion = investor.creditosPendientes.some(
    (c) => c.status === "pendiente_reinversion"
  );
  const cancelLabel = cancelLabelOverride || (tieneCompraCartera ? "Cancelar Compra Cartera" : "Cancelar Sesión");
  const handleCancelSesion = useCallback(() => {
    const creditoIds = idsToCancel || investor.creditosPendientes.map((c) => c.credito_id);
    if (creditoIds.length === 0) return;

    devolverPendientes.mutate(
      {
        creditos: Array.isArray(creditoIds) && creditoIds.length === 1 ? creditoIds[0] : (creditoIds as number[]),
        inversionista_id: investor.inversionista_id,
      },
      {
        onSuccess: (res) => {
          const count = res.creditos_limpiados?.length ?? (Array.isArray(creditoIds) ? (creditoIds as number[]).length : 1);
          toast.success(res.message || `${count} crédito(s) devueltos a cube.`);
          setConfirmingCancel(false);
          setIdsToCancel(null);
          recalculateSession();
        },
        onError: (err) => {
          toast.error(err?.message || "Error al cancelar la sesión");
        },
      }
    );
  }, [devolverPendientes, investor, idsToCancel, recalculateSession]);


  const handleAceptarCompraCartera = useCallback(() => {
    if (selectedAceptarIds.length === 0) return;

    aceptarCompra.mutate(
      { creditos: selectedAceptarIds },
      {
        onSuccess: (res) => {
          toast.success(res.message || "Compra de cartera aceptada y notificada.");
          setSelectedCompraIds(new Set());
          recalculateSession();
        },
        onError: (err) => {
          toast.error(err?.message || "Error al aceptar la compra de cartera");
        },
      }
    );
  }, [aceptarCompra, selectedAceptarIds, recalculateSession]);

  const compraRevisionCreditos = useMemo(() => {
    return investor.creditosPendientes.filter((c) => c.status === "pendiente_revision");
  }, [investor]);

  const compraTiempoRestanteMs = useMemo(() => {
    const tiempos = compraRevisionCreditos
      .map((c) => c.tiempo_restante_ms)
      .filter((v): v is number => typeof v === "number");
    return tiempos.length > 0 ? Math.min(...tiempos) : null;
  }, [compraRevisionCreditos]);

  const compraYaExtendida = selectedConfirmarIds.length > 0
    && investor.creditosPendientes
        .filter(c => selectedConfirmarIds.includes(c.credito_id))
        .every((c) => Boolean(c.compra_cartera_extendida_at));

  const handleExtenderCompraCartera = useCallback(() => {
    const ids = investor.creditosPendientes
      .filter((c) => selectedConfirmarIds.includes(c.credito_id) && !c.compra_cartera_extendida_at)
      .map((c) => c.credito_id);
    if (ids.length === 0) return;

    extenderCompra.mutate(
      {
        creditos: ids,
        inversionista_id: investor.inversionista_id,
      },
      {
        onSuccess: (res) => {
          toast.success(res.message || "Compra de cartera extendida 24 horas.");
          recalculateSession();
        },
        onError: (err) => {
          toast.error(err?.message || "Error al extender la compra de cartera");
        },
      }
    );
  }, [selectedConfirmarIds, investor.creditosPendientes, extenderCompra, investor.inversionista_id, recalculateSession]);

  const totalCompra = useMemo(() => {
    return investor.creditosPendientes
      .filter(c => c.status === "pendiente_compra_cartera" || c.status === "pendiente_revision")
      .reduce((acc, c) => acc + Number(c.monto_aportado_nuevo ?? c.monto_aportado), 0);
  }, [investor]);

  const totalReinversion = useMemo(() => {
    return investor.creditosPendientes
      .filter(c => c.status === "pendiente_reinversion")
      .reduce((acc, c) => acc + Number(c.monto_aportado_nuevo ?? c.monto_aportado), 0);
  }, [investor]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header compacto */}
      <button
        type="button"
        className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-gray-50/80 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset"
        onClick={() => setExpanded((p) => !p)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
            <User className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-900 truncate">{investor.nombre}</span>
              <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-700 bg-blue-50 shrink-0">
                {investor.creditosPendientes.length}
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-gray-500">
              {investor.dpi && <span className="tabular-nums">DPI: {investor.dpi}</span>}
              {investor.email && (
                <span className="flex items-center gap-0.5">
                  <Mail className="w-2.5 h-2.5" aria-hidden="true" />{investor.email}
                </span>
              )}
              <span className="capitalize">{investor.moneda}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Totales removidos por solicitud del usuario */}
          {expanded
            ? <ChevronUp className="w-4 h-4 text-gray-400" aria-hidden="true" />
            : <ChevronDown className="w-4 h-4 text-gray-400" aria-hidden="true" />
          }
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3">
          {/* Listado agrupado por tipo */}
          <div className="space-y-6">
            {/* GRUPO: COMPRA DE CARTERA */}
            {tieneCompraCartera && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <div className="h-px flex-1 bg-amber-100" />
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={handleToggleAllCompra} className="flex items-center gap-1.5 focus:outline-none group">
                      {allCompraSelected
                        ? <div className="w-3 h-3 rounded-sm border border-amber-500 bg-amber-500 flex items-center justify-center">
                            <Check className="w-2 h-2 text-white stroke-[3]" />
                          </div>
                        : someCompraSelected
                          ? <div className="w-3 h-3 rounded-sm border border-amber-400 bg-amber-100 flex items-center justify-center">
                              <div className="w-1.5 h-px bg-amber-500" />
                            </div>
                          : <div className="w-3 h-3 rounded-sm border border-amber-200 bg-white group-hover:border-amber-400 transition-colors" />
                      }
                      <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Compra de Cartera</span>
                    </button>
                    {compraRevisionCreditos.length > 0 && (
                      <Badge variant="outline" className="gap-1 text-[10px] border-blue-200 text-blue-700 bg-blue-50 font-semibold">
                        <Clock className="w-3 h-3" aria-hidden="true" />
                        {formatTiempoRestante(compraTiempoRestanteMs)}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] border-amber-200 text-amber-700 bg-amber-50 font-bold">
                      {formatQ(totalCompra)}
                    </Badge>
                  </div>
                  <div className="h-px flex-1 bg-amber-100" />
                </div>
                
                <div className="space-y-2">
                  {investor.creditosPendientes
                    .filter(c => c.status === "pendiente_compra_cartera" || c.status === "pendiente_revision")
                    .map((credito) => (
                      <CreditRow
                        key={credito.id}
                        credito={credito}
                        editingCreditId={editingCreditId}
                        isEditing={isEditing}
                        onStartEdit={handleStartEdit}
                        onCancelEdit={handleCancelEdit}
                        distribucion={distribucion}
                        isBalanced={isBalanced}
                        montoAportado={montoAportado}
                        isLoadingCandidates={isLoadingCandidates}
                        destinos={destinos}
                        selectedDestinoIds={selectedDestinoIds}
                        onToggleDestino={handleToggleDestino}
                        onSave={handleSave}
                        reemplazarIsPending={reemplazar.isPending}
                        checked={selectedCompraIds.has(credito.credito_id)}
                        onToggleSelection={handleToggleCompraId}
                      />
                    ))
                  }
                </div>

                {/* Botones de acción para Compra de Cartera */}
                {!isEditing && (
                  <div className="flex justify-end gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const creditos = investor.creditosPendientes.filter(c => selectedCompraIds.has(c.credito_id));
                          if (creditos.length === 0) return;
                          setPendingAction({
                            tipo: "cancelar",
                            creditos,
                            handler: () => {
                              setIdsToCancel(creditos.map(c => c.credito_id));
                              setCancelLabelOverride("Cancelar Compra");
                              setConfirmingCancel(true);
                            },
                          });
                        }}
                        disabled={selectedCompraIds.size === 0 || completarEspejo.isPending || devolverPendientes.isPending || aceptarCompra.isPending || extenderCompra.isPending}
                        className="gap-1 text-[11px] h-7 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 disabled:opacity-50"
                      >
                      <Ban className="w-3 h-3" aria-hidden="true" />
                      Cancelar Compra
                    </Button>
                    {showAceptar && (
                      <Button
                        size="sm"
                        onClick={() => setPendingAction({
                          tipo: "aceptar",
                          creditos: investor.creditosPendientes.filter(c => selectedAceptarIds.includes(c.credito_id)),
                          handler: handleAceptarCompraCartera,
                        })}
                        disabled={aceptarCompra.isPending || completarEspejo.isPending || devolverPendientes.isPending || extenderCompra.isPending}
                        className="gap-1 text-[11px] h-7 bg-amber-500 text-white hover:bg-amber-600 border-none"
                      >
                        {aceptarCompra.isPending
                          ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                          : <Check className="w-3 h-3" aria-hidden="true" />
                        }
                        Aceptar Compra
                      </Button>
                    )}
                    {compraRevisionCreditos.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPendingAction({
                          tipo: "extender",
                          creditos: investor.creditosPendientes.filter(c => selectedConfirmarIds.includes(c.credito_id) && !c.compra_cartera_extendida_at),
                          handler: handleExtenderCompraCartera,
                        })}
                        disabled={selectedConfirmarIds.length === 0 || compraYaExtendida || extenderCompra.isPending || completarEspejo.isPending || devolverPendientes.isPending || aceptarCompra.isPending}
                        className="gap-1 text-[11px] h-7 border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800 disabled:opacity-60"
                      >
                        {extenderCompra.isPending
                          ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                          : <Plus className="w-3 h-3" aria-hidden="true" />
                        }
                        {compraYaExtendida ? "Extendido 24h" : "Extender 24h"}
                      </Button>
                    )}
                    {showConfirmar && (
                      <Button
                        size="sm"
                        onClick={() => setPendingAction({
                          tipo: "confirmar",
                          creditos: investor.creditosPendientes.filter(c => selectedConfirmarIds.includes(c.credito_id)),
                          handler: handleConfirmCompraCartera,
                        })}
                        disabled={completarEspejo.isPending || devolverPendientes.isPending || aceptarCompra.isPending || extenderCompra.isPending}
                        className="gap-1 text-[11px] h-7 bg-amber-600 text-white hover:bg-amber-700"
                      >
                        {completarEspejo.isPending
                          ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                          : <Check className="w-3 h-3" aria-hidden="true" />
                        }
                        Confirmar Compra
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* GRUPO: REINVERSIONES */}
            {tieneReinversion && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <div className="h-px flex-1 bg-blue-100" />
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={handleToggleAllReinversion} className="flex items-center gap-1.5 focus:outline-none group">
                      {allReinversionSelected
                        ? <div className="w-3 h-3 rounded-sm border border-blue-500 bg-blue-500 flex items-center justify-center">
                            <Check className="w-2 h-2 text-white stroke-[3]" />
                          </div>
                        : someReinversionSelected
                          ? <div className="w-3 h-3 rounded-sm border border-blue-400 bg-blue-100 flex items-center justify-center">
                              <div className="w-1.5 h-px bg-blue-500" />
                            </div>
                          : <div className="w-3 h-3 rounded-sm border border-blue-200 bg-white group-hover:border-blue-400 transition-colors" />
                      }
                      <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Reinversiones</span>
                    </button>
                    <Badge variant="outline" className="text-[10px] border-blue-200 text-blue-700 bg-blue-50 font-bold">
                      {formatQ(totalReinversion)}
                    </Badge>
                  </div>
                  <div className="h-px flex-1 bg-blue-100" />
                </div>

                <div className="space-y-2">
                  {investor.creditosPendientes
                    .filter(c => c.status === "pendiente_reinversion")
                    .map((credito) => (
                      <CreditRow
                        key={credito.id}
                        credito={credito}
                        editingCreditId={editingCreditId}
                        isEditing={isEditing}
                        onStartEdit={handleStartEdit}
                        onCancelEdit={handleCancelEdit}
                        distribucion={distribucion}
                        isBalanced={isBalanced}
                        montoAportado={montoAportado}
                        isLoadingCandidates={isLoadingCandidates}
                        destinos={destinos}
                        selectedDestinoIds={selectedDestinoIds}
                        onToggleDestino={handleToggleDestino}
                        onSave={handleSave}
                        reemplazarIsPending={reemplazar.isPending}
                        checked={selectedReinversionIds.has(credito.credito_id)}
                        onToggleSelection={handleToggleReinversionId}
                      />
                    ))
                  }
                </div>

                {/* Botones de acción para Reinversión */}
                {!isEditing && (
                  <div className="flex justify-end gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const creditos = investor.creditosPendientes.filter(c => selectedReinversionIds.has(c.credito_id));
                          if (creditos.length === 0) return;
                          setPendingAction({
                            tipo: "cancelar",
                            creditos,
                            handler: () => {
                              setIdsToCancel(creditos.map(c => c.credito_id));
                              setCancelLabelOverride("Cancelar Reinversión");
                              setConfirmingCancel(true);
                            },
                          });
                        }}
                        disabled={selectedReinversionIds.size === 0 || completarEspejo.isPending || devolverPendientes.isPending || aceptarCompra.isPending}
                        className="gap-1 text-[11px] h-7 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 disabled:opacity-50"
                      >
                        <Ban className="w-3 h-3" aria-hidden="true" />
                        Cancelar Reinversión
                      </Button>
                    <Button
                      size="sm"
                      onClick={() => setPendingAction({
                        tipo: "confirmar_reinversion",
                        creditos: investor.creditosPendientes.filter(c => selectedReinversionIds.has(c.credito_id)),
                        handler: handleConfirmReinversion,
                      })}
                      disabled={completarEspejo.isPending || devolverPendientes.isPending || aceptarCompra.isPending || selectedReinversionIds.size === 0}
                      className="gap-1 text-[11px] h-7 bg-blue-600 text-white hover:bg-blue-700"
                    >
                      {completarEspejo.isPending
                        ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                        : <Check className="w-3 h-3" aria-hidden="true" />
                      }
                      Confirmar Reinversión
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Modal de cancelación (ahora solo el contenido, ya que los botones están arriba) */}
          {confirmingCancel && !isEditing && (
            <div className="pt-4 mt-2 border-t border-gray-100">
              <div className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50/70 px-3 py-2">
                <div className="flex items-start gap-2 min-w-0">
                  <AlertCircle className="w-3.5 h-3.5 text-red-600 mt-0.5 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-red-800">
                      ¿Confirmar {cancelLabel.toLowerCase()}?
                    </p>
                    <p className="text-[10px] text-red-700/80 leading-tight">
                      Se devolverán todos los créditos de este inversionista a cube. Esta acción no se puede deshacer.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setConfirmingCancel(false);
                      setIdsToCancel(null);
                      setCancelLabelOverride("");
                    }}
                    disabled={devolverPendientes.isPending}
                    className="gap-1 text-[11px] h-7 border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  >
                    <Undo2 className="w-3 h-3 text-gray-500" aria-hidden="true" />
                    No
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleCancelSesion}
                    disabled={devolverPendientes.isPending}
                    className="gap-1 text-[11px] h-7 bg-red-600 text-white hover:bg-red-700"
                  >
                    {devolverPendientes.isPending
                      ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                      : <Check className="w-3 h-3" aria-hidden="true" />
                    }
                    Sí, {cancelLabel.toLowerCase()}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <ModalConfirmAccion
        open={!!pendingAction}
        onClose={() => setPendingAction(null)}
        onConfirm={() => { pendingAction?.handler(); setPendingAction(null); }}
        tipo={pendingAction?.tipo ?? "aceptar"}
        creditos={pendingAction?.creditos ?? []}
        isPending={aceptarCompra.isPending || completarEspejo.isPending || devolverPendientes.isPending || extenderCompra.isPending}
      />
    </div>
  );
}
